'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

type Script = { id: string; title: string; content: string; category: string }
type StorylineStep = { id?: string; step_number: number; content: string }
type Storyline = { id: string; name: string; category: string; steps: StorylineStep[] }

const CATEGORIES = ['greeting', 'upsell', 'reengagement', 'custom']
const INPUT = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 6, padding: '8px 12px', color: 'var(--text-primary)',
  fontSize: 13, boxSizing: 'border-box' as const, width: '100%', outline: 'none',
}
const CARD = {
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 20, marginBottom: 16,
}
const LABEL = {
  fontSize: 11, textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8,
}

export default function ScriptsPage() {
  const [creatorId, setCreatorId] = useState('')
  const [activeView, setActiveView] = useState<'scripts' | 'storylines'>('storylines')

  // Scripts state
  const [scripts, setScripts] = useState<Script[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('custom')
  const [editingScript, setEditingScript] = useState<Script | null>(null)

  // Storylines state
  const [storylines, setStorylines] = useState<Storyline[]>([])
  const [showNewStoryline, setShowNewStoryline] = useState(false)
  const [newStorylineName, setNewStorylineName] = useState('')
  const [newStorylineCategory, setNewStorylineCategory] = useState('upsell')
  const [newSteps, setNewSteps] = useState<string[]>([''])
  const [expandedStoryline, setExpandedStoryline] = useState<string | null>(null)
  const [editingStoryline, setEditingStoryline] = useState<Storyline | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('chatter_creators').select('creator_id').eq('chatter_id', user.id).limit(1).single()
        .then(({ data }) => { if (data) setCreatorId((data as any).creator_id) })
    })
  }, [])

  useEffect(() => {
    if (!creatorId) return
    loadScripts()
    loadStorylines()
  }, [creatorId])

  async function loadScripts() {
    const { data } = await supabase.from('scripts').select('*').eq('creator_id', creatorId).order('category')
    if (data) setScripts(data)
  }

  async function loadStorylines() {
    const { data } = await supabase
      .from('storylines')
      .select('id, name, category, storyline_steps(id, step_number, content)')
      .eq('creator_id', creatorId)
      .order('created_at')
    if (data) {
      setStorylines(data.map((sl: any) => ({
        ...sl,
        steps: [...(sl.storyline_steps ?? [])].sort((a: any, b: any) => a.step_number - b.step_number),
      })))
    }
  }

  async function addScript() {
    if (!newTitle.trim() || !newContent.trim()) return
    const { data } = await supabase.from('scripts')
      .insert({ creator_id: creatorId, title: newTitle.trim(), content: newContent.trim(), category: newCategory })
      .select().single()
    if (data) { setScripts(prev => [...prev, data]); setNewTitle(''); setNewContent('') }
  }

  async function saveEditScript() {
    if (!editingScript) return
    await supabase.from('scripts').update({ title: editingScript.title, content: editingScript.content, category: editingScript.category }).eq('id', editingScript.id)
    setScripts(prev => prev.map(s => s.id === editingScript.id ? editingScript : s))
    setEditingScript(null)
  }

  async function deleteScript(id: string) {
    await supabase.from('scripts').delete().eq('id', id)
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  async function addStoryline() {
    if (!newStorylineName.trim()) return
    const validSteps = newSteps.filter(s => s.trim())
    if (validSteps.length === 0) return

    const { data: sl } = await supabase.from('storylines')
      .insert({ creator_id: creatorId, name: newStorylineName.trim(), category: newStorylineCategory })
      .select().single()
    if (!sl) return

    await supabase.from('storyline_steps').insert(
      validSteps.map((content, i) => ({ storyline_id: sl.id, step_number: i, content: content.trim() }))
    )

    setNewStorylineName('')
    setNewSteps([''])
    setShowNewStoryline(false)
    loadStorylines()
  }

  async function saveEditStoryline() {
    if (!editingStoryline) return
    await supabase.from('storylines').update({ name: editingStoryline.name, category: editingStoryline.category }).eq('id', editingStoryline.id)
    await supabase.from('storyline_steps').delete().eq('storyline_id', editingStoryline.id)
    await supabase.from('storyline_steps').insert(
      editingStoryline.steps.map((s, i) => ({ storyline_id: editingStoryline.id, step_number: i, content: s.content.trim() }))
    )
    setEditingStoryline(null)
    loadStorylines()
  }

  async function deleteStoryline(id: string) {
    await supabase.from('storylines').delete().eq('id', id)
    setStorylines(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg-base)', padding: 32, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
              <span className="silver-text">Scripts</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Manage quick-reply scripts and multi-step storylines</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['storylines', 'scripts'] as const).map(v => (
              <button key={v} type="button" onClick={() => setActiveView(v)} style={{
                padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                border: activeView === v ? '1px solid var(--silver)' : '1px solid var(--border)',
                background: activeView === v ? 'rgba(200,200,200,0.1)' : 'transparent',
                color: activeView === v ? 'var(--silver)' : 'var(--text-muted)',
              }}>{v}</button>
            ))}
          </div>
        </div>

        {/* STORYLINES VIEW */}
        {activeView === 'storylines' && (
          <div>
            <button type="button" onClick={() => setShowNewStoryline(v => !v)} style={{
              width: '100%', padding: '12px', borderRadius: 10, marginBottom: 20,
              border: '1px dashed var(--border)', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 18 }}>+</span> New Storyline
            </button>

            {/* New storyline form */}
            {showNewStoryline && (
              <div style={{ ...CARD, borderColor: 'var(--silver)', marginBottom: 24 }}>
                <div style={LABEL}>New Storyline</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input value={newStorylineName} onChange={e => setNewStorylineName(e.target.value)}
                    placeholder="Storyline name (e.g. Custom Video Upsell)"
                    style={{ ...INPUT, flex: 1 }} />
                  <select value={newStorylineCategory} onChange={e => setNewStorylineCategory(e.target.value)}
                    style={{ ...INPUT, width: 'auto', padding: '8px 10px' }}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div style={LABEL}>Steps (in order)</div>
                {newSteps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)',
                      flexShrink: 0, marginTop: 8,
                    }}>{i + 1}</div>
                    <textarea value={step} onChange={e => setNewSteps(prev => prev.map((s, j) => j === i ? e.target.value : s))}
                      placeholder={`Step ${i + 1} message...`} rows={2}
                      style={{ ...INPUT, resize: 'none', flex: 1 }} />
                    {newSteps.length > 1 && (
                      <button type="button" onClick={() => setNewSteps(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 18, marginTop: 6 }}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setNewSteps(prev => [...prev, ''])}
                  style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '5px 12px', marginBottom: 12 }}>
                  + Add step
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={addStoryline} style={{
                    padding: '7px 16px', background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                    borderRadius: 6, color: 'var(--silver)', fontSize: 13, cursor: 'pointer',
                  }}>Save Storyline</button>
                  <button type="button" onClick={() => setShowNewStoryline(false)} style={{
                    padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Storyline list */}
            {CATEGORIES.map(cat => {
              const catSL = storylines.filter(s => s.category === cat)
              if (catSL.length === 0) return null
              return (
                <div key={cat} style={{ marginBottom: 24 }}>
                  <div style={LABEL}>{cat}</div>
                  {catSL.map(sl => (
                    <div key={sl.id} style={CARD}>
                      {editingStoryline?.id === sl.id ? (
                        // Edit mode
                        <div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            <input value={editingStoryline.name} onChange={e => setEditingStoryline(prev => prev ? { ...prev, name: e.target.value } : null)}
                              style={{ ...INPUT, flex: 1 }} />
                            <select value={editingStoryline.category} onChange={e => setEditingStoryline(prev => prev ? { ...prev, category: e.target.value } : null)}
                              style={{ ...INPUT, width: 'auto', padding: '8px 10px' }}>
                              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          {editingStoryline.steps.map((step, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                              <div style={{
                                width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-elevated)',
                                border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)',
                                flexShrink: 0, marginTop: 8,
                              }}>{i + 1}</div>
                              <textarea value={step.content}
                                onChange={e => setEditingStoryline(prev => prev ? {
                                  ...prev, steps: prev.steps.map((s, j) => j === i ? { ...s, content: e.target.value } : s)
                                } : null)}
                                rows={2} style={{ ...INPUT, resize: 'none', flex: 1 }} />
                              {editingStoryline.steps.length > 1 && (
                                <button type="button" onClick={() => setEditingStoryline(prev => prev ? { ...prev, steps: prev.steps.filter((_, j) => j !== i) } : null)}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 18, marginTop: 6 }}>×</button>
                              )}
                            </div>
                          ))}
                          <button type="button" onClick={() => setEditingStoryline(prev => prev ? { ...prev, steps: [...prev.steps, { step_number: prev.steps.length, content: '' }] } : null)}
                            style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '5px 12px', marginBottom: 12 }}>
                            + Add step
                          </button>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={saveEditStoryline} style={{
                              padding: '6px 14px', background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                              borderRadius: 6, color: 'var(--silver)', fontSize: 12, cursor: 'pointer',
                            }}>Save</button>
                            <button type="button" onClick={() => setEditingStoryline(null)} style={{
                              padding: '6px 14px', background: 'transparent', border: '1px solid var(--border)',
                              borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                            }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{sl.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sl.steps.length} steps</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button type="button" onClick={() => setExpandedStoryline(expandedStoryline === sl.id ? null : sl.id)}
                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
                                {expandedStoryline === sl.id ? '▲ Hide' : '▼ Preview'}
                              </button>
                              <button type="button" onClick={() => setEditingStoryline(sl)}
                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
                                Edit
                              </button>
                              <button type="button" onClick={() => deleteStoryline(sl.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16 }}>×</button>
                            </div>
                          </div>

                          {expandedStoryline === sl.id && (
                            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                              {sl.steps.map((step, i) => (
                                <div key={step.id ?? i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                                  <div style={{
                                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 10, color: 'var(--text-muted)', marginTop: 2,
                                  }}>{i + 1}</div>
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1, padding: '4px 0' }}>
                                    {step.content}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* SCRIPTS VIEW */}
        {activeView === 'scripts' && (
          <div>
            {/* Add new script */}
            <div style={CARD}>
              <div style={LABEL}>Add Quick-Reply Script</div>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Title (e.g. Warm greeting)"
                style={{ ...INPUT, marginBottom: 8 }} />
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
                placeholder="Message content..." rows={3}
                style={{ ...INPUT, resize: 'none', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  style={{ ...INPUT, width: 'auto', padding: '7px 12px' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" onClick={addScript} style={{
                  padding: '7px 16px', background: 'rgba(200,200,200,0.1)',
                  border: '1px solid var(--silver)', borderRadius: 6,
                  color: 'var(--silver)', fontSize: 13, cursor: 'pointer',
                }}>Add</button>
              </div>
            </div>

            {/* Script list */}
            {CATEGORIES.map(cat => {
              const catScripts = scripts.filter(s => s.category === cat)
              if (catScripts.length === 0) return null
              return (
                <div key={cat} style={{ marginBottom: 24 }}>
                  <div style={LABEL}>{cat}</div>
                  {catScripts.map(script => (
                    <div key={script.id} style={{ ...CARD, padding: '12px 16px' }}>
                      {editingScript?.id === script.id ? (
                        <div>
                          <input value={editingScript.title} onChange={e => setEditingScript(prev => prev ? { ...prev, title: e.target.value } : null)}
                            style={{ ...INPUT, marginBottom: 8 }} />
                          <textarea value={editingScript.content} onChange={e => setEditingScript(prev => prev ? { ...prev, content: e.target.value } : null)}
                            rows={3} style={{ ...INPUT, resize: 'none', marginBottom: 8 }} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" onClick={saveEditScript} style={{
                              padding: '5px 12px', background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                              borderRadius: 6, color: 'var(--silver)', fontSize: 12, cursor: 'pointer',
                            }}>Save</button>
                            <button type="button" onClick={() => setEditingScript(null)} style={{
                              padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)',
                              borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                            }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>{script.title}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{script.content}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button type="button" onClick={() => setEditingScript(script)}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '3px 8px' }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => deleteScript(script.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16 }}>×</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}