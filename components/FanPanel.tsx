'use client'

import React, { useState, useEffect } from 'react'
import type { Fan } from '../types'
import { supabase } from '../lib/supabase'
import { User } from 'lucide-react'
import { apiFetch } from '../lib/api'
import {
  describeHistoryProgress,
  summarizeHistoryImport,
  type FanHistoryProgress,
} from '../lib/fanHistory'
import {
  describePaidItem,
  summarizeContentAccess,
  initialSelection,
  repairOffer,
  type ContentAccessEvidence,
} from '../lib/contentAccess'
import { useRealtimeRecovery } from '../lib/realtime-recovery'

export interface FanPanelProps {
  fan: Fan | null
  creatorId: string
  onInsertMessage?: (text: string) => void
  onHistoryLoaded?: () => void
  showToast?: (message: string) => void
  /**
   * Narrow-viewport navigation back to the thread. Below 1024px this panel is
   * a screen of its own rather than a column beside the conversation, so it
   * needs its own way back. Hidden by CSS wherever both are already visible.
   */
  onBack?: () => void
}

type Tab = 'profile' | 'sales'

/** The review reason services/content_access.py writes. */
const CONTENT_ACCESS_REASON = 'content_access_issue'

type ReviewResolution =
  | 'repair_ppv'
  | 'mark_purchased'
  | 'mark_not_sent'
  | 'mark_not_purchased'
  | 'resume_ai'
  // Content-access holds. The backend refuses plain 'resume_ai' for these, so
  // an operator has to record what actually happened rather than putting
  // automation back in front of an unanswered complaint.
  | 'resend_paid_content'
  | 'access_restored'
  | 'not_an_access_issue'

type FullAutoStatus = {
  effective_auto_mode: boolean
  needs_human_review: boolean
  review_reason: string | null
  commercial_state: {
    status: string
    next_followup_at: string | null
    next_followup_type: string | null
    last_session_completed_at: string | null
    last_abandoned_ppv_at: string | null
    desired_experience?: string | null
    confirmed_budget_cents?: number | null
    accepted_offer_label?: string | null
    accepted_offer_price_cents?: number | null
    last_session_experience?: string | null
    last_session_revenue_cents?: number | null
  }
  session: {
    status?: string
    payment_state?: string
    current_index?: number
    plan?: unknown[]
  } | null
  pending_ppv: {
    sent_at?: string
    expires_at?: string
    price?: number
    verification_attempts?: number
  } | null
  scheduled_actions: Array<{
    id: string
    action_type: string
    status: string
    execute_at: string
    last_error?: string | null
  }>
  auto_mode_reason?: string
  ppv_media_bundles?: Record<string, string[]>
  fan_intelligence?: {
    facts?: Array<{ category?: string; fact_key?: string; value?: unknown; confidence?: number }>
    hard_limits?: unknown[]
    conflicts?: Array<{ fact_key?: string; values?: unknown[] }>
  }
  buyer_lifecycle?: Record<string, any>
  affordability?: Record<string, any>
  price_learning?: Record<string, any>
}

type SalesEntry = {
  date: string
  item: string
  amount: number
  chatter: string
  reason?: string
  media_id?: string
  media_ids?: string[]
  payment_reference?: string
}

type MediaPreviewItem = {
  mediaId: string
  url: string
  thumbnailUrl: string | null
  mimetype: string | null
}

/** Render the canonical creator legend JSONB into readable multi-line text. */
function renderLegend(legend: any): string {
  if (!legend) return ''
  const labels: [string, string][] = [
    ['name', 'Name'], ['origin', 'From'], ['age', 'Age'],
    ['job', 'Job'], ['background', 'Background'],
  ]
  const lines = labels
    .filter(([k]) => (legend[k] ?? '').toString().trim())
    .map(([k, label]) => `${label}: ${legend[k]}`)
  const other = Array.isArray(legend.other) ? legend.other.filter((o: string) => (o ?? '').trim()) : []
  if (other.length) lines.push('Other: ' + other.join('; '))
  return lines.join('\n')
}

function formatOperationalTime(value?: string | null): string {
  if (!value) return 'unknown'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function displayTrackedValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not learned yet'
  if (Array.isArray(value)) return value.map(displayTrackedValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replaceAll('_', ' ')
}

function formatTrackedMoney(cents: unknown): string {
  const parsed = Number(cents)
  return Number.isFinite(parsed) ? `$${(parsed / 100).toFixed(parsed % 100 ? 2 : 0)}` : 'Not learned yet'
}

export default function FanPanel({ fan, creatorId, onHistoryLoaded, showToast, onBack }: FanPanelProps) {
  const recoveryTick = useRealtimeRecovery()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [showMemberNote, setShowMemberNote] = useState(false)
  const [showModelNote, setShowModelNote] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [creatorLegend, setCreatorLegend] = useState<string>('')
  const [memberNote, setMemberNote] = useState('')
  const [fanNotes, setFanNotes] = useState('')
  const [fanPreferences, setFanPreferences] = useState<string[]>([])
  const [needsReview, setNeedsReview] = useState<{ frozen: boolean; reason: string }>({ frozen: false, reason: '' })
  const [salesLog, setSalesLog] = useState<SalesEntry[]>([])
  const [notSoldLog, setNotSoldLog] = useState<SalesEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  // Historical import is necessarily partial: API Fansly caps a chat page at ten
  // messages, so a long conversation is hundreds of paid round trips and one
  // press advances a durable cursor rather than finishing the job. The operator
  // needs to see where that cursor is, not just what the last press returned.
  const [historyProgress, setHistoryProgress] = useState<FanHistoryProgress | null>(null)
  const [details, setDetails] = useState({
    age: '', payday: '', hobbies: '', relationship_status: '',
  })
  const [aiSummary, setAiSummary] = useState<any>(null)
  const [showAiProfile, setShowAiProfile] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const [fullAutoStatus, setFullAutoStatus] = useState<FullAutoStatus | null>(null)
  const [reviewResolution, setReviewResolution] = useState<string | null>(null)
  // Evidence behind a content-access hold. Null while it loads; the panel shows
  // a loading line rather than a verdict, because "not loaded" and "nothing
  // was bought" lead an operator to opposite actions.
  const [accessEvidence, setAccessEvidence] = useState<ContentAccessEvidence | null>(null)
  // Which purchase the operator says the complaint is about. Empty means "not
  // chosen yet", and when more than one purchase is repairable that is exactly
  // what it stays until they choose: the backend refuses an unqualified resend
  // rather than assuming the newest, and the panel must not quietly supply the
  // assumption it removed.
  const [accessSelection, setAccessSelection] = useState<string>('')
  const [accessError, setAccessError] = useState('')
  const [statusRefresh, setStatusRefresh] = useState(0)

  const mediaIdsForEntry = (entry: SalesEntry): string[] => {
    const primary = entry.media_id || (entry.item?.startsWith('PPV media ') ? entry.item.slice('PPV media '.length).trim() : '')
    const direct = entry.media_ids?.length ? entry.media_ids : (primary ? [primary] : [])
    const recovered = primary ? fullAutoStatus?.ppv_media_bundles?.[primary] : undefined
    return [...new Set((recovered?.length ? recovered : direct).filter(Boolean))]
  }

  const openMediaPreview = async (mediaIds: string[], cid: string) => {
    const uniqueIds = [...new Set(mediaIds.filter(Boolean))]
    const resolved = await Promise.all(uniqueIds.map(async mediaId => {
      try {
        const res = await apiFetch(`/vault-media-url/${cid}/${mediaId}`)
        if (!res.ok) return null
        const data = await res.json()
        if (!data.url) return null
        return {
          mediaId,
          url: data.url as string,
          thumbnailUrl: data.thumbnail_url as string | null,
          mimetype: data.mimetype as string | null,
        } satisfies MediaPreviewItem
      } catch {
        return null
      }
    }))
    const items = resolved.filter((item): item is MediaPreviewItem => item !== null)
    if (items.length) setMediaPreview({ items, index: 0 })
    else showToast?.('Could not load this PPV media')
  }

  useEffect(() => {
    if (!creatorId) { setCreatorLegend(''); return }
    void supabase
      .from('creators')
      .select('legend')
      .eq('id', creatorId)
      .single()
      .then(({ data }) => {
        setCreatorLegend(renderLegend((data as any)?.legend))
      })
  }, [creatorId])

  // Live-update the MODEL LEGEND when the canonical creator facts change.
  useEffect(() => {
    if (!creatorId) return
    const channel = supabase
      .channel(`creator-legend-${creatorId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'creators',
        filter: `id=eq.${creatorId}`,
      }, (payload) => {
        setCreatorLegend(renderLegend((payload.new as any)?.legend))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [creatorId, recoveryTick])

  useEffect(() => {
    if (!fan?.id) return
    void supabase
      .from('fans')
      .select('sales_log, not_sold_log, needs_human_review, review_reason, member_note, notes, preferences, ai_summary, age, payday, hobbies, relationship_status')
      .eq('id', fan.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          showToast?.(error.message)
          return
        }
        setSalesLog((data as any)?.sales_log ?? [])
        setNotSoldLog((data as any)?.not_sold_log ?? [])
        setNeedsReview({ frozen: !!(data as any)?.needs_human_review, reason: (data as any)?.review_reason ?? '' })
        setMemberNote((data as any)?.member_note ?? '')
        setFanNotes((data as any)?.notes ?? '')
        setFanPreferences(Array.isArray((data as any)?.preferences) ? (data as any).preferences : [])
        setAiSummary((data as any)?.ai_summary ?? null)
        setDetails({
          age: (data as any)?.age || (data as any)?.ai_summary?.age || '',
          payday: (data as any)?.payday || (data as any)?.ai_summary?.payday || '',
          hobbies: (data as any)?.hobbies || (data as any)?.ai_summary?.hobbies || '',
          relationship_status: (data as any)?.relationship_status || (data as any)?.ai_summary?.relationship_status || '',
        })
      })
  }, [fan?.id, statusRefresh])

  useEffect(() => {
    if (!fan?.id) { setFullAutoStatus(null); return }
    let cancelled = false
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const response = await apiFetch(`/fan/${fan.id}/full-auto-status`)
        if (!response.ok) return
        const body = await response.json() as FullAutoStatus
        if (!cancelled) setFullAutoStatus(body)
      } catch {
        // Keep the conversation usable if the operational panel is unavailable.
      } finally {
        loading = false
      }
    }
    void load()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [fan?.id, recoveryTick, statusRefresh])

  useEffect(() => {
    if (fan) {
      const summary = fan.ai_summary
      setAiSummary(summary ?? null)
      setDetails({
        age: (fan as any).age || summary?.age || '',
        payday: (fan as any).payday || summary?.payday || '',
        hobbies: (fan as any).hobbies || summary?.hobbies || '',
        relationship_status: (fan as any).relationship_status || summary?.relationship_status || '',
      })
      setMemberNote(fan.member_note ?? '')
      setFanNotes(fan.notes ?? '')
      setFanPreferences(fan.preferences ?? [])
    }
  }, [fan?.id])

  // The durable backfill checkpoint, read on open. Costs no provider call: the
  // route reads the stored cursor, so it answers even with the connector off.
  useEffect(() => {
    let cancelled = false
    setHistoryProgress(null)
    if (!fan?.id || !creatorId) return
    ;(async () => {
      try {
        const res = await apiFetch(`/fan-history/${creatorId}/${fan.id}`)
        const data = await res.json()
        if (!cancelled) setHistoryProgress(data.history ?? null)
      } catch {
        // History progress is informational. A panel that cannot show it is
        // still a working panel, and a toast here would be noise on every open.
      }
    })()
    return () => { cancelled = true }
  }, [fan?.id, creatorId])

  useEffect(() => {
    if (!fan) return
    const channel = supabase
      .channel(`fan-${fan.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'fans',
        filter: `id=eq.${fan.id}`,
      }, (payload) => {
        const updated = payload.new as any
        setAiSummary(updated.ai_summary ?? null)
        if (Array.isArray(updated.sales_log)) setSalesLog(updated.sales_log)
        if (Array.isArray(updated.not_sold_log)) setNotSoldLog(updated.not_sold_log)
        setNeedsReview({ frozen: !!updated.needs_human_review, reason: updated.review_reason ?? '' })
        setMemberNote(updated.member_note ?? '')
        setFanNotes(updated.notes ?? '')
        setFanPreferences(Array.isArray(updated.preferences) ? updated.preferences : [])
        setDetails({
          age: updated.age || updated.ai_summary?.age || '',
          payday: updated.payday || updated.ai_summary?.payday || '',
          hobbies: updated.hobbies || updated.ai_summary?.hobbies || '',
          relationship_status: updated.relationship_status || updated.ai_summary?.relationship_status || '',
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fan?.id, recoveryTick])



  async function handleDetailBlur(field: string, value: string) {
    if (!fan) return
    await supabase.from('fans').update({ [field]: value }).eq('id', fan.id)
  }

  async function loadHistory() {
    if (!fan || !creatorId) return
    setLoadingHistory(true)
    try {
      const res = await apiFetch(`/load-history/${creatorId}/${fan.id}`,
        { method: 'POST' }
      )
      const data = await res.json()
      onHistoryLoaded?.()
      setHistoryProgress(data.history ?? null)
      showToast?.(summarizeHistoryImport(data))
    } finally {
      setLoadingHistory(false)
    }
  }

  // The evidence is fetched only for the hold it belongs to, so an ordinary
  // frozen conversation costs no extra request.
  useEffect(() => {
    if (!fan?.id || needsReview.reason !== CONTENT_ACCESS_REASON) {
      setAccessEvidence(null)
      setAccessError('')
      setAccessSelection('')
      return
    }
    let cancelled = false
    setAccessEvidence(null)
    setAccessError('')
    setAccessSelection('')
    apiFetch(`/fan/${fan.id}/content-access`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) {
          setAccessError(body.detail || 'Could not read what this customer paid for')
          return
        }
        const evidence = body as ContentAccessEvidence
        setAccessEvidence(evidence)
        // Pre-selected only when there is nothing to choose between.
        setAccessSelection(initialSelection(evidence))
      })
      .catch(error => {
        if (!cancelled) setAccessError(String(error instanceof Error ? error.message : error))
      })
    return () => { cancelled = true }
  }, [fan?.id, needsReview.reason, statusRefresh])

  async function resolveReview(resolution: ReviewResolution) {
    if (!fan?.id || reviewResolution) return
    // The backend refuses an unqualified resend when more than one purchase is
    // repairable. Catching it here means the operator is asked rather than
    // shown an error, but the backend refusal is the boundary that matters:
    // this check is a courtesy, not the rule.
    if (
      resolution === 'resend_paid_content' &&
      accessEvidence?.selection_required &&
      !accessSelection
    ) {
      setAccessError('Choose which purchase they cannot open before resending.')
      return
    }
    if (resolution === 'mark_not_sent' && !window.confirm('Confirm that this PPV did not reach the fan. This will make the session eligible to send again.')) return
    if (resolution === 'mark_not_purchased' && !window.confirm('Confirm on Fansly that this locked PPV was not purchased. It will be recorded as abandoned and may receive the configured follow-up.')) return
    if (resolution === 'resend_paid_content' && !window.confirm('Send this customer the content they already paid for, again and free of charge. They will not be charged a second time.')) return
    setReviewResolution(resolution)
    try {
      // Who is resolving it, the same way the PPV approval flow records it
      // (app/monetization/page.tsx). A repair that sent a customer a free copy
      // of something needs an actor on the record; "the backend did it" is not
      // an auditable answer.
      const { data: { user } } = await supabase.auth.getUser()
      const operatorId = user?.id ?? null
      const response = await apiFetch(`/fan/${fan.id}/resolve-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution,
          // Which purchase, and which hold. Both are sent so the repair is
          // bound to what was actually on screen: the reference stops an
          // older item's complaint resending a newer item, and the case id
          // stops the decision landing on a hold raised since it was read.
          reference: accessSelection,
          review_case_id: accessEvidence?.review_case_id ?? '',
          resolved_by: operatorId,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || 'Could not resolve this conversation')
      // The repair can succeed while the conversation stays frozen — a crisis
      // hold raised during the platform call is not this resolution's to
      // clear. Believing the local optimistic update in that case would show
      // an operator a resumed conversation that is still stopped.
      if (body.hold_superseded) {
        setAccessError(
          'Sent. This conversation is still on hold for something else, ' +
          'raised while the repair was running — reopen it to see what.',
        )
      } else {
        setNeedsReview({ frozen: false, reason: '' })
      }
      setStatusRefresh(value => value + 1)
      showToast?.(
        resolution === 'repair_ppv' ? 'Payment tracking repaired — AI resumed'
        : resolution === 'mark_purchased' ? 'Purchase recorded — AI resumed'
        : resolution === 'mark_not_sent' ? 'PPV marked not sent — AI resumed'
        : resolution === 'mark_not_purchased' ? 'PPV marked not purchased — AI resumed'
        : resolution === 'resend_paid_content' ? 'Paid content sent again, free — AI resumed'
        : resolution === 'access_restored' ? 'Access recorded as restored — AI resumed'
        : resolution === 'not_an_access_issue' ? 'Recorded as not an access problem — AI resumed'
        : 'AI resumed for this fan'
      )
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : 'Could not resolve this conversation')
    } finally {
      setReviewResolution(null)
    }
  }

  const LABEL_STYLE = {
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
    marginBottom: 12,
  }

  const CARD_STYLE = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    padding: 16,
  }

  if (!fan) {
    return (
      <aside style={{
        height: '100%', width: '100%', background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)', display: 'flex',
        flexDirection: 'column', gap: 14,
        alignItems: 'center', justifyContent: 'center', padding: 20,
        color: 'var(--text-muted)', fontSize: 14, textAlign: 'center',
      }}>
        Select a conversation.
        {onBack && (
          <button
            type="button"
            className="cleo-only-compact"
            onClick={onBack}
            style={{
              padding: '8px 14px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
            }}
          >
            ‹ Back
          </button>
        )}
      </aside>
    )
  }

  const tierStyles: React.CSSProperties =
    fan.spend_tier === 'whale' ? { border: '1px solid var(--silver)', color: 'var(--silver)' }
    : fan.spend_tier === 'active' ? { border: '1px solid var(--green)', color: 'var(--green)' }
    : fan.spend_tier === 'casual' ? { border: '1px solid var(--purple)', color: 'var(--purple)' }
    : { border: '1px solid var(--text-faint)', color: 'var(--text-faint)' }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Profile', icon: <User size={14} /> },
    { id: 'sales', label: 'Sales', icon: <span style={{ fontSize: 12 }}>$</span> },
  ]
  const historyLine = describeHistoryProgress(historyProgress)
  const currentPreview = mediaPreview?.items[mediaPreview.index]

  return (
    <>
    <aside style={{
      height: '100%', width: '100%', background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Fan header - always visible */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {onBack && (
            <button
              type="button"
              className="cleo-only-compact"
              onClick={onBack}
              aria-label="Back to conversation"
              style={{
                width: 34, height: 34, flexShrink: 0, padding: 0,
                alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                fontSize: 17, lineHeight: 1, cursor: 'pointer',
              }}
            >
              ‹
            </button>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            FAN PROFILE
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, ...CARD_STYLE }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Total spent</div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--silver)' }}>
              ${fan.total_spent}
            </span>
          </div>
          <div style={{ flex: 1, ...CARD_STYLE, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Tier</div>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
              padding: '3px 8px', borderRadius: 4, alignSelf: 'flex-start', ...tierStyles,
            }}>
              {fan.spend_tier}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            type="button"
            onClick={loadHistory}
            disabled={loadingHistory}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 4,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer',
              opacity: loadingHistory ? 0.5 : 1,
            }}
          >
            {loadingHistory ? 'Loading...' : '↓ Load History'}
          </button>
        </div>
        {historyLine && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', textAlign: 'right',
            marginTop: -8, marginBottom: 12,
          }}>
            {historyLine}
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        padding: '0 12px', flexShrink: 0,
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: '8px 4px', background: 'none', border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--silver)' : '2px solid transparent',
              color: activeTab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: 11, cursor: 'pointer', textTransform: 'uppercase',
              letterSpacing: '0.04em', transition: 'all 0.15s ease',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {t.icon} {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, paddingBottom: 48 }}>
        {needsReview.frozen && (
          <div style={{
            marginBottom: 16, padding: '12px 14px', borderRadius: 10,
            background: 'rgba(229,118,137,0.10)', border: '1px solid rgba(229,118,137,0.4)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e57689', marginBottom: 4 }}>
              ⚠ Auto mode paused — needs a human
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
              {needsReview.reason === 'ppv_purchase_verification_unavailable'
                ? 'The PPV was sent, but Fansly purchase verification is unavailable. Check the fan on Fansly, then record whether it was purchased.'
                : needsReview.reason === 'ppv_sent_but_reconciliation_not_persisted' || needsReview.reason === 'delivery_sent_but_not_persisted'
                ? 'The PPV may have reached the fan, but payment tracking was not fully saved. Choose the outcome below before AI can resume.'
                : needsReview.reason === CONTENT_ACCESS_REASON
                ? 'This customer says they cannot open something. AI stopped rather than answering a support problem with another offer.'
                : `This conversation was frozen${needsReview.reason ? ` (${needsReview.reason})` : ''}. Review it, then resume AI when you're ready.`}
            </div>
            {needsReview.reason === CONTENT_ACCESS_REASON ? (
              <ContentAccessResolution
                evidence={accessEvidence}
                error={accessError}
                busy={reviewResolution}
                selection={accessSelection}
                onSelect={setAccessSelection}
                onResolve={resolveReview}
              />
            ) : needsReview.reason === 'ppv_purchase_verification_unavailable' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('mark_purchased')} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(155,143,212,0.12)', border: '1px solid var(--purple)', color: 'var(--purple)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                  {reviewResolution === 'mark_purchased' ? 'Recording…' : 'Mark purchased'}
                </button>
                <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('mark_not_purchased')} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                  {reviewResolution === 'mark_not_purchased' ? 'Updating…' : 'Confirm not purchased'}
                </button>
              </div>
            ) : needsReview.reason === 'ppv_sent_but_reconciliation_not_persisted' || needsReview.reason === 'delivery_sent_but_not_persisted' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('repair_ppv')} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(94,214,154,0.12)', border: '1px solid var(--green)', color: 'var(--green)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                  {reviewResolution === 'repair_ppv' ? 'Repairing…' : 'Repair payment tracking'}
                </button>
                <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('mark_purchased')} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(155,143,212,0.12)', border: '1px solid var(--purple)', color: 'var(--purple)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                  {reviewResolution === 'mark_purchased' ? 'Recording…' : 'Mark purchased'}
                </button>
                <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('mark_not_sent')} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                  {reviewResolution === 'mark_not_sent' ? 'Updating…' : 'Confirm not sent'}
                </button>
              </div>
            ) : (
              <button type="button" disabled={!!reviewResolution} onClick={() => void resolveReview('resume_ai')} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: 'rgba(94,214,154,0.12)', border: '1px solid var(--green)', color: 'var(--green)', cursor: reviewResolution ? 'wait' : 'pointer', opacity: reviewResolution ? 0.55 : 1 }}>
                {reviewResolution === 'resume_ai' ? 'Resuming…' : 'Resume AI'}
              </button>
            )}
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {fullAutoStatus && (
              <div style={{ marginBottom: 20 }}>
                <div style={LABEL_STYLE}>FULL AUTO</div>
                <div style={{ ...CARD_STYLE, borderColor: fullAutoStatus.scheduled_actions.some(action => action.status === 'FAILED') ? 'rgba(229,118,137,0.45)' : 'var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-primary)' }}>
                        {fullAutoStatus.commercial_state.status.replaceAll('_', ' ')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Auto {fullAutoStatus.effective_auto_mode ? 'on' : 'off'}
                        {fullAutoStatus.session?.payment_state ? ` · ${fullAutoStatus.session.payment_state.replaceAll('_', ' ')}` : ''}
                      </div>
                    </div>
                    <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, background: fullAutoStatus.effective_auto_mode ? 'var(--green)' : 'var(--text-faint)' }} />
                  </div>

                  {fullAutoStatus.pending_ppv && (
                    <div style={{ padding: '8px 10px', borderRadius: 7, background: 'rgba(155,143,212,0.08)', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--purple)' }}>Locked PPV awaiting purchase</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                        ${fullAutoStatus.pending_ppv.price ?? 0} · expires {formatOperationalTime(fullAutoStatus.pending_ppv.expires_at)} · checked {fullAutoStatus.pending_ppv.verification_attempts ?? 0}×
                      </div>
                    </div>
                  )}

                  {fullAutoStatus.commercial_state.next_followup_at && (
                    <div style={{ padding: '8px 10px', borderRadius: 7, background: 'var(--bg-hover)', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {fullAutoStatus.commercial_state.next_followup_type?.replaceAll('_', ' ')}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                        {formatOperationalTime(fullAutoStatus.commercial_state.next_followup_at)}
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const response = await apiFetch(`/fan/${fan.id}/cancel-followup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action_type: fullAutoStatus.commercial_state.next_followup_type }),
                          })
                          if (!response.ok) { showToast?.('Could not cancel follow-up'); return }
                          setFullAutoStatus(current => current ? {
                            ...current,
                            commercial_state: {
                              ...current.commercial_state,
                              next_followup_at: null,
                              next_followup_type: null,
                            },
                            scheduled_actions: current.scheduled_actions.filter(action => !action.action_type.endsWith('FOLLOWUP') && action.action_type !== 'PAYDAY_REENGAGEMENT'),
                          } : current)
                          showToast?.('Follow-up cancelled')
                        }}
                        style={{ marginTop: 7, padding: 0, border: 'none', background: 'transparent', color: '#e57689', fontSize: 10.5, cursor: 'pointer' }}
                      >
                        Cancel follow-up
                      </button>
                    </div>
                  )}

                  {fullAutoStatus.scheduled_actions.filter(action => action.status === 'FAILED').map(action => (
                    <div key={action.id} style={{ fontSize: 10.5, color: '#e57689', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(229,118,137,0.2)' }}>
                      <div>{action.action_type.replaceAll('_', ' ')} failed{action.last_error ? `: ${action.last_error}` : ''}</div>
                      <button
                        type="button"
                        onClick={async () => {
                          const response = await apiFetch(`/fan/${fan.id}/retry-followup/${action.id}`, { method: 'POST' })
                          if (!response.ok) { showToast?.('Could not retry follow-up'); return }
                          setFullAutoStatus(current => current ? {
                            ...current,
                            scheduled_actions: current.scheduled_actions.map(item => item.id === action.id ? { ...item, status: 'PENDING', last_error: null } : item),
                          } : current)
                          showToast?.('Follow-up requeued')
                        }}
                        style={{ marginTop: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(229,118,137,0.45)', background: 'transparent', color: '#e57689', fontSize: 10.5, cursor: 'pointer' }}
                      >
                        Retry now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={LABEL_STYLE}>NOTES</div>
            <div style={{ ...CARD_STYLE, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 12, minHeight: 60 }}>
              {fanNotes.trim() ? fanNotes : 'No notes yet.'}
            </div>

            {/* Member note */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setShowMemberNote(v => !v)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', background: 'rgba(100,160,255,0.06)',
                  border: '1px solid rgba(100,160,255,0.2)', borderRadius: 8,
                  padding: '8px 12px', cursor: 'pointer', marginBottom: showMemberNote ? 8 : 0,
                }}
              >
                <span style={{ fontSize: 11, color: 'rgba(100,180,255,0.9)', fontWeight: 600, letterSpacing: '0.06em' }}>
                  👤 MEMBER
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {showMemberNote ? '▲ hide' : '▼ show'}
                </span>
              </button>
              {showMemberNote && (
                <div style={{ ...CARD_STYLE, borderColor: 'rgba(100,160,255,0.2)' }}>
                  {memberNote.trim() ? (
                    <pre style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {memberNote}
                    </pre>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Not enough conversation yet. Will auto-fill after 10 fan messages.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Model note */}
            <div style={{ marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => setShowModelNote(v => !v)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', background: 'rgba(255,180,100,0.06)',
                  border: '1px solid rgba(255,180,100,0.2)', borderRadius: 8,
                  padding: '8px 12px', cursor: 'pointer', marginBottom: showModelNote ? 8 : 0,
                }}
              >
                <span style={{ fontSize: 11, color: 'rgba(255,190,80,0.9)', fontWeight: 600, letterSpacing: '0.06em' }}>
                  🎭 MODEL LEGEND
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {showModelNote ? '▲ hide' : '▼ show'}
                </span>
              </button>
              {showModelNote && (
                <div style={{ ...CARD_STYLE, borderColor: 'rgba(255,180,100,0.2)' }}>
                  {creatorLegend.trim() ? (
                    <pre style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {creatorLegend}
                    </pre>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No legend tracked yet. Will auto-fill as the creator shares personal details.
                    </div>
                  )}
                </div>
              )}
            </div>

            {aiSummary && (
              <div style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowAiProfile(v => !v)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', background: 'rgba(155,143,212,0.08)',
                    border: '1px solid rgba(155,143,212,0.25)', borderRadius: 8,
                    padding: '8px 12px', cursor: 'pointer', marginBottom: showAiProfile ? 8 : 0,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600, letterSpacing: '0.06em' }}>
                    ✦ AI FAN ANALYSIS
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {showAiProfile ? '▲ hide' : '▼ show'}
                  </span>
                </button>
                {showAiProfile && (
                  <div style={{ ...CARD_STYLE, borderColor: 'rgba(155,143,212,0.2)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                      {aiSummary.summary}
                    </div>
                    <div className="cleo-field-row" style={{ gap: 8 }}>
                      {[
                        { label: 'Emotional type', value: aiSummary.emotional_type },
                        { label: 'Spending', value: aiSummary.spending_behavior },
                        { label: 'Location', value: aiSummary.location },
                        { label: 'Occupation', value: aiSummary.occupation },
                        { label: 'Payday', value: aiSummary.payday },
                        { label: 'Relationship', value: aiSummary.relationship_status },
                      ].filter(item => item.value && item.value !== 'null' && item.value !== 'unknown').map(item => (
                        <div key={item.label} style={{ background: 'var(--bg-hover)', borderRadius: 6, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{item.label.toUpperCase()}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    {aiSummary.kinks?.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>KINKS & PREFERENCES</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {aiSummary.kinks.map((kink: string) => (
                            <span key={kink} style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 999,
                              background: 'rgba(155, 143, 212, 0.15)',
                              color: 'var(--purple)',
                              border: '1px solid rgba(155, 143, 212, 0.3)',
                            }}>{kink}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiSummary.reengagement_triggers && (
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(76,175,130,0.08)', borderRadius: 6, border: '1px solid rgba(76,175,130,0.2)' }}>
                        <div style={{ fontSize: 10, color: 'var(--green)', marginBottom: 2 }}>RE-ENGAGEMENT</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{aiSummary.reengagement_triggers}</div>
                      </div>
                    )}
                    {aiSummary.risk_signals && aiSummary.risk_signals !== 'null' && (
                      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,80,80,0.08)', borderRadius: 6, border: '1px solid rgba(255,80,80,0.2)' }}>
                        <div style={{ fontSize: 10, color: '#ff6b6b', marginBottom: 2 }}>⚠ RISK SIGNALS</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{aiSummary.risk_signals}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {fullAutoStatus && (
              <div style={{ order: 99, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(value => !value)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: '0.06em' }}>ADVANCED TRACKED DATA</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showAdvanced ? '▲ hide' : '▼ show'}</span>
                </button>
                {showAdvanced && (
                  <div style={{ ...CARD_STYLE, marginTop: 8, padding: 12 }}>
                    <div className="cleo-field-row" style={{ gap: 7 }}>
                      {[
                        ['Auto eligibility', fullAutoStatus.auto_mode_reason],
                        ['Last active', fan.last_active ? formatOperationalTime(fan.last_active) : null],
                        ['Commercial state', fullAutoStatus.commercial_state.status],
                        ['Requested experience', fullAutoStatus.commercial_state.desired_experience],
                        ['Accepted offer', fullAutoStatus.commercial_state.accepted_offer_label],
                        ['Accepted price', fullAutoStatus.commercial_state.accepted_offer_price_cents != null ? formatTrackedMoney(fullAutoStatus.commercial_state.accepted_offer_price_cents) : null],
                        ['Lifecycle', fullAutoStatus.buyer_lifecycle?.stage],
                        ['Confirmed purchases', fullAutoStatus.buyer_lifecycle?.purchase_count],
                        ['Confirmed revenue', fullAutoStatus.buyer_lifecycle?.purchase_revenue_cents != null ? formatTrackedMoney(fullAutoStatus.buyer_lifecycle.purchase_revenue_cents) : null],
                        ['First purchase', fullAutoStatus.buyer_lifecycle?.first_purchase_at ? formatOperationalTime(fullAutoStatus.buyer_lifecycle.first_purchase_at) : null],
                        ['Last purchase', fullAutoStatus.buyer_lifecycle?.last_purchase_at ? formatOperationalTime(fullAutoStatus.buyer_lifecycle.last_purchase_at) : null],
                        ['Affordability', fullAutoStatus.affordability?.status],
                        ['Available now', fullAutoStatus.affordability?.current_available_cents != null ? formatTrackedMoney(fullAutoStatus.affordability.current_available_cents) : null],
                        ['Current hard limit', fullAutoStatus.affordability?.current_limit_cents != null ? formatTrackedMoney(fullAutoStatus.affordability.current_limit_cents) : null],
                        ['Latest counteroffer', fullAutoStatus.affordability?.latest_counteroffer_cents != null ? formatTrackedMoney(fullAutoStatus.affordability.latest_counteroffer_cents) : null],
                        ['Highest purchase', fullAutoStatus.affordability?.highest_confirmed_purchase_cents != null ? formatTrackedMoney(fullAutoStatus.affordability.highest_confirmed_purchase_cents) : null],
                        ['Payday', fullAutoStatus.affordability?.payday_at || fullAutoStatus.affordability?.payday_raw],
                        ['Price mode', fullAutoStatus.price_learning?.mode],
                        ['Price confidence', fullAutoStatus.price_learning?.confidence],
                        ['Learned target', fullAutoStatus.price_learning?.recommended_target_cents != null ? formatTrackedMoney(fullAutoStatus.price_learning.recommended_target_cents) : null],
                        ['Learned range', fullAutoStatus.price_learning?.recommended_floor_cents != null || fullAutoStatus.price_learning?.recommended_ceiling_cents != null
                          ? `${formatTrackedMoney(fullAutoStatus.price_learning?.recommended_floor_cents)}–${formatTrackedMoney(fullAutoStatus.price_learning?.recommended_ceiling_cents)}` : null],
                        ['Positive price signals', fullAutoStatus.price_learning?.positive_signal_count],
                        ['Resistance signals', fullAutoStatus.price_learning?.resistance_signal_count],
                        ['Last session', fullAutoStatus.commercial_state.last_session_experience],
                        ['Last session revenue', fullAutoStatus.commercial_state.last_session_revenue_cents != null ? formatTrackedMoney(fullAutoStatus.commercial_state.last_session_revenue_cents) : null],
                        ['Session completed', fullAutoStatus.commercial_state.last_session_completed_at ? formatOperationalTime(fullAutoStatus.commercial_state.last_session_completed_at) : null],
                      ].map(([label, value]) => (
                        <div key={String(label)} style={{ padding: '7px 8px', borderRadius: 6, background: 'var(--bg-hover)' }}>
                          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
                          <div style={{ fontSize: 10.5, color: value === null || value === undefined || value === '' ? 'var(--text-faint)' : 'var(--text-secondary)', marginTop: 2, overflowWrap: 'anywhere' }}>
                            {displayTrackedValue(value)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {(fullAutoStatus.fan_intelligence?.facts?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Evidence-backed fan facts</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {fullAutoStatus.fan_intelligence?.facts?.slice(0, 12).map((fact, index) => (
                            <div key={`${fact.fact_key}-${index}`} style={{ fontSize: 10.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span>{displayTrackedValue(fact.fact_key)}</span>
                              <span style={{ textAlign: 'right' }}>{displayTrackedValue(fact.value)}{fact.confidence != null ? ` · ${Math.round(fact.confidence * 100)}%` : ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(fullAutoStatus.fan_intelligence?.hard_limits?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 10, padding: '7px 8px', borderRadius: 6, background: 'rgba(229,118,137,0.08)', color: '#e57689', fontSize: 10.5 }}>
                        Hard limits: {displayTrackedValue(fullAutoStatus.fan_intelligence?.hard_limits)}
                      </div>
                    )}
                    <div style={{ marginTop: 10, color: 'var(--text-faint)', fontSize: 9.5, lineHeight: 1.45 }}>
                      Empty fields mean the fan has not supplied reliable evidence yet; they are not silently guessed.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={LABEL_STYLE}>FAN DETAILS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {[
                { label: 'Age', field: 'age' },
                { label: 'Pay day', field: 'payday' },
                { label: 'Hobbies', field: 'hobbies' },
                { label: 'Relationship', field: 'relationship_status' },
              ].map(({ label, field }) => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 76, flexShrink: 0 }}>{label}</span>
                  <input
                    type="text"
                    value={details[field as keyof typeof details]}
                    onChange={e => setDetails(prev => ({ ...prev, [field]: e.target.value }))}
                    onBlur={e => handleDetailBlur(field, e.target.value)}
                    placeholder="—"
                    style={{
                      flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      borderRadius: 6, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={LABEL_STYLE}>PREFERENCES</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {fanPreferences.length > 0 ? fanPreferences.map(pref => (
                <span key={pref} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(155, 143, 212, 0.15)', color: 'var(--purple)',
                  border: '1px solid rgba(155, 143, 212, 0.3)',
                }}>
                  {pref}
                </span>
              )) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>None yet.</span>}
            </div>
          </div>
        )}

        {/* SALES TAB */}
        {activeTab === 'sales' && (
          <div>
            <div style={{ ...CARD_STYLE, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Current sales state</div>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{fullAutoStatus?.commercial_state.status ?? 'IDLE'}</div>
              {fullAutoStatus?.pending_ppv && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(224,180,109,0.08)', border: '1px solid rgba(224,180,109,0.3)' }}>
                  <div style={{ color: '#e0b46d', fontSize: 11, fontWeight: 650 }}>Locked PPV awaiting payment · ${fullAutoStatus.pending_ppv.price ?? 0}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 3 }}>Expires {formatOperationalTime(fullAutoStatus.pending_ppv.expires_at)} · {fullAutoStatus.pending_ppv.verification_attempts ?? 0} checks</div>
                </div>
              )}
              {fullAutoStatus?.session && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 7 }}>Session step {(fullAutoStatus.session.current_index ?? 0) + 1} of {fullAutoStatus.session.plan?.length ?? 0} · {fullAutoStatus.session.payment_state ?? fullAutoStatus.session.status}</div>
              )}
              {fullAutoStatus?.commercial_state.next_followup_type && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 7 }}>Next: {fullAutoStatus.commercial_state.next_followup_type} · {formatOperationalTime(fullAutoStatus.commercial_state.next_followup_at)}</div>
              )}
            </div>

            <div style={{ padding: '9px 10px', marginBottom: 16, borderRadius: 7, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45 }}>
              Build and send locked PPVs from the conversation composer. Sales appear here only after the platform confirms payment; operators cannot manually inflate revenue or bypass purchase reconciliation.
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Confirmed purchases</div>
            {salesLog.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>No confirmed purchases yet.</div>
            ) : salesLog.slice().reverse().map((sale, index) => (
              <div key={`${sale.date}-${index}`} style={{ ...CARD_STYLE, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{sale.item}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sale.date} · {sale.chatter}</div>
                    {mediaIdsForEntry(sale).length > 0 && (
                      <button type='button' onClick={() => void openMediaPreview(mediaIdsForEntry(sale), creatorId)} style={{ padding: 0, marginTop: 4, border: 0, background: 'transparent', color: 'var(--purple)', fontSize: 10, cursor: 'pointer' }}>
                        Preview all {mediaIdsForEntry(sale).length} purchased media
                      </button>
                    )}
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>${sale.amount}</span>
                </div>
              </div>
            ))}

            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 0 8px' }}>Abandoned or declined PPVs</div>
            {notSoldLog.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No abandoned PPVs recorded.</div>
            ) : notSoldLog.slice().reverse().map((attempt, index) => (
              <div key={`${attempt.date}-${index}`} style={{ ...CARD_STYLE, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{attempt.item}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{attempt.date} · {attempt.chatter}</div>
                    {attempt.reason && <div style={{ fontSize: 11, color: 'rgba(255,120,120,0.8)', marginTop: 3 }}>{attempt.reason}</div>}
                    {mediaIdsForEntry(attempt).length > 0 && (
                      <button type='button' onClick={() => void openMediaPreview(mediaIdsForEntry(attempt), creatorId)} style={{ padding: 0, marginTop: 4, border: 0, background: 'transparent', color: 'var(--purple)', fontSize: 10, cursor: 'pointer' }}>
                        Preview all {mediaIdsForEntry(attempt).length} offered media
                      </button>
                    )}
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--text-muted)' }}>${attempt.amount}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </aside>
    {mediaPreview && currentPreview && (
      <div
        onClick={() => setMediaPreview(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div onClick={e => e.stopPropagation()} style={{ width: 'min(1000px, 92vw)', maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '0 10px' }}>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
            PPV media {mediaPreview.index + 1} of {mediaPreview.items.length}
          </div>
          {currentPreview.mimetype?.startsWith('video') ? (
            <video
              key={currentPreview.mediaId}
              src={currentPreview.url}
              controls
              autoPlay
              style={{ maxHeight: '62dvh', maxWidth: '100%', borderRadius: 8 }}
            />
          ) : (
            <img
              key={currentPreview.mediaId}
              src={currentPreview.url}
              alt="PPV media preview"
              style={{ maxHeight: '62dvh', maxWidth: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
          )}
          {mediaPreview.items.length > 1 && (
            <>
              <button type="button" aria-label="Previous media" onClick={() => setMediaPreview(current => current ? { ...current, index: (current.index - 1 + current.items.length) % current.items.length } : current)}
                className="cleo-lightbox-prev"
                style={{ position: 'fixed', left: 24, top: '50%', transform: 'translateY(-50%)', width: 40, height: 48, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 24, cursor: 'pointer' }}>‹</button>
              <button type="button" aria-label="Next media" onClick={() => setMediaPreview(current => current ? { ...current, index: (current.index + 1) % current.items.length } : current)}
                className="cleo-lightbox-next"
                style={{ position: 'fixed', right: 24, top: '50%', transform: 'translateY(-50%)', width: 40, height: 48, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 24, cursor: 'pointer' }}>›</button>
              <div style={{ display: 'flex', gap: 7, maxWidth: '88vw', overflowX: 'auto', padding: 3 }}>
                {mediaPreview.items.map((item, index) => (
                  <button key={item.mediaId} type="button" className="cleo-tap-sm" onClick={() => setMediaPreview(current => current ? { ...current, index } : current)}
                    style={{ width: 58, height: 58, flexShrink: 0, padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: index === mediaPreview.index ? '2px solid var(--purple)' : '1px solid rgba(255,255,255,0.2)', background: '#111' }}>
                    {item.mimetype?.startsWith('video') ? (
                      <div style={{ color: 'white', fontSize: 18, lineHeight: '56px' }}>▶</div>
                    ) : (
                      <img src={item.thumbnailUrl || item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setMediaPreview(null)}
          className="cleo-lightbox-close"
          style={{
            position: 'fixed', top: 20, right: 20,
            background: 'rgba(255,255,255,0.1)', border: 'none',
            color: 'white', borderRadius: '50%', width: 36, height: 36,
            fontSize: 18, cursor: 'pointer',
          }}
        >×</button>
      </div>
    )}
    </>
  )
}


/**
 * The evidence behind a content-access hold, and what may be done about it.
 *
 * Separate from the panel body because it is the one review reason where the
 * operator needs to see something before choosing, rather than choosing between
 * outcomes they already know. The resend button appears only when the backend's
 * evidence says a resend is valid; offering it otherwise would teach an operator
 * to click through an error.
 */
function ContentAccessResolution({
  evidence,
  error,
  busy,
  selection,
  onSelect,
  onResolve,
}: {
  evidence: ContentAccessEvidence | null
  error: string
  busy: string | null
  /** The purchase the operator says the complaint is about. '' when unchosen. */
  selection: string
  onSelect: (reference: string) => void
  onResolve: (resolution: ReviewResolution) => void | Promise<void>
}) {
  const summary = summarizeContentAccess(evidence)
  const items = evidence?.paid_items ?? []
  const chosen = items.find(item => item.reference === selection) ?? null
  // What may be done about the CHOSEN item, not about the customer. A repair
  // already confirmed for one purchase says nothing about another.
  const offer = chosen ? repairOffer(chosen) : null
  const blocked = Boolean(summary?.selectionRequired) && !selection
  const canResend =
    Boolean(summary?.canResend) && !blocked && (offer ? offer.canResend : true)

  const secondary = {
    padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.55 : 1,
  } as const

  return (
    <div>
      {error ? (
        <div style={{ fontSize: 12, color: '#e57689', marginBottom: 10 }}>
          {error} — you can still record the outcome below.
        </div>
      ) : !summary ? (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>
          Checking what this customer paid for…
        </div>
      ) : (
        <div style={{
          marginBottom: 10, padding: '10px 12px', borderRadius: 8,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 4 }}>
            {summary.headline}
            {summary.uncertain && (
              <span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--text-faint)' }}>
                (unverified)
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {summary.detail}
          </div>
          {items.length > 0 && (
            <>
              {summary?.selectionRequired && (
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8, fontWeight: 600 }}>
                  Which one can&apos;t they open?
                </div>
              )}
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
                {items.map(item => {
                  const itemOffer = repairOffer(item)
                  const reference = item.reference || item.platform_message_id
                  const picked = selection === item.reference
                  return (
                    <li
                      key={reference}
                      style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 5 }}
                    >
                      <label style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                        cursor: item.media_ids.length ? 'pointer' : 'default',
                      }}>
                        {/* A radio even when there is one item: it is the
                            record of what the operator chose, and it is what
                            is sent back with the resolution. */}
                        <input
                          type="radio"
                          name="content-access-item"
                          checked={picked}
                          disabled={!item.media_ids.length || !!busy}
                          onChange={() => onSelect(item.reference)}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          <span style={{ color: picked ? 'var(--text-secondary)' : undefined }}>
                            {describePaidItem(item)}
                          </span>
                          {itemOffer.note && (
                            <span style={{
                              display: 'block', marginTop: 2,
                              color: itemOffer.needsDecision ? '#e0b64f' : 'var(--text-faint)',
                            }}>
                              {itemOffer.note}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {summary?.canResend && (
          <button
            type="button"
            disabled={!!busy || !canResend}
            onClick={() => void onResolve('resend_paid_content')}
            title={
              blocked
                ? 'Choose which purchase they cannot open'
                : offer && !offer.canResend
                ? offer.note
                : undefined
            }
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(94,214,154,0.12)', border: '1px solid var(--green)',
              color: 'var(--green)',
              cursor: busy ? 'wait' : canResend ? 'pointer' : 'not-allowed',
              opacity: busy || !canResend ? 0.55 : 1,
            }}
          >
            {busy === 'resend_paid_content'
              ? 'Sending…'
              : blocked
              ? 'Choose an item to resend'
              : 'Resend it free'}
          </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void onResolve('access_restored')}
          style={secondary}
        >
          {busy === 'access_restored' ? 'Recording…' : 'I fixed it myself'}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void onResolve('not_an_access_issue')}
          style={secondary}
        >
          {busy === 'not_an_access_issue' ? 'Recording…' : 'Not an access problem'}
        </button>
      </div>
    </div>
  )
}
