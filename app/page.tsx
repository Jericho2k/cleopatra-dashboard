'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Fan, Message, ConversationSummary } from '../types'
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
}

function rowToFan(row: Record<string, unknown>): Fan {
  return {
    id: row.id as string,
    display_name: row.display_name as string,
    total_spent: Number(row.total_spent),
    spend_tier: row.spend_tier as Fan['spend_tier'],
    last_active: (row.last_active as string) ?? null,
    preferences: Array.isArray(row.preferences) ? (row.preferences as string[]) : [],
    notes: (row.notes as string) ?? '',
    age: (row.age as string) ?? '',
    payday: (row.payday as string) ?? '',
    hobbies: (row.hobbies as string) ?? '',
    relationship_status: (row.relationship_status as string) ?? '',
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
  }
}

export default function Page() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [creators, setCreators] = useState<{id: string, name: string}[]>([])
  const [authLoading, setAuthLoading] = useState(true)

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

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
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
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

  useEffect(() => {
    async function loadCreators() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('chatter_creators')
        .select('creator_id, creators(id, platform_username)')
        .eq('chatter_id', user.id)
      const list = (data ?? []).map((r: any) => ({
        id: r.creator_id,
        name: r.creators?.platform_username ?? r.creator_id,
      }))
      setCreators(list)
      if (list.length > 0) openTab(list[0].id, list[0].name)
      setAuthLoading(false)
    }
    loadCreators()
  }, [])

  useEffect(() => {
    if (!activeTab || activeTab.conversations.length > 0) return
    async function load() {
      const { data: fansData } = await supabase
        .from('fans')
        .select('*')
        .eq('creator_id', activeTab!.creatorId)
      const fans = (fansData ?? []).map(rowToFan)
      const summaries = await Promise.all(fans.map(async (fan) => {
        const { data: msgData } = await supabase
          .from('messages')
          .select('*')
          .eq('fan_id', fan.id)
          .eq('creator_id', activeTab!.creatorId)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const last = msgData ? rowToMessage(msgData) : null
        return {
          fan,
          last_message: last?.content ?? '',
          last_message_time: last?.sent_at ?? new Date(0).toISOString(),
          unread: false,
          unread_count: 0,
        }
      }))
      updateTab(activeTab!.id, {
        conversations: summaries.sort((a, b) =>
          new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
        )
      })
    }
    load()
  }, [activeTabId])

  useEffect(() => {
    if (!activeTab?.activeFan) return
    updateTab(activeTab.id, { messagesLoading: true })
    supabase
      .from('messages')
      .select('*')
      .eq('fan_id', activeTab.activeFan.id)
      .eq('creator_id', activeTab.creatorId)
      .order('sent_at', { ascending: true })
      .limit(40)
      .then(({ data }) => {
        updateTab(activeTab.id, {
          messages: (data ?? []).map(rowToMessage),
          messagesLoading: false,
        })
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
        const row = payload.new as Record<string, unknown>
        const msg = rowToMessage(row)
        if (msg.role === 'creator') return
        setTabs(prev => prev.map(tab => {
          if (tab.creatorId !== msg.creator_id) return tab
          const isActiveTab = tab.id === activeTabId
          const isActiveFan = tab.activeFan?.id === msg.fan_id
          return {
            ...tab,
            messages: isActiveTab && isActiveFan
              ? tab.messages.some(m => m.id === msg.id)
                ? tab.messages
                : [...tab.messages, msg]
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
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeTabId])

  if (authLoading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
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
      }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 12px',
              height: 32,
              borderRadius: 6,
              cursor: 'pointer',
              background: tab.id === activeTabId ? 'var(--bg-elevated)' : 'transparent',
              border: tab.id === activeTabId ? '1px solid var(--border)' : '1px solid transparent',
              fontSize: 12,
              color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            <span>{tab.creatorName}</span>
            {tab.activeFan && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {tab.activeFan.display_name}</span>
            )}
            {tabs.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                style={{ marginLeft: 4, color: 'var(--text-faint)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
              >
                ×
              </span>
            )}
          </div>
        ))}
        {/* New tab button */}
        <button
          type="button"
          onClick={() => {
            const unused = creators.find(c => !tabs.some(t => t.creatorId === c.id))
            if (unused) openTab(unused.id, unused.name)
          }}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginLeft: 4,
          }}
        >
          +
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr 280px', overflow: 'hidden' }}>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <Sidebar
            conversations={activeTab?.conversations ?? []}
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
                id: `temp-${Date.now()}`,
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
          />
        </div>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <FanPanel fan={activeTab?.activeFan ?? null} />
        </div>
      </div>
    </div>
  )
}
