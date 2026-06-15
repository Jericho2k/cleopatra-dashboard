'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const API = process.env.NEXT_PUBLIC_API_URL

type VaultSet = {
  id: string; creator_id: string; title: string
  location: string | null; outfit: string | null
  explicit_min: number | null; explicit_max: number | null
  media_ids: string[]; preview_media_id: string | null
  suggested_price: number | null
  status: 'draft' | 'approved' | 'archived'; source: 'ai' | 'manual'
}
type Thumb = { thumbnail_url: string | null; url: string | null; mimetype: string | null }

export default function SetsPage() {
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([])
  const [creatorId, setCreatorId] = useState<string | null>(null)
  const [sets, setSets] = useState<VaultSet[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all')
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({})
  const [preview, setPreview] = useState<{ url: string; isVideo: boolean } | null>(null)

  useEffect(() => {
    supabase.from('creators').select('id, name').then(({ data }) => {
      const list = (data ?? []).map((c: any) => ({ id: c.id, name: c.name }))
      setCreators(list); setCreatorId(prev => prev ?? list[0]?.id ?? null)
    })
  }, [])

  async function loadSets(cid: string) {
    setLoading(true)
    const { data } = await supabase.from('vault_sets').select('*').eq('creator_id', cid)
      .order('status', { ascending: true }).order('explicit_max', { ascending: false })
    setSets((data ?? []) as VaultSet[]); setLoading(false)
  }
  useEffect(() => { if (creatorId) loadSets(creatorId) }, [creatorId])

  useEffect(() => {
    if (!creatorId) return
    const ids = [...new Set(sets.flatMap(s => s.media_ids))].filter(id => !(id in thumbs))
    if (!ids.length) return
    Promise.all(ids.map(mid =>
      fetch(`${API}/vault-media-url/${creatorId}/${mid}`).then(r => r.json())
        .then(d => ({ mid, d })).catch(() => ({ mid, d: { thumbnail_url: null, url: null, mimetype: null } }))
    )).then(res => setThumbs(prev => { const n = { ...prev }; for (const { mid, d } of res) n[mid] = d; return n }))
  }, [sets, creatorId])

  async function generate() {
    if (!creatorId) return
    setGenerating(true)
    try { await fetch(`${API}/generate-sets/${creatorId}`, { method: 'POST' }); await loadSets(creatorId) }
    finally { setGenerating(false) }
  }
  async function patchSet(id: string, patch: Partial<VaultSet>) {
    setSets(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
    await supabase.from('vault_sets').update(patch).eq('id', id)
  }
  async function removeMedia(s: VaultSet, mid: string) {
    const media_ids = s.media_ids.filter(x => x !== mid)
    const preview_media_id = s.preview_media_id === mid ? (media_ids[0] ?? null) : s.preview_media_id
    await patchSet(s.id, { media_ids, preview_media_id })
  }
  async function del(id: string) {
    setSets(prev => prev.filter(s => s.id !== id)); await supabase.from('vault_sets').delete().eq('id', id)
  }
  async function openFull(mid: string) {
    const t = thumbs[mid]
    if (t?.url) return setPreview({ url: t.url, isVideo: !!t.mimetype?.startsWith('video') })
    const r = await fetch(`${API}/vault-media-url/${creatorId}/${mid}`).then(r => r.json())
    if (r?.url) setPreview({ url: r.url, isVideo: !!r.mimetype?.startsWith('video') })
  }

  const shown = sets.filter(s => (filter === 'all' ? true : s.status === filter))
  const counts = { all: sets.length, draft: sets.filter(s => s.status === 'draft').length, approved: sets.filter(s => s.status === 'approved').length }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Sets</div>
        <select value={creatorId ?? ''} onChange={e => setCreatorId(e.target.value)}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
          {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Curate consistent photo sets the AI can send. Only <b>approved</b> sets are sellable in auto-mode.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <button onClick={generate} disabled={generating || !creatorId}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--silver)', background: 'rgba(200,200,200,0.1)', color: 'var(--silver)', fontSize: 13, cursor: 'pointer' }}>
          {generating ? 'Generating…' : '✦ Generate sets from vault'}
        </button>
        <div style={{ flex: 1 }} />
        {(['all', 'draft', 'approved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
            border: filter === f ? '1px solid var(--silver)' : '1px solid var(--border)',
            background: filter === f ? 'rgba(200,200,200,0.1)' : 'transparent',
            color: filter === f ? 'var(--silver)' : 'var(--text-muted)',
          }}>{f[0].toUpperCase() + f.slice(1)} ({counts[f]})</button>
        ))}
      </div>

      {loading ? <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        : shown.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No sets yet — hit “Generate sets from vault.”</div>
        : shown.map(s => (
          <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14, background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <input value={s.title}
                onChange={e => setSets(prev => prev.map(x => x.id === s.id ? { ...x, title: e.target.value } : x))}
                onBlur={e => patchSet(s.id, { title: e.target.value })}
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }} />
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999,
                background: s.status === 'approved' ? 'rgba(76,175,130,0.15)' : 'rgba(200,200,200,0.1)',
                color: s.status === 'approved' ? 'var(--green)' : 'var(--text-muted)' }}>
                {s.status}{s.source === 'manual' ? ' · manual' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>{s.media_ids.length} pcs</span>
              <span>explicit {s.explicit_min}–{s.explicit_max}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                $<input type="number" defaultValue={s.suggested_price ?? 0}
                  onBlur={e => patchSet(s.id, { suggested_price: Number(e.target.value) })}
                  style={{ width: 64, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {s.media_ids.map(mid => {
                const t = thumbs[mid]; const src = t?.thumbnail_url ?? t?.url ?? null
                const isPreview = s.preview_media_id === mid
                return (
                  <div key={mid} style={{ position: 'relative', width: 78, height: 100, borderRadius: 6, overflow: 'hidden',
                    border: isPreview ? '2px solid var(--silver)' : '1px solid var(--border)', background: 'var(--bg-base)' }}>
                    {src ? <img src={src} alt="" onClick={() => openFull(mid)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>🎬</div>}
                    <button title="Preview image" onClick={() => patchSet(s.id, { preview_media_id: mid })}
                      style={{ position: 'absolute', left: 2, top: 2, border: 'none', borderRadius: 4, cursor: 'pointer',
                        background: isPreview ? 'var(--silver)' : 'rgba(0,0,0,0.5)', color: isPreview ? '#000' : '#fff', fontSize: 10, padding: '1px 4px' }}>★</button>
                    <button title="Remove" onClick={() => removeMedia(s, mid)}
                      style={{ position: 'absolute', right: 2, top: 2, border: 'none', borderRadius: 4, cursor: 'pointer',
                        background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, lineHeight: 1, padding: '2px 5px' }}>×</button>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {s.status === 'approved'
                ? <button onClick={() => patchSet(s.id, { status: 'draft' })} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Unapprove</button>
                : <button onClick={() => patchSet(s.id, { status: 'approved' })} disabled={s.media_ids.length < 2} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--green)', background: 'rgba(76,175,130,0.15)', color: 'var(--green)', fontSize: 12, cursor: 'pointer', opacity: s.media_ids.length < 2 ? 0.5 : 1 }}>Approve</button>}
              <div style={{ flex: 1 }} />
              <button onClick={() => del(s.id)} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-faint)', fontSize: 12, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        ))}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out' }}>
          {preview.isVideo ? <video src={preview.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
            : <img src={preview.url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} />}
        </div>
      )}
    </div>
  )
}
