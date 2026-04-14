'use client'

import React, { useState, useEffect } from 'react'
import type { Fan } from '../types'
import { supabase } from '../lib/supabase'
import { User, FileText, Lock } from 'lucide-react'

export interface FanPanelProps {
  fan: Fan | null
  creatorId: string
  onInsertMessage?: (text: string) => void
}

type Tab = 'profile' | 'scripts' | 'ppv'

interface StorylineStep {
  id: string
  step_number: number
  content: string
}

interface Storyline {
  id: string
  name: string
  category: string
  steps: StorylineStep[]
  currentStep: number
  completed: boolean
  progressId: string | null
}

interface PPVOffer {
  id: string
  title: string
  description: string
  price: number
  sent: boolean
  purchased: boolean
  sendId: string | null
}

export default function FanPanel({ fan, creatorId, onInsertMessage }: FanPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [storylines, setStorylines] = useState<Storyline[]>([])
  const [ppvOffers, setPPVOffers] = useState<PPVOffer[]>([])
  const [details, setDetails] = useState({
    age: '', payday: '', hobbies: '', relationship_status: '',
  })
  const [expandedStoryline, setExpandedStoryline] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<any>(null)
  const [showAiProfile, setShowAiProfile] = useState(false)
  const [autoMode, setAutoMode] = useState<boolean | null>(null)

  useEffect(() => {
    if (fan) {
      const summary = fan.ai_summary
      setAiSummary(summary ?? null)
      setAutoMode(fan.auto_mode ?? null)
      setDetails({
        age: (fan as any).age ?? '',
        payday: (fan as any).payday || summary?.payday || '',
        hobbies: (fan as any).hobbies || '',
        relationship_status: (fan as any).relationship_status || summary?.relationship_status || '',
      })
    }
  }, [fan?.id, fan?.auto_mode])

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
        if ('auto_mode' in updated) {
          const v = updated.auto_mode
          setAutoMode(v === null || v === undefined ? null : Boolean(v))
        }
        setDetails({
          age: updated.age ?? '',
          payday: updated.payday || updated.ai_summary?.payday || '',
          hobbies: updated.hobbies || '',
          relationship_status: updated.relationship_status || updated.ai_summary?.relationship_status || '',
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fan?.id])

  useEffect(() => {
    if (!fan || !creatorId) return
    loadScripts()
    loadPPV()
  }, [fan?.id, creatorId])

  async function loadScripts() {
    if (!fan) return
    const { data: slData } = await supabase
      .from('storylines')
      .select('id, name, category, storyline_steps(id, step_number, content)')
      .eq('creator_id', creatorId)
      .order('created_at')

    const { data: progressData } = await supabase
      .from('fan_storyline_progress')
      .select('*')
      .eq('fan_id', fan.id)

    const progressMap: Record<string, any> = {}
    ;(progressData ?? []).forEach(p => { progressMap[p.storyline_id] = p })

    const result: Storyline[] = (slData ?? []).map((sl: any) => {
      const progress = progressMap[sl.id]
      const steps = [...(sl.storyline_steps ?? [])].sort((a: any, b: any) => a.step_number - b.step_number)
      return {
        id: sl.id,
        name: sl.name,
        category: sl.category,
        steps,
        currentStep: progress?.current_step ?? 0,
        completed: progress?.completed ?? false,
        progressId: progress?.id ?? null,
      }
    })
    setStorylines(result)
  }

  async function loadPPV() {
    if (!fan) return
    const { data: offers } = await supabase
      .from('ppv_offers')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at')

    const { data: sends } = await supabase
      .from('fan_ppv_sends')
      .select('*')
      .eq('fan_id', fan.id)

    const sendMap: Record<string, any> = {}
    ;(sends ?? []).forEach(s => { sendMap[s.ppv_offer_id] = s })

    const result: PPVOffer[] = (offers ?? []).map((o: any) => {
      const send = sendMap[o.id]
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        price: o.price,
        sent: !!send,
        purchased: send?.purchased ?? false,
        sendId: send?.id ?? null,
      }
    })
    setPPVOffers(result)
  }

  async function markStepSent(storyline: Storyline) {
    if (!fan) return
    const nextStep = storyline.currentStep + 1
    const completed = nextStep >= storyline.steps.length

    if (storyline.progressId) {
      await supabase
        .from('fan_storyline_progress')
        .update({ current_step: nextStep, completed, updated_at: new Date().toISOString() })
        .eq('id', storyline.progressId)
    } else {
      await supabase
        .from('fan_storyline_progress')
        .insert({
          fan_id: fan.id,
          creator_id: creatorId,
          storyline_id: storyline.id,
          current_step: nextStep,
          completed,
        })
    }
    loadScripts()
  }

  async function resetStoryline(storyline: Storyline) {
    if (!fan || !storyline.progressId) return
    await supabase
      .from('fan_storyline_progress')
      .update({ current_step: 0, completed: false, updated_at: new Date().toISOString() })
      .eq('id', storyline.progressId)
    loadScripts()
  }

  async function markPPVSent(offer: PPVOffer) {
    if (!fan) return
    if (offer.sendId) {
      await supabase.from('fan_ppv_sends').update({ purchased: !offer.purchased }).eq('id', offer.sendId)
    } else {
      await supabase.from('fan_ppv_sends').insert({
        fan_id: fan.id,
        creator_id: creatorId,
        ppv_offer_id: offer.id,
        purchased: false,
      })
    }
    loadPPV()
  }

  async function handleDetailBlur(field: string, value: string) {
    if (!fan) return
    await supabase.from('fans').update({ [field]: value }).eq('id', fan.id)
  }

  async function toggleFanAutoMode() {
    if (!fan) return
    const current = autoMode
    const next = current === null ? true : current === true ? false : null
    setAutoMode(next)
    await supabase.from('fans').update({ auto_mode: next }).eq('id', fan.id)
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
    { id: 'scripts', label: 'Scripts', icon: <FileText size={14} /> },
    { id: 'ppv', label: 'PPV', icon: <Lock size={14} /> },
  ]

  return (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto mode for this fan</span>
          <button
            type="button"
            onClick={() => toggleFanAutoMode()}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 4,
              background: autoMode === true ? 'rgba(76,175,130,0.15)' : 'transparent',
              border: autoMode === true
                ? '1px solid var(--green)'
                : autoMode === false
                  ? '1px solid rgba(255,80,80,0.35)'
                  : '1px solid var(--border)',
              color: autoMode === true
                ? 'var(--green)'
                : autoMode === false
                  ? '#ff6b6b'
                  : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {autoMode === null ? 'Default' : autoMode === true ? 'On' : 'Off'}
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
      <div style={{ flex: 1, overflow: 'auto', padding: 16, paddingBottom: 20 }}>

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div>
            <div style={LABEL_STYLE}>NOTES</div>
            <div style={{ ...CARD_STYLE, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 20, minHeight: 60 }}>
              {fan.notes?.trim() ? fan.notes : 'No notes yet.'}
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

        {/* SCRIPTS TAB */}
        {activeTab === 'scripts' && (
          <div>
            {storylines.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No storylines yet.</div>
            ) : storylines.map(sl => {
              const currentStepData = sl.steps[sl.currentStep]
              const progress = sl.completed ? 100 : Math.round((sl.currentStep / sl.steps.length) * 100)
              return (
                <div key={sl.id} style={{ ...CARD_STYLE, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{sl.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase' }}>{sl.category}</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedStoryline(expandedStoryline === sl.id ? null : sl.id)
                        }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', fontSize: 11, padding: '2px 6px',
                        }}
                      >
                        {expandedStoryline === sl.id ? '▲ hide' : '▼ all steps'}
                      </button>
                    </div>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 999,
                      background: sl.completed ? 'rgba(76, 175, 130, 0.15)' : 'rgba(200,200,200,0.1)',
                      color: sl.completed ? 'var(--green)' : 'var(--text-muted)',
                      border: `1px solid ${sl.completed ? 'rgba(76,175,130,0.3)' : 'var(--border)'}`,
                    }}>
                      {sl.completed ? '✓ Done' : `${sl.currentStep}/${sl.steps.length}`}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 3, background: 'var(--bg-hover)', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: sl.completed ? 'var(--green)' : 'var(--silver)', borderRadius: 2, transition: 'width 0.3s ease' }} />
                  </div>

                  {/* All steps expanded */}
                  {expandedStoryline === sl.id && (
                    <div style={{ marginBottom: 10 }}>
                      {sl.steps.map((step, i) => (
                        <div key={step.id} style={{
                          display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start',
                          opacity: i < sl.currentStep ? 0.4 : 1,
                        }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 700,
                            background: i < sl.currentStep ? 'var(--green)'
                              : i === sl.currentStep ? 'var(--silver)'
                              : 'var(--bg-hover)',
                            color: i <= sl.currentStep ? '#000' : 'var(--text-muted)',
                          }}>
                            {i < sl.currentStep ? '✓' : i + 1}
                          </div>
                          <div style={{
                            fontSize: 11, color: i === sl.currentStep ? 'var(--text-primary)' : 'var(--text-secondary)',
                            lineHeight: 1.4, flex: 1,
                            fontWeight: i === sl.currentStep ? 600 : 400,
                          }}>
                            {step.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Current step */}
                  {!sl.completed && currentStepData && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>NEXT MESSAGE</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '8px 10px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                        {currentStepData.content}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    {!sl.completed && (
                      <button
                        type="button"
                        onClick={() => {
                          if (currentStepData) onInsertMessage?.(currentStepData.content)
                          markStepSent(sl)
                        }}
                        style={{
                          flex: 1, padding: '6px 10px', borderRadius: 6,
                          background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                          color: 'var(--silver)', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        Send →
                      </button>
                    )}
                    {sl.currentStep > 0 && (
                      <button
                        type="button"
                        onClick={() => resetStoryline(sl)}
                        style={{
                          padding: '6px 10px', borderRadius: 6,
                          background: 'transparent', border: '1px solid var(--border)',
                          color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* PPV TAB */}
        {activeTab === 'ppv' && (
          <div>
            {ppvOffers.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No PPV offers yet.</div>
            ) : ppvOffers.map(offer => (
              <div key={offer.id} style={{ ...CARD_STYLE, marginBottom: 10, opacity: offer.purchased ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{offer.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{offer.description}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--green)', flexShrink: 0, marginLeft: 8 }}>
                    ${offer.price}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {!offer.sent ? (
                    <button
                      type="button"
                      onClick={() => {
                        onInsertMessage?.(`${offer.title} — $${offer.price}\n${offer.description}`)
                        markPPVSent(offer)
                      }}
                      style={{
                        flex: 1, padding: '5px 10px', borderRadius: 6,
                        background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                        color: 'var(--silver)', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      Send →
                    </button>
                  ) : (
                    <>
                      <span style={{
                        flex: 1, padding: '5px 10px', borderRadius: 6, textAlign: 'center',
                        background: 'rgba(76,175,130,0.1)', border: '1px solid rgba(76,175,130,0.3)',
                        color: 'var(--green)', fontSize: 11,
                      }}>
                        {offer.purchased ? '✓ Purchased' : '✓ Sent'}
                      </span>
                      {!offer.purchased && (
                        <button
                          type="button"
                          onClick={() => markPPVSent(offer)}
                          style={{
                            padding: '5px 10px', borderRadius: 6,
                            background: 'rgba(76,175,130,0.1)', border: '1px solid rgba(76,175,130,0.3)',
                            color: 'var(--green)', fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          Purchased ✓
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </aside>
  )
}
