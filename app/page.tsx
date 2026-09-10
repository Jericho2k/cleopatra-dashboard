'use client'

//after the revert

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import type { Fan, Message, ConversationSummary, FanList } from '../types'
import { warmBackend } from '../lib/api'
import { recoverRealtime, useRealtimeRecovery } from '../lib/realtime-recovery'
import { capRetainedMessages, dedupeMessages } from '../lib/messages'
import {
  conversationsAreStale,
  mergeConversationSummaries,
} from '../lib/conversations'
import { isFanslyList } from '../lib/fanLists'
import Sidebar from '../components/Sidebar'
import ConversationView from '../components/ConversationView'
import FanPanel from '../components/FanPanel'

type Tab = {
  id: string
  creatorId: string
  creatorName: string
  activeFan: Fan | null
  messages: Message[]
  conversations: ConversationSummary[]
  messagesLoading: boolean
  unreadCounts: Record<string, number>
  pendingMessage: string
  autoMode: boolean
  hasMoreMessages: boolean
  oldestMessageTime: string | null
}

const ACTIVE_CHAT_SYNC_TIMEOUT_MS = 15_000

// API-002 - this used to be a 45-second heartbeat (3 minutes when idle), and
// every tick made a real API Fansly list_chat_messages call through the
// backend: ~80 provider calls an hour per open browser tab, ~2,000 an hour
// across 25 operators, duplicating the webhook, the backend's own 5-30 minute
// reconciliation, and Supabase realtime.
//
// Deleting the poll outright would have been wrong. It was compensating for
// real gaps: a dropped realtime socket, a webhook that had not landed yet,
// attachment enrichment that arrives after the message row. So it is kept as
// RECOVERY rather than as a heartbeat, and it runs when there is a reason to
// think we missed something:
//
//   * the conversation was just opened;
//   * realtime reconnected after dropping (useRealtimeRecovery);
//   * the tab became visible again after being hidden;
//   * the backend told us a chat binding is still pending;
//   * and a slow safety interval underneath all of that.
//
// Correctness is not traded away here: realtime plus the webhook plus the
// backend reconciler all still deliver messages. This is the belt on top.
const ACTIVE_CHAT_SAFETY_INTERVAL_MS = 15 * 60_000
// However many reasons fire at once, one fan is reconciled at most this often.
// Flicking between tabs must not turn into provider traffic.
const ACTIVE_CHAT_MIN_INTERVAL_MS = 60_000
const ACTIVE_CHAT_BINDING_RETRY_MS = 15 * 60_000

async function syncActiveFanMessages(creatorId: string, fanId: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    ACTIVE_CHAT_SYNC_TIMEOUT_MS,
  )
  try {
    const response = await apiFetch(`/sync-fan-messages/${creatorId}/${fanId}`, {
      method: 'POST',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 409) {
        return {
          status: 'binding_unavailable',
          retry_after_seconds: ACTIVE_CHAT_BINDING_RETRY_MS / 1000,
        }
      }
      throw new Error(body.detail || `Chat refresh failed (${response.status})`)
    }
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Chat refresh timed out. Please try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

//Latest adjustment
function rowToFan(row: Record<string, unknown>): Fan {
  return {
    id: (row.fan_id ?? row.id) as string,
    display_name: row.display_name as string,
    total_spent: Number(row.total_spent ?? 0),
    spend_tier: (row.spend_tier as Fan['spend_tier']) ?? 'cold',
    last_active: (row.last_active as string) ?? null,
    preferences: Array.isArray(row.preferences) ? (row.preferences as string[]) : [],
    notes: (row.notes as string) ?? '',
    member_note: (row.member_note as string) ?? '',
    model_note: (row.model_note as string) ?? '',
    age: (row.age as string) ?? '',
    payday: (row.payday as string) ?? '',
    hobbies: (row.hobbies as string) ?? '',
    relationship_status: (row.relationship_status as string) ?? '',
    auto_mode: row.auto_mode === undefined || row.auto_mode === null
      ? null
      : Boolean(row.auto_mode),
    ai_summary: row.ai_summary ?? null,
  }
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    fansly_message_id: (row.fansly_message_id as string) ?? null,
    fan_id: row.fan_id as string,
    creator_id: row.creator_id as string,
    role: row.role as Message['role'],
    content: row.content as string,
    sent_at: row.sent_at as string,
    was_ai_suggested: Boolean(row.was_ai_suggested),
    was_selected: Boolean(row.was_selected),
    media_context: (row.media_context as any) ?? null,
  }
}

export default function Page() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [creators, setCreators] = useState<{id: string, name: string}[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [showNewTabDropdown, setShowNewTabDropdown] = useState(false)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [fanLists, setFanLists] = useState<FanList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [syncingChats, setSyncingChats] = useState(false)
  const [conversationsLoading, setConversationsLoading] = useState(false)

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

  const recoveryTick = useRealtimeRecovery()

  const activeTabIdRef = useRef(activeTabId)
  const tabsRef = useRef<Tab[]>([])
  const fanListsRef = useRef<FanList[]>([])
  const creatorsRef = useRef<{id: string, name: string}[]>([])
  const conversationsCache = useRef<Record<string, ConversationSummary[]>>({})
  // When each creator's conversation list was last read, and a monotonically
  // increasing id so a slow response for one creator cannot be applied to
  // another's tab (FE-005).
  const conversationsFetchedAt = useRef<Record<string, number>>({})
  const conversationsRequestRef = useRef(0)
  // When each open conversation last reconciled against API Fansly, so several
  // reasons firing at once still cost at most one provider call (API-002).
  const lastChatReconcileAt = useRef<Record<string, number>>({})
  const messagesCache = useRef<Record<string, Message[]>>({})
  const messagesPaginationCache = useRef<Record<string, { hasMoreMessages: boolean; oldestMessageTime: string | null }>>({})
  // FE-001 - fans whose history the operator has deliberately scrolled back
  // into. Their threads are never trimmed: the retained-message bound exists to
  // stop a tab left open on a busy fan growing on its own, not to throw away
  // history somebody just asked for. Cleared when the thread is reloaded.
  const expandedHistoryFans = useRef<Set<string>>(new Set())
  useEffect(() => {
    warmBackend()
  }, [])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    fanListsRef.current = fanLists
  }, [fanLists])

  useEffect(() => {
    creatorsRef.current = creators
  }, [creators])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t))
  }, [])

  const openTab = (creatorId: string, creatorName: string) => {
    const existing = tabs.find(t => t.creatorId === creatorId)
    if (existing) { setActiveTabId(existing.id); return }
    const newTab: Tab = {
      id: `tab-${Date.now()}`,
      creatorId,
      creatorName,
      activeFan: null,
      messages: [],
      conversations: [],
      messagesLoading: false,
      unreadCounts: {},
      pendingMessage: '',
      autoMode: false,
      hasMoreMessages: false,
      oldestMessageTime: null,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const toggleAutoMode = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab) return
    const next = !tab.autoMode
    const response = await apiFetch(`/creator/${tab.creatorId}/auto-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(body.detail || 'Could not update creator auto mode.')
      return
    }
    updateTab(tabId, { autoMode: Boolean(body.auto_mode) })
  }, [updateTab])

  const toggleFanAutoMode = useCallback(async (tabId: string, fanId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab) return

    const { data: fanData } = await supabase
      .from('fans')
      .select('auto_mode')
      .eq('id', fanId)
      .single()

    const current = fanData?.auto_mode
    const next = current === null || current === undefined
      ? true
      : current === true
        ? false
        : null

    const response = await apiFetch(`/fan/${fanId}/auto-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_mode: next }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body.detail || 'Could not update fan auto mode.')
    }
    const savedMode = body.auto_mode as boolean | null

    updateTab(tabId, {
      conversations: tab.conversations.map(c =>
        c.fan.id === fanId ? { ...c, fan: { ...c.fan, auto_mode: savedMode } } : c
      ),
      activeFan: tab.activeFan?.id === fanId
        ? { ...tab.activeFan, auto_mode: savedMode }
        : tab.activeFan,
    })
  }, [updateTab])

  const closeTab = (tabId: string) => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId)
      if (activeTabId === tabId && remaining.length > 0) {
        setActiveTabId(remaining[remaining.length - 1].id)
      }
      return remaining
    })
  }

  const loadCreators = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data } = await supabase
      .from('chatter_creators')
      .select('creator_id, creators(id, platform_username, auto_mode)')
      .eq('chatter_id', user.id)
    const list = (data ?? []).map((r: any) => ({
      id: r.creator_id,
      name: r.creators?.platform_username ?? r.creator_id,
      autoMode: r.creators?.auto_mode ?? false,
    }))
    setCreators(list.map(({ id, name }) => ({ id, name })))
    return list
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user || !alive) { setAuthLoading(false); return }

      const { data } = await supabase
        .from('chatter_creators')
        .select('creator_id, creators(id, platform_username, auto_mode)')
        .eq('chatter_id', user.id)

      const list = (data ?? []).map((r: any) => ({
        id: r.creator_id,
        name: r.creators?.platform_username ?? r.creator_id,
        autoMode: r.creators?.auto_mode ?? false,
      }))
      setCreators(list.map(({ id, name }) => ({ id, name })))

      if (!alive || list.length === 0) { setAuthLoading(false); return }

      const first = list[0]
      const tabId = `tab-${Date.now()}`
      const baseTab: Tab = {
        id: tabId,
        creatorId: first.id,
        creatorName: first.name,
        activeFan: null,
        messages: [],
        conversations: [],
        messagesLoading: false,
        unreadCounts: {},
        pendingMessage: '',
        autoMode: first.autoMode,
        hasMoreMessages: false,
        oldestMessageTime: null,
      }

      // Fan conversations are deliberately memory-only. Persisting them in
      // browser storage could expose one agency account's chat data after a
      // different operator signs into the same browser profile.
      setTabs([baseTab])
      setActiveTabId(tabId)

      setConversationsLoading(true)
      try {
        const [conversationsResult, fanListsResult] = await Promise.all([
          supabase
            .from('fan_conversation_summaries')
            .select('*')
            .eq('creator_id', first.id)
            .order('last_message_time', { ascending: false, nullsFirst: false }),
          supabase
            .from('fan_lists')
            .select('*, fan_list_members(fan_id)')
            .eq('creator_id', first.id),
        ])

        if (!alive) return

        const conversations: ConversationSummary[] = (conversationsResult.data ?? []).map((row: any) => ({
          fan: rowToFan(row),
          last_message: row.last_message ?? '',
          last_message_time: row.last_message_time ?? new Date(0).toISOString(),
          unread: false,
          unread_count: 0,
        }))

        conversationsCache.current[first.id] = conversations
        setFanLists((fanListsResult.data ?? []).map((l: any) => ({
          ...l,
          member_fan_ids: (l.fan_list_members ?? []).map((m: any) => m.fan_id),
        })))

        setTabs([{ ...baseTab, conversations }])
        setActiveTabId(tabId)
      } finally {
        if (alive) {
          setConversationsLoading(false)
          setAuthLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [])

  const loadFanLists = useCallback(async (creatorId: string) => {
    const { data: lists } = await supabase
      .from('fan_lists')
      .select('*, fan_list_members(fan_id)')
      .eq('creator_id', creatorId)
    setFanLists((lists ?? []).map((l: any) => ({
      ...l,
      member_fan_ids: (l.fan_list_members ?? []).map((m: any) => m.fan_id),
    })))
  }, [])

  useEffect(() => {
    const handler = async () => {
      const list = await loadCreators()
      list.forEach((c: any) => {
        if (!tabs.some(t => t.creatorId === c.id)) {
          // Don't auto-open, just make available in dropdown
        }
      })
    }
    window.addEventListener('creator-added', handler)
    return () => window.removeEventListener('creator-added', handler)
  }, [loadCreators, tabs])

  const createList = useCallback(async (name: string, color: string, excludeFromAuto: boolean) => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    if (!tab) return
    const { data } = await supabase.from('fan_lists').insert({
      creator_id: tab.creatorId,
      name,
      color,
      exclude_from_auto: excludeFromAuto,
    }).select().single()
    if (data) setFanLists(prev => [...prev, { ...data, member_fan_ids: [] }])
  }, [])

  const updateList = useCallback(async (listId: string, name: string, color: string, excludeFromAuto: boolean) => {
    const list = fanListsRef.current.find(l => l.id === listId)
    // A Fansly mirror's name belongs to Fansly and the next sync would restore
    // it anyway. Color and the auto-mode exclusion are Cleopatra's own.
    const patch = isFanslyList(list ?? { id: listId, name })
      ? { color, exclude_from_auto: excludeFromAuto }
      : { name, color, exclude_from_auto: excludeFromAuto }
    await supabase.from('fan_lists').update(patch).eq('id', listId)
    setFanLists(prev => prev.map(l => l.id === listId ? { ...l, ...patch } : l))
  }, [])

  const deleteList = useCallback(async (listId: string) => {
    const list = fanListsRef.current.find(l => l.id === listId)
    // Cleopatra does not own a Fansly list. The UI hides Delete for mirrors;
    // this is the guard behind it.
    if (list && isFanslyList(list)) return
    await supabase.from('fan_lists').delete().eq('id', listId)
    setFanLists(prev => prev.filter(l => l.id !== listId))
    setActiveListId(current => (current === listId ? null : current))
  }, [])

  const addFanToList = useCallback(async (fanId: string, listId: string) => {
    await supabase.from('fan_list_members').upsert({ list_id: listId, fan_id: fanId })
    setFanLists(prev => prev.map(l =>
      l.id === listId && !l.member_fan_ids.includes(fanId)
        ? { ...l, member_fan_ids: [...l.member_fan_ids, fanId] }
        : l
    ))
  }, [])

  const removeFanFromList = useCallback(async (fanId: string, listId: string) => {
    await supabase.from('fan_list_members').delete().eq('fan_id', fanId).eq('list_id', listId)
    setFanLists(prev => prev.map(l =>
      l.id === listId ? { ...l, member_fan_ids: l.member_fan_ids.filter(id => id !== fanId) } : l
    ))
  }, [])

  // FE-005 - a tab for a creator other than the active one receives no realtime
  // events, because the channel is filtered to one creator_id. So switching
  // back has to catch that tab up: the cached list is shown immediately, and a
  // fresh read replaces it when it lands.
  //
  // The load is guarded by a request id. Switching creators quickly used to be
  // able to apply creator A's response to creator B's tab.
  useEffect(() => {
    if (!activeTab) return
    const creatorId = activeTab.creatorId
    const tabId = activeTab.id

    const cached = conversationsCache.current[creatorId]
    const hasSomethingToShow = activeTab.conversations.length > 0 || (cached?.length ?? 0) > 0
    if (cached && cached.length > 0 && activeTab.conversations.length === 0) {
      updateTab(tabId, { conversations: cached })
    }

    if (
      hasSomethingToShow
      && !conversationsAreStale(conversationsFetchedAt.current[creatorId])
    ) {
      return
    }

    const request = ++conversationsRequestRef.current
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('fan_conversation_summaries')
        .select('*')
        .eq('creator_id', creatorId)
        .order('last_message_time', { ascending: false, nullsFirst: false })

      if (cancelled || request !== conversationsRequestRef.current) return

      const summaries: ConversationSummary[] = (data ?? []).map((row: any) => ({
        fan: rowToFan(row),
        last_message: row.last_message ?? '',
        last_message_time: row.last_message_time ?? new Date(0).toISOString(),
        unread: false,
        unread_count: 0,
      }))

      const tab = tabsRef.current.find(candidate => candidate.id === tabId)
      const merged = mergeConversationSummaries(
        tab?.conversations.length ? tab.conversations : (cached ?? []),
        summaries,
        tab?.activeFan?.id ?? null,
      )

      conversationsCache.current[creatorId] = merged
      conversationsFetchedAt.current[creatorId] = Date.now()
      updateTab(tabId, { conversations: merged })
    }
    void load()
    return () => { cancelled = true }
  }, [activeTabId, activeTab?.conversations.length, activeTab?.creatorId, updateTab])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ creatorId?: string }>
      const creatorId = ce.detail?.creatorId ?? activeTab?.creatorId
      if (creatorId) {
        delete conversationsCache.current[creatorId]
        delete conversationsFetchedAt.current[creatorId]
      }
      setTabs(prev => prev.map(tab => {
        if (tab.creatorId !== creatorId) return tab
        return { ...tab, conversations: [] }
      }))
    }
    window.addEventListener('chats-synced', handler)
    return () => window.removeEventListener('chats-synced', handler)
  }, [activeTab?.creatorId])

  useEffect(() => {
    if (!activeTab?.activeFan) return
    const fanId = activeTab.activeFan.id

    if (messagesCache.current[fanId] !== undefined) {
      const cached = messagesCache.current[fanId]
      const pag = messagesPaginationCache.current[fanId]
      updateTab(activeTab.id, {
        messages: cached,
        messagesLoading: false,
        hasMoreMessages: pag?.hasMoreMessages ?? ((cached?.length ?? 0) >= 50),
        oldestMessageTime: pag?.oldestMessageTime ?? cached[0]?.sent_at ?? null,
      })
      return
    }

    updateTab(activeTab.id, { messagesLoading: true })
    supabase
      .from('messages')
      .select('*')
      .eq('fan_id', fanId)
      .eq('creator_id', activeTab.creatorId)
      .order('sent_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) {
          console.error('[messages] fetch error:', error)
          updateTab(activeTab.id, { messagesLoading: false })
          return
        }
        const msgs = dedupeMessages((data ?? []).reverse().map(rowToMessage))
        messagesCache.current[fanId] = msgs
        const hasMore = (data ?? []).length === 50
        const oldest = msgs[0]?.sent_at ?? null
        messagesPaginationCache.current[fanId] = { hasMoreMessages: hasMore, oldestMessageTime: oldest }
        updateTab(activeTab.id, {
          messages: msgs,
          messagesLoading: false,
          hasMoreMessages: hasMore,
          oldestMessageTime: oldest,
        })
      })
  }, [activeTab?.activeFan?.id, activeTabId])

  const loadMoreMessages = useCallback(async () => {
    const tabId = activeTabIdRef.current
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab?.activeFan || !tab.hasMoreMessages || !tab.oldestMessageTime) return

    const fanId = tab.activeFan.id

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('fan_id', fanId)
      .eq('creator_id', tab.creatorId)
      .order('sent_at', { ascending: false })
      .lt('sent_at', tab.oldestMessageTime)
      .limit(50)

    if (error || !data) return

    // Deliberate operator action: keep every message it returns, and remember
    // that this thread must not be trimmed behind their back.
    expandedHistoryFans.current.add(fanId)
    const olderMsgs = data.reverse().map(rowToMessage)
    const combined = dedupeMessages([...olderMsgs, ...tab.messages])

    messagesCache.current[fanId] = combined
    const hasMore = data.length === 50
    const oldest = olderMsgs[0]?.sent_at ?? tab.oldestMessageTime
    messagesPaginationCache.current[fanId] = { hasMoreMessages: hasMore, oldestMessageTime: oldest }
    updateTab(tab.id, {
      messages: combined,
      hasMoreMessages: hasMore,
      oldestMessageTime: oldest,
    })
  }, [updateTab])

  // Stable handlers for the memoized chat panels. They read live state from refs
  // instead of closing over activeTab/tabs, so their identity never changes and
  // ConversationView / FanPanel can skip re-rendering on unrelated realtime events.
  //
  // FE-004 - the Sidebar's handlers now follow the same pattern. It was passed
  // five inline arrows, so wrapping it in React.memo would have achieved
  // nothing: a new function identity on every render defeats the comparison.
  const handleSelectFan = useCallback((fan: Fan) => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    if (!tab) return
    updateTab(tab.id, {
      activeFan: fan,
      conversations: tab.conversations.map(c =>
        c.fan.id === fan.id ? { ...c, unread: false, unread_count: 0 } : c
      ),
    })
  }, [updateTab])

  const handleCreatorChange = useCallback((id: string) => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    const creator = creatorsRef.current.find(c => c.id === id)
    if (!creator || !tab) return
    updateTab(tab.id, {
      creatorId: id,
      creatorName: creator.name,
      activeFan: null,
      messages: [],
      conversations: [],
      hasMoreMessages: false,
      oldestMessageTime: null,
    })
    void loadFanLists(id)
  }, [loadFanLists, updateTab])

  const handleToggleAutoMode = useCallback(() => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    if (tab) void toggleAutoMode(tab.id)
  }, [toggleAutoMode])

  const handleSyncChats = useCallback(async () => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    if (!tab) return
    setSyncingChats(true)
    try {
      const res = await apiFetch(
        `/sync-chats/${tab.creatorId}?incremental=true&force=true`,
        { method: 'POST' },
      )
      await res.json()
      delete conversationsCache.current[tab.creatorId]
      delete conversationsFetchedAt.current[tab.creatorId]
      updateTab(tab.id, { conversations: [] })
    } finally {
      setSyncingChats(false)
    }
  }, [updateTab])

  const handleMarkAllRead = useCallback(async () => {
    const tab = tabsRef.current.find(candidate => candidate.id === activeTabIdRef.current)
    if (!tab) return
    await apiFetch(`/mark-all-read/${tab.creatorId}`, { method: 'POST' })
    updateTab(tab.id, {
      conversations: tab.conversations.map(c => ({ ...c, unread: false, unread_count: 0 })),
      unreadCounts: {},
    })
  }, [updateTab])

  const handleReplySent = useCallback((content: string, messageId: string) => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (!tab?.activeFan) return
    const newMsg: Message = {
      id: messageId,
      fan_id: tab.activeFan.id,
      creator_id: tab.creatorId,
      role: 'creator',
      content,
      sent_at: new Date().toISOString(),
      was_ai_suggested: false,
      was_selected: false,
    }
    const nextMessages = dedupeMessages([...tab.messages, newMsg])
    messagesCache.current[tab.activeFan.id] = nextMessages
    updateTab(tab.id, { messages: nextMessages })
  }, [updateTab])

  const handleClearPending = useCallback(() => {
    const tabId = activeTabIdRef.current
    if (tabId) updateTab(tabId, { pendingMessage: '' })
  }, [updateTab])

  const handleToggleFanAuto = useCallback(async () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (tab?.activeFan) {
      await toggleFanAutoMode(tab.id, tab.activeFan.id)
    }
  }, [toggleFanAutoMode])

  const handleHistoryLoaded = useCallback(async () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (!tab?.activeFan) return

    const fanId = tab.activeFan.id
    updateTab(tab.id, { messagesLoading: true })
    delete messagesCache.current[fanId]
    delete messagesPaginationCache.current[fanId]
    // Back to the 50-message window, so the thread is trimmable again.
    expandedHistoryFans.current.delete(fanId)

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('fan_id', fanId)
      .eq('creator_id', tab.creatorId)
      .order('sent_at', { ascending: false })
      .limit(50)
    if (error) {
      updateTab(tab.id, { messagesLoading: false })
      throw new Error(error.message || 'Could not reload this conversation.')
    }
    if (data) {
      const msgs = dedupeMessages(data.reverse().map(rowToMessage))
      messagesCache.current[fanId] = msgs
      const hasMore = data.length === 50
      const oldest = msgs[0]?.sent_at ?? null
      messagesPaginationCache.current[fanId] = { hasMoreMessages: hasMore, oldestMessageTime: oldest }
      updateTab(tab.id, {
        messages: msgs,
        messagesLoading: false,
        hasMoreMessages: hasMore,
        oldestMessageTime: oldest,
      })
    } else {
      updateTab(tab.id, { messagesLoading: false })
    }
  }, [updateTab])

  useEffect(() => {
    const creatorId = activeTab?.creatorId
    const fanId = activeTab?.activeFan?.id
    if (!creatorId || !fanId) return

    let cancelled = false
    let inFlight = false
    let timer: number | undefined

    const scheduleSafetyCheck = (delay: number = ACTIVE_CHAT_SAFETY_INTERVAL_MS) => {
      if (cancelled) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => void reconcile('safety-interval'), delay)
    }

    const reconcile = async (_reason: string) => {
      if (cancelled || inFlight) return
      if (document.visibilityState !== 'visible') {
        // A hidden tab has no operator watching it and the backend reconciler
        // covers the account anyway, so it makes no provider calls at all.
        scheduleSafetyCheck()
        return
      }

      const key = `${creatorId}:${fanId}`
      const since = Date.now() - (lastChatReconcileAt.current[key] ?? 0)
      if (since < ACTIVE_CHAT_MIN_INTERVAL_MS) {
        scheduleSafetyCheck(ACTIVE_CHAT_MIN_INTERVAL_MS - since)
        return
      }

      inFlight = true
      lastChatReconcileAt.current[key] = Date.now()
      let nextDelay = ACTIVE_CHAT_SAFETY_INTERVAL_MS
      try {
        const body = await syncActiveFanMessages(creatorId, fanId)
        const retrySeconds = Number(body.retry_after_seconds ?? 0)
        if (
          (body.status === 'binding_pending' || body.status === 'binding_unavailable')
          && retrySeconds > 0
        ) {
          // A known inconsistency: the chat is not bound yet, so come back for
          // it rather than waiting out the full safety interval.
          nextDelay = Math.min(nextDelay, Math.max(retrySeconds * 1000, ACTIVE_CHAT_MIN_INTERVAL_MS))
        }
        const changed = Number(body.imported ?? 0) + Number(body.media_updated ?? 0)
        if (changed > 0 && !cancelled) {
          await handleHistoryLoaded()
        }
      } catch {
        // Realtime, the webhook and the backend reconciler all remain; do not
        // hammer a failing upstream chat endpoint.
        nextDelay = ACTIVE_CHAT_SAFETY_INTERVAL_MS
      } finally {
        inFlight = false
        scheduleSafetyCheck(nextDelay)
      }
    }

    // Opening a conversation is the one moment an operator most wants to know
    // nothing is missing.
    void reconcile('conversation-opened')

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void reconcile('tab-visible')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeTab?.creatorId, activeTab?.activeFan?.id, handleHistoryLoaded])

  useEffect(() => {
    if (!activeTab?.creatorId) return
    const cid = activeTab.creatorId
    const channel = supabase
      .channel('messages-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `creator_id=eq.${cid}`,
      }, (payload) => {
        const msg = rowToMessage(payload.new as Record<string, unknown>)

        setTabs(prev => {
          const next = prev.map(tab => {
            if (tab.creatorId !== msg.creator_id) return tab
            const isActiveTab = tab.id === activeTabIdRef.current
            const isActiveFan = tab.activeFan?.id === msg.fan_id

            // A realtime message arrives on its own, so this is where the
            // retained-history bound applies - unless the operator has scrolled
            // back into this thread, in which case trimming would delete what
            // they are reading.
            const trim = (rows: Message[]) =>
              expandedHistoryFans.current.has(msg.fan_id)
                ? rows
                : capRetainedMessages(rows)

            const currentCached = messagesCache.current[msg.fan_id]
            if (currentCached !== undefined) {
              messagesCache.current[msg.fan_id] = trim(
                dedupeMessages([...currentCached, msg]),
              )
            }
            const mergedMessages = isActiveTab && isActiveFan
              ? trim(dedupeMessages([...tab.messages, msg]))
              : tab.messages
            if (
              isActiveTab
              && isActiveFan
              && mergedMessages.length === tab.messages.length
            ) {
              return { ...tab, messages: mergedMessages }
            }

            const currentConversation = tab.conversations.find(c => c.fan.id === msg.fan_id)
            const updatedConversations = currentConversation
              ? [{
                  ...currentConversation,
                  last_message: msg.content,
                  last_message_time: msg.sent_at,
                  unread: !isActiveFan,
                  unread_count: isActiveFan ? 0 : (currentConversation.unread_count ?? 0) + 1,
                }, ...tab.conversations.filter(c => c.fan.id !== msg.fan_id)]
              : tab.conversations

            return {
              ...tab,
              messages: mergedMessages,
              conversations: updatedConversations,
            }
          })
          return next
        })
      })

    channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `creator_id=eq.${cid}`,
      }, (payload) => {
        const msg = rowToMessage(payload.new as Record<string, unknown>)
        const cached = messagesCache.current[msg.fan_id]
        if (cached) {
          messagesCache.current[msg.fan_id] = cached.map(existing =>
            existing.id === msg.id ? msg : existing
          )
        }
        setTabs(prev => prev.map(tab => {
          if (tab.creatorId !== msg.creator_id) return tab
          return {
            ...tab,
            messages: tab.messages.map(existing =>
              existing.id === msg.id ? msg : existing
            ),
          }
        }))
      })

    channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'fans',
        filter: `creator_id=eq.${cid}`,
      }, async (payload) => {
        const row = payload.new as Record<string, unknown>
        const newFan = rowToFan(row)
        const fanCreatorId = row.creator_id as string
        setTabs(prev => prev.map(tab => {
          if (tab.creatorId !== fanCreatorId) return tab
          const exists = tab.conversations.some(c => c.fan.id === newFan.id)
          if (exists) return tab
          return {
            ...tab,
            conversations: [{
              fan: newFan,
              last_message: '',
              last_message_time: new Date().toISOString(),
              unread: true,
              unread_count: 1,
            }, ...tab.conversations],
          }
        }))
      })
    channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'fans',
        filter: `creator_id=eq.${cid}`,
      }, (payload) => {
        const row = payload.new as Record<string, unknown>
        const updatedFan = rowToFan(row)
        const fanCreatorId = row.creator_id as string
        setTabs(prev => prev.map(tab => {
          if (tab.creatorId !== fanCreatorId) return tab
          return {
            ...tab,
            activeFan: tab.activeFan?.id === updatedFan.id ? updatedFan : tab.activeFan,
            conversations: tab.conversations.map(c =>
              c.fan.id === updatedFan.id ? { ...c, fan: updatedFan } : c
            ),
          }
        }))
      })

    let disposed = false
    channel.subscribe((status) => {
      if (!disposed && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
        void recoverRealtime()
      }
    })
    return () => {
      disposed = true
      supabase.removeChannel(channel)
    }
  }, [activeTab?.creatorId, recoveryTick])

  // After a realtime reconnect (tab refocus / network restored), the socket only
  // delivers messages from the resubscribe point onward — anything that landed
  // while it was dead is missed. Catch the open thread up by appending messages
  // newer than the last one currently loaded (preserves pagination + scroll, no
  // dupes). The conversation list keeps itself current via the resubscribed
  // messages-realtime channel going forward.
  useEffect(() => {
    if (recoveryTick === 0) return
    // Nothing that arrived while the socket was down reached ANY open tab, so
    // every creator's cached conversation list is suspect, not just this one's
    // (FE-005). Clearing the freshness stamps makes the next switch catch up.
    conversationsFetchedAt.current = {}

    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    const fanId = tab?.activeFan?.id
    if (!tab || !fanId) return
    const creatorId = tab.creatorId
    const newestLoaded = tab.messages[tab.messages.length - 1]?.sent_at ?? null

    let cancelled = false

    // API-002 - a reconnect is the clearest signal that something may have been
    // missed, so this is where an API Fansly reconciliation genuinely belongs.
    // The socket only delivers from the resubscribe point onward, so anything
    // that landed while it was dead is invisible to Supabase too; asking the
    // platform is the only way to be sure. Rate limiting inside the reconciler
    // keeps a flapping connection from turning into provider traffic.
    void (async () => {
      const key = `${creatorId}:${fanId}`
      const since = Date.now() - (lastChatReconcileAt.current[key] ?? 0)
      if (since < ACTIVE_CHAT_MIN_INTERVAL_MS) return
      lastChatReconcileAt.current[key] = Date.now()
      try {
        const body = await syncActiveFanMessages(creatorId, fanId)
        const changed = Number(body.imported ?? 0) + Number(body.media_updated ?? 0)
        if (changed > 0 && !cancelled) await handleHistoryLoaded()
      } catch {
        // The catch-up read below still runs; realtime is resubscribed either
        // way.
      }
    })()

    ;(async () => {
      let query = supabase
        .from('messages')
        .select('*')
        .eq('fan_id', fanId)
        .eq('creator_id', creatorId)
        .order('sent_at', { ascending: true })
      if (newestLoaded) query = query.gt('sent_at', newestLoaded)
      const { data, error } = await query.limit(200)
      if (cancelled || error || !data || data.length === 0) return

      setTabs(prev => prev.map(t => {
        if (t.id !== activeTabIdRef.current || t.activeFan?.id !== fanId) return t
        const have = new Set(t.messages.map(m => m.id))
        const missed = data.map(rowToMessage).filter(m => !have.has(m.id))
        if (missed.length === 0) return t
        const combined = expandedHistoryFans.current.has(fanId)
          ? dedupeMessages([...t.messages, ...missed])
          : capRetainedMessages(dedupeMessages([...t.messages, ...missed]))
        messagesCache.current[fanId] = combined
        return { ...t, messages: combined }
      }))
    })()
    return () => { cancelled = true }
  }, [handleHistoryLoaded, recoveryTick])

  if (authLoading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      {/* Tabs bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 8px',
        height: 40,
        flexShrink: 0,
        gap: 2,
        position: 'relative',
      }}>
        {tabs.map((tab) => {
          const totalUnread = Object.values(tab.unreadCounts).reduce((a, b) => a + b, 0)
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => {
                setDraggedTabId(tab.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (!draggedTabId || draggedTabId === tab.id) return
                setTabs(prev => {
                  const from = prev.findIndex(t => t.id === draggedTabId)
                  const to = prev.findIndex(t => t.id === tab.id)
                  const reordered = [...prev]
                  const [moved] = reordered.splice(from, 1)
                  reordered.splice(to, 0, moved)
                  return reordered
                })
                setDraggedTabId(null)
              }}
              onDragEnd={() => setDraggedTabId(null)}
              onClick={() => setActiveTabId(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 10px',
                height: 32,
                borderRadius: 6,
                cursor: 'grab',
                background: tab.id === activeTabId ? 'var(--bg-elevated)' : 'transparent',
                border: tab.id === activeTabId ? '1px solid var(--border)' : '1px solid transparent',
                fontSize: 12,
                color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-muted)',
                flexShrink: 0,
                opacity: draggedTabId === tab.id ? 0.4 : 1,
                transition: 'opacity 0.15s ease, background 0.15s ease',
                userSelect: 'none',
              }}
            >
              <span>{tab.creatorName}</span>
              {tab.autoMode && (
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 999,
                  background: 'rgba(76,175,130,0.2)', color: 'var(--green)',
                  border: '1px solid rgba(76,175,130,0.4)',
                  animation: 'pulse 2s infinite',
                  letterSpacing: '0.05em',
                }}>
                  ● AUTO
                </span>
              )}
              {tab.activeFan && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {tab.activeFan.display_name}</span>
              )}
              {tab.id !== activeTabId && totalUnread > 0 && (
                <span style={{
                  background: 'var(--green)',
                  color: '#000',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 5px',
                  minWidth: 16,
                  textAlign: 'center',
                }}>
                  {totalUnread}
                </span>
              )}
              {tabs.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  style={{
                    marginLeft: 2,
                    color: 'var(--text-faint)',
                    fontSize: 15,
                    lineHeight: 1,
                    cursor: 'pointer',
                    padding: '0 2px',
                  }}
                >
                  ×
                </span>
              )}
            </div>
          )
        })}

        {/* + button with dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowNewTabDropdown(v => !v)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: showNewTabDropdown ? 'var(--bg-elevated)' : 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
            }}
          >
            +
          </button>
          {showNewTabDropdown && (
            <div style={{
              position: 'absolute',
              top: 36,
              left: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 4,
              zIndex: 100,
              minWidth: 160,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: 'fadeIn 0.1s ease',
            }}>
              {creators.filter(c => !tabs.some(t => t.creatorId === c.id)).length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  All creators are open
                </div>
              ) : creators.filter(c => !tabs.some(t => t.creatorId === c.id)).map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    openTab(c.id, c.name)
                    setShowNewTabDropdown(false)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--bg-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--silver)',
                    flexShrink: 0,
                  }}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Close dropdown on outside click */}
        {showNewTabDropdown && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setShowNewTabDropdown(false)}
          />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr 280px', overflow: 'hidden' }}>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <Sidebar
            conversations={activeTab?.conversations ?? []}
            conversationsLoading={conversationsLoading}
            activeFanId={activeTab?.activeFan?.id ?? null}
            onSelectFan={handleSelectFan}
            creators={creators}
            activeCreatorId={activeTab?.creatorId ?? ''}
            onCreatorChange={handleCreatorChange}
            fanLists={fanLists}
            activeListId={activeListId}
            onSelectList={setActiveListId}
            onCreateList={createList}
            onUpdateList={updateList}
            onDeleteList={deleteList}
            onAddFanToList={addFanToList}
            onRemoveFanFromList={removeFanFromList}
            globalAutoMode={activeTab?.autoMode ?? false}
            onToggleAutoMode={handleToggleAutoMode}
            syncingChats={syncingChats}
            onSyncChats={handleSyncChats}
            onMarkAllRead={handleMarkAllRead}
          />
        </div>
        <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ConversationView
            fan={activeTab?.activeFan ?? null}
            creatorId={activeTab?.creatorId ?? ''}
            messages={activeTab?.messages ?? []}
            onReplySent={handleReplySent}
            messagesLoading={activeTab?.messagesLoading ?? false}
            pendingMessage={activeTab?.pendingMessage ?? ''}
            onClearPending={handleClearPending}
            creatorAutoMode={activeTab?.autoMode ?? false}
            onToggleAutoMode={handleToggleFanAuto}
            hasMoreMessages={activeTab?.hasMoreMessages ?? false}
            onLoadMore={loadMoreMessages}
          />
        </div>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <FanPanel
          fan={activeTab?.activeFan ?? null}
          creatorId={activeTab?.creatorId ?? ''}
          onHistoryLoaded={handleHistoryLoaded}
        />
        </div>
      </div>
    </div>
  )
}
