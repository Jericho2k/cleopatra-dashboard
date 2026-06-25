'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const API = process.env.NEXT_PUBLIC_API_URL

type VaultSet = {
  id: string; creator_id: string; title: string
  location: string | null; outfit: string | null
  explicit_min: number | null; explicit_max: number | null
  media_ids: string[]; preview_media_id: string | null
  suggested_price: number | null; tags: string[] | null
  status: 'draft' | 'approved' | 'archived'; source: 'ai' | 'manual'
}
type Thumb = { thumbnail_url: string | null; url: string | null; mimetype: string | null }
type VaultMedia = { fansly_media_id: string; thumbnail_url: string | null; url: string | null; mimetype: string | null; explicitness_level: number | null; album_title: string | null }

export default function SetsPage() {
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([])
  const [creatorId, setCreatorId] = useState<string | null>(null)
  const [sets, setSets] = useState<VaultSet[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all')
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({})
  const [preview, setPreview] = useState<{ url: string; isVideo: boolean } | null>(null)
  // manual picker
  const [vault, setVault] = useState<VaultMedia[]>([])
  const [vaultLoading, setVaultLoading] = useState(false)
  const [picker, setPicker] = useState<{ setId: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [albumFilter, setAlbumFilter] = useState<string>('all')
  const [pickerLimit, setPickerLimit] = useState<number>(60)

  // creators — matches app/page.tsx (chatter_creators scoped to the user)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('chatter_creators')
        .select('creator_id, creators(id, platform_username)')
        .eq('chatter_id', user.id)
      const list = (data ?? []).map((r: any) => ({
        id: r.creator_id, name: r.creators?.platform_username ?? r.creator_id,
      }))
      setCreators(list)
      setCreatorId(prev => prev ?? list[0]?.id ?? null)
    })()
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
    let cancelled = false
    ;(async () => {
      const updates: Record<string, Thumb> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data } = await supabase
          .from('creator_vault_media')
          .select('fansly_media_id, thumbnail_url, url, mimetype')
          .eq('creator_id', creatorId)
          .in('fansly_media_id', chunk)
        for (const row of (data ?? []) as any[]) {
          updates[row.fansly_media_id] = { thumbnail_url: row.thumbnail_url, url: row.url, mimetype: row.mimetype }
        }
      }
      if (!cancelled) setThumbs(prev => ({ ...prev, ...updates }))
    })()
    return () => { cancelled = true }
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
    const { data } = await supabase.from('creator_vault_media')
      .select('url, mimetype').eq('creator_id', creatorId).eq('fansly_media_id', mid).single()
    if (data?.url) setPreview({ url: data.url, isVideo: !!data.mimetype?.startsWith('video') })
  }

  // manual create
  async function newSet() {
    if (!creatorId) return
    const { data } = await supabase.from('vault_sets').insert({
      creator_id: creatorId, title: 'New set', media_ids: [], status: 'draft',
      source: 'manual', suggested_price: 30,
    }).select().single()
    if (data) { setSets(prev => [data as VaultSet, ...prev]); openPicker((data as VaultSet).id) }
  }

  async function loadVault(cid: string) {
    if (vault.length) return
    setVaultLoading(true)
    const all: VaultMedia[] = []; let from = 0
    while (true) {
      const { data } = await supabase.from('creator_vault_media')
        .select('fansly_media_id, thumbnail_url, url, mimetype, explicitness_level, album_title')
        .eq('creator_id', cid).order('album_title').range(from, from + 999)
      if (data) all.push(...(data as VaultMedia[]))
      if (!data || data.length < 1000) break
      from += 1000
    }
    setVault(all); setVaultLoading(false)
  }
  function openPicker(setId: string) { setSelected(new Set()); setAlbumFilter('all'); setPickerLimit(60); setPicker({ setId }); if (creatorId) loadVault(creatorId) }

  const vaultMap = useMemo(() => Object.fromEntries(vault.map(v => [v.fansly_media_id, v])), [vault])
  const albums = useMemo(() => ['all', ...Array.from(new Set(vault.map(v => v.album_title || 'Uncategorized')))], [vault])

  async function addSelected() {
    if (!picker) return
    const s = sets.find(x => x.id === picker.setId); if (!s) return
    const merged = [...new Set([...s.media_ids, ...Array.from(selected)])]
    const levels = merged.map(id => vaultMap[id]?.explicitness_level).filter((x): x is number => typeof x === 'number')
    const patch: Partial<VaultSet> = { media_ids: merged, preview_media_id: s.preview_media_id ?? merged[0] ?? null }
    if (levels.length) { patch.explicit_min = Math.min(...levels); patch.explicit_max = Math.max(...levels) }
    await patchSet(s.id, patch); setPicker(null); setSelected(new Set())
  }

  const shown = sets.filter(s => (filter === 'all' ? true : s.status === filter))
  const counts = { all: sets.length, draft: sets.filter(s => s.status === 'draft').length, approved: sets.filter(s => s.status === 'approved').length }
  const pickerVaultAll = vault.filter(v => albumFilter === 'all' || (v.album_title || 'Uncategorized') === albumFilter)
  const pickerVault = pickerVaultAll.slice(0, pickerLimit)

  return (
    <div style={{ height: '100vh', overflowY: 'auto', boxSizing: 'border-box', padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Sets</div>
        <select value={creatorId ?? ''} onChange={e => setCreatorId(e.target.value)}
          style={{ minWidth: 180, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
          {creators.length === 0 && <option value="">No creators</option>}
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
        <button onClick={newSet} disabled={!creatorId}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
          + New set
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
        : shown.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No sets yet — generate from vault, or “+ New set” to build one by hand.</div>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                explicit
                <select value={s.explicit_max ?? ''}
                  onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); patchSet(s.id, { explicit_min: v, explicit_max: v }) }}
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '3px 6px', fontSize: 12 }}>
                  <option value="">–</option>
                  {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                $<input type="number" defaultValue={s.suggested_price ?? 0}
                  onBlur={e => patchSet(s.id, { suggested_price: Number(e.target.value) })}
                  style={{ width: 64, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
              </label>
              <button onClick={() => openPicker(s.id)} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>+ Add photos</button>
            </div>
            {s.tags && s.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {s.tags.map(t => (
                  <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'rgba(155,143,212,0.12)', color: '#9b8fd4' }}>{t}</span>
                ))}
              </div>
            )}
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

      {picker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, width: 'min(880px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600 }}>Add to set</div>
              <select value={albumFilter} onChange={e => { setAlbumFilter(e.target.value); setPickerLimit(60) }}
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                {albums.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {pickerVaultAll.length} items{pickerVaultAll.length > pickerVault.length ? ` · showing ${pickerVault.length}` : ''}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={addSelected} disabled={selected.size === 0}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--green)', background: 'rgba(76,175,130,0.15)', color: 'var(--green)', fontSize: 13, cursor: 'pointer', opacity: selected.size ? 1 : 0.5 }}>Add {selected.size || ''}</button>
              <button onClick={() => setPicker(null)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 16, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gridAutoRows: 'min-content', alignContent: 'start', gap: 8 }}>
              {vaultLoading ? <div style={{ color: 'var(--text-muted)' }}>Loading vault…</div>
                : pickerVault.map(v => {
                  const sel = selected.has(v.fansly_media_id)
                  const isVid = v.mimetype?.startsWith('video')
                  return (
                    <div key={v.fansly_media_id} onClick={() => setSelected(prev => { const n = new Set(prev); n.has(v.fansly_media_id) ? n.delete(v.fansly_media_id) : n.add(v.fansly_media_id); return n })}
                      style={{ position: 'relative', height: 128, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: sel ? '2px solid var(--green)' : '1px solid var(--border)' }}>
                      {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-faint)' }}>{isVid ? '🎬' : '?'}</div>}
                      {isVid && <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 12 }}>🎬</span>}
                      {sel && <span style={{ position: 'absolute', right: 4, top: 4, background: 'var(--green)', color: '#000', borderRadius: 999, fontSize: 11, padding: '0 5px' }}>✓</span>}
                    </div>
                  )
                })}
            </div>
            {pickerVaultAll.length > pickerVault.length && (
              <div style={{ padding: '0 16px 16px', textAlign: 'center' }}>
                <button onClick={() => setPickerLimit(l => l + 120)}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
                  Load more ({pickerVaultAll.length - pickerVault.length} left)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}