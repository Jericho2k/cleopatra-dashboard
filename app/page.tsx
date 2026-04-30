'use client'

//after the revert

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Fan, Message, ConversationSummary, FanList } from '../types'
import { warmBackend } from '../lib/api'
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

  const activeTabIdRef = useRef(activeTabId)
  const conversationsCache = useRef<Record<string, ConversationSummary[]>>({})
  const messagesCache = useRef<Record<string, Message[]>>({})
  useEffect(() => {
    warmBackend()
  }, [])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const updateTab = (tabId: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t))
  }

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
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const insertMessage = (text: string) => {
    if (!activeTab) return
    updateTab(activeTab.id, { pendingMessage: text })
  }

  const toggleAutoMode = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    const next = !tab.autoMode
    updateTab(tabId, { autoMode: next })
    await supabase.from('creators').update({ auto_mode: next }).eq('id', tab.creatorId)
  }

  const toggleFanAutoMode = async (tabId: string, fanId: string) => {
    const tab = tabs.find(t => t.id === tabId)
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

    await supabase
      .from('fans')
      .update({ auto_mode: next })
      .eq('id', fanId)

    updateTab(tabId, {
      conversations: tab.conversations.map(c =>
        c.fan.id === fanId ? { ...c, fan: { ...c.fan, auto_mode: next } } : c
      ),
      activeFan: tab.activeFan?.id === fanId
        ? { ...tab.activeFan, auto_mode: next }
        : tab.activeFan,
    })
  }

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
      }

      // Restore stale cache immediately for faster first paint.
      try {
        const cached = localStorage.getItem(`conversations_${first.id}`)
        if (cached) {
          const parsed = JSON.parse(cached) as { data: ConversationSummary[]; ts: number }
          if (Date.now() - parsed.ts < 5 * 60 * 1000 && Array.isArray(parsed.data)) {
            conversationsCache.current[first.id] = parsed.data
            setTabs([{ ...baseTab, conversations: parsed.data }])
            setActiveTabId(tabId)
          }
        }
      } catch {}

      if (!conversationsCache.current[first.id]) {
        setTabs([baseTab])
        setActiveTabId(tabId)
      }

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
        try {
          localStorage.setItem(
            `conversations_${first.id}`,
            JSON.stringify({ data: conversations, ts: Date.now() })
          )
        } catch {}

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

  console.log('[messages] fan clicked:', fanId)
  console.log('[messages] cache state:', messagesCache.current[fanId])

  // Only use cache if it has been explicitly set (not undefined)
  // undefined = never fetched, [] = fetched but empty (valid)
  if (messagesCache.current[fanId] !== undefined) {
    console.log('[messages] returning from cache:', messagesCache.current[fanId].length, 'msgs')
    updateTab(activeTab.id, { messages: messagesCache.current[fanId], messagesLoading: false })
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
      console.log('[messages] query result - data:', data?.length, 'error:', error)
      if (error) {
        console.error('[messages] fetch error:', error)
        updateTab(activeTab.id, { messagesLoading: false })
        return
      }
      const msgs = (data ?? []).reverse().map(rowToMessage)
      console.log('[messages] setting', msgs.length, 'messages')
      messagesCache.current[fanId] = msgs
      updateTab(activeTab.id, { messages: msgs, messagesLoading: false })
      })
  }, [activeTab?.activeFan?.id, activeTabId])

  useEffect(() => {
    const channel = supabase
      .channel('messages-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const msg = rowToMessage(payload.new as Record<string, unknown>)
        setTabs(prev => prev.map(tab => {
          if (tab.creatorId !== msg.creator_id) return tab
          const isActiveTab = tab.id === activeTabIdRef.current
          const isActiveFan = tab.activeFan?.id === msg.fan_id

          if (tab.messages.some(m => m.id === msg.id)) return tab

          return {
            ...tab,
            messages: isActiveTab && isActiveFan
              ? [...tab.messages, msg]
              : tab.messages,
            conversations: tab.conversations
              .map(c => c.fan.id === msg.fan_id
                ? { ...c, last_message: msg.content, last_message_time: msg.sent_at,
                    unread: !isActiveFan, unread_count: isActiveFan ? 0 : (c.unread_count ?? 0) + 1 }
                : c
              )
              .sort((a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()),
          }
        }))
      })

    if (activeTab?.creatorId) {
      const cid = activeTab.creatorId
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
    }

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeTab?.creatorId])

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
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-chats/${activeTab.creatorId}`, { method: 'POST' })
                await res.json()
                delete conversationsCache.current[activeTab.creatorId]
                updateTab(activeTab.id, { conversations: [] })
              } finally {
                setSyncingChats(false)
              }
            }}
            onMarkAllRead={async () => {
              if (!activeTab) return
              await fetch(`${process.env.NEXT_PUBLIC_API_URL}/mark-all-read/${activeTab.creatorId}`, { method: 'POST' })
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
            onReplySent={(content) => {
              if (!activeTab?.activeFan) return
              const newMsg: Message = {
                id: `temp-${Date.now()}-${content.slice(0, 10)}`,
                fan_id: activeTab.activeFan.id,
                creator_id: activeTab.creatorId,
                role: 'creator',
                content,
                sent_at: new Date().toISOString(),
                was_ai_suggested: false,
                was_selected: false,
              }
              updateTab(activeTab.id, { messages: [...activeTab.messages, newMsg] })
            }}
            messagesLoading={activeTab?.messagesLoading ?? false}
            pendingMessage={activeTab?.pendingMessage ?? ''}
            onClearPending={() => activeTab && updateTab(activeTab.id, { pendingMessage: '' })}
            creatorAutoMode={activeTab?.autoMode ?? false}
            onToggleAutoMode={() => activeTab?.activeFan && toggleFanAutoMode(activeTab.id, activeTab.activeFan.id)}
          />
        </div>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <FanPanel
          fan={activeTab?.activeFan ?? null}
          creatorId={activeTab?.creatorId ?? ''}
          onInsertMessage={insertMessage}
          onHistoryLoaded={async () => {
            if (!activeTab?.activeFan) return
            
            // Clear cache for this fan
            if (messagesCache.current) {
              delete messagesCache.current[activeTab.activeFan.id]
            }
            
            // Reload messages from DB without clearing first
            const { data } = await supabase
              .from('messages')
              .select('*')
              .eq('fan_id', activeTab.activeFan.id)
              .eq('creator_id', activeTab.creatorId)
              .order('sent_at', { ascending: false })
              .limit(50)
            if (data) {
              updateTab(activeTab.id, { messages: data.reverse().map(rowToMessage) })
            }
          }}
        />
        </div>
      </div>
    </div>
  )
}
