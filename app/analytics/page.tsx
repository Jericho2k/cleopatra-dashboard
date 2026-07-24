'use client'

import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { supabase } from '../../lib/supabase'

type Creator = { id: string; name: string; auto_mode: boolean; last_chat_reconcile_at: string | null }
type Health = {
  generated_at: string
  summary: { payment_pending: number; followups_pending: number; human_review: number; failed_actions: number; processing_actions: number }
  fans: Array<{
    fan_id: string; display_name: string; commercial_state: string; next_followup_at: string | null
    next_followup_type: string | null; needs_human_review: boolean
    failed_actions: Array<{ action_type: string; last_error: string | null }>
  }>
}
type Approval = { id: string; fan_id: string; fans?: { display_name?: string | null } | null; price_cents: number; media_ids: string[]; approved_experience: string | null; message_content: string }
type Preview = { creator_auto_mode: boolean; eligible: number; ineligible: number; total: number }

const card: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }

export default function OverviewPage() {
  const [creators, setCreators] = useState<Creator[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [fanStats, setFanStats] = useState({ total: 0, revenue: 0, buyers: 0, whales: 0 })
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('chatter_creators')
        .select('creator_id, creators(id, platform_username, auto_mode, last_chat_reconcile_at)')
        .eq('chatter_id', user.id)
      const rows = (data ?? []).map((row: any) => ({
        id: row.creator_id,
        name: row.creators?.platform_username ?? row.creator_id,
        auto_mode: Boolean(row.creators?.auto_mode),
        last_chat_reconcile_at: row.creators?.last_chat_reconcile_at ?? null,
      }))
      setCreators(rows)
      setCreatorId(rows[0]?.id ?? '')
    })()
  }, [])

  useEffect(() => { if (creatorId) void loadOverview(creatorId) }, [creatorId])

  async function loadOverview(id: string) {
    setLoading(true)
    setMessage('')
    try {
      const [healthResponse, previewResponse, approvalResponse, fansResponse] = await Promise.all([
        apiFetch(`/creator/${id}/full-auto-health`),
        apiFetch(`/creator/${id}/auto-audience-preview`),
        apiFetch(`/creator/${id}/ppv-approvals?status=pending`),
        supabase.from('fans').select('total_spent, spend_tier, sales_log').eq('creator_id', id),
      ])
      if (!healthResponse.ok) throw new Error(await healthResponse.text())
      setHealth(await healthResponse.json())
      setPreview(previewResponse.ok ? await previewResponse.json() : null)
      if (approvalResponse.ok) {
        const body = await approvalResponse.json()
        setApprovals(body.requests ?? [])
      } else setApprovals([])
      const fans = fansResponse.data ?? []
      setFanStats({
        total: fans.length,
        revenue: fans.reduce((sum, fan) => sum + Number(fan.total_spent ?? 0), 0),
        buyers: fans.filter(fan => Number(fan.total_spent ?? 0) > 0 || (fan.sales_log?.length ?? 0) > 0).length,
        whales: fans.filter(fan => fan.spend_tier === 'whale').length,
      })
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error))
    } finally {
      setLoading(false)
    }
  }

  async function resolveApproval(id: string, action: 'approve' | 'reject') {
    setResolving(id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const response = await apiFetch(`/ppv-approvals/${id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: user?.id ?? null }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || `Could not ${action} PPV`)
      await loadOverview(creatorId)
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error))
    } finally {
      setResolving(null)
    }
  }

  const selected = creators.find(creator => creator.id === creatorId)
  const attention = (health?.summary.failed_actions ?? 0) + (health?.summary.human_review ?? 0) + approvals.length

  return (
    <main style={{ height: '100%', overflow: 'auto', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-muted)' }}>Agency operations</div>
            <h1 style={{ margin: '5px 0 6px', fontFamily: 'var(--font-display)', fontSize: 28 }}>Overview</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>The current state of Full Auto, revenue, approvals, and exceptions.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={creatorId} onChange={event => setCreatorId(event.target.value)} style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
              {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
            </select>
            <button type='button' onClick={() => void loadOverview(creatorId)} disabled={!creatorId || loading} style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer' }}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

        {message && <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 8, border: '1px solid rgba(229,118,137,0.4)', color: '#e57689', fontSize: 12 }}>{message}</div>}

        <div style={{ ...card, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selected?.name || 'Creator'}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              Full Auto {selected?.auto_mode ? 'is on' : 'is off'} · {preview?.eligible ?? 0} of {preview?.total ?? 0} current fans eligible
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: attention ? '#e57689' : 'var(--green)', fontWeight: 700, fontSize: 13 }}>{attention ? `${attention} need attention` : 'Healthy'}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 3 }}>Chats reconciled {selected?.last_chat_reconcile_at ? new Date(selected.last_chat_reconcile_at).toLocaleString() : 'not yet'}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
          <Metric label='Confirmed revenue' value={`$${fanStats.revenue}`} />
          <Metric label='Fans' value={fanStats.total} />
          <Metric label='Buyers' value={fanStats.buyers} />
          <Metric label='Whales' value={fanStats.whales} />
          <Metric label='Auto eligible' value={preview?.eligible ?? 0} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
          <Metric label='Payment pending' value={health?.summary.payment_pending ?? 0} />
          <Metric label='Follow-ups due' value={health?.summary.followups_pending ?? 0} />
          <Metric label='PPV approvals' value={approvals.length} alert={approvals.length > 0} />
          <Metric label='Needs human' value={health?.summary.human_review ?? 0} alert={(health?.summary.human_review ?? 0) > 0} />
          <Metric label='Failed actions' value={health?.summary.failed_actions ?? 0} alert={(health?.summary.failed_actions ?? 0) > 0} />
        </div>

        {approvals.length > 0 && (
          <section style={{ ...card, marginBottom: 16 }}>
            <SectionTitle title='PPV approvals' subtitle='Exact prepared sends waiting for an operator.' />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {approvals.map(approval => (
                <div key={approval.id} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{approval.fans?.display_name || 'Fan'} · ${(approval.price_cents / 100).toFixed(0)}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>{approval.media_ids.length} media{approval.approved_experience ? ` · ${approval.approved_experience}` : ''}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>{approval.message_content || 'just for you...'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <SmallButton onClick={() => void resolveApproval(approval.id, 'reject')} disabled={resolving === approval.id}>Reject</SmallButton>
                    <SmallButton primary onClick={() => void resolveApproval(approval.id, 'approve')} disabled={resolving === approval.id}>{resolving === approval.id ? 'Sending…' : 'Approve & send'}</SmallButton>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={card}>
          <SectionTitle title='Needs attention' subtitle='Only actionable states are shown here.' />
          {!health || health.fans.length === 0 ? (
            <div style={{ padding: '22px 0', color: 'var(--text-muted)', fontSize: 13 }}>No payment holds, failed actions, due follow-ups, or human-review flags.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {health.fans.map(fan => (
                <a key={fan.fan_id} href='/' style={{ textDecoration: 'none', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 650 }}>{fan.display_name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>{fan.commercial_state}{fan.next_followup_type ? ` · ${fan.next_followup_type}` : ''}</div>
                    {fan.failed_actions[0]?.last_error && <div style={{ color: '#e57689', fontSize: 11, marginTop: 5 }}>{fan.failed_actions[0].action_type}: {fan.failed_actions[0].last_error}</div>}
                  </div>
                  <div style={{ color: fan.needs_human_review || fan.failed_actions.length ? '#e57689' : 'var(--text-secondary)', fontSize: 11 }}>Open chat →</div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return <div style={{ ...card, padding: 14, borderColor: alert ? 'rgba(229,118,137,0.5)' : 'var(--border)', background: alert ? 'rgba(229,118,137,0.08)' : 'var(--bg-surface)' }}><div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>{label}</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 23, marginTop: 5, color: alert ? '#e57689' : 'var(--text-primary)' }}>{value}</div></div>
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div style={{ marginBottom: 13 }}><div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div><div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>{subtitle}</div></div>
}

function SmallButton({ children, onClick, disabled, primary = false }: { children: React.ReactNode; onClick: () => void; disabled: boolean; primary?: boolean }) {
  return <button type='button' onClick={onClick} disabled={disabled} style={{ padding: '7px 10px', borderRadius: 6, cursor: disabled ? 'wait' : 'pointer', border: primary ? '1px solid var(--silver)' : '1px solid var(--border)', background: primary ? 'var(--silver)' : 'transparent', color: primary ? '#111' : 'var(--text-secondary)', opacity: disabled ? 0.6 : 1 }}>{children}</button>
}
