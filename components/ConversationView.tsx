'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { Fan, Message } from '../types'
import { sendReply, getLatestSuggestions, generateSuggestions, apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useRealtimeRecovery } from '../lib/realtime-recovery'
import { ChevronDown } from 'lucide-react'

type OperatorPPVMedia = {
  id: string
  external_media_id: string
  url: string | null
  thumbnail_url: string | null
  mimetype: string | null
  filename: string | null
  album_title: string | null
  ai_description: string | null
  price_min: number | null
  price_max: number | null
  fan_sale_status: 'unused' | 'sent' | 'payment_pending' | 'abandoned' | 'voided' | 'sold'
}

type OperatorPPVSet = {
  id: string
  title: string | null
  description: string | null
  media_ids: string[]
  suggested_price: number | null
  base_price_cents: number | null
  min_price_cents: number | null
  max_price_cents: number | null
}

type OperatorPPVOptions = {
  has_payment_pending: boolean
  media: OperatorPPVMedia[]
  approved_sets: OperatorPPVSet[]
}

type OperatorPPVMode = 'set' | 'manual'
type OperatorPPVStatusFilter = 'all' | 'unused' | 'payment_pending' | 'not_sold' | 'sold'

export interface ConversationViewProps {
  fan: Fan | null
  creatorId: string
  messages: Message[]
  onReplySent: (content: string, messageId: string) => void
  messagesLoading?: boolean
  pendingMessage?: string
  onClearPending?: () => void
  /** Creator-level auto (hides suggestions when on, independent of fan override). */
  creatorAutoMode?: boolean
  onToggleAutoMode?: () => void | Promise<void>
  hasMoreMessages?: boolean
  onLoadMore?: () => void | Promise<void>
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return displayName.slice(0, 2).toUpperCase() || '?'
}

function ConversationView({
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
  const recoveryTick = useRealtimeRecovery()
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [stage, setStage] = useState<string>('WARMING_UP')
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [autoModeSaving, setAutoModeSaving] = useState(false)
  const [autoModeError, setAutoModeError] = useState('')
  const [autoAvailable, setAutoAvailable] = useState<boolean | null>(null)
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null)
  const [scripts, setScripts] = useState<{ id: string; title: string; content: string; category: string }[]>([])
  const [showScripts, setShowScripts] = useState(false)
  const [blockedWords, setBlockedWords] = useState<string[]>([])
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [mediaPreview, setMediaPreview] = useState<{ url: string; mimetype: string; filename: string } | null>(null)
  const [ppvComposerOpen, setPpvComposerOpen] = useState(false)
  const [ppvComposerMode, setPpvComposerMode] = useState<OperatorPPVMode>('manual')
  const [ppvOptions, setPpvOptions] = useState<OperatorPPVOptions | null>(null)
  const [ppvOptionsLoading, setPpvOptionsLoading] = useState(false)
  const [ppvSelectedIds, setPpvSelectedIds] = useState<string[]>([])
  const [ppvSelectedSetId, setPpvSelectedSetId] = useState<string | null>(null)
  const [ppvAlbumFilter, setPpvAlbumFilter] = useState('all')
  const [ppvStatusFilter, setPpvStatusFilter] = useState<OperatorPPVStatusFilter>('all')
  const [ppvVisibleLimit, setPpvVisibleLimit] = useState(180)
  const [ppvPrice, setPpvPrice] = useState('')
  const [ppvMessage, setPpvMessage] = useState('just for you...')
  const [ppvSending, setPpvSending] = useState(false)
  const [ppvError, setPpvError] = useState('')
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
    let cancelled = false
    getLatestSuggestions(fan.id, creatorId).then((res) => {
      if (cancelled) return
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
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [fan?.id, creatorId, recoveryTick])

  useEffect(() => {
    if (!creatorId) {
      setAutoAvailable(null)
      return
    }
    let cancelled = false
    apiFetch(`/creator/${creatorId}/auto-availability`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!cancelled && response.ok) {
          setAutoAvailable(Boolean(body.auto_available))
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [creatorId, recoveryTick])

  useEffect(() => {
    prevMessagesLenRef.current = 0
    prevLastMessageIdRef.current = undefined
    setPpvComposerOpen(false)
    setPpvOptions(null)
    setPpvSelectedIds([])
    setPpvSelectedSetId(null)
    setPpvAlbumFilter('all')
    setPpvStatusFilter('all')
    setPpvVisibleLimit(180)
    setPpvPrice('')
    setPpvError('')
    setPpvMediaMap({})
    setReplyError('')
    setAutoModeError('')
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
      .flatMap(m => {
        const ppv = m.media_context?.ppv
        if (!ppv) return []
        const ids = (ppv as any).media_ids?.length
          ? ((ppv as any).media_ids as string[])
          : (ppv.media_id ? [ppv.media_id as string] : [])
        return ids
      })
      .filter(id => !(id in ppvMediaMap))

    if (unresolved.length === 0) return

    const uniqueIds = [...new Set(unresolved)]

    let cancelled = false
    apiFetch(`/vault-media-urls/${creatorId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: uniqueIds }),
    })
      .then(async response => {
        if (!response.ok) throw new Error(`Media lookup failed (${response.status})`)
        return response.json()
      })
      .then(body => {
        if (!cancelled) {
          setPpvMediaMap(prev => ({ ...prev, ...(body.media ?? {}) }))
        }
      })
      .catch(() => {
        if (cancelled) return
        const missing = Object.fromEntries(uniqueIds.map(mediaId => [
          mediaId,
          { url: null, thumbnail_url: null, mimetype: null },
        ]))
        setPpvMediaMap(prev => ({ ...prev, ...missing }))
      })
    return () => { cancelled = true }
  }, [messages, creatorId, ppvMediaMap])

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
    setQueuedMessages(parts.slice(1))
    textareaRef.current?.focus()
  }

  const refetchSuggestions = () => {
    if (!fan) return
    const lastFanMessage = [...messages].reverse().find(m => m.role === 'fan')
    if (!lastFanMessage) return
    setLoading(true)
    setReplyError('')
    void generateSuggestions(fan.id, creatorId, lastFanMessage.content).catch(error => {
      setLoading(false)
      setReplyError(String(error instanceof Error ? error.message : error))
    })
    // New suggestions will arrive via Supabase realtime subscription
    // which already sets setSuggestions and setLoading(false)
  }

  const openPpvComposer = async (mode: OperatorPPVMode = 'manual') => {
    if (!fan) return
    setPpvComposerMode(mode)
    setPpvComposerOpen(true)
    setPpvOptionsLoading(true)
    setPpvOptions(null)
    setPpvSelectedIds([])
    setPpvSelectedSetId(null)
    setPpvAlbumFilter('all')
    setPpvStatusFilter('all')
    setPpvVisibleLimit(180)
    setPpvPrice('')
    setPpvError('')
    try {
      const response = await apiFetch(`/fan/${fan.id}/operator-ppv-options?creator_id=${creatorId}`)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 404) throw new Error('The operator PPV route is not available on the deployed backend yet.')
        throw new Error(body.detail || `Could not load vault media (${response.status})`)
      }
      setPpvOptions(body)
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      setPpvError(message === 'Failed to fetch'
        ? 'Could not reach the backend. Confirm the latest backend deployment is healthy and allows this dashboard origin.'
        : message)
    } finally {
      setPpvOptionsLoading(false)
    }
  }

  const choosePpvSet = (set: OperatorPPVSet) => {
    setPpvSelectedSetId(set.id)
    setPpvSelectedIds(set.media_ids ?? [])
    const cents = Number(set.base_price_cents ?? 0) || Math.round(Number(set.suggested_price ?? 0) * 100)
    setPpvPrice(cents > 0 ? String(cents / 100) : '')
    setPpvError('')
  }

  const togglePpvMedia = (mediaId: string) => {
    setPpvSelectedSetId(null)
    setPpvSelectedIds(current => current.includes(mediaId)
      ? current.filter(id => id !== mediaId)
      : [...current, mediaId])
    setPpvError('')
  }

  const sendOperatorPpv = async () => {
    if (!fan || ppvSending) return
    const priceCents = Math.round(Number(ppvPrice) * 100)
    if (!ppvSelectedIds.length || !Number.isFinite(priceCents) || priceCents <= 0) {
      setPpvError('Select media and enter a valid price.')
      return
    }
    setPpvSending(true)
    setPpvError('')
    try {
      const response = await apiFetch(`/fan/${fan.id}/operator-ppv?creator_id=${creatorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_ids: ppvSelectedIds,
          price_cents: priceCents,
          message_content: ppvMessage,
          set_id: ppvSelectedSetId,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || 'PPV could not be sent')
      setPpvComposerOpen(false)
      setPpvSelectedIds([])
      setPpvSelectedSetId(null)
      setPpvPrice('')
    } catch (error) {
      setPpvError(String(error instanceof Error ? error.message : error))
    } finally {
      setPpvSending(false)
    }
  }

  const handleTextareaKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    const value = inputValue.trim()
    if (!value || !fan || replySending) return
    const blocked = getBlockedMatches(value)
    if (blocked.length > 0) {
      const confirmed = window.confirm(`⚠️ Message contains blocked word(s): ${blocked.join(', ')}\n\nSend anyway?`)
      if (!confirmed) return
    }
    setReplySending(true)
    setReplyError('')
    try {
      const result = await sendReply(fan.id, creatorId, value, false)
      onReplySent(value, result.message_id)
      setInputValue('')
      handleAfterSend()
    } catch (error) {
      setReplyError(String(error instanceof Error ? error.message : error))
    } finally {
      setReplySending(false)
    }
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
  const ppvAlbums = ppvOptions
    ? Array.from(new Set(ppvOptions.media.map(media => media.album_title || 'Uncategorized'))).sort((a, b) => a.localeCompare(b))
    : []
  const ppvMediaByExternalId = ppvOptions
    ? new Map(ppvOptions.media.map(media => [media.external_media_id, media]))
    : new Map<string, OperatorPPVMedia>()
  const ppvVisibleMedia = (ppvOptions?.media ?? []).filter(media => {
    const inAlbum = ppvAlbumFilter === 'all' || (media.album_title || 'Uncategorized') === ppvAlbumFilter
    const inStatus = ppvStatusFilter === 'all'
      || (ppvStatusFilter === 'unused' && ['unused', 'voided'].includes(media.fan_sale_status))
      || (ppvStatusFilter === 'payment_pending' && media.fan_sale_status === 'payment_pending')
      || (ppvStatusFilter === 'sold' && media.fan_sale_status === 'sold')
      || (ppvStatusFilter === 'not_sold' && ['sent', 'abandoned'].includes(media.fan_sale_status))
    return inAlbum && inStatus
  })
  const ppvStatusCounts: Record<OperatorPPVStatusFilter, number> = {
    all: ppvOptions?.media.length ?? 0,
    unused: ppvOptions?.media.filter(media => ['unused', 'voided'].includes(media.fan_sale_status)).length ?? 0,
    payment_pending: ppvOptions?.media.filter(media => media.fan_sale_status === 'payment_pending').length ?? 0,
    not_sold: ppvOptions?.media.filter(media => ['sent', 'abandoned'].includes(media.fan_sale_status)).length ?? 0,
    sold: ppvOptions?.media.filter(media => media.fan_sale_status === 'sold').length ?? 0,
  }

  const fanAutoMode = fan.auto_mode
  const buttonLabel = autoAvailable === false
    ? '🔒 Locked'
    : fanAutoMode === true
      ? '● Auto'
      : fanAutoMode === false
        ? '○ Off'
        : 'Auto'
  const buttonColor = fanAutoMode === true ? 'var(--green)' : fanAutoMode === false ? '#ff6b6b' : 'var(--text-muted)'
  const buttonBg = fanAutoMode === true ? 'rgba(76,175,130,0.15)' : fanAutoMode === false ? 'rgba(255,80,80,0.1)' : 'transparent'
  const buttonBorder = fanAutoMode === true ? '1px solid rgba(76,175,130,0.4)' : fanAutoMode === false ? '1px solid rgba(255,80,80,0.3)' : '1px solid var(--border)'

  return (
    <>
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
            disabled={autoModeSaving || autoAvailable === false}
            onClick={() => {
              if (!onToggleAutoMode || autoModeSaving || autoAvailable === false) return
              setAutoModeSaving(true)
              setAutoModeError('')
              void Promise.resolve(onToggleAutoMode())
                .catch(error => {
                  setAutoModeError(String(
                    error instanceof Error ? error.message : error
                  ))
                })
                .finally(() => setAutoModeSaving(false))
            }}
            title={
              autoModeError
              || (autoAvailable === false
                ? 'Approve at least one vault set before enabling auto mode.'
                : undefined)
            }
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 4,
              cursor: autoModeSaving
                ? 'wait'
                : autoAvailable === false
                  ? 'not-allowed'
                  : 'pointer',
              background: buttonBg,
              color: buttonColor,
              border: buttonBorder,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              opacity: autoModeSaving || autoAvailable === false ? 0.6 : 1,
            }}
          >
            {autoModeSaving ? 'Saving…' : buttonLabel}
          </button>
          {autoModeError && (
            <span style={{ maxWidth: 240, fontSize: 10, color: '#ff8b8b' }}>
              {autoModeError}
            </span>
          )}
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
                const mediaIds: string[] = ((ppv as any).media_ids?.length ? (ppv as any).media_ids
                                            : ppv.media_id ? [ppv.media_id] : []) as string[]

                return (
                  <div style={{ marginTop: 8, background: 'rgba(155,143,212,0.1)', border: '1px solid rgba(155,143,212,0.3)', borderRadius: 8, overflow: 'hidden' }}>
                    {mediaIds.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, lineHeight: 0 }}>
                        {mediaIds.map((mid) => {
                          const resolved = ppvMediaMap[mid]
                          const thumbSrc = resolved?.thumbnail_url ?? resolved?.url ?? null
                          const isVideo = resolved?.mimetype?.startsWith('video') ?? false
                          const w = mediaIds.length > 1 ? '32.7%' : '100%'
                          if (!thumbSrc) return (
                            <div key={mid} style={{ width: w, maxWidth: 220, aspectRatio: '3/4', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>…</div>
                          )
                          return (
                            <div key={mid} style={{ position: 'relative', cursor: 'pointer', width: w, maxWidth: 220, aspectRatio: '3/4', overflow: 'hidden' }}
                              onClick={async () => {
                                const { data } = await supabase
                                  .from('creator_vault_media')
                                  .select('url, mimetype, filename')
                                  .eq('creator_id', creatorId)
                                  .eq('fansly_media_id', mid)
                                  .maybeSingle()
                                if (data?.url) setMediaPreview(data as any)
                              }}>
                              <img src={thumbSrc} alt="PPV preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
                                <span style={{ fontSize: 18 }}>{isVideo ? '🎬' : '🔒'}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <div style={{ padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 600 }}>
                        💎 PPV Sent — ${ppv.price}{mediaIds.length > 1 ? ` · ${mediaIds.length} pcs` : ''}
                      </div>
                    </div>
                  </div>
                )
              })()}
              {(msg as any).attachments?.map((att: any, i: number) => (
                att.type === 'ppv' ? (
                  <div key={i} style={{ marginTop: 8 }}>
                    {att.thumbnail_url ? (
                      <div style={{
                        position: 'relative', width: 200, borderRadius: 10, overflow: 'hidden',
                        border: '1px solid rgba(155,143,212,0.35)',
                      }}>
                        <img
                          src={att.thumbnail_url}
                          alt=""
                          style={{
                            width: '100%', display: 'block',
                            filter: 'blur(10px)',
                            transform: 'scale(1.05)',
                          }}
                        />
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: 'rgba(0,0,0,0.45)',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                          <div style={{ fontSize: 22 }}>
                            {att.mimetype?.startsWith('video') ? '▶' : '🔒'}
                          </div>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: 'var(--purple)',
                          }}>
                            💎 ${att.price}
                          </div>
                          {att.title && (
                            <div style={{
                              fontSize: 10, color: 'rgba(255,255,255,0.7)',
                              textAlign: 'center', padding: '0 8px',
                              maxWidth: 180, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {att.title}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        padding: '10px 12px',
                        background: 'rgba(155,143,212,0.15)',
                        border: '1px solid rgba(155,143,212,0.3)',
                        borderRadius: 8, fontSize: 12,
                      }}>
                        <div style={{ color: 'var(--purple)', fontWeight: 600, marginBottom: 4 }}>
                          💎 PPV Sent — ${att.price}
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>{att.title}</div>
                      </div>
                    )}
                  </div>
                ) : att.thumbnail_url ? (
                  <div
                    key={i}
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/vault-media-url/${creatorId}/${att.media_id}`
                        )
                        const data = await res.json()
                        if (data.url) {
                          setMediaPreview({ url: data.url, mimetype: data.mimetype ?? '', filename: data.filename ?? '' })
                        }
                      } catch (e) {
                        console.error('Failed to get media URL', e)
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      marginTop: 6,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--border)',
                      position: 'relative',
                      maxWidth: 220,
                    }}
                  >
                    <img
                      src={att.thumbnail_url}
                      style={{
                        width: '100%',
                        display: 'block',
                        borderRadius: 8,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '4px 8px',
                      background: 'rgba(0,0,0,0.6)',
                      fontSize: 11,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      💎 ${att.price} · click to preview
                    </div>
                  </div>
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
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => void openPpvComposer('set')}
              style={{
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 12,
              }}
            >
              Choose a set
            </button>
            <button
              type="button"
              onClick={() => void openPpvComposer('manual')}
              style={{
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid rgba(155,143,212,0.4)',
                background: 'rgba(155,143,212,0.1)', color: 'var(--purple)', fontSize: 12,
              }}
            >
              Build locked PPV
            </button>
          </div>
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
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            fontSize: 11, color: 'var(--green)', padding: '2px 8px 8px',
          }}>
            <span>+ {queuedMessages.length} message{queuedMessages.length > 1 ? 's' : ''} queued</span>
            <button
              type="button"
              aria-label="Cancel queued messages"
              title="Cancel queued messages"
              onClick={() => setQueuedMessages([])}
              style={{
                padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)', fontSize: 10,
                cursor: 'pointer',
              }}
            >
              × clear
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onInput={handleTextareaInput}
          onKeyDown={handleTextareaKeyDown}
          rows={1}
          placeholder="type your own reply..."
          disabled={replySending}
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
        {replyError && (
          <div style={{ color: '#e57689', fontSize: 11, marginTop: 6 }}>{replyError}</div>
        )}
      </div>
    </div>
    {ppvComposerOpen && (
      <div
        onClick={() => { if (!ppvSending) setPpvComposerOpen(false) }}
        style={{
          position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.78)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
      >
        <div
          onClick={event => event.stopPropagation()}
          style={{
            width: 1000, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>
                {ppvComposerMode === 'set' ? 'Choose a set' : 'Build locked PPV'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {ppvComposerMode === 'set'
                  ? `Review every item in an approved set before sending it to ${fan.display_name}.`
                  : `Build a custom bundle by album and sale history. Status is specific to ${fan.display_name}.`}
              </div>
            </div>
            <button type="button" onClick={() => setPpvComposerOpen(false)} disabled={ppvSending}
              style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>

          {ppvOptionsLoading ? (
            <div style={{ padding: 30, color: 'var(--text-muted)', textAlign: 'center' }}>Loading vault…</div>
          ) : ppvOptions ? (
            <>
              {ppvComposerMode === 'set' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                  {ppvOptions.approved_sets.length === 0 ? (
                    <div style={{ padding: 24, borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
                      No approved sets are available. Approve a set on the Sets page first.
                    </div>
                  ) : ppvOptions.approved_sets.map(set => {
                    const active = ppvSelectedSetId === set.id
                    const baseCents = Number(set.base_price_cents ?? 0) || Math.round(Number(set.suggested_price ?? 0) * 100)
                    const minCents = Number(set.min_price_cents ?? 0)
                    const maxCents = Number(set.max_price_cents ?? 0)
                    return (
                      <div key={set.id} style={{
                        padding: 14, borderRadius: 10,
                        border: active ? '1px solid var(--purple)' : '1px solid var(--border)',
                        background: active ? 'rgba(155,143,212,0.09)' : 'var(--bg-elevated)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 650 }}>{set.title || 'Approved set'}</div>
                            {set.description && (
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 5 }}>
                                {set.description}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                              {set.media_ids?.length ?? 0} media · default ${(baseCents / 100).toFixed(0)}
                              {minCents > 0 && maxCents >= minCents ? ` · allowed $${(minCents / 100).toFixed(0)}–$${(maxCents / 100).toFixed(0)}` : ''}
                            </div>
                          </div>
                          <button type="button" onClick={() => choosePpvSet(set)} style={{
                            padding: '7px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                            border: active ? '1px solid var(--purple)' : '1px solid var(--border-strong)',
                            background: active ? 'var(--purple)' : 'var(--bg-surface)',
                            color: active ? '#111' : 'var(--text-secondary)',
                          }}>
                            {active ? 'Selected' : 'Select set'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                          {set.media_ids.map(mediaId => {
                            const media = ppvMediaByExternalId.get(mediaId)
                            const source = media?.thumbnail_url || media?.url
                            const statusColor = media?.fan_sale_status === 'sold' ? 'var(--green)'
                              : media?.fan_sale_status === 'payment_pending' ? '#e0b46d'
                              : media?.fan_sale_status === 'sent' ? 'var(--purple)'
                              : 'var(--text-muted)'
                            return (
                              <button key={mediaId} type="button"
                                disabled={!media?.url}
                                title={media?.url ? 'Preview media' : 'Preview unavailable'}
                                onClick={() => media?.url && setMediaPreview({
                                  url: media.url,
                                  mimetype: media.mimetype || '',
                                  filename: media.filename || media.external_media_id,
                                })}
                                style={{
                                  position: 'relative', width: 84, height: 108, padding: 0, overflow: 'hidden',
                                  borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)',
                                  cursor: media?.url ? 'zoom-in' : 'default', color: 'var(--text-muted)',
                                }}>
                                {source && !media?.mimetype?.startsWith('video') ? (
                                  <img src={source} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : media?.thumbnail_url ? (
                                  <img src={media.thumbnail_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                                    {media?.mimetype?.startsWith('video') ? '🎬' : 'Media'}
                                  </div>
                                )}
                                {media && <span style={{
                                  position: 'absolute', left: 4, bottom: 4, padding: '2px 5px', borderRadius: 999,
                                  background: 'rgba(0,0,0,0.76)', color: statusColor, fontSize: 8,
                                  textTransform: 'uppercase', letterSpacing: '0.03em',
                                }}>{media.fan_sale_status.replace('_', ' ')}</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 3 }}>Sale history</span>
                    {(['all', 'unused', 'payment_pending', 'not_sold', 'sold'] as OperatorPPVStatusFilter[]).map(status => {
                      const active = ppvStatusFilter === status
                      const label = status === 'not_sold'
                        ? 'Not sold'
                        : status === 'payment_pending'
                          ? 'Pending'
                          : status[0].toUpperCase() + status.slice(1)
                      return (
                        <button key={status} type="button" onClick={() => { setPpvStatusFilter(status); setPpvVisibleLimit(180) }} style={{
                          padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11,
                          border: active ? '1px solid var(--purple)' : '1px solid var(--border)',
                          background: active ? 'rgba(155,143,212,0.13)' : 'transparent',
                          color: active ? 'var(--purple)' : 'var(--text-muted)',
                        }}>{label} ({ppvStatusCounts[status]})</button>
                      )
                    })}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Choose an album</div>
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, marginBottom: 4 }}>
                    {[{ value: 'all', label: 'All media', count: ppvOptions.media.length }, ...ppvAlbums.map(album => ({
                      value: album,
                      label: album,
                      count: ppvOptions.media.filter(media => (media.album_title || 'Uncategorized') === album).length,
                    }))].map(album => {
                      const active = ppvAlbumFilter === album.value
                      return (
                        <button key={album.value} type="button" onClick={() => { setPpvAlbumFilter(album.value); setPpvVisibleLimit(180) }} style={{
                          flex: '0 0 126px', minHeight: 76, padding: '10px 9px', borderRadius: 8, cursor: 'pointer',
                          border: active ? '1px solid var(--purple)' : '1px solid var(--border)',
                          background: active ? 'rgba(155,143,212,0.11)' : 'var(--bg-elevated)',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: 20, lineHeight: 1 }}>📁</div>
                          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.label}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>{album.count} items</div>
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Individual media</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{ppvVisibleMedia.length} shown</div>
                  </div>
                  {ppvVisibleMedia.length === 0 ? (
                    <div style={{ padding: 24, borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
                      No media matches this album and sale-history filter.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8, maxHeight: 330, overflow: 'auto', paddingRight: 4 }}>
                      {ppvVisibleMedia.slice(0, ppvVisibleLimit).map(media => {
                        const active = ppvSelectedIds.includes(media.external_media_id)
                        const statusColor = media.fan_sale_status === 'sold' ? 'var(--green)'
                          : media.fan_sale_status === 'payment_pending' ? '#e0b46d'
                          : media.fan_sale_status === 'sent' ? 'var(--purple)'
                          : 'var(--text-muted)'
                        const source = media.thumbnail_url || media.url
                        return (
                          <div key={media.id} role="checkbox" aria-checked={active} tabIndex={0}
                            onClick={() => togglePpvMedia(media.external_media_id)}
                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') togglePpvMedia(media.external_media_id) }}
                            style={{
                              overflow: 'hidden', borderRadius: 8, cursor: 'pointer', textAlign: 'left', position: 'relative',
                              border: active ? '2px solid var(--purple)' : '1px solid var(--border)',
                              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                            }}>
                            <div style={{ aspectRatio: '1/1', background: 'var(--bg-main)', overflow: 'hidden', position: 'relative' }}>
                              {source && !media.mimetype?.startsWith('video') ? (
                                <img src={source} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : media.thumbnail_url ? (
                                <img src={media.thumbnail_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 20 }}>
                                  {media.mimetype?.startsWith('video') ? '🎬' : 'Media'}
                                </div>
                              )}
                              {active && <div style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: 12, fontWeight: 800 }}>✓</div>}
                              {media.url && <button type="button" title="Preview media" onClick={event => {
                                event.stopPropagation()
                                setMediaPreview({ url: media.url || '', mimetype: media.mimetype || '', filename: media.filename || media.external_media_id })
                              }} style={{
                                position: 'absolute', left: 5, top: 5, padding: '3px 6px', borderRadius: 5,
                                border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(0,0,0,0.7)',
                                color: '#fff', fontSize: 9, cursor: 'zoom-in',
                              }}>Preview</button>}
                            </div>
                            <div style={{ padding: '7px 8px' }}>
                              <div style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.filename || media.ai_description || media.external_media_id}</div>
                              <div style={{ fontSize: 9, color: statusColor, marginTop: 3, textTransform: 'uppercase' }}>{media.fan_sale_status.replace('_', ' ')}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {ppvVisibleMedia.length > ppvVisibleLimit && (
                    <button
                      type="button"
                      onClick={() => setPpvVisibleLimit(limit => limit + 180)}
                      style={{
                        marginTop: 10, padding: '6px 10px', borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                      }}
                    >
                      Show 180 more ({ppvVisibleMedia.length - ppvVisibleLimit} remaining)
                    </button>
                  )}
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, marginTop: 18 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Message</label>
                  <input value={ppvMessage} onChange={event => setPpvMessage(event.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Price</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-muted)' }}>$</span>
                    <input type="number" min="1" value={ppvPrice} onChange={event => setPpvPrice(event.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px 9px 24px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              </div>

              {ppvError && <div style={{ color: '#e57689', fontSize: 12, marginTop: 10 }}>{ppvError}</div>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{ppvSelectedIds.length} media selected</div>
                <button type="button" onClick={() => void sendOperatorPpv()}
                  disabled={ppvSending || !ppvSelectedIds.length}
                  style={{
                    padding: '9px 16px', borderRadius: 8, fontWeight: 700,
                    border: '1px solid var(--silver)', background: 'var(--silver)', color: '#111',
                    cursor: ppvSending ? 'wait' : 'pointer', opacity: ppvSending || !ppvSelectedIds.length ? 0.5 : 1,
                  }}>
                  {ppvSending ? 'Sending…' : 'Send locked PPV'}
                </button>
              </div>
            </>
          ) : null}
          {!ppvOptionsLoading && ppvError && !ppvOptions && (
            <div>
              <div style={{ color: '#e57689', fontSize: 12 }}>{ppvError}</div>
              <button type="button" onClick={() => void openPpvComposer(ppvComposerMode)}
                style={{ marginTop: 10, padding: '7px 11px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    {mediaPreview && (
      <div
        onClick={() => setMediaPreview(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
      >
        <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0, maxWidth: '80vw' }}>
          {mediaPreview.mimetype?.startsWith('video') ? (
            <video
              src={mediaPreview.url}
              controls
              style={{ maxHeight: '80vh', maxWidth: '80vw', borderRadius: 8, background: '#000' }}
            />
          ) : (
            <img
              src={mediaPreview.url}
              style={{ maxHeight: '80vh', maxWidth: '80vw', objectFit: 'contain', borderRadius: 8 }}
            />
          )}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6, textAlign: 'center' }}>
            {mediaPreview.filename}
          </div>
        </div>
      </div>
    )}
    </>
  )
}

export default React.memo(ConversationView)
