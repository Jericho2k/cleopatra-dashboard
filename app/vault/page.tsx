'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function VaultPage() {
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([])
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null)

  const [vaultAlbums, setVaultAlbums] = useState<Record<string, any[]>>({})
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [previewEdits, setPreviewEdits] = useState<{ content_category: string; ai_description: string; price_min: string; price_max: string; scene_location: string; scene_outfit: string; scene_lighting: string; scene_id: string } | null>(null)
  const [previewSaving, setPreviewSaving] = useState(false)
  const [syncingVault, setSyncingVault] = useState(false)
  const [vaultProgress, setVaultProgress] = useState<{ synced: number; total: number; album: string } | null>(null)
  const [uploadingVault, setUploadingVault] = useState(false)
  const [categorizingVault, setCategorizingVault] = useState(false)
  const [categorizeProgress, setCategorizeProgress] = useState<{ done: number; total: number; status: string } | null>(null)
  const [uploadAlbum, setUploadAlbum] = useState('')
  const [newAlbumName, setNewAlbumName] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploadNotesMode, setUploadNotesMode] = useState<'manual' | 'ai'>('ai')
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // creators — matches Sets page (chatter_creators scoped to the signed-in user)
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
      setSelectedCreatorId(prev => prev ?? list[0]?.id ?? null)
    })()
  }, [])

  const loadVaultMedia = async (creatorId: string) => {
    const allRows: any[] = []
    const pageSize = 1000
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('creator_vault_media')
        .select('id, filename, url, album_title, mimetype, ai_description, thumbnail_url, media_type, title, price, is_active, content_category, price_min, price_max, scene_id, scene_location, scene_outfit, scene_lighting, explicitness_level, good_for, tags')
        .eq('creator_id', creatorId)
        .order('album_title')
        .range(from, from + pageSize - 1)
      if (data) allRows.push(...data)
      if (!data || data.length < pageSize) break
      from += pageSize
    }
    const byAlbum = allRows.reduce((acc: Record<string, any[]>, item: any) => {
      const album = item.album_title || 'Uncategorized'
      if (!acc[album]) acc[album] = []
      acc[album].push(item)
      return acc
    }, {} as Record<string, any[]>)
    setVaultAlbums(byAlbum)
  }

  useEffect(() => {
    if (!selectedCreatorId) return
    setSelectedAlbum(null)
    loadVaultMedia(selectedCreatorId)
  }, [selectedCreatorId])

  return (
    <div style={{ height: '100vh', overflowY: 'auto', boxSizing: 'border-box', padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--silver)' }}>
          VAULT
        </div>
        <select value={selectedCreatorId ?? ''} onChange={e => setSelectedCreatorId(e.target.value)}
          style={{ minWidth: 180, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
          {creators.length === 0 && <option value="">No creators</option>}
          {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
                <button
                  onClick={async () => {
                    if (!selectedCreatorId || syncingVault) return
                    setSyncingVault(true)
                    setVaultProgress({ synced: 0, total: 0, album: 'Starting...' })
                    const creatorId = selectedCreatorId
                    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-vault-start/${creatorId}`, { method: 'POST' })
                    const interval = setInterval(async () => {
                      try {
                        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-vault-status/${creatorId}`)
                        const state = await res.json()
                        setVaultProgress({ synced: state.synced, total: state.total, album: state.album })
                        if (state.status === 'done' || state.status === 'error') {
                          clearInterval(interval)
                          await loadVaultMedia(creatorId)
                          setSyncingVault(false)
                          setTimeout(() => setVaultProgress(null), 1500)
                        }
                      } catch {
                        clearInterval(interval)
                        setSyncingVault(false)
                        setVaultProgress(null)
                      }
                    }, 1000)
                  }}
                  style={{
                    padding: '6px 14px', borderRadius: 6,
                    cursor: syncingVault ? 'not-allowed' : 'pointer',
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: 12,
                    opacity: syncingVault ? 0.5 : 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {syncingVault
                    ? `↻ ${vaultProgress?.synced ?? 0}${vaultProgress?.total ? `/${vaultProgress.total}` : ''}`
                    : '↻ Sync Vault'}
                </button>
                <button
                  onClick={() => setShowUploadModal(true)}
                  disabled={!selectedCreatorId}
                  style={{
                    padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: 12,
                    opacity: !selectedCreatorId ? 0.5 : 1,
                  }}
                >
                  ↑ Add Media
                </button>
                <button
                  onClick={async () => {
                    if (!selectedCreatorId || categorizingVault) return
                    setCategorizingVault(true)
                    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categorize-vault/${selectedCreatorId}`, { method: 'POST' })
                    const interval = setInterval(async () => {
                      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categorize-vault-status/${selectedCreatorId}`)
                      const state = await res.json()
                      setCategorizeProgress(state)
                      if (state.status === 'done' || state.status === 'error') {
                        clearInterval(interval)
                        setCategorizingVault(false)
                        setTimeout(() => setCategorizeProgress(null), 2000)
                      }
                    }, 2000)
                  }}
                  disabled={!selectedCreatorId || categorizingVault}
                  style={{
                    padding: '6px 14px', borderRadius: 6, cursor: categorizingVault ? 'not-allowed' : 'pointer',
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: 12,
                    opacity: !selectedCreatorId || categorizingVault ? 0.5 : 1,
                  }}
                >
                  {categorizingVault
                    ? `✦ ${categorizeProgress?.done ?? 0}/${categorizeProgress?.total ?? '?'}`
                    : '✦ Categorize'}
                </button>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Vault</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {Object.values(vaultAlbums).flat().length} media items across {Object.keys(vaultAlbums).length} albums
                </div>
              </div>

              {!selectedAlbum && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div
                    onClick={() => setSelectedAlbum('__all__')}
                    style={{
                      width: 140, padding: '16px 12px', borderRadius: 8,
                      border: '1px solid var(--border)', cursor: 'pointer',
                      background: 'var(--bg-elevated)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 28 }}>📁</div>
                    <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>All</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {Object.values(vaultAlbums).flat().length} items
                    </div>
                  </div>

                  {Object.entries(vaultAlbums).map(([albumTitle, items]: [string, any[]]) => (
                    <div
                      key={albumTitle}
                      onClick={() => setSelectedAlbum(albumTitle)}
                      style={{
                        width: 140, padding: '16px 12px', borderRadius: 8,
                        border: '1px solid var(--border)', cursor: 'pointer',
                        background: 'var(--bg-elevated)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 28 }}>📂</div>
                      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', wordBreak: 'break-word' }}>
                        {albumTitle}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length} items</div>
                    </div>
                  ))}
                </div>
              )}

              {selectedAlbum && (
                <div>
                  <button
                    onClick={() => setSelectedAlbum(null)}
                    style={{
                      marginBottom: 16, fontSize: 12, padding: '4px 10px',
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >
                    ← Back
                  </button>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                    {selectedAlbum === '__all__' ? 'All Media' : selectedAlbum}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(selectedAlbum === '__all__'
                      ? Object.values(vaultAlbums).flat()
                      : vaultAlbums[selectedAlbum] || []
                    ).map((item: any) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setPreviewItem(item)
                          setPreviewEdits({
                            content_category: item.content_category || '',
                            ai_description: item.ai_description || '',
                            price_min: String(item.price_min || ''),
                            price_max: String(item.price_max || ''),
                            scene_location: item.scene_location || '',
                            scene_outfit: item.scene_outfit || '',
                            scene_lighting: item.scene_lighting || '',
                            scene_id: item.scene_id || '',
                          })
                        }}
                        style={{ cursor: 'pointer', position: 'relative' }}
                      >
                        {item.mimetype?.startsWith('video') ? (
                          <div style={{
                            width: 100, height: 100, borderRadius: 6,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 24,
                          }}>🎥</div>
                        ) : item.url ? (
                          <img src={item.url} style={{
                            width: 100, height: 100, objectFit: 'cover',
                            borderRadius: 6, border: '1px solid var(--border)',
                          }} onError={(e) => {
                            (e.target as HTMLImageElement).parentElement!.innerHTML =
                              '<div style="width:100px;height:100px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px"></div>'
                          }} />
                        ) : (
                          <div style={{
                            width: 100, height: 100, borderRadius: 6,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                          }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {previewItem && previewEdits && (
                <div
                  onClick={() => { setPreviewItem(null); setPreviewEdits(null) }}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.85)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 24,
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'flex', gap: 20, maxWidth: '90vw', maxHeight: '90vh',
                      alignItems: 'flex-start',
                    }}
                  >
                    {/* Media */}
                    <div style={{ flexShrink: 0, maxWidth: '60vw' }}>
                      {previewItem.mimetype?.startsWith('video') ? (
                        <video src={previewItem.url} controls style={{ maxHeight: '80vh', maxWidth: '60vw', borderRadius: 8, background: '#000' }} />
                      ) : (
                        <img src={previewItem.url} style={{ maxHeight: '80vh', maxWidth: '60vw', objectFit: 'contain', borderRadius: 8 }} />
                      )}
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6, textAlign: 'center' }}>
                        {previewItem.filename}
                      </div>
                    </div>

                    {/* Metadata panel */}
                    <div style={{
                      width: 280, flexShrink: 0,
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: 20, overflowY: 'auto', maxHeight: '80vh',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Media Details</div>
                        <button
                          onClick={() => { setPreviewItem(null); setPreviewEdits(null) }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: 0 }}
                        >×</button>
                      </div>

                      {/* Category */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</div>
                        <select
                          value={previewEdits.content_category}
                          onChange={e => setPreviewEdits(p => p ? { ...p, content_category: e.target.value } : p)}
                          style={{
                            width: '100%', background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)', borderRadius: 6,
                            color: 'var(--text-primary)', padding: '7px 10px', fontSize: 12,
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="">— uncategorized —</option>
                          <option value="teaser_clothed">Clothed teaser (free)</option>
                          <option value="teaser_bundle">Teaser bundle no nudity (free)</option>
                          <option value="legs_feet">Legs / feet / armpits ($15-70)</option>
                          <option value="lingerie_photo">Lingerie photo ($10-80)</option>
                          <option value="lingerie_video">Lingerie video ($15-90)</option>
                          <option value="nude_photo">Nude photo ($15-80)</option>
                          <option value="striptease_video">Striptease video ($15-100)</option>
                          <option value="closeup_photo">Closeup photo ($25-130)</option>
                          <option value="closeup_video">Closeup video ($25-130)</option>
                          <option value="dictate_video">Dictate / dirty talk video ($15-50)</option>
                          <option value="solo_toy_photo">Solo / toy photo ($20-80)</option>
                          <option value="solo_toy_video">Solo / toy / orgasm video ($30-150)</option>
                          <option value="bg_content">BG content ($50-300)</option>
                          <option value="task">Task / custom ($10-50)</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      {/* Price range */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price range ($)</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="number"
                            placeholder="Min"
                            value={previewEdits.price_min}
                            onChange={e => setPreviewEdits(p => p ? { ...p, price_min: e.target.value } : p)}
                            style={{ flex: 1, minWidth: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            type="number"
                            placeholder="Max"
                            value={previewEdits.price_max}
                            onChange={e => setPreviewEdits(p => p ? { ...p, price_max: e.target.value } : p)}
                            style={{ flex: 1, minWidth: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>

                      {/* AI Description */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Description</div>
                        <textarea
                          value={previewEdits.ai_description}
                          onChange={e => setPreviewEdits(p => p ? { ...p, ai_description: e.target.value } : p)}
                          rows={4}
                          placeholder="Describe this media for the AI..."
                          style={{
                            width: '100%', background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)', borderRadius: 6,
                            padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)',
                            resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                          }}
                        />
                      </div>

                      {/* Scene fields */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scene</div>
                        <input
                          placeholder="📍 Location (e.g. bedroom, bathroom)"
                          value={previewEdits.scene_location}
                          onChange={e => setPreviewEdits(p => p ? { ...p, scene_location: e.target.value } : p)}
                          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
                        />
                        <input
                          placeholder="👗 Outfit (e.g. red lingerie, naked, towel)"
                          value={previewEdits.scene_outfit}
                          onChange={e => setPreviewEdits(p => p ? { ...p, scene_outfit: e.target.value } : p)}
                          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
                        />
                        <input
                          placeholder="💡 Lighting (e.g. dim, natural, neon)"
                          value={previewEdits.scene_lighting}
                          onChange={e => setPreviewEdits(p => p ? { ...p, scene_lighting: e.target.value } : p)}
                          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
                        />
                        <input
                          placeholder="🎬 Scene ID (e.g. bathroom-red-lingerie)"
                          value={previewEdits.scene_id}
                          onChange={e => setPreviewEdits(p => p ? { ...p, scene_id: e.target.value } : p)}
                          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>

                      {/* Album info (read only) */}
                      <div style={{ marginBottom: 14, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>ALBUM</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{previewItem.album_title || '—'}</div>
                      </div>

                      {/* Re-categorize button */}
                      <button
                        onClick={async () => {
                          if (!previewItem?.id || previewSaving) return
                          setPreviewSaving(true)
                          try {
                            const res = await fetch(
                              `${process.env.NEXT_PUBLIC_API_URL}/recategorize-item/${previewItem.id}`,
                              { method: 'POST' }
                            )
                            const data = await res.json()
                            if (data.status === 'ok' && data.item) {
                              setPreviewItem((prev: any) => ({ ...prev, ...data.item }))
                              setPreviewEdits((prev: any) => prev ? {
                                ...prev,
                                content_category: data.item.content_category || prev.content_category,
                                ai_description: data.item.ai_description || prev.ai_description,
                                scene_location: data.item.scene_location || prev.scene_location,
                                scene_outfit: data.item.scene_outfit || prev.scene_outfit,
                                scene_lighting: data.item.scene_lighting || prev.scene_lighting,
                                scene_id: data.item.scene_id || prev.scene_id,
                              } : prev)
                              setVaultAlbums(prev => {
                                const next: Record<string, any[]> = {}
                                Object.entries(prev).forEach(([album, items]) => {
                                  next[album] = (items as any[]).map(m => m.id === previewItem.id ? { ...m, ...data.item } : m)
                                })
                                return next
                              })
                            }
                          } finally {
                            setPreviewSaving(false)
                          }
                        }}
                        disabled={previewSaving}
                        style={{
                          width: '100%', padding: '6px', borderRadius: 6, marginBottom: 8,
                          background: 'rgba(155,143,212,0.1)', border: '1px solid rgba(155,143,212,0.3)',
                          color: 'var(--purple)', fontSize: 12, cursor: previewSaving ? 'not-allowed' : 'pointer',
                          opacity: previewSaving ? 0.6 : 1,
                        }}
                      >
                        {previewSaving ? 'Analyzing...' : '✦ Re-analyze with AI'}
                      </button>

                      <button
                        onClick={async () => {
                          if (!previewItem?.id || previewSaving) return
                          setPreviewSaving(true)
                          await supabase.from('creator_vault_media').update({
                            content_category: previewEdits.content_category,
                            ai_description: previewEdits.ai_description,
                            price_min: Number(previewEdits.price_min) || 0,
                            price_max: Number(previewEdits.price_max) || 0,
                            scene_location: previewEdits.scene_location,
                            scene_outfit: previewEdits.scene_outfit,
                            scene_lighting: previewEdits.scene_lighting,
                            scene_id: previewEdits.scene_id,
                          }).eq('id', previewItem.id)
                          // Update local state
                          setVaultAlbums(prev => {
                            const next: Record<string, any[]> = {}
                            Object.entries(prev).forEach(([album, items]) => {
                              next[album] = items.map(m => m.id === previewItem.id
                                ? { ...m, ...previewEdits, price_min: Number(previewEdits.price_min) || 0, price_max: Number(previewEdits.price_max) || 0 }
                                : m
                              )
                            })
                            return next
                          })
                          setPreviewItem((prev: any) => ({ ...prev, ...previewEdits }))
                          setPreviewSaving(false)
                          setPreviewItem(null)
                          setPreviewEdits(null)
                        }}
                        disabled={previewSaving}
                        style={{
                          width: '100%', padding: '8px', borderRadius: 6,
                          background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)',
                          color: 'var(--silver)', fontSize: 13, cursor: previewSaving ? 'not-allowed' : 'pointer',
                          opacity: previewSaving ? 0.6 : 1,
                        }}
                      >
                        {previewSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
      </div>

      {showUploadModal && (
        <div
          onClick={() => { if (!uploadingVault) { setShowUploadModal(false); setUploadFile(null); setUploadPreview(null); setUploadNotes(''); setUploadAlbum(''); setNewAlbumName('') } }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw',
              maxHeight: '90vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Add Media to Vault</div>
              <button type="button" onClick={() => { setShowUploadModal(false); setUploadFile(null); setUploadPreview(null); setUploadNotes(''); setUploadAlbum(''); setNewAlbumName('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>
            </div>

            {!uploadFile ? (
              <div
                onDragOver={e => { e.preventDefault(); setUploadDragOver(true) }}
                onDragLeave={() => setUploadDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setUploadDragOver(false)
                  const f = e.dataTransfer.files[0]
                  if (!f) return
                  setUploadFile(f)
                  setUploadPreview(URL.createObjectURL(f))
                }}
                onClick={() => document.getElementById('vault-file-input')?.click()}
                style={{
                  border: `2px dashed ${uploadDragOver ? 'var(--purple)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '40px 20px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  cursor: 'pointer', transition: 'border-color 0.2s',
                  background: uploadDragOver ? 'rgba(155,143,212,0.05)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 32 }}>📎</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Drag & drop an image or video<br />
                  <span style={{ fontSize: 12, color: 'var(--purple)' }}>or click to browse</span>
                </div>
                <input
                  id="vault-file-input"
                  type="file"
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setUploadFile(f)
                    setUploadPreview(URL.createObjectURL(f))
                    e.target.value = ''
                  }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 16, position: 'relative' }}>
                {uploadFile.type.startsWith('video') ? (
                  <video src={uploadPreview!} controls style={{ width: '100%', maxHeight: 240, borderRadius: 8, background: '#000' }} />
                ) : (
                  <img src={uploadPreview!} style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 8, background: 'var(--bg-elevated)' }} />
                )}
                <button
                  type="button"
                  onClick={() => { setUploadFile(null); setUploadPreview(null) }}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                    color: 'white', cursor: 'pointer', width: 24, height: 24,
                    fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{uploadFile.name}</div>
              </div>
            )}

            <div style={{ marginBottom: 16, marginTop: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Album</div>
              <select
                value={uploadAlbum}
                onChange={e => setUploadAlbum(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">No album</option>
                {Object.keys(vaultAlbums).map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
                <option value="__new__">+ Create new album...</option>
              </select>
              {uploadAlbum === '__new__' && (
                <input
                  type="text"
                  value={newAlbumName}
                  onChange={e => setNewAlbumName(e.target.value)}
                  placeholder="Album name..."
                  style={{
                    width: '100%', marginTop: 8, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-primary)', padding: '8px 12px',
                    fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>AI Description</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {(['ai', 'manual'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setUploadNotesMode(mode)}
                    style={{
                      padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      background: uploadNotesMode === mode ? 'rgba(155,143,212,0.15)' : 'transparent',
                      border: uploadNotesMode === mode ? '1px solid var(--purple)' : '1px solid var(--border)',
                      color: uploadNotesMode === mode ? 'var(--purple)' : 'var(--text-muted)',
                    }}
                  >
                    {mode === 'ai' ? '✦ Auto-generate' : '✎ Write manually'}
                  </button>
                ))}
              </div>
              {uploadNotesMode === 'manual' ? (
                <textarea
                  value={uploadNotes}
                  onChange={e => setUploadNotes(e.target.value)}
                  rows={3}
                  placeholder="Describe this media for the AI (e.g. 'red lingerie set, bedroom, playful mood')..."
                  style={{
                    width: '100%', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', borderRadius: 6,
                    padding: '8px 12px', color: 'var(--text-primary)',
                    fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                  AI will analyze the media and generate a description automatically after upload.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={async () => {
                  if (!uploadFile || !selectedCreatorId || uploadingVault) return
                  const album = uploadAlbum === '__new__'
                    ? newAlbumName.trim() || 'Uncategorized'
                    : uploadAlbum || 'Uncategorized'
                  setUploadingVault(true)
                  try {
                    const formData = new FormData()
                    formData.append('file', uploadFile)
                    formData.append('album_title', album)
                    if (uploadNotesMode === 'manual' && uploadNotes.trim()) {
                      formData.append('ai_description', uploadNotes.trim())
                    }
                    const res = await fetch(
                      `${process.env.NEXT_PUBLIC_API_URL}/upload-vault-media/${selectedCreatorId}`,
                      { method: 'POST', body: formData }
                    )
                    const data = await res.json()
                    if (data.status === 'ok' && data.item) {
                      const item = data.item
                      const albumKey = item.album_title || 'Uncategorized'
                      setVaultAlbums(prev => ({
                        ...prev,
                        [albumKey]: [...(prev[albumKey] || []), item],
                      }))
                      setShowUploadModal(false)
                      setUploadFile(null)
                      setUploadPreview(null)
                      setUploadNotes('')
                      setUploadAlbum('')
                      setNewAlbumName('')
                    }
                  } finally {
                    setUploadingVault(false)
                  }
                }}
                disabled={!uploadFile || uploadingVault}
                style={{
                  flex: 1, padding: '8px', background: 'var(--purple)',
                  border: 'none', borderRadius: 6, color: 'white',
                  fontSize: 13, cursor: !uploadFile || uploadingVault ? 'not-allowed' : 'pointer',
                  opacity: !uploadFile || uploadingVault ? 0.6 : 1,
                }}
              >
                {uploadingVault ? 'Uploading...' : 'Upload'}
              </button>
              <button
                type="button"
                onClick={() => { setShowUploadModal(false); setUploadFile(null); setUploadPreview(null); setUploadNotes(''); setUploadAlbum(''); setNewAlbumName('') }}
                disabled={uploadingVault}
                style={{
                  padding: '8px 16px', background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 2000,
          background: toast.type === 'error' ? 'rgba(255,80,80,0.15)' : 'rgba(76,175,130,0.15)',
          border: `1px solid ${toast.type === 'error' ? 'rgba(255,80,80,0.4)' : 'rgba(76,175,130,0.4)'}`,
          color: toast.type === 'error' ? '#ff6b6b' : 'var(--green)',
        }}>
          {toast.message}
        </div>
      )}
    </div>
  )
}