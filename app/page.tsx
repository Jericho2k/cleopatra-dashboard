'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Fan, Message, ConversationSummary } from '../types'
import Sidebar from '../components/Sidebar'
import ConversationView from '../components/ConversationView'
import FanPanel from '../components/FanPanel'

const CREATOR_ID = 'cc36c60d-21aa-44fc-b0c4-67cdc7376b2c'

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
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeFan, setActiveFan] = useState<Fan | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const activeFanRef = useRef<Fan | null>(null)
  useEffect(() => { activeFanRef.current = activeFan }, [activeFan])

  useEffect(() => {
    async function load() {
      const { data: fansData, error: fansError } = await supabase
        .from('fans')
        .select('*')
        .eq('creator_id', CREATOR_ID)
      if (fansError) return
      const fans = (fansData ?? []).map((row) => rowToFan(row))
      const summaries: ConversationSummary[] = await Promise.all(
        fans.map(async (fan) => {
          const { data: msgData } = await supabase
            .from('messages')
            .select('*')
            .eq('fan_id', fan.id)
            .eq('creator_id', CREATOR_ID)
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
        })
      )
      setConversations(summaries.sort((a, b) =>
        new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
      ))
      const openFan = localStorage.getItem('open-fan')
      if (openFan) {
        localStorage.removeItem('open-fan')
        const match = summaries.find((c) => c.fan.display_name === openFan)
        if (match) setActiveFan(match.fan)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!activeFan) {
      setMessages([])
      return
    }
    async function load() {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('fan_id', activeFan!.id)
        .eq('creator_id', CREATOR_ID)
        .order('sent_at', { ascending: true })
        .limit(40)
      if (error) return
      setMessages((data ?? []).map((row) => rowToMessage(row)))
    }
    load()
  }, [activeFan?.id])

  useEffect(() => {
    const channel = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `creator_id=eq.${CREATOR_ID}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          const msg = rowToMessage(row)
          if (msg.role === 'creator') return
          if (msg.fan_id === activeFanRef.current?.id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev
              return [...prev, msg]
            })
          }
          setConversations((prev) =>
            [...prev]
              .map((c) =>
                c.fan.id === msg.fan_id
                  ? {
                      ...c,
                      last_message: msg.content,
                      last_message_time: msg.sent_at,
                      unread: msg.role === 'fan' && msg.fan_id !== activeFanRef.current?.id ? true : c.unread,
                      unread_count: msg.role === 'fan' && msg.fan_id !== activeFanRef.current?.id
                        ? (c.unread_count ?? 0) + 1
                        : c.unread_count,
                    }
                  : c
              )
              .sort((a, b) =>
                new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
              )
          )
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('fans-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'fans',
          filter: `creator_id=eq.${CREATOR_ID}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          const newFan = rowToFan(row)
          setConversations((prev) => {
            if (prev.some((c) => c.fan.id === newFan.id)) return prev
            return [
              ...prev,
              {
                fan: newFan,
                last_message: '',
                last_message_time: new Date(0).toISOString(),
                unread: false,
                unread_count: 0,
              },
            ]
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'fans',
          filter: `creator_id=eq.${CREATOR_ID}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          const updatedFan = rowToFan(row)
          setActiveFan((prev) => (prev?.id === updatedFan.id ? updatedFan : prev))
          setConversations((prev) =>
            prev.map((c) => (c.fan.id === updatedFan.id ? { ...c, fan: updatedFan } : c))
          )
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  function handleSelectFan(fan: Fan) {
    setActiveFan(fan)
    setConversations((prev) =>
      prev.map((c) => (c.fan.id === fan.id ? { ...c, unread: false, unread_count: 0 } : c))
    )
  }

  function onReplySent(content: string) {
    if (!activeFan) return
    const newMsg: Message = {
      id: `temp-${Date.now()}`,
      fan_id: activeFan.id,
      creator_id: CREATOR_ID,
      role: 'creator',
      content,
      sent_at: new Date().toISOString(),
      was_ai_suggested: false,
      was_selected: false,
    }
    setMessages((prev) => [...prev, newMsg])
  }

  return (
    <div style={{
      height: '100vh',
      display: 'grid',
      gridTemplateColumns: '280px 1fr 280px',
      overflow: 'hidden',
      background: 'var(--bg-base)',
    }}>
      <div style={{ height: '100vh', overflow: 'hidden' }}>
        <Sidebar
          conversations={conversations}
          activeFanId={activeFan?.id ?? null}
          onSelectFan={handleSelectFan}
        />
      </div>
      <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ConversationView
          fan={activeFan}
          creatorId={CREATOR_ID}
          messages={messages}
          onReplySent={onReplySent}
        />
      </div>
      <div style={{ height: '100vh', overflow: 'hidden' }}>
        <FanPanel fan={activeFan} />
      </div>
    </div>
  )
}
