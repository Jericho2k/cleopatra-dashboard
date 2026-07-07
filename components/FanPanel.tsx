'use client'

import React, { useState, useEffect } from 'react'
import type { Fan } from '../types'
import { supabase } from '../lib/supabase'
import { User } from 'lucide-react'
import { apiFetch } from '../lib/api'

export interface FanPanelProps {
  fan: Fan | null
  creatorId: string
  onInsertMessage?: (text: string) => void
  onHistoryLoaded?: () => void
  showToast?: (message: string) => void
}

type Tab = 'profile' | 'sales'

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

export default function FanPanel({ fan, creatorId, onHistoryLoaded, showToast }: FanPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [showMemberNote, setShowMemberNote] = useState(true)
  const [showModelNote, setShowModelNote] = useState(false)
  const [creatorLegend, setCreatorLegend] = useState<string>('')
  const [needsReview, setNeedsReview] = useState<{ frozen: boolean; reason: string }>({ frozen: false, reason: '' })
  const [salesLog, setSalesLog] = useState<{ date: string; item: string; amount: number; chatter: string }[]>([])
  const [notSoldLog, setNotSoldLog] = useState<{ date: string; item: string; amount: number; reason: string; chatter: string }[]>([])
  const [newSale, setNewSale] = useState({ item: '', amount: '', chatter: '' })
  const [newNotSold, setNewNotSold] = useState({ item: '', amount: '', reason: '', chatter: '' })
  const [salesLoading, setSalesLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [details, setDetails] = useState({
    age: '', payday: '', hobbies: '', relationship_status: '',
  })
  const [aiSummary, setAiSummary] = useState<any>(null)
  const [showAiProfile, setShowAiProfile] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<{ url: string; isVideo: boolean } | null>(null)

  const openMediaPreview = async (mediaId: string, cid: string) => {
    const res = await apiFetch(`/vault-media-url/${cid}/${mediaId}`)
    const data = await res.json()
    if (data.url) {
      const isVideo = data.mimetype?.startsWith('video') || mediaId?.includes('video')
      setMediaPreview({ url: data.url, isVideo })
    }
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
  }, [creatorId])

  useEffect(() => {
    if (!fan?.id) return
    void supabase
      .from('fans')
      .select('sales_log, not_sold_log, needs_human_review, review_reason')
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
      })
  }, [fan?.id])

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
    }
  }, [fan?.id])

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
        setDetails({
          age: updated.age || updated.ai_summary?.age || '',
          payday: updated.payday || updated.ai_summary?.payday || '',
          hobbies: updated.hobbies || updated.ai_summary?.hobbies || '',
          relationship_status: updated.relationship_status || updated.ai_summary?.relationship_status || '',
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fan?.id])



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
      showToast?.(`Imported ${data.imported} messages`)
    } finally {
      setLoadingHistory(false)
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
        height: '100vh', width: '100%', background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 14,
      }}>
        Select a conversation.
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

  return (
    <>
    <aside style={{
      height: '100vh', width: '100%', background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Fan header - always visible */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          FAN PROFILE
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
              This conversation was frozen{needsReview.reason ? ` (${needsReview.reason})` : ''}. Review it, then resume AI when you're ready.
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!fan?.id) return
                const { error } = await supabase.from('fans')
                  .update({ needs_human_review: false, review_reason: null })
                  .eq('id', fan.id)
                if (error) { showToast?.(error.message); return }
                setNeedsReview({ frozen: false, reason: '' })
                showToast?.('AI resumed for this fan')
              }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: 'rgba(94,214,154,0.12)', border: '1px solid var(--green)',
                color: 'var(--green)', cursor: 'pointer',
              }}
            >
              Resume AI
            </button>
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div>
            <div style={LABEL_STYLE}>NOTES</div>
            <div style={{ ...CARD_STYLE, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 12, minHeight: 60 }}>
              {fan.notes?.trim() ? fan.notes : 'No notes yet.'}
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
                  {(fan as any).member_note?.trim() ? (
                    <pre style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {(fan as any).member_note}
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
              {fan.preferences?.length > 0 ? fan.preferences.map(pref => (
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
            {/* SOLD */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Sales</div>
            {salesLog.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>No sales logged yet.</div>
            )}
            {salesLog.map((s, i) => (
              <div key={i} style={{ ...CARD_STYLE, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{s.item}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.date} · {s.chatter}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--green)', flexShrink: 0, marginLeft: 8 }}>
                    ${s.amount}
                  </span>
                </div>
              </div>
            ))}

            {/* Add sale */}
            <div style={{ marginBottom: 20, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>+ Log sale</div>
              <input
                placeholder="Item (e.g. pussy photo)"
                value={newSale.item}
                onChange={e => setNewSale(p => ({ ...p, item: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', marginBottom: 6, boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  placeholder="Amount $"
                  type="number"
                  value={newSale.amount}
                  onChange={e => setNewSale(p => ({ ...p, amount: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                />
                <input
                  placeholder="Your name"
                  value={newSale.chatter}
                  onChange={e => setNewSale(p => ({ ...p, chatter: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button
                type="button"
                disabled={salesLoading || !newSale.item || !newSale.amount}
                onClick={async () => {
                  if (!fan?.id || !newSale.item || !newSale.amount) return
                  setSalesLoading(true)
                  const entry = {
                    date: new Date().toLocaleDateString('en-GB'),
                    item: newSale.item,
                    amount: Number(newSale.amount),
                    chatter: newSale.chatter || 'unknown',
                  }
                  const updated = [...salesLog, entry]
                  await supabase.from('fans').update({
                    sales_log: updated,
                    total_spent: (fan.total_spent ?? 0) + entry.amount,
                  }).eq('id', fan.id)
                  setSalesLog(updated)
                  setNewSale({ item: '', amount: '', chatter: '' })
                  setSalesLoading(false)
                }}
                style={{
                  width: '100%', padding: '6px', borderRadius: 6,
                  background: 'rgba(76,175,130,0.15)', border: '1px solid var(--green)',
                  color: 'var(--green)', fontSize: 12, cursor: 'pointer',
                }}
              >
                {salesLoading ? 'Saving...' : 'Log Sale'}
              </button>
            </div>

            {/* NOT SOLD */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Not Sold</div>
            {notSoldLog.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>No failed attempts logged yet.</div>
            )}
            {notSoldLog.map((s, i) => (
              <div key={i} style={{ ...CARD_STYLE, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{s.item}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.date} · {s.chatter}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,120,120,0.8)', marginTop: 2 }}>{s.reason}</div>
                    {s.item?.includes('PPV media') && s.item.split(' ')[2] && (
                      <button
                        onClick={() => openMediaPreview(s.item.split(' ')[2], creatorId)}
                        style={{
                          fontSize: 11, color: 'var(--purple)',
                          background: 'none', border: 'none',
                          cursor: 'pointer', padding: 0, marginTop: 4,
                        }}
                      >
                        👁 Preview media
                      </button>
                    )}
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>
                    ${s.amount}
                  </span>
                </div>
              </div>
            ))}

            {/* Add not sold */}
            <div style={{ padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>+ Log failed attempt</div>
              <input
                placeholder="Item you tried to sell"
                value={newNotSold.item}
                onChange={e => setNewNotSold(p => ({ ...p, item: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', marginBottom: 6, boxSizing: 'border-box', outline: 'none' }}
              />
              <input
                placeholder="Reason (e.g. too expensive, limit $400)"
                value={newNotSold.reason}
                onChange={e => setNewNotSold(p => ({ ...p, reason: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', marginBottom: 6, boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  placeholder="Amount $"
                  type="number"
                  value={newNotSold.amount}
                  onChange={e => setNewNotSold(p => ({ ...p, amount: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                />
                <input
                  placeholder="Your name"
                  value={newNotSold.chatter}
                  onChange={e => setNewNotSold(p => ({ ...p, chatter: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button
                type="button"
                disabled={salesLoading || !newNotSold.item}
                onClick={async () => {
                  if (!fan?.id || !newNotSold.item) return
                  setSalesLoading(true)
                  const entry = {
                    date: new Date().toLocaleDateString('en-GB'),
                    item: newNotSold.item,
                    amount: Number(newNotSold.amount) || 0,
                    reason: newNotSold.reason || '',
                    chatter: newNotSold.chatter || 'unknown',
                  }
                  const updated = [...notSoldLog, entry]
                  await supabase.from('fans').update({ not_sold_log: updated }).eq('id', fan.id)
                  setNotSoldLog(updated)
                  setNewNotSold({ item: '', amount: '', reason: '', chatter: '' })
                  setSalesLoading(false)
                }}
                style={{
                  width: '100%', padding: '6px', borderRadius: 6,
                  background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)',
                  color: 'rgba(255,120,120,0.9)', fontSize: 12, cursor: 'pointer',
                }}
              >
                {salesLoading ? 'Saving...' : 'Log Failed Attempt'}
              </button>
            </div>
          </div>
        )}

      </div>
    </aside>
    {mediaPreview && (
      <div
        onClick={() => setMediaPreview(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div onClick={e => e.stopPropagation()}>
          {mediaPreview.isVideo ? (
            <video
              src={mediaPreview.url}
              controls
              autoPlay
              style={{ maxHeight: '85vh', maxWidth: '85vw', borderRadius: 8 }}
            />
          ) : (
            <img
              src={mediaPreview.url}
              style={{ maxHeight: '85vh', maxWidth: '85vw', objectFit: 'contain', borderRadius: 8 }}
            />
          )}
        </div>
        <button
          onClick={() => setMediaPreview(null)}
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