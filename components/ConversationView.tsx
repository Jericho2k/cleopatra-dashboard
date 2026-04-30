'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { Fan, Message } from '../types'
import { sendReply, getLatestSuggestions, generateSuggestions } from '../lib/api'
import { supabase } from '../lib/supabase'
import { ChevronDown } from 'lucide-react'

export interface ConversationViewProps {
  fan: Fan | null
  creatorId: string
  messages: Message[]
  onReplySent: (content: string) => void
  messagesLoading?: boolean
  pendingMessage?: string
  onClearPending?: () => void
  /** Creator-level auto (hides suggestions when on, independent of fan override). */
  creatorAutoMode?: boolean
  onToggleAutoMode?: () => void
  hasMoreMessages?: boolean
  onLoadMore?: () => void | Promise<void>
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
  messagesLoading,
  pendingMessage,
  onClearPending,
  creatorAutoMode,
  onToggleAutoMode,
  hasMoreMessages,
  onLoadMore,
}: ConversationViewProps) {
  const [suggestions, setSuggestions] = useState<string[]>(['', '', ''])
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [stage, setStage] = useState<string>('WARMING_UP')
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null)
  const [scripts, setScripts] = useState<{ id: string; title: string; content: string; category: string }[]>([])
  const [showScripts, setShowScripts] = useState(false)
  const [blockedWords, setBlockedWords] = useState<string[]>([])
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  // media_id -> { url, thumbnail_url, mimetype } resolved from vault
  const [ppvMediaMap, setPpvMediaMap] = useState<Record<string, {
    url: string | null
    thumbnail_url: string | null
    mimetype: string | null
  }>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isLoadingMore = useRef(false)
  const prevMessagesLenRef = useRef(0)
  const prevLastMessageIdRef = useRef<string | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lastMessage = messages[messages.length - 1]

  useEffect(() => {
    if (!fan) return
    setSuggestions(['', '', ''])
    setLoading(false)
    getLatestSuggestions(fan.id, creatorId).then((res) => {
      if (res.suggestions.length > 0) setSuggestions(res.suggestions)
      setStage(res.stage)
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
          const s = payload.new as { suggestions: string[]; stage: string }
          if (s?.suggestions?.length > 0) {
            setSuggestions(s.suggestions)
            setStage(s.stage ?? 'WARMING_UP')
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
    prevMessagesLenRef.current = 0
    prevLastMessageIdRef.current = undefined
  }, [fan?.id])

  useEffect(() => {
    if (messages.length === 0) {
      prevMessagesLenRef.current = 0
      prevLastMessageIdRef.current = undefined
      return
    }
    const lastId = messages[messages.length - 1]?.id
    const prevLen = prevMessagesLenRef.current
    const prevLastId = prevLastMessageIdRef.current
    const grew = messages.length > prevLen
    prevMessagesLenRef.current = messages.length
    prevLastMessageIdRef.current = lastId

    // Scroll to bottom only when newest message changed (not when prepending history).
    if (grew && lastId !== prevLastId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [messages])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !fan) return

    const handleScroll = () => {
      if (el.scrollTop > 100) return
      if (isLoadingMore.current) return
      if (!hasMoreMessages) return

      isLoadingMore.current = true
      const prevScrollHeight = el.scrollHeight

      void (async () => {
        try {
          await Promise.resolve(onLoadMore?.())
        } finally {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (scrollContainerRef.current === el) {
                el.scrollTop = el.scrollHeight - prevScrollHeight
              }
              isLoadingMore.current = false
            })
          })
        }
      })()
    }

    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [hasMoreMessages, onLoadMore, fan?.id])

  useEffect(() => {
    if (!pendingMessage) return
    setInputValue(pendingMessage)
    textareaRef.current?.focus()
    onClearPending?.()
  }, [pendingMessage])

  useEffect(() => {
    if (!fan) return
    supabase
      .from('scripts')
      .select('*')
      .eq('creator_id', creatorId)
      .order('category')
      .then(({ data }) => {
        if (data) setScripts(data)
      })
  }, [creatorId])

  useEffect(() => {
    supabase
      .from('blocked_words')
      .select('word')
      .eq('creator_id', creatorId)
      .then(({ data }) => {
        if (data) setBlockedWords(data.map((w) => w.word))
      })
  }, [creatorId])

  useEffect(() => {
    if (!creatorId || messages.length === 0) return

    // Collect media_ids that haven't been resolved yet
    const unresolved = messages
      .filter(m => m.media_context?.ppv?.media_id)
      .map(m => m.media_context!.ppv!.media_id as string)
      .filter(id => !(id in ppvMediaMap))

    if (unresolved.length === 0) return

    const uniqueIds = [...new Set(unresolved)]

    Promise.all(
      uniqueIds.map(mediaId =>
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/vault-media-url/${creatorId}/${mediaId}`)
          .then(r => r.json())
          .then(data => ({ mediaId, data }))
          .catch(() => ({ mediaId, data: { url: null, thumbnail_url: null, mimetype: null } }))
      )
    ).then(results => {
      const updates: typeof ppvMediaMap = {}
      for (const { mediaId, data } of results) {
        updates[mediaId] = data
      }
      setPpvMediaMap(prev => ({ ...prev, ...updates }))
    })
  }, [messages, creatorId])

  const getBlockedMatches = (text: string): string[] => {
    const lower = text.toLowerCase()
    return blockedWords.filter((w) => lower.includes(w))
  }

  const handleAfterSend = () => {
    if (queuedMessages.length > 0) {
      const [next, ...rest] = queuedMessages
      setInputValue(next)
      setQueuedMessages(rest)
      textareaRef.current?.focus()
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    if (!suggestion.trim()) return
    const parts = suggestion.split(' | ').map(p => p.trim()).filter(Boolean)
    setInputValue(parts[0])
    if (parts.length > 1) {
      setQueuedMessages(parts.slice(1))
    }
    textareaRef.current?.focus()
  }

  const refetchSuggestions = () => {
    if (!fan) return
    const lastFanMessage = [...messages].reverse().find(m => m.role === 'fan')
    if (!lastFanMessage) return
    setLoading(true)
    generateSuggestions(fan.id, creatorId, lastFanMessage.content)
    // New suggestions will arrive via Supabase realtime subscription
    // which already sets setSuggestions and setLoading(false)
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    const value = inputValue.trim()
    if (!value || !fan) return
    const blocked = getBlockedMatches(value)
    if (blocked.length > 0) {
      const confirmed = window.confirm(`⚠️ Message contains blocked word(s): ${blocked.join(', ')}\n\nSend anyway?`)
      if (!confirmed) return
    }
    sendReply(fan.id, creatorId, value, false)
    onReplySent(value)
    setInputValue('')
    handleAfterSend()
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

  const hasBlockedWords = getBlockedMatches(inputValue).length > 0

  const fanAutoMode = fan.auto_mode
  const buttonLabel = fanAutoMode === true ? '● Auto' : fanAutoMode === false ? '○ Off' : 'Auto'
  const buttonColor = fanAutoMode === true ? 'var(--green)' : fanAutoMode === false ? '#ff6b6b' : 'var(--text-muted)'
  const buttonBg = fanAutoMode === true ? 'rgba(76,175,130,0.15)' : fanAutoMode === false ? 'rgba(255,80,80,0.1)' : 'transparent'
  const buttonBorder = fanAutoMode === true ? '1px solid rgba(76,175,130,0.4)' : fanAutoMode === false ? '1px solid rgba(255,80,80,0.3)' : '1px solid var(--border)'

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
      <div style={{
        flexShrink: 0, padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-surface)',
      }}>
        {/* Left: avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)',
          }}>
            {getInitials(fan.display_name)}
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {fan.display_name}
          </span>
        </div>

        {/* Right: auto toggle + stage badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Auto mode for this fan
          </span>
          <button
            type="button"
            onClick={() => onToggleAutoMode?.()}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              background: buttonBg,
              color: buttonColor,
              border: buttonBorder,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}
          >
            {buttonLabel}
          </button>
        </div>
        <span style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '4px 10px', borderRadius: 4, flexShrink: 0,
          background: 'rgba(76, 175, 130, 0.15)', color: 'var(--green)',
          border: '1px solid rgba(76, 175, 130, 0.3)',
        }}>
          {stage.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {hasMoreMessages && (
          <div style={{
            textAlign: 'center',
            padding: '8px 0',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            Scroll up to load more
          </div>
        )}
        {messagesLoading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--bg-base)',
            opacity: 0.5,
            pointerEvents: 'none',
            transition: 'opacity 0.15s ease',
          }} />
        )}
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
              {msg.content && (
                <div style={{
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word',
                }}
                >
                  {msg.content}
                </div>
              )}
              {!msg.content && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  📎 Media
                </div>
              )}
              {msg.media_context?.attachments && msg.media_context.attachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {msg.media_context.attachments.map((att: any, i: number) => (
                    att.url ? (
                      <img key={i} src={att.url} alt="" style={{
                        maxWidth: 220, borderRadius: 8,
                        border: '1px solid var(--border)', display: 'block',
                      }} onError={(e) => {
                        (e.target as HTMLImageElement).parentElement!.innerHTML =
                          '<div style="padding:8px;color:var(--text-muted);font-size:12px">🖼 Media</div>'
                      }} />
                    ) : (
                      <div key={i} style={{
                        padding: '8px 12px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: 8,
                        fontSize: 12, color: 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span>🖼</span><span>Media</span>
                      </div>
                    )
                  ))}
                </div>
              )}
              {msg.media_context?.ppv && (() => {
                const ppv = msg.media_context!.ppv!
                const mediaId = ppv.media_id as string | undefined
                const resolved = mediaId ? ppvMediaMap[mediaId] : undefined
                const thumbSrc = resolved?.thumbnail_url ?? resolved?.url ?? null
                const isVideo = resolved?.mimetype?.startsWith('video') ?? false

                return (
                  <div style={{
                    marginTop: 8,
                    background: 'rgba(155,143,212,0.1)',
                    border: '1px solid rgba(155,143,212,0.3)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}>
                    {thumbSrc && (
                      <div style={{ position: 'relative', lineHeight: 0 }}>
                        <img
                          src={thumbSrc}
                          alt="PPV preview"
                          style={{
                            width: '100%',
                            maxWidth: 220,
                            display: 'block',
                            filter: 'blur(6px)',
                            transform: 'scale(1.05)', // hide blur edge artifacts
                            borderRadius: 0,
                          }}
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                        {/* Lock overlay */}
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(0,0,0,0.25)',
                        }}>
                          <span style={{ fontSize: 22 }}>{isVideo ? '🎬' : '🔒'}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 600 }}>
                        💎 PPV Sent — ${ppv.price}
                      </div>
                      {ppv.title && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {ppv.title}
                        </div>
                      )}
                      {mediaId && !resolved && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, opacity: 0.6 }}>
                          Loading preview…
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
              {(msg as any).attachments?.map((att: any, i: number) => (
                att.type === 'ppv' ? (
                  <div key={i} style={{
                    marginTop: 8, padding: '10px 12px',
                    background: 'rgba(155,143,212,0.15)',
                    border: '1px solid rgba(155,143,212,0.3)',
                    borderRadius: 8, fontSize: 12,
                  }}>
                    <div style={{ color: 'var(--purple)', fontWeight: 600, marginBottom: 4 }}>
                      💎 PPV Sent — ${att.price}
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>{att.title}</div>
                  </div>
                ) : att.thumbnail_url ? (
                  <img key={i} src={att.thumbnail_url} alt="" style={{
                    marginTop: 8, maxWidth: 200, borderRadius: 8,
                    border: '1px solid var(--border)',
                    display: 'block',
                  }} />
                ) : null
              ))}
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
        {!((creatorAutoMode ?? false) || fan.auto_mode === true) && <>        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: suggestionsOpen ? '0 0 10px 0' : '4px 0',
            cursor: 'pointer',
          }}
          onClick={() => setSuggestionsOpen(v => !v)}
        >
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            AI Suggestions
          </div>
          <ChevronDown size={12} style={{
            color: 'var(--text-muted)',
            transform: suggestionsOpen ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.2s ease',
          }} />
        </div>
        {suggestionsOpen && (
        <>
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
                padding: '6px 10px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                color: loading ? 'var(--text-faint)' : 'var(--text-primary)',
                fontSize: 14,
                cursor: loading || !s.trim() ? 'default' : 'pointer',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {loading ? (
                <span style={{ padding: '4px 4px' }}>…</span>
              ) : s ? (
                s.split(' | ').map((part, pi) => (
                  <span key={pi} style={{
                    display: 'block',
                    padding: '5px 10px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    lineHeight: 1.4,
                  }}>
                    {part}
                  </span>
                ))
              ) : (
                <span style={{ padding: '5px 10px' }}>{'\u00A0'}</span>
              )}
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
        <div style={{ display: 'flex', marginBottom: 12 }}>
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
              opacity: loading ? 0.5 : 1,
            }}
          >
            Regenerate
          </button>
          {scripts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowScripts((v) => !v)}
              style={{
                background: showScripts ? 'var(--bg-hover)' : 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '5px 12px',
                marginLeft: 8,
              }}
            >
              Scripts
            </button>
          )}
        </div>

        {showScripts && (
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            {['greeting', 'upsell', 'reengagement', 'custom'].map((cat) => {
              const catScripts = scripts.filter((s) => s.category === cat)
              if (catScripts.length === 0) return null
              return (
                <div key={cat}>
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                      padding: '8px 12px 4px',
                    }}
                  >
                    {cat}
                  </div>
                  {catScripts.map((script) => (
                    <button
                      key={script.id}
                      type="button"
                      onClick={() => {
                        setInputValue(script.content)
                        setShowScripts(false)
                        textareaRef.current?.focus()
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderTop: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: 'var(--text-secondary)', marginRight: 8 }}>{script.title}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{script.content.slice(0, 40)}…</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        </>
        )}
        </>}

        <div
          style={{
            height: 1,
            background: 'var(--border)',
            marginBottom: 12,
          }}
        />
        {queuedMessages.length > 0 && (
          <div style={{
            fontSize: 11, color: 'var(--green)',
            padding: '2px 8px',
          }}>
            + {queuedMessages.length} message{queuedMessages.length > 1 ? 's' : ''} queued
          </div>
        )}
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
            border: hasBlockedWords ? '1px solid rgba(255, 80, 80, 0.6)' : '1px solid var(--border-subtle)',
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
