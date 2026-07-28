'use client'

//after the revert

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import type { Fan, Message, ConversationSummary, FanList } from '../types'
import { warmBackend } from '../lib/api'
import { useRealtimeRecovery } from '../lib/realtime-recovery'
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
  const conversationsCache = useRef<Record<string, ConversationSummary[]>>({})
  const messagesCache = useRef<Record<string, Message[]>>({})
  const messagesPaginationCache = useRef<Record<string, { hasMoreMessages: boolean; oldestMessageTime: string | null }>>({})
  useEffect(() => {
    warmBackend()
  }, [])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

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

  const toggleAutoMode = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
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
  }

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

  async function loadFanLists(creatorId: string) {
    const { data: lists } = await supabase
      .from('fan_lists')
      .select('*, fan_list_members(fan_id)')
      .eq('creator_id', creatorId)
    setFanLists((lists ?? []).map((l: any) => ({
      ...l,
      member_fan_ids: (l.fan_list_members ?? []).map((m: any) => m.fan_id),
    })))
  }

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

  async function createList(name: string, color: string, excludeFromAuto: boolean) {
    if (!activeTab) return
    const { data } = await supabase.from('fan_lists').insert({
      creator_id: activeTab.creatorId,
      name,
      color,
      exclude_from_auto: excludeFromAuto,
    }).select().single()
    if (data) setFanLists(prev => [...prev, { ...data, member_fan_ids: [] }])
  }

  async function updateList(listId: string, name: string, color: string, excludeFromAuto: boolean) {
    await supabase.from('fan_lists').update({ name, color, exclude_from_auto: excludeFromAuto }).eq('id', listId)
    setFanLists(prev => prev.map(l => l.id === listId ? { ...l, name, color, exclude_from_auto: excludeFromAuto } : l))
  }

  async function deleteList(listId: string) {
    await supabase.from('fan_lists').delete().eq('id', listId)
    setFanLists(prev => prev.filter(l => l.id !== listId))
    if (activeListId === listId) setActiveListId(null)
  }

  async function addFanToList(fanId: string, listId: string) {
    await supabase.from('fan_list_members').upsert({ list_id: listId, fan_id: fanId })
    setFanLists(prev => prev.map(l =>
      l.id === listId && !l.member_fan_ids.includes(fanId)
        ? { ...l, member_fan_ids: [...l.member_fan_ids, fanId] }
        : l
    ))
  }

  async function removeFanFromList(fanId: string, listId: string) {
    await supabase.from('fan_list_members').delete().eq('fan_id', fanId).eq('list_id', listId)
    setFanLists(prev => prev.map(l =>
      l.id === listId ? { ...l, member_fan_ids: l.member_fan_ids.filter(id => id !== fanId) } : l
    ))
  }

  useEffect(() => {
    if (!activeTab) return
    if (activeTab.conversations.length > 0) return
    const cached = conversationsCache.current[activeTab.creatorId]
    if (cached && cached.length > 0) {
      updateTab(activeTab.id, { conversations: cached })
      return
    }

    async function load() {
      const { data } = await supabase
        .from('fan_conversation_summaries')
        .select('*')
        .eq('creator_id', activeTab!.creatorId)
        .order('last_message_time', { ascending: false, nullsFirst: false })

      const summaries: ConversationSummary[] = (data ?? []).map((row: any) => ({
        fan: rowToFan(row),
        last_message: row.last_message ?? '',
        last_message_time: row.last_message_time ?? new Date(0).toISOString(),
        unread: false,
        unread_count: 0,
      }))

      conversationsCache.current[activeTab!.creatorId] = summaries
      updateTab(activeTab!.id, { conversations: summaries })
    }
    load()
  }, [activeTabId, activeTab?.conversations.length])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ creatorId?: string }>
      const creatorId = ce.detail?.creatorId ?? activeTab?.creatorId
      if (creatorId) delete conversationsCache.current[creatorId]
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
        const msgs = (data ?? []).reverse().map(rowToMessage)
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

    const olderMsgs = data.reverse().map(rowToMessage)
    const combined = [...olderMsgs, ...tab.messages]

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
    const nextMessages = tab.messages.some(message => message.id === messageId)
      ? tab.messages
      : [...tab.messages, newMsg]
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
    delete messagesCache.current[fanId]
    delete messagesPaginationCache.current[fanId]

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('fan_id', fanId)
      .eq('creator_id', tab.creatorId)
      .order('sent_at', { ascending: false })
      .limit(50)
    if (data) {
      const msgs = data.reverse().map(rowToMessage)
      messagesCache.current[fanId] = msgs
      const hasMore = data.length === 50
      const oldest = msgs[0]?.sent_at ?? null
      messagesPaginationCache.current[fanId] = { hasMoreMessages: hasMore, oldestMessageTime: oldest }
      updateTab(tab.id, {
        messages: msgs,
        hasMoreMessages: hasMore,
        oldestMessageTime: oldest,
      })
    }
  }, [updateTab])

  useEffect(() => {
    const creatorId = activeTab?.creatorId
    const fanId = activeTab?.activeFan?.id
    if (!creatorId || !fanId) return

    let cancelled = false
    let inFlight = false
    const reconcile = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const response = await apiFetch(`/sync-fan-messages/${creatorId}/${fanId}`, {
          method: 'POST',
        })
        const body = await response.json().catch(() => ({}))
        const changed = Number(body.imported ?? 0) + Number(body.media_updated ?? 0)
        if (response.ok && changed > 0 && !cancelled) {
          await handleHistoryLoaded()
        }
      } catch {
        // Realtime and the ten-minute backend reconciler remain as fallbacks.
      } finally {
        inFlight = false
      }
    }

    void reconcile()
    const interval = window.setInterval(() => void reconcile(), 20_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
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

            if (tab.messages.some(m => m.id === msg.id)) return tab

            const currentCached = messagesCache.current[msg.fan_id]
            if (currentCached !== undefined && !currentCached.some(m => m.id === msg.id)) {
              messagesCache.current[msg.fan_id] = [...currentCached, msg]
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
              messages: isActiveTab && isActiveFan
                ? [...tab.messages, msg]
                : tab.messages,
              conversations: updatedConversations,
            }
          })
          return next
        })
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

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeTab?.creatorId, recoveryTick])

  // After a realtime reconnect (tab refocus / network restored), the socket only
  // delivers messages from the resubscribe point onward — anything that landed
  // while it was dead is missed. Catch the open thread up by appending messages
  // newer than the last one currently loaded (preserves pagination + scroll, no
  // dupes). The conversation list keeps itself current via the resubscribed
  // messages-realtime channel going forward.
  useEffect(() => {
    if (recoveryTick === 0) return
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    const fanId = tab?.activeFan?.id
    if (!tab || !fanId) return
    const creatorId = tab.creatorId
    const newestLoaded = tab.messages[tab.messages.length - 1]?.sent_at ?? null

    let cancelled = false
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
        const combined = [...t.messages, ...missed]
        messagesCache.current[fanId] = combined
        return { ...t, messages: combined }
      }))
    })()
    return () => { cancelled = true }
  }, [recoveryTick])

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
        {tabs.map((tab, index) => {
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
            onSelectFan={(fan) => {
              if (!activeTab) return
              updateTab(activeTab.id, {
                activeFan: fan,
                conversations: activeTab.conversations.map(c =>
                  c.fan.id === fan.id ? { ...c, unread: false, unread_count: 0 } : c
                )
              })
            }}
            creators={creators}
            activeCreatorId={activeTab?.creatorId ?? ''}
            onCreatorChange={(id) => {
              const creator = creators.find(c => c.id === id)
              if (!creator || !activeTab) return
              updateTab(activeTab.id, {
                creatorId: id,
                creatorName: creator.name,
                activeFan: null,
                messages: [],
                conversations: [],
                hasMoreMessages: false,
                oldestMessageTime: null,
              })
              loadFanLists(id)
            }}
            fanLists={fanLists}
            activeListId={activeListId}
            onSelectList={setActiveListId}
            onCreateList={createList}
            onUpdateList={updateList}
            onDeleteList={deleteList}
            onAddFanToList={addFanToList}
            onRemoveFanFromList={removeFanFromList}
            globalAutoMode={activeTab?.autoMode ?? false}
            onToggleAutoMode={() => activeTab && toggleAutoMode(activeTab.id)}
            syncingChats={syncingChats}
            onSyncChats={async () => {
              if (!activeTab) return
              setSyncingChats(true)
              try {
                const res = await apiFetch(`/sync-chats/${activeTab.creatorId}?incremental=true&force=true`, { method: 'POST' })
                await res.json()
                delete conversationsCache.current[activeTab.creatorId]
                updateTab(activeTab.id, { conversations: [] })
              } finally {
                setSyncingChats(false)
              }
            }}
            onMarkAllRead={async () => {
              if (!activeTab) return
              await apiFetch(`/mark-all-read/${activeTab.creatorId}`, { method: 'POST' })
              updateTab(activeTab.id, {
                conversations: activeTab.conversations.map(c => ({ ...c, unread: false, unread_count: 0 })),
                unreadCounts: {},
              })
            }}
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
