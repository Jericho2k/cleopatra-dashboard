'use client'

/**
 * Owner-only Full Auto simulator.
 *
 * Chat as a fan against a test_ fan and watch the REAL Full Auto pipeline
 * answer. Nothing here is a second engine: the page posts one message and the
 * backend runs the same analyzer, commercial orchestrator, session planning,
 * conversation director and writer that production runs, then persists the
 * reply locally. No API Fansly traffic happens at any point.
 *
 * The page renders nothing at all until the backend confirms the capability.
 * An ordinary agency account that navigates here directly sees the same empty
 * state as a route that does not exist, rather than an "access denied" screen
 * announcing a feature it may not use. The backend rejects the endpoints
 * independently; this is presentation only.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  canSimulate,
  fetchSimulationCapabilities,
  fetchSimulationCreators,
  sendSimulatedFanMessage,
  simulatePpvOutcome,
  type SimulationCapabilities,
  type SimulationCreator,
} from '../../lib/simulation'

type TranscriptEntry = {
  key: string
  role: 'fan' | 'creator'
  content: string
  simulatedPpv?: { price?: number; mediaIds?: string[] } | null
}

const PANEL: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}

export default function SimulatorPage() {
  const [capabilities, setCapabilities] = useState<SimulationCapabilities | null>(null)
  const [creators, setCreators] = useState<SimulationCreator[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [fanId, setFanId] = useState('')
  const [draft, setDraft] = useState('')
  const [fast, setFast] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSimulationCapabilities().then(value => {
      if (cancelled) return
      setCapabilities(value)
      if (value.auto_simulation) {
        void fetchSimulationCreators().then(rows => {
          if (!cancelled) setCreators(rows)
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const allowed = canSimulate(capabilities)
  const creator = useMemo(
    () => creators.find(row => row.id === creatorId) ?? null,
    [creators, creatorId],
  )

  useEffect(() => {
    if (!creatorId && creators.length > 0) setCreatorId(creators[0].id)
  }, [creators, creatorId])

  useEffect(() => {
    const fans = creator?.test_fans ?? []
    if (fans.length === 0) {
      setFanId('')
      return
    }
    if (!fans.some(fan => fan.id === fanId)) setFanId(fans[0].id)
  }, [creator, fanId])

  // Switching fan starts a fresh view. The fan's stored history is NOT reset —
  // every simulated turn still loads it server-side as conversation context;
  // this panel only shows what this session sent and received.
  useEffect(() => {
    setTranscript([])
  }, [creatorId, fanId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [transcript])

  const send = async () => {
    const message = draft.trim()
    if (!message || !creatorId || !fanId || busy) return
    setBusy(true)
    setError('')
    setDraft('')
    setTranscript(current => [
      ...current,
      { key: `fan-${Date.now()}`, role: 'fan', content: message },
    ])
    try {
      const turn = await sendSimulatedFanMessage(creatorId, fanId, message, fast)
      const replies = turn.creator_messages.map(entry => {
        const ppv = (entry.media_context as { ppv?: Record<string, unknown> } | null)?.ppv
        return {
          key: entry.id,
          role: 'creator' as const,
          content: entry.content,
          simulatedPpv: ppv
            ? {
                price: Number(ppv.price ?? 0),
                mediaIds: Array.isArray(ppv.media_ids)
                  ? (ppv.media_ids as unknown[]).map(String)
                  : undefined,
              }
            : null,
        }
      })
      setTranscript(current => [...current, ...replies])
      if (replies.length === 0) {
        setError(
          turn.analysis_degraded
            ? 'Full Auto sent nothing: the situation analyzer was degraded and failed closed.'
            : 'Full Auto decided to send nothing this turn.',
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const ppvOutcome = async (outcome: 'purchase' | 'decline') => {
    if (!creatorId || !fanId || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await simulatePpvOutcome(creatorId, fanId, outcome)
      if (result.status === 'no_pending_ppv') {
        setError('There is no pending simulated PPV for this fan.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  // Not allowed, or not answered yet: render nothing. No access-denied screen,
  // because the feature must look as though it does not exist.
  if (!allowed) return null

  const fans = creator?.test_fans ?? []

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
            Simulator
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Chat as a fan against a test conversation. Runs the real Full Auto
            pipeline and persists locally. No messages reach Fansly.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Creator
            <select
              value={creatorId}
              onChange={event => setCreatorId(event.target.value)}
              style={{ ...PANEL, padding: '6px 8px', color: 'var(--text-primary)', minWidth: 180 }}
            >
              {creators.length === 0 && <option value="">No creators</option>}
              {creators.map(row => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Test fan
            <select
              value={fanId}
              onChange={event => setFanId(event.target.value)}
              style={{ ...PANEL, padding: '6px 8px', color: 'var(--text-primary)', minWidth: 180 }}
            >
              {fans.length === 0 && <option value="">No test_ fans</option>}
              {fans.map(fan => (
                <option key={fan.id} value={fan.id}>{fan.display_name}</option>
              ))}
            </select>
          </label>
        </div>

        {fans.length === 0 && creators.length > 0 && (
          <div style={{ ...PANEL, padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            This creator has no fans whose platform id begins with{' '}
            <code>test_</code>. Simulation is restricted to those, server side.
          </div>
        )}

        <div style={{ ...PANEL, padding: 16, minHeight: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            Conversation
          </div>
          {transcript.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Nothing sent in this session yet. Existing history for this fan is
              still used as context by every turn — open the fan in Chats to
              read it.
            </div>
          )}
          {transcript.map(entry => (
            <div key={entry.key} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ color: entry.role === 'fan' ? 'var(--text-muted)' : 'var(--silver)', fontWeight: 600 }}>
                {entry.role === 'fan' ? 'Fan' : 'Creator'}:{' '}
              </span>
              <span>{entry.content}</span>
              {entry.simulatedPpv && (
                <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  simulated PPV ${entry.simulatedPpv.price?.toFixed(2)}
                  {showDebug && entry.simulatedPpv.mediaIds
                    ? ` · ${entry.simulatedPpv.mediaIds.join(', ')}`
                    : ''}
                </span>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {error && (
          <div style={{ ...PANEL, padding: 10, fontSize: 12, color: '#ff8b8b' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="type as fan..."
            disabled={busy || !fanId}
            style={{ ...PANEL, flex: 1, padding: '8px 10px', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !fanId || draft.trim() === ''}
            style={{
              ...PANEL,
              padding: '8px 14px',
              cursor: busy ? 'wait' : 'pointer',
              color: 'var(--silver)',
              opacity: busy || !fanId ? 0.6 : 1,
            }}
          >
            {busy ? 'Running…' : 'Send simulated fan message'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={fast} onChange={event => setFast(event.target.checked)} />
            Fast mode
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showDebug} onChange={event => setShowDebug(event.target.checked)} />
            Show media ids on simulated PPV
          </label>
          <button
            type="button"
            onClick={() => void ppvOutcome('purchase')}
            disabled={busy || !fanId}
            style={{ ...PANEL, padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Simulate purchase
          </button>
          <button
            type="button"
            onClick={() => void ppvOutcome('decline')}
            disabled={busy || !fanId}
            style={{ ...PANEL, padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Simulate decline
          </button>
        </div>
      </div>
    </div>
  )
}
