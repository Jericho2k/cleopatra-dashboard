'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { supabase } from '../../lib/supabase'

type Creator = {
  id: string
  platform_username: string | null
  platform: string | null
}

type SextingMode = 'PAID_ONLY' | 'HYBRID_TEASER' | 'FREE_TEXT_ALLOWED'

type Policy = {
  sexting_mode: SextingMode
  teaser_max_messages: number
  free_text_max_messages: number
  free_session_cooldown_hours: number
  media_always_paid: boolean
  payday_reengagement_enabled: boolean
  payday_send_hour_local: number
  timezone: string
  offer_two_packages: boolean
  quick_package_target_cents: number
  full_package_target_cents: number
  session_min_steps: number
  session_max_steps: number
  post_purchase_cooldown_messages: number
  require_purchase_before_next_step: boolean
  ppv_recheck_minutes: number
  ppv_payment_window_hours: number
  abandoned_ppv_followup_enabled: boolean
  abandoned_ppv_followup_delay_hours: number
  post_session_followup_enabled: boolean
  post_session_followup_delay_hours: number
  followup_recent_activity_suppression_hours: number
}

type FullAutoHealth = {
  summary: {
    payment_pending: number
    followups_pending: number
    human_review: number
    failed_actions: number
    processing_actions: number
  }
  fans: Array<{
    fan_id: string
    display_name: string
    commercial_state: string
    next_followup_at: string | null
    next_followup_type: string | null
    needs_human_review: boolean
    failed_actions: Array<{ action_type: string; last_error: string | null }>
  }>
}

const DEFAULT_POLICY: Policy = {
  sexting_mode: 'HYBRID_TEASER',
  teaser_max_messages: 4,
  free_text_max_messages: 20,
  free_session_cooldown_hours: 24,
  media_always_paid: true,
  payday_reengagement_enabled: true,
  payday_send_hour_local: 18,
  timezone: 'UTC',
  offer_two_packages: true,
  quick_package_target_cents: 2500,
  full_package_target_cents: 6000,
  session_min_steps: 2,
  session_max_steps: 4,
  post_purchase_cooldown_messages: 2,
  require_purchase_before_next_step: true,
  ppv_recheck_minutes: 20,
  ppv_payment_window_hours: 24,
  abandoned_ppv_followup_enabled: true,
  abandoned_ppv_followup_delay_hours: 18,
  post_session_followup_enabled: true,
  post_session_followup_delay_hours: 18,
  followup_recent_activity_suppression_hours: 6,
}

export default function MonetizationPage() {
  const [creators, setCreators] = useState<Creator[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [health, setHealth] = useState<FullAutoHealth | null>(null)

  useEffect(() => {
    void loadCreators()
  }, [])

  useEffect(() => {
    if (creatorId) {
      void loadPolicy(creatorId)
      void loadHealth(creatorId)
    }
  }, [creatorId])

  async function loadCreators() {
    setLoading(true)
    const { data, error } = await supabase
      .from('creators')
      .select('id, platform_username, platform')
      .order('platform_username', { ascending: true })
    if (error) {
      setMessage(`Could not load creators: ${error.message}`)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as Creator[]
    setCreators(rows)
    if (rows[0]) setCreatorId(rows[0].id)
    else setLoading(false)
  }

  async function loadPolicy(id: string) {
    setLoading(true)
    setMessage('')
    try {
      const response = await apiFetch(`/creator/${id}/commercial-policy`)
      if (!response.ok) throw new Error(await response.text())
      const body = await response.json()
      setPolicy({ ...DEFAULT_POLICY, ...(body.policy ?? {}) })
    } catch (error) {
      setMessage(`Could not load monetization policy: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function loadHealth(id: string) {
    try {
      const response = await apiFetch(`/creator/${id}/full-auto-health`)
      if (!response.ok) throw new Error(await response.text())
      setHealth(await response.json())
    } catch {
      setHealth(null)
    }
  }

  async function savePolicy() {
    if (!creatorId) return
    if (policy.session_min_steps > policy.session_max_steps) {
      setMessage('Minimum session steps cannot exceed maximum session steps.')
      return
    }
    if (policy.quick_package_target_cents >= policy.full_package_target_cents && policy.offer_two_packages) {
      setMessage('The full-session price must be higher than the quick-session price.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const response = await apiFetch(`/creator/${creatorId}/commercial-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      })
      if (!response.ok) throw new Error(await response.text())
      const body = await response.json()
      setPolicy({ ...DEFAULT_POLICY, ...(body.policy ?? {}) })
      setMessage('Monetization policy saved.')
      void loadHealth(creatorId)
    } catch (error) {
      setMessage(`Save failed: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const selectedCreator = useMemo(
    () => creators.find((creator) => creator.id === creatorId),
    [creators, creatorId],
  )

  return (
    <main style={{ height: '100%', overflow: 'auto', background: 'var(--bg-main)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '34px 28px 80px' }}>
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Full Auto
          </div>
          <h1 style={{ margin: '6px 0 8px', fontSize: 30, fontFamily: 'var(--font-display)' }}>Monetization policy</h1>
          <p style={{ margin: 0, maxWidth: 720, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            These rules are deterministic. The dialogue model may phrase the decision, but it cannot override pricing,
            free-session limits, payday follow-up, or purchase-gated session progression.
          </p>
        </div>

        <Card title="Creator">
          <label style={labelStyle}>Account</label>
          <select value={creatorId} onChange={(event) => setCreatorId(event.target.value)} style={inputStyle}>
            {creators.map((creator) => (
              <option value={creator.id} key={creator.id}>
                {creator.platform_username || creator.id} {creator.platform ? `· ${creator.platform}` : ''}
              </option>
            ))}
          </select>
          {selectedCreator && <Hint>Changes apply only to {selectedCreator.platform_username || selectedCreator.id}.</Hint>}
        </Card>

        {loading ? (
          <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <>
            <Card title="Sexting strategy">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <ModeCard mode="PAID_ONLY" title="Paid only" text="Brief warm-up, then sell. No free explicit service." />
                <ModeCard mode="HYBRID_TEASER" title="Hybrid teaser" text="Limited text preview, then transition to paid options." />
                <ModeCard mode="FREE_TEXT_ALLOWED" title="Free text allowed" text="Text-only experience can continue within the configured allowance." />
              </div>
              <Grid>
                <NumberField label="Hybrid teaser messages" value={policy.teaser_max_messages} min={0} max={50} onChange={(value) => update('teaser_max_messages', value)} />
                <NumberField label="Free text messages" value={policy.free_text_max_messages} min={1} max={500} onChange={(value) => update('free_text_max_messages', value)} />
                <NumberField label="Free-session cooldown (hours)" value={policy.free_session_cooldown_hours} min={0} max={720} onChange={(value) => update('free_session_cooldown_hours', value)} />
              </Grid>
              <Toggle label="Media always requires payment" checked={policy.media_always_paid} onChange={(value) => update('media_always_paid', value)} />
            </Card>

            <Card title="Paid session packages">
              <Toggle label="Offer two packages" checked={policy.offer_two_packages} onChange={(value) => update('offer_two_packages', value)} />
              <Grid>
                <MoneyField label="Quick-session target" cents={policy.quick_package_target_cents} onChange={(value) => update('quick_package_target_cents', value)} />
                <MoneyField label="Full-session target" cents={policy.full_package_target_cents} onChange={(value) => update('full_package_target_cents', value)} disabled={!policy.offer_two_packages} />
                <NumberField label="Minimum PPV steps" value={policy.session_min_steps} min={1} max={8} onChange={(value) => update('session_min_steps', value)} />
                <NumberField label="Maximum PPV steps" value={policy.session_max_steps} min={1} max={8} onChange={(value) => update('session_max_steps', value)} />
              </Grid>
              <Toggle label="Require purchase before the next PPV step" checked={policy.require_purchase_before_next_step} onChange={(value) => update('require_purchase_before_next_step', value)} />
              <NumberField label="Text messages between purchased PPV steps" value={policy.post_purchase_cooldown_messages} min={0} max={20} onChange={(value) => update('post_purchase_cooldown_messages', value)} />
              <Hint>Package prices are confirmed by selection; Cleopatra never infers a hidden spending ceiling.</Hint>
            </Card>

            <Card title="Payday recovery">
              <Toggle label="Schedule contextual follow-up when a purchase is postponed until payday" checked={policy.payday_reengagement_enabled} onChange={(value) => update('payday_reengagement_enabled', value)} />
              <Grid>
                <NumberField label="Local send hour" value={policy.payday_send_hour_local} min={0} max={23} onChange={(value) => update('payday_send_hour_local', value)} />
                <div>
                  <label style={labelStyle}>Creator timezone</label>
                  <input value={policy.timezone} onChange={(event) => update('timezone', event.target.value)} placeholder="Europe/Berlin" style={inputStyle} />
                </div>
              </Grid>
              <Hint>Use an IANA timezone such as Europe/Berlin, America/New_York, or Europe/Moscow.</Hint>
            </Card>

            <Card title="Full-auto lifecycle">
              <Grid>
                <NumberField label="Purchase window (hours)" value={policy.ppv_payment_window_hours} min={1} max={168} onChange={(value) => update('ppv_payment_window_hours', value)} />
                <NumberField label="Purchase recheck (minutes)" value={policy.ppv_recheck_minutes} min={5} max={1440} onChange={(value) => update('ppv_recheck_minutes', value)} />
                <NumberField label="Recent activity suppression (hours)" value={policy.followup_recent_activity_suppression_hours} min={0} max={168} onChange={(value) => update('followup_recent_activity_suppression_hours', value)} />
              </Grid>
              <Toggle label="Follow up after a completed paid session" checked={policy.post_session_followup_enabled} onChange={(value) => update('post_session_followup_enabled', value)} />
              <NumberField label="Post-session delay (hours)" value={policy.post_session_followup_delay_hours} min={1} max={720} onChange={(value) => update('post_session_followup_delay_hours', value)} />
              <Toggle label="Follow up once after an abandoned locked PPV" checked={policy.abandoned_ppv_followup_enabled} onChange={(value) => update('abandoned_ppv_followup_enabled', value)} />
              <NumberField label="Abandoned PPV delay (hours)" value={policy.abandoned_ppv_followup_delay_hours} min={1} max={720} onChange={(value) => update('abandoned_ppv_followup_delay_hours', value)} />
              <Hint>A failed verification is retried. An offer is abandoned only after the full purchase window expires.</Hint>
            </Card>

            {health && (
              <Card title="Pilot health">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <Metric label="Payment pending" value={health.summary.payment_pending} />
                  <Metric label="Follow-ups" value={health.summary.followups_pending} />
                  <Metric label="Needs human" value={health.summary.human_review} />
                  <Metric label="Failed actions" value={health.summary.failed_actions} alert={health.summary.failed_actions > 0} />
                </div>
                {health.fans.length > 0 && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {health.fans.slice(0, 8).map((fan) => (
                      <div key={fan.fan_id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{fan.display_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fan.commercial_state}{fan.next_followup_type ? ` · ${fan.next_followup_type}` : ''}
                          </div>
                        </div>
                        {(fan.needs_human_review || fan.failed_actions.length > 0) && (
                          <span style={{ color: '#e57689', fontSize: 11 }}>Needs attention</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => void loadHealth(creatorId)} style={{ ...buttonStyle, marginTop: 14, width: 'auto', padding: '8px 14px' }}>
                  Refresh health
                </button>
              </Card>
            )}

            {message && (
              <div style={{ margin: '16px 0', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-secondary)' }}>
                {message}
              </div>
            )}
            <button onClick={() => void savePolicy()} disabled={saving || !creatorId} style={buttonStyle}>
              {saving ? 'Saving…' : 'Save monetization policy'}
            </button>
          </>
        )}
      </div>
    </main>
  )

  function update<K extends keyof Policy>(key: K, value: Policy[K]) {
    setPolicy((current) => ({ ...current, [key]: value }))
  }

  function ModeCard({ mode, title, text }: { mode: SextingMode; title: string; text: string }) {
    const active = policy.sexting_mode === mode
    return (
      <button
        type="button"
        onClick={() => update('sexting_mode', mode)}
        style={{
          textAlign: 'left', padding: 14, borderRadius: 10, cursor: 'pointer',
          border: active ? '1px solid var(--silver)' : '1px solid var(--border)',
          background: active ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-primary)',
        }}
      >
        <div style={{ fontWeight: 650, marginBottom: 5 }}>{title}</div>
        <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, fontSize: 12 }}>{text}</div>
      </button>
    )
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 20, marginBottom: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 17 }}>{title}</h2>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 14 }}>{children}</div>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45, margin: '10px 0 0' }}>{children}</p>
}

function Metric({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div style={{ padding: 12, borderRadius: 9, border: `1px solid ${alert ? 'rgba(229,118,137,0.5)' : 'var(--border)'}`, background: alert ? 'rgba(229,118,137,0.08)' : 'var(--bg-elevated)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontFamily: 'var(--font-display)', color: alert ? '#e57689' : 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} style={inputStyle} />
    </div>
  )
}

function MoneyField({ label, cents, onChange, disabled = false }: { label: string; cents: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-muted)' }}>$</span>
        <input disabled={disabled} type="number" min={1} step="1" value={(cents / 100).toFixed(0)} onChange={(event) => onChange(Math.max(0, Number(event.target.value) * 100))} style={{ ...inputStyle, paddingLeft: 26, opacity: disabled ? 0.5 : 1 }} />
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 7, fontSize: 12, color: 'var(--text-muted)' }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }
const buttonStyle: React.CSSProperties = { padding: '11px 18px', borderRadius: 9, border: '1px solid var(--silver)', background: 'var(--silver)', color: '#111', fontWeight: 700, cursor: 'pointer' }
