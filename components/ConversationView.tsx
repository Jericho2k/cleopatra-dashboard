'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { Fan, Message } from '../types'
import { sendReply, getLatestSuggestions } from '../lib/api'
import { supabase } from '../lib/supabase'

export interface ConversationViewProps {
  fan: Fan | null
  creatorId: string
  messages: Message[]
  onReplySent: (content: string) => void
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return displayName.slice(0, 2).toUpperCase() || '?'
}

export default function ConversationView({
  fan,
  creatorId,
  messages,
  onReplySent,
}: ConversationViewProps) {
  const [suggestions, setSuggestions] = useState<string[]>(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lastMessage = messages[messages.length - 1]
  const stage = 'WARMING_UP'

  useEffect(() => {
    if (!fan) return
    getLatestSuggestions(fan.id, creatorId).then((s: string[]) => {
      if (s.length > 0) setSuggestions(s)
    })
    const channel = supabase
      .channel(`suggestions-${fan.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'suggestions',
          filter: `fan_id=eq.${fan.id}`,
        },
        (payload) => {
          const s = (payload.new as { suggestions: string[] }).suggestions
          if (s?.length > 0) {
            setLoading(true)
            setSuggestions(s)
            setLoading(false)
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fan?.id, creatorId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  const handleSuggestionClick = (suggestion: string) => {
    if (!fan || !suggestion.trim()) return
    sendReply(fan.id, creatorId, suggestion, true)
    onReplySent(suggestion)
    setSuggestions(['', '', ''])
  }

  const refetchSuggestions = () => {
    if (!fan) return
    setLoading(true)
    getLatestSuggestions(fan.id, creatorId).then((s: string[]) => {
      if (s.length > 0) setSuggestions(s)
      setLoading(false)
    })
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    const value = inputValue.trim()
    if (!value || !fan) return
    sendReply(fan.id, creatorId, value, false)
    onReplySent(value)
    setInputValue('')
  }

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    setInputValue((e.target as HTMLTextAreaElement).value)
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * 3
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`
  }

  if (fan === null) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        Select a conversation to start chatting.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-base)',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--bg-surface)',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-secondary)',
          }}
        >
          {getInitials(fan.display_name)}
        </div>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fan.display_name}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '4px 10px',
            borderRadius: 4,
            background: 'rgba(76, 175, 130, 0.15)',
            color: 'var(--green)',
            border: '1px solid rgba(76, 175, 130, 0.3)',
          }}
        >
          {stage.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignSelf: msg.role === 'fan' ? 'flex-start' : 'flex-end',
              maxWidth: '80%',
            }}
          >
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              {msg.role}
            </span>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: msg.role === 'fan' ? 'var(--bg-elevated)' : 'var(--bg-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom */}
      <div
        style={{
          flexShrink: 0,
          padding: 16,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}
        >
          AI SUGGESTIONS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {(loading ? ['', '', ''] : suggestions.slice(0, 3)).map((s, i) => (
            <button
              key={i}
              type="button"
              disabled={loading || !s.trim()}
              onClick={() => handleSuggestionClick(s)}
              onMouseEnter={() => setHoveredSuggestion(i)}
              onMouseLeave={() => setHoveredSuggestion(null)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                color: loading ? 'var(--text-faint)' : 'var(--text-primary)',
                fontSize: 14,
                cursor: loading || !s.trim() ? 'default' : 'pointer',
                position: 'relative',
              }}
            >
              {loading ? '…' : s || '\u00A0'}
              {!loading && s.trim() && (
                <span
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--silver)',
                    opacity: hoveredSuggestion === i ? 1 : 0,
                  }}
                >
                  →
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refetchSuggestions}
          disabled={loading}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: loading ? 'default' : 'pointer',
            padding: '5px 12px',
            marginBottom: 12,
            opacity: loading ? 0.5 : 1,
          }}
        >
          Regenerate
        </button>
        <div
          style={{
            height: 1,
            background: 'var(--border)',
            marginBottom: 12,
          }}
        />
        <textarea
          ref={textareaRef}
          value={inputValue}
          onInput={handleTextareaInput}
          onKeyDown={handleTextareaKeyDown}
          rows={1}
          placeholder="type your own reply..."
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            fontSize: 14,
            lineHeight: 1.45,
            resize: 'none',
            overflow: 'hidden',
            minHeight: 40,
          }}
        />
      </div>
    </div>
  )
}
