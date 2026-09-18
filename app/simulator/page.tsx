'use client'

/**
 * The Full Auto simulator — a persistent testing workspace.
 *
 * Type as the fan; the REAL Full Auto pipeline answers as the creator. Nothing
 * here is a second engine: the backend runs whichever persistent conversation
 * core this test fan resolves to, through the same application entry point
 * used by production, then persists the reply locally. No API Fansly traffic
 * happens at any point.
 *
 * Three panes:
 *   LEFT    persistent test conversations, and a control to create a new one
 *   CENTRE  the complete DB-backed conversation, PPV cards included
 *   RIGHT   the persisted state of the selected test fan, and its pending
 *           scheduled actions with a Run now control
 *
 * Below 1024px those three do not fit side by side, so a segmented control
 * moves between them and the chat is the surface you land on. Every pane stays
 * mounted in that mode — the whole workspace is state on THIS component, so the
 * selected fan, the draft in the composer, the fan's AI stack profile and the
 * loaded state panel all survive switching. Which panes are on screen is
 * decided by a media query reading `data-pane`; nothing here measures the
 * window.
 *
 * The transcript is read from the same `messages` rows the production Chats view
 * reads. It survives a refresh, leaving and returning, a browser restart and
 * coming back tomorrow, because it was never anywhere else. The previous
 * version kept it in React state.
 *
 * The page renders nothing at all until the backend confirms the capability. An
 * account without it that navigates here directly sees the same empty state as
 * a route that does not exist, rather than an "access denied" screen announcing
 * a feature it may not use. The backend rejects the endpoints independently;
 * this is presentation only.
 *
 * TWO TIERS. Agency operators simulate their own creators, with their own
 * creators' approved vault. The cross-tenant catalog mirror is owner only, and
 * for everyone else its panel is ABSENT rather than disabled — a greyed-out
 * "Mirror from another creator" control would disclose that other creators
 * exist and that somebody can copy between them, which is precisely what the
 * backend refuses to reveal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import SimulatedChat from '../../components/SimulatedChat'
import SimulationStatePanel from '../../components/SimulationStatePanel'
import {
  fetchAIStackRegistry,
  saveSimulationFanAIStack,
  type AIStackRegistry,
} from '../../lib/aiStack'
import {
  canSelectConversationCore,
  fetchConversationCores,
  saveSimulationFanConversationCore,
  type ConversationCoreRegistry,
} from '../../lib/conversationCore'
import { dedupeMessages } from '../../lib/messages'
import {
  canMirrorCatalog,
  canSeeOperatorDiagnostics,
  canSimulate,
  completedTurnMessage,
  fetchLatestSimulationTurn,
  fetchSimulationCapabilities,
  fetchSimulationCreators,
  fetchSimulationTurn,
  describeSimulationFailure,
  newIdempotencyKey,
  simulatePpvOutcome,
  startSimulatedTurn,
  SimulationTurnBusyError,
  turnIsTerminal,
  turnProgressMessage,
  TURN_POLL_INTERVAL_MS,
  type SimulationCapabilities,
  type SimulationCreator,
  type SimulationTestFan,
  type SimulationTurn,
} from '../../lib/simulation'
import {
  actionOutcomeMessage,
  createSimulationTestFan,
  deleteSimulationCatalogMirror,
  describeMirrorSource,
  fetchMirrorSources,
  fetchSimulationState,
  mirrorSimulationCatalog,
  mirrorSummary,
  runSimulationActionNow,
  type MirrorSource,
  type SimulationScheduledAction,
  type SimulationState,
} from '../../lib/simulationWorkspace'
import { supabase } from '../../lib/supabase'
import type { Message } from '../../types'

const PANEL: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}

const HISTORY_LIMIT = 300

export default function SimulatorPage() {
  const [capabilities, setCapabilities] = useState<SimulationCapabilities | null>(null)
  const [registry, setRegistry] = useState<AIStackRegistry | null>(null)
  const [coreRegistry, setCoreRegistry] = useState<ConversationCoreRegistry | null>(null)
  const [creators, setCreators] = useState<SimulationCreator[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [fanId, setFanId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [state, setState] = useState<SimulationState | null>(null)
  const [stateLoading, setStateLoading] = useState(false)
  const [draft, setDraft] = useState('')
  // The turn currently being watched. Non-terminal means the pipeline is
  // running on the backend, which is a completely different thing from this
  // browser waiting on a request — the browser can reload, and this comes back.
  const [turn, setTurn] = useState<SimulationTurn | null>(null)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  // Which pane a narrow viewport is showing. Chat is the default surface, the
  // way it is the default on a desktop with all three up. Desktop CSS ignores
  // this entirely, so setting it there is harmless.
  const [pane, setPane] = useState<'chat' | 'list' | 'state'>('chat')
  const [fast, setFast] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [lastActionResult, setLastActionResult] = useState('')
  const [creatingFan, setCreatingFan] = useState(false)
  const [newFanName, setNewFanName] = useState('')
  const [mirrorSourceId, setMirrorSourceId] = useState('')
  const [mirrorSources, setMirrorSources] = useState<MirrorSource[]>([])
  const [mirroring, setMirroring] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Guards a late history read from overwriting a newer one after a fan switch.
  const historyToken = useRef(0)

  useEffect(() => {
    let cancelled = false
    void fetchSimulationCapabilities().then(value => {
      if (cancelled) return
      setCapabilities(value)
      if (!value.auto_simulation) return
      void fetchSimulationCreators().then(rows => {
        if (!cancelled) setCreators(rows)
      })
      void fetchAIStackRegistry().then(found => {
        if (!cancelled) setRegistry(found)
      })
      // Conversational architecture selection can affect live creator traffic,
      // so its registry and controls are platform-owner only.
      if (value.operator_diagnostics) {
        void fetchConversationCores().then(found => {
          if (!cancelled) setCoreRegistry(found)
        })
      }
      // Mirror SOURCES come from their own owner-only, cross-tenant listing,
      // and are requested ONLY by an account the backend said may mirror.
      // Asking on behalf of an agency would be a wasted 404 at best and, if
      // the refusal were ever rendered, a disclosure at worst.
      if (canMirrorCatalog(value)) {
        void fetchMirrorSources().then(rows => {
          if (!cancelled) setMirrorSources(rows)
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const allowed = canSimulate(capabilities)
  const mayMirror = canMirrorCatalog(capabilities)
  const maySeeDiagnostics = canSeeOperatorDiagnostics(capabilities)
  const maySelectCore = canSelectConversationCore(capabilities)
  const creator = useMemo(
    () => creators.find(row => row.id === creatorId) ?? null,
    [creators, creatorId],
  )
  const fans = useMemo(() => creator?.test_fans ?? [], [creator])
  const fan = useMemo(
    () => fans.find(row => row.id === fanId) ?? null,
    [fans, fanId],
  )

  useEffect(() => {
    if (!creatorId && creators.length > 0) setCreatorId(creators[0].id)
  }, [creators, creatorId])

  useEffect(() => {
    if (fans.length === 0) {
      setFanId('')
      return
    }
    if (!fans.some(row => row.id === fanId)) setFanId(fans[0].id)
  }, [fans, fanId])

  /**
   * Read the persisted conversation.
   *
   * The same query the production Chats view uses, against the same table. This
   * is the only place the transcript comes from — there is deliberately no
   * simulator-side message store to fall out of sync with it.
   */
  const loadHistory = useCallback(async () => {
    if (!creatorId || !fanId) {
      setMessages([])
      return
    }
    const token = ++historyToken.current
    setHistoryLoading(true)
    const { data, error: readError } = await supabase
      .from('messages')
      .select('*')
      .eq('fan_id', fanId)
      .eq('creator_id', creatorId)
      .order('sent_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (token !== historyToken.current) return
    setHistoryLoading(false)
    if (readError) {
      setError(`Could not read the conversation: ${readError.message}`)
      return
    }
    setMessages(dedupeMessages(((data ?? []) as Message[]).slice().reverse()))
  }, [creatorId, fanId])

  const loadState = useCallback(async () => {
    if (!creatorId || !fanId) {
      setState(null)
      return
    }
    setStateLoading(true)
    const found = await fetchSimulationState(creatorId, fanId)
    setStateLoading(false)
    setState(found)
  }, [creatorId, fanId])

  const refresh = useCallback(async () => {
    await Promise.all([loadHistory(), loadState()])
  }, [loadHistory, loadState])

  /**
   * Adopt a turn and, when it has finished, show what it produced.
   *
   * One place decides what the operator is told about a turn, so the poll, the
   * submission and the reload-recovery cannot drift into three different
   * vocabularies for the same three states.
   */
  const adoptTurn = useCallback(
    async (next: SimulationTurn) => {
      setTurn(next)
      if (!turnIsTerminal(next)) {
        setNotice('')
        return
      }
      // Terminal. Fetch the persisted reply automatically — the operator must
      // never have to press Refresh to find out what happened.
      await refresh()
      setNotice(completedTurnMessage(next))
    },
    [refresh],
  )

  useEffect(() => {
    setError('')
    setNotice('')
    setLastActionResult('')
    setTurn(null)
    setTurnStartedAt(null)
    void loadHistory()
    void loadState()
  }, [loadHistory, loadState])

  /**
   * Resume whatever this conversation was doing, on open and after a reload.
   *
   * The incident's second failure mode was that a turn in flight existed
   * nowhere the browser could see it. It does now, so arriving at a
   * conversation asks: is something running, and did anything finish while I
   * was away? A turn that is still processing is adopted and watched; one that
   * already finished is left alone, because its reply is in the transcript the
   * history read is loading anyway.
   */
  useEffect(() => {
    if (!creatorId || !fanId) return
    let cancelled = false
    void fetchLatestSimulationTurn(creatorId, fanId)
      .then(found => {
        if (cancelled || !found || turnIsTerminal(found)) return
        setTurn(found)
        setTurnStartedAt(Date.parse(found.created_at ?? '') || Date.now())
      })
      // A backend that has not deployed the durable turn yet, or a read that
      // failed: there is simply nothing to resume. Never a reason to show an
      // error on a conversation the operator has only just opened.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [creatorId, fanId])

  const watching = turn !== null && !turnIsTerminal(turn)

  /**
   * Poll the turn while it runs.
   *
   * A poll is a pure read on the backend — it starts nothing and restarts
   * nothing — so this is free to keep asking until the turn is terminal. A
   * transient read failure is ignored rather than surfaced: the turn is
   * durable, and the next tick will find it.
   */
  useEffect(() => {
    if (!watching || !creatorId || !fanId || !turn) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void fetchSimulationTurn(creatorId, fanId, turn.turn_id)
        .then(next => {
          if (!cancelled) void adoptTurn(next)
        })
        .catch(() => {})
    }, TURN_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [watching, creatorId, fanId, turn, adoptTurn])

  // Drives the "still generating" wording. Separate from the poll so the
  // message advances on its own clock rather than only when a read lands.
  useEffect(() => {
    if (!watching || turnStartedAt === null) {
      setElapsedMs(0)
      return
    }
    setElapsedMs(Date.now() - turnStartedAt)
    const timer = window.setInterval(
      () => setElapsedMs(Date.now() - turnStartedAt),
      1_000,
    )
    return () => window.clearInterval(timer)
  }, [watching, turnStartedAt])

  /**
   * Submit one fan message.
   *
   * Returns as soon as the turn is RECORDED. The reply arrives through the
   * poll above, so a writer spending a minute on provider recovery is a
   * progress message rather than the "Timeout ... and was cancelled" this
   * screen used to show while the backend was still working — and then
   * persisted a reply anyway.
   *
   * The idempotency key is generated once per press and kept for the whole
   * submission, so a retry of a request that may or may not have landed cannot
   * become a second turn.
   */
  const send = async () => {
    const message = draft.trim()
    if (!message || !creatorId || !fanId || busy || watching) return
    setBusy(true)
    setError('')
    setNotice('')
    setDraft('')
    const key = newIdempotencyKey()
    try {
      const started = await startSimulatedTurn(creatorId, fanId, message, fast, key)
      setTurnStartedAt(Date.now())
      await adoptTurn(started)
      // The fan's own message is already persisted, so show it immediately
      // rather than leaving the composer looking like nothing happened.
      await loadHistory()
    } catch (caught) {
      if (caught instanceof SimulationTurnBusyError) {
        // Not an error the operator has to resolve: it names the turn they
        // should already be watching. Adopt it instead of asking them to
        // retry, which is how one fan message becomes two creator replies.
        setDraft(message)
        if (caught.turnId) {
          setTurnStartedAt(Date.now())
          setTurn({ turn_id: caught.turnId, status: 'processing' })
        }
        setNotice('That fan already has a turn running. Waiting for it to finish.')
      } else {
        setDraft(message)
        setError(describeSimulationFailure(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const ppvOutcome = async (outcome: 'purchase' | 'decline') => {
    // Not while a turn is mid-flight: moving commercial state underneath a
    // running pipeline is exactly the interleaving the per-fan serialisation
    // exists to prevent.
    if (!creatorId || !fanId || busy || watching) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await simulatePpvOutcome(creatorId, fanId, outcome)
      if (result.status === 'no_pending_ppv') {
        setNotice('There is no pending simulated PPV for this fan.')
      }
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const runAction = async (action: SimulationScheduledAction) => {
    if (!creatorId || !fanId || busyActionId) return
    setBusyActionId(action.id)
    setError('')
    try {
      const result = await runSimulationActionNow(creatorId, fanId, action.id)
      setLastActionResult(
        `${action.label}: ${actionOutcomeMessage(result.outcome, result.messages_sent)}`,
      )
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    } finally {
      setBusyActionId(null)
      await refresh()
    }
  }

  const addTestFan = async () => {
    if (!creatorId || creatingFan) return
    setCreatingFan(true)
    setError('')
    try {
      const created = await createSimulationTestFan(creatorId, newFanName)
      setNewFanName('')
      setCreators(current =>
        current.map(row =>
          row.id === creatorId
            ? { ...row, test_fans: [...row.test_fans, created as SimulationTestFan] }
            : row,
        ),
      )
      setFanId(created.id)
      setNotice(
        `Created ${created.display_name} (${created.platform_fan_id}). No history, no purchases, no learned state.`,
      )
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    } finally {
      setCreatingFan(false)
    }
  }

  /**
   * Mirror another creator's vault metadata into this test creator's catalog.
   *
   * Owner only, and it does not make anything deliverable: mirrored rows are
   * marked simulation_only (live planning filters them out) and carry rewritten
   * `sim:` media ids, which are not platform ids and are refused by every
   * delivery path. The point is realistic PLANNING input — coherence grouping,
   * escalation, photo/video mixes, multi-step allocation, price probing inside
   * approved bounds — which a thin test vault cannot exercise at all.
   */
  const runMirror = async (remove: boolean) => {
    if (!creatorId || !mirrorSourceId || mirroring) return
    setMirroring(true)
    setError('')
    setNotice('')
    try {
      const result = remove
        ? await deleteSimulationCatalogMirror(mirrorSourceId, creatorId)
        : await mirrorSimulationCatalog(mirrorSourceId, creatorId)
      setNotice(mirrorSummary(result))
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    } finally {
      setMirroring(false)
    }
  }

  const setFanProfile = async (profileId: string) => {
    if (!creatorId || !fanId) return
    setError('')
    try {
      const stored = await saveSimulationFanAIStack(
        creatorId,
        fanId,
        profileId || null,
      )
      setCreators(current =>
        current.map(row =>
          row.id === creatorId
            ? {
                ...row,
                test_fans: row.test_fans.map(entry =>
                  entry.id === fanId ? { ...entry, ai_stack_profile: stored } : entry,
                ),
              }
            : row,
        ),
      )
      await loadState()
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    }
  }

  const setFanCore = async (coreId: string) => {
    if (!creatorId || !fanId || !maySelectCore) return
    setError('')
    try {
      const stored = await saveSimulationFanConversationCore(
        creatorId,
        fanId,
        coreId || null,
      )
      setCreators(current =>
        current.map(row =>
          row.id === creatorId
            ? {
                ...row,
                test_fans: row.test_fans.map(entry =>
                  entry.id === fanId ? { ...entry, conversation_core: stored } : entry,
                ),
              }
            : row,
        ),
      )
      await loadState()
    } catch (caught) {
      setError(describeSimulationFailure(caught))
    }
  }

  // Not allowed, or not answered yet: render nothing. No access-denied screen,
  // because the feature must look as though it does not exist.
  if (!allowed) return null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Pane switcher. Hidden on desktop, where all three are already up. */}
      <div className="cleo-segmented" role="tablist" aria-label="Simulator panes">
        <button type="button" role="tab" data-active={pane === 'chat'} aria-selected={pane === 'chat'} onClick={() => setPane('chat')}>
          Chat
        </button>
        <button type="button" role="tab" data-active={pane === 'list'} aria-selected={pane === 'list'} onClick={() => setPane('list')}>
          Fans &amp; setup
        </button>
        <button type="button" role="tab" data-active={pane === 'state'} aria-selected={pane === 'state'} onClick={() => setPane('state')}>
          State
        </button>
      </div>

      <div className="cleo-panes cleo-panes-sim" data-pane={pane}>
      {/* LEFT — persistent test conversations */}
      <div className="cleo-pane cleo-pane-list">
        <div style={{ ...PANEL, minHeight: '100%', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            Creator
          </div>
          <select
            value={creatorId}
            onChange={event => setCreatorId(event.target.value)}
            style={{ ...PANEL, width: '100%', marginTop: 6, padding: '6px 8px', color: 'var(--text-primary)' }}
          >
            {creators.length === 0 && <option value="">No creators</option>}
            {creators.map(row => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Test conversations
          </div>
          {fans.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              No test fans yet. Create one below — simulation is restricted to
              fans whose platform id begins with <code>test_</code>, server side.
            </div>
          )}
          {fans.map(entry => (
            <button
              key={entry.id}
              type="button"
              onClick={() => { setFanId(entry.id); setPane('chat') }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 4,
                padding: '7px 9px',
                borderRadius: 6,
                border: `1px solid ${entry.id === fanId ? 'var(--border-strong)' : 'transparent'}`,
                background: entry.id === fanId ? 'var(--bg-elevated)' : 'transparent',
                color: 'var(--text-primary)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <div>{entry.display_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {entry.ai_stack_profile ?? 'inherits AI stack'}
                {maySeeDiagnostics && ` · ${entry.conversation_core ?? 'inherits core'}`}
              </div>
            </button>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <input
            value={newFanName}
            onChange={event => setNewFanName(event.target.value)}
            placeholder="name (optional)"
            style={{ ...PANEL, width: '100%', padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12 }}
          />
          <button
            type="button"
            onClick={() => void addTestFan()}
            disabled={!creatorId || creatingFan}
            style={{
              ...PANEL,
              width: '100%',
              marginTop: 6,
              padding: '6px 8px',
              color: 'var(--silver)',
              fontSize: 12,
              cursor: creatingFan ? 'wait' : 'pointer',
            }}
          >
            {creatingFan ? 'Creating…' : '+ New test fan'}
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
            Creates a real, persistent simulation fan with a generated{' '}
            <code>test_</code> id. It cannot become a live Fansly fan: the
            platform id is produced by the backend, never by this form.
          </div>
        </div>

        {/* Cross-tenant catalog mirror. Owner only, and ABSENT — not disabled
            — for everyone else: a greyed-out control would still disclose that
            other creators exist and that somebody can copy between them. */}
        {mayMirror && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Simulation catalog
          </div>
          <select
            value={mirrorSourceId}
            onChange={event => setMirrorSourceId(event.target.value)}
            style={{ ...PANEL, width: '100%', padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12 }}
          >
            <option value="">Mirror from…</option>
            {mirrorSources
              // A creator cannot mirror onto itself: that would mark its own
              // vault simulation-only and take it out of live planning.
              .filter(row => row.creator_id !== creatorId)
              .map(row => (
                <option key={row.creator_id} value={row.creator_id}>
                  {describeMirrorSource(row)}
                </option>
              ))}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => void runMirror(false)}
              disabled={!mirrorSourceId || mirroring}
              style={{ ...PANEL, flex: 1, padding: '5px 8px', color: 'var(--silver)', fontSize: 11, cursor: mirroring ? 'wait' : 'pointer' }}
            >
              {mirroring ? 'Working…' : 'Mirror / refresh'}
            </button>
            <button
              type="button"
              onClick={() => void runMirror(true)}
              disabled={!mirrorSourceId || mirroring}
              style={{ ...PANEL, padding: '5px 8px', color: 'var(--text-secondary)', fontSize: 11, cursor: mirroring ? 'wait' : 'pointer' }}
            >
              Remove
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
            Copies vault metadata into <strong>{creator?.name ?? 'this creator'}</strong>{' '}
            so simulated planning has realistic content. Sources may include
            creators you are not otherwise assigned to; reading one here grants
            no other access to it and never writes to it. Mirrored rows are
            badged TEST / SIMULATION and carry rewritten <code>sim:</code> ids —
            excluded from live planning and impossible to deliver.
          </div>
        </div>
        )}
      </div>

      </div>

      {/* CENTRE — the complete persisted conversation */}
      <div className="cleo-pane cleo-pane-chat" style={{ ...PANEL }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ margin: 0, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
            {fan?.display_name ?? 'Simulator'}
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            You type as the fan. The real Full Auto pipeline answers as the
            creator, and every message is persisted. Nothing reaches Fansly.
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '6px 14px' }}>
          <SimulatedChat
            creatorId={creatorId}
            fanName={fan?.display_name ?? 'Fan'}
            messages={messages}
            loading={historyLoading}
            showDebug={showDebug}
            operatorDiagnostics={maySeeDiagnostics}
          />
        </div>

        {/* A turn in flight is a PRODUCT status, not a spinner and not a
            provider diagnosis. An agency operator is never told that a host is
            rate limiting, which host, which model, or that a fallback exists.
            The owner's Debug details toggle adds the turn id, which is all an
            operator needs to find it in the logs. */}
        {watching && (
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              borderTop: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
            role="status"
            aria-live="polite"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--purple)',
                flexShrink: 0,
              }}
            />
            <span>{turnProgressMessage(elapsedMs)}</span>
            {showDebug && maySeeDiagnostics && turn && (
              <span style={{ color: 'var(--text-faint)' }}>turn {turn.turn_id}</span>
            )}
          </div>
        )}

        {(error || notice) && !watching && (
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              borderTop: '1px solid var(--border)',
              color: error ? '#ff8b8b' : 'var(--text-secondary)',
            }}
          >
            {error || notice}
          </div>
        )}

        <div className="cleo-composer" style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              disabled={busy || watching || !fanId}
              style={{ ...PANEL, flex: 1, minWidth: 0, padding: '8px 10px', color: 'var(--text-primary)' }}
            />
            {/* Disabled while this fan has a turn running. The backend refuses
                a second concurrent turn outright, so this is the UI agreeing
                with a rule rather than being the rule. */}
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || watching || !fanId || draft.trim() === ''}
              style={{
                ...PANEL,
                flexShrink: 0,
                padding: '8px 14px',
                cursor: busy || watching ? 'wait' : 'pointer',
                color: 'var(--silver)',
                opacity: busy || watching || !fanId ? 0.6 : 1,
              }}
            >
              {busy || watching ? 'Running…' : 'Send as fan'}
            </button>
          </div>

          {/* Simulator-only controls. Deliberately below the composer and
              visually separate, so the conversation itself never reads as a
              debug console. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={fast} onChange={event => setFast(event.target.checked)} />
              Fast replies
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showDebug} onChange={event => setShowDebug(event.target.checked)} />
              Debug details
            </label>
            <button
              type="button"
              onClick={() => void ppvOutcome('purchase')}
              disabled={busy || watching || !fanId}
              style={{ ...PANEL, padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Simulate purchase
            </button>
            <button
              type="button"
              onClick={() => void ppvOutcome('decline')}
              disabled={busy || watching || !fanId}
              style={{ ...PANEL, padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Simulate decline
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              style={{ ...PANEL, padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT — persisted state and delayed behaviour */}
      <div className="cleo-pane cleo-pane-state">
        <SimulationStatePanel
          state={state}
          loading={stateLoading}
          busyActionId={busyActionId}
          lastActionResult={lastActionResult}
          onRunAction={action => void runAction(action)}
          aiStackControl={
            fanId ? (
              <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ ...PANEL, padding: 12 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
                  AI stack for this test fan
                </div>
                <select
                  value={fan?.ai_stack_profile ?? ''}
                  onChange={event => void setFanProfile(event.target.value)}
                  style={{ ...PANEL, width: '100%', padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12 }}
                >
                  <option value="">Inherit creator / production default</option>
                  {/* The reduced representation an agency receives is exactly
                      what this control needs: an id to send and a name to
                      show. */}
                  {(registry?.profiles ?? []).map(profile => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
                  Persistent, and scoped to this test fan only. Point one test
                  fan at the legacy stack and another at V2 to compare them turn
                  for turn. Real fans are never affected.
                </div>
              </div>
              {maySelectCore && coreRegistry && (
                <div style={{ ...PANEL, padding: 12 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Conversation core for this test fan
                  </div>
                  <select
                    value={fan?.conversation_core ?? ''}
                    onChange={event => void setFanCore(event.target.value)}
                    style={{ ...PANEL, width: '100%', padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12 }}
                  >
                    <option value="">Inherit creator / deployment (rollback)</option>
                    {coreRegistry.cores.map(core => (
                      <option key={core.id} value={core.id}>{core.name}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
                    Owner-only and persistent. Select Semantic owner v1 to test
                    the replacement through the real Simulator/Full Auto path;
                    clear it to roll back immediately. Real fans are unaffected.
                  </div>
                </div>
              )}
              </div>
            ) : null
          }
        />
      </div>
      </div>
    </div>
  )
}
