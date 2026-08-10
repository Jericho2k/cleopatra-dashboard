'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/api'
import ConfirmDialog from '../../components/ConfirmDialog'

const VAULT_CATEGORY_RANGES: Record<string, { min: number; max: number }> = {
  teaser_clothed: { min: 0, max: 0 },
  teaser_bundle: { min: 0, max: 0 },
  legs_feet: { min: 15, max: 70 },
  lingerie_photo: { min: 10, max: 80 },
  lingerie_video: { min: 15, max: 90 },
  nude_photo: { min: 15, max: 80 },
  nude_video: { min: 20, max: 110 },
  striptease_video: { min: 15, max: 100 },
  closeup_photo: { min: 25, max: 130 },
  closeup_video: { min: 25, max: 130 },
  dictate_video: { min: 15, max: 50 },
  solo_toy_photo: { min: 20, max: 80 },
  solo_toy_video: { min: 30, max: 150 },
  explicit_photo: { min: 25, max: 130 },
  explicit_video: { min: 35, max: 170 },
  bg_content: { min: 50, max: 300 },
  task: { min: 10, max: 50 },
  other: { min: 0, max: 0 },
}

function normalizedCategoryPrices(category: string, minValue: string, maxValue: string) {
  const range = VAULT_CATEGORY_RANGES[category]
  if (!range) {
    return {
      min: Math.max(Number(minValue) || 0, 0),
      max: Math.max(Number(maxValue) || 0, 0),
      adjusted: false,
    }
  }
  const requestedMin = Number(minValue)
  const requestedMax = Number(maxValue)
  const min = Math.min(
    Math.max(Number.isFinite(requestedMin) ? requestedMin : range.min, range.min),
    range.max,
  )
  const max = Math.min(
    Math.max(Number.isFinite(requestedMax) ? requestedMax : range.max, min),
    range.max,
  )
  return {
    min,
    max,
    adjusted: min !== requestedMin || max !== requestedMax,
  }
}

type VaultCategorizationOverview = {
  initial_completed_at: string | null
  auto_categorize_new_media: boolean
  last_vault_sync_at: string | null
  vault_sync_interval_hours: number
  active_sync: {
    status: string
    synced: number
    total: number
    album: string
  }
  uncategorized: number
  stale_classifications: number
  stale_approved_classifications: number
  video_frame_upgrades: number
  classifier_version: number
  manual_reanalysis: {
    used: number
    remaining: number
    daily_limit: number
    allowed: boolean
  }
  active_run: {
    status: string
    mode?: string
    done: number
    total: number
    errors?: number
    elapsed_seconds?: number
    estimated_seconds_remaining?: number | null
    items_per_minute?: number
  }
}

type PendingUpgrade = {
  count: number
  scope: 'approved' | 'videos' | 'all'
  title: string
  description: string
}

function shortDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined || seconds < 1) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.ceil(seconds % 60)
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

const VAULT_TOOL_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

function lastSyncLabel(value?: string | null) {
  if (!value) return 'First automatic sync is pending'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Previously synchronized'
  return `Last updated ${parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export default function VaultPage() {
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([])
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null)

  const [vaultAlbums, setVaultAlbums] = useState<Record<string, any[]>>({})
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null)
  const [vaultVisibleLimit, setVaultVisibleLimit] = useState(200)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [previewEdits, setPreviewEdits] = useState<{ content_category: string; ai_description: string; price_min: string; price_max: string; scene_location: string; scene_outfit: string; scene_lighting: string; scene_id: string } | null>(null)
  const [previewSaving, setPreviewSaving] = useState(false)
  const [syncingVault, setSyncingVault] = useState(false)
  const [vaultProgress, setVaultProgress] = useState<{ synced: number; total: number; album: string } | null>(null)
  const [uploadingVault, setUploadingVault] = useState(false)
  const [categorizingVault, setCategorizingVault] = useState(false)
  const [categorizeProgress, setCategorizeProgress] = useState<{
    done: number
    total: number
    status: string
    elapsed_seconds?: number
    estimated_seconds_remaining?: number | null
    items_per_minute?: number
  } | null>(null)
  const [categorizationOverview, setCategorizationOverview] = useState<VaultCategorizationOverview | null>(null)
  const [pendingUpgrade, setPendingUpgrade] = useState<PendingUpgrade | null>(null)
  const [uploadAlbum, setUploadAlbum] = useState('')
  const [newAlbumName, setNewAlbumName] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploadNotesMode, setUploadNotesMode] = useState<'manual' | 'ai'>('ai')
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const categorizeIntervalRef = useRef<number | null>(null)
  const syncIntervalRef = useRef<number | null>(null)
  const categorizePollInFlight = useRef(false)
  const syncPollInFlight = useRef(false)
  const vaultRealtimeRefreshRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (categorizeIntervalRef.current !== null) {
      window.clearInterval(categorizeIntervalRef.current)
    }
    if (syncIntervalRef.current !== null) {
      window.clearInterval(syncIntervalRef.current)
    }
    if (vaultRealtimeRefreshRef.current !== null) {
      window.clearTimeout(vaultRealtimeRefreshRef.current)
    }
  }, [])

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

  const loadVaultMedia = useCallback(async (creatorId: string) => {
    const allRows: any[] = []
    const pageSize = 1000
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('creator_vault_media')
        .select('id, filename, url, album_title, mimetype, ai_description, thumbnail_url, media_type, title, price, is_active, content_category, price_min, price_max, scene_id, scene_location, scene_outfit, scene_lighting, explicitness_level, good_for, tags, classification_version, classification_model, classification_source, classification_confidence, classified_at')
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
  }, [])

  const loadCategorizationOverview = useCallback(async (creatorId: string) => {
    try {
      const response = await apiFetch(`/creator/${creatorId}/vault-categorization-overview`)
      if (!response.ok) return
      setCategorizationOverview(await response.json())
    } catch {
      setCategorizationOverview(null)
    }
  }, [])

  useEffect(() => {
    if (!selectedCreatorId) return
    setSelectedAlbum(null)
    void Promise.all([
      loadVaultMedia(selectedCreatorId),
      loadCategorizationOverview(selectedCreatorId),
    ])
  }, [loadCategorizationOverview, loadVaultMedia, selectedCreatorId])

  useEffect(() => {
    if (!selectedCreatorId) return
    const creatorId = selectedCreatorId
    const refreshVaultSoon = () => {
      if (vaultRealtimeRefreshRef.current !== null) {
        window.clearTimeout(vaultRealtimeRefreshRef.current)
      }
      vaultRealtimeRefreshRef.current = window.setTimeout(() => {
        void loadVaultMedia(creatorId)
      }, 750)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      void Promise.all([
        loadVaultMedia(creatorId),
        loadCategorizationOverview(creatorId),
      ])
    }
    const channel = supabase
      .channel(`vault-media-${creatorId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'creator_vault_media',
        filter: `creator_id=eq.${creatorId}`,
      }, refreshVaultSoon)
      .subscribe()

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      if (vaultRealtimeRefreshRef.current !== null) {
        window.clearTimeout(vaultRealtimeRefreshRef.current)
        vaultRealtimeRefreshRef.current = null
      }
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [loadCategorizationOverview, loadVaultMedia, selectedCreatorId])

  const startCategorization = async (
    mode: 'initial' | 'new' | 'upgrade',
    confirmUpgrade = false,
    upgradeScope: 'approved' | 'videos' | 'all' = 'all',
  ) => {
    if (!selectedCreatorId || categorizingVault) return
    setCategorizingVault(true)
    setCategorizeProgress({ done: 0, total: 0, status: 'starting' })
    try {
      const params = new URLSearchParams({ mode })
      if (mode === 'upgrade') params.set('upgrade_scope', upgradeScope)
      if (confirmUpgrade) params.set('confirm_upgrade', 'true')
      const startRes = await apiFetch(
        `/categorize-vault/${selectedCreatorId}?${params.toString()}`,
        { method: 'POST' },
      )
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) {
        showToast(startData.detail || 'Could not start vault categorization.', 'error')
        setCategorizingVault(false)
        return
      }
      if (startData.status === 'nothing_to_categorize') {
        setCategorizingVault(false)
        showToast('There is nothing in this category queue to process.')
        await loadCategorizationOverview(selectedCreatorId)
        return
      }
      if (startData.status === 'initial_already_completed') {
        setCategorizingVault(false)
        await loadCategorizationOverview(selectedCreatorId)
        showToast('Existing-media categorization is already complete.', 'error')
        return
      }

      if (categorizeIntervalRef.current !== null) {
        window.clearInterval(categorizeIntervalRef.current)
      }
      categorizeIntervalRef.current = window.setInterval(async () => {
        if (categorizePollInFlight.current) return
        categorizePollInFlight.current = true
        try {
          const response = await apiFetch(`/categorize-vault-status/${selectedCreatorId}`)
          const state = await response.json()
          setCategorizeProgress(state)
          if (state.status === 'done' || state.status === 'error') {
            if (categorizeIntervalRef.current !== null) {
              window.clearInterval(categorizeIntervalRef.current)
              categorizeIntervalRef.current = null
            }
            setCategorizingVault(false)
            await Promise.all([
              loadVaultMedia(selectedCreatorId),
              loadCategorizationOverview(selectedCreatorId),
            ])
            window.setTimeout(() => setCategorizeProgress(null), 2000)
            if (state.status === 'done') {
              showToast(
                state.errors
                  ? `Updated ${state.done}; ${state.errors} item(s) remain stale and can be retried.`
                  : `Updated ${state.done} item(s).`,
              )
            } else {
              showToast(state.error || 'Vault categorization stopped with an error.', 'error')
            }
          }
        } finally {
          categorizePollInFlight.current = false
        }
      }, 2000)
    } catch {
      setCategorizingVault(false)
      showToast('Could not reach the vault categorization service.', 'error')
    }
  }

  const startVaultSync = async () => {
    if (!selectedCreatorId || syncingVault) return
    setSyncingVault(true)
    setVaultProgress({ synced: 0, total: 0, album: 'Starting...' })
    const creatorId = selectedCreatorId
    try {
      // The 24-hour cooldown protects the automatic scheduler. An operator who
      // just uploaded media on Fansly must still be able to import it now.
      const startRes = await apiFetch(`/sync-vault-start/${creatorId}?force=true`, {
        method: 'POST',
      })
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) {
        showToast(startData.detail || 'Could not start vault synchronization.', 'error')
        setSyncingVault(false)
        setVaultProgress(null)
        return
      }
      if (startData.status === 'cooldown') {
        setSyncingVault(false)
        setVaultProgress(null)
        const remaining = shortDuration(Number(startData.hours_remaining || 0) * 3600)
        showToast(
          `Vault is current — the next automatic check is available${remaining ? ` in ${remaining}` : ' soon'}.`,
        )
        return
      }
      if (syncIntervalRef.current !== null) {
        window.clearInterval(syncIntervalRef.current)
      }
      syncIntervalRef.current = window.setInterval(async () => {
        if (syncPollInFlight.current) return
        syncPollInFlight.current = true
        try {
          const res = await apiFetch(`/sync-vault-status/${creatorId}`)
          const state = await res.json()
          setVaultProgress({
            synced: state.synced,
            total: state.total,
            album: state.album,
          })
          if (state.status === 'done' || state.status === 'error') {
            if (syncIntervalRef.current !== null) {
              window.clearInterval(syncIntervalRef.current)
              syncIntervalRef.current = null
            }
            await Promise.all([
              loadVaultMedia(creatorId),
              loadCategorizationOverview(creatorId),
            ])
            setSyncingVault(false)
            window.setTimeout(() => setVaultProgress(null), 1500)
            if (state.status === 'done') {
              const categorized = Number(state.categorized_new ?? 0)
              showToast(
                state.synced > 0
                  ? `Imported ${state.synced} new item(s)${categorized ? ` and categorized ${categorized}` : ''}.`
                  : 'Vault is already synchronized.',
              )
            } else {
              showToast(state.album || 'Vault synchronization failed.', 'error')
            }
          }
        } catch {
          if (syncIntervalRef.current !== null) {
            window.clearInterval(syncIntervalRef.current)
            syncIntervalRef.current = null
          }
          setSyncingVault(false)
          setVaultProgress(null)
          showToast('Could not read vault synchronization progress.', 'error')
        } finally {
          syncPollInFlight.current = false
        }
      }, 1000)
    } catch {
      setSyncingVault(false)
      setVaultProgress(null)
      showToast('Could not reach the vault synchronization service.', 'error')
    }
  }

  const selectedVaultItems = selectedAlbum === '__all__'
    ? Object.values(vaultAlbums).flat()
    : selectedAlbum
      ? vaultAlbums[selectedAlbum] || []
      : []

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
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 20,
                padding: '12px 14px', border: '1px solid var(--border)',
                borderRadius: 8, background: 'var(--bg-elevated)',
              }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                    {syncingVault ? 'Updating vault…' : 'Automatic vault updates are on'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>
                    {syncingVault
                      ? `${vaultProgress?.synced ?? 0}${vaultProgress?.total ? `/${vaultProgress.total}` : ''} new items checked${vaultProgress?.album ? ` · ${vaultProgress.album}` : ''}`
                      : `${lastSyncLabel(categorizationOverview?.last_vault_sync_at)} · automatic daily refresh · manual check anytime`}
                  </div>
                </div>
                <button
                  onClick={() => setShowUploadModal(true)}
                  disabled={!selectedCreatorId}
                  style={{
                    padding: '7px 13px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 12,
                    opacity: !selectedCreatorId ? 0.5 : 1,
                  }}
                >
                  + Add media
                </button>
                <details style={{ position: 'relative' }}>
                  <summary
                    style={{
                      padding: '7px 13px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)', color: 'var(--text-muted)',
                      fontSize: 12, listStyle: 'none', userSelect: 'none',
                    }}
                  >
                    Vault tools ···
                  </summary>
                  <div
                    style={{
                      position: 'absolute', zIndex: 30, right: 0, top: 'calc(100% + 6px)',
                      width: 270, padding: 6, borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                      boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
                    }}
                  >
                    <button
                      onClick={event => {
                        event.currentTarget.closest('details')?.removeAttribute('open')
                        void startVaultSync()
                      }}
                      disabled={!selectedCreatorId || syncingVault}
                      style={{
                        ...VAULT_TOOL_STYLE,
                        opacity: !selectedCreatorId || syncingVault ? 0.5 : 1,
                      }}
                    >
                      {syncingVault ? 'Sync in progress…' : 'Check Fansly for new media now'}
                    </button>
                    <button
                      onClick={event => {
                        event.currentTarget.closest('details')?.removeAttribute('open')
                        void startCategorization(
                          categorizationOverview?.initial_completed_at ? 'new' : 'initial',
                        )
                      }}
                      disabled={!selectedCreatorId || categorizingVault || Boolean(categorizationOverview?.initial_completed_at && !categorizationOverview.uncategorized)}
                      style={{
                        ...VAULT_TOOL_STYLE,
                        opacity: !selectedCreatorId || categorizingVault || Boolean(categorizationOverview?.initial_completed_at && !categorizationOverview.uncategorized) ? 0.5 : 1,
                      }}
                    >
                      {categorizingVault
                        ? `Categorizing ${categorizeProgress?.done ?? 0}/${categorizeProgress?.total ?? '?'}${
                          categorizeProgress?.estimated_seconds_remaining
                            ? ` · ${shortDuration(categorizeProgress.estimated_seconds_remaining)} left`
                            : ''
                        }`
                        : categorizationOverview?.initial_completed_at
                          ? `Categorize new media (${categorizationOverview.uncategorized})`
                          : `Categorize existing media (${categorizationOverview?.uncategorized ?? 0})`}
                    </button>
                    {Boolean(categorizationOverview?.video_frame_upgrades) && (
                      <button
                        onClick={event => {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                          const count = categorizationOverview?.video_frame_upgrades ?? 0
                          setPendingUpgrade({
                            count,
                            scope: 'videos',
                            title: `Analyze ${count} video${count === 1 ? '' : 's'} from real frames?`,
                            description: 'Cleopatra will sample four moments across each clip and classify the sequence as video—not from a poster image. Videos that cannot provide readable frames stay queued for a safe retry.',
                          })
                        }}
                        disabled={!selectedCreatorId || categorizingVault}
                        style={{ ...VAULT_TOOL_STYLE, color: 'var(--green)' }}
                      >
                        Analyze video frames ({categorizationOverview?.video_frame_upgrades})
                      </button>
                    )}
                    {Boolean(categorizationOverview?.stale_approved_classifications) && (
                      <button
                        onClick={event => {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                          const count = categorizationOverview?.stale_approved_classifications ?? 0
                          setPendingUpgrade({
                            count,
                            scope: 'approved',
                            title: `Re-analyze ${count} approved-set item${count === 1 ? '' : 's'}?`,
                            description: `This paid analysis updates only old or failed metadata to classifier v${categorizationOverview?.classifier_version}. Current-version media will not run again.`,
                          })
                        }}
                        disabled={!selectedCreatorId || categorizingVault}
                        style={{ ...VAULT_TOOL_STYLE, color: 'var(--purple)' }}
                      >
                        Re-analyze approved-set media ({categorizationOverview?.stale_approved_classifications})
                      </button>
                    )}
                    {Boolean(categorizationOverview?.stale_classifications) && (
                      <button
                        onClick={event => {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                          const count = categorizationOverview?.stale_classifications ?? 0
                          setPendingUpgrade({
                            count,
                            scope: 'all',
                            title: `Re-analyze ${count} remaining item${count === 1 ? '' : 's'}?`,
                            description: `This paid analysis processes only media with old or failed metadata. Anything already on classifier v${categorizationOverview?.classifier_version} is automatically excluded.`,
                          })
                        }}
                        disabled={!selectedCreatorId || categorizingVault}
                        style={VAULT_TOOL_STYLE}
                      >
                        Re-analyze remaining metadata ({categorizationOverview?.stale_classifications})
                      </button>
                    )}
                  </div>
                </details>
              </div>

              {categorizationOverview && (
                <div style={{
                  marginBottom: 20, padding: '12px 14px', border: '1px solid var(--border)',
                  borderRadius: 8, background: 'var(--bg-elevated)', fontSize: 12,
                }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 5 }}>
                    AI categorization is optional
                  </div>
                  <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    It is required only for automatic set building and semantic media matching. The full vault can be
                    processed once; later syncs process only newly imported media and never rerun the completed vault.
                    Older or failed classifications are shown separately and require confirmation; current-version
                    media is never charged twice.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={categorizationOverview.auto_categorize_new_media}
                      onChange={async event => {
                        if (!selectedCreatorId) return
                        const enabled = event.target.checked
                        setCategorizationOverview(current => current ? { ...current, auto_categorize_new_media: enabled } : current)
                        const response = await apiFetch(`/creator/${selectedCreatorId}/vault-categorization-settings`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ auto_categorize_new_media: enabled }),
                        })
                        if (!response.ok) {
                          setCategorizationOverview(current => current ? { ...current, auto_categorize_new_media: !enabled } : current)
                          showToast('Could not update the new-media categorization setting.', 'error')
                        }
                      }}
                    />
                    Automatically categorize media imported by future syncs and uploads
                  </label>
                  <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                    Existing-media categorization: {categorizationOverview.initial_completed_at ? 'completed' : 'not run'} ·
                    {' '}{categorizationOverview.uncategorized} uncategorized ·
                    {' '}{categorizationOverview.stale_classifications} on old or failed metadata ·
                    {' '}{categorizationOverview.stale_approved_classifications} approved-set items on legacy metadata ·
                    {' '}{categorizationOverview.manual_reanalysis.remaining}/{categorizationOverview.manual_reanalysis.daily_limit} manual AI re-analyses remaining today
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Vault</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {Object.values(vaultAlbums).flat().length} media items across {Object.keys(vaultAlbums).length} albums
                </div>
              </div>

              {!selectedAlbum && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div
                    onClick={() => { setSelectedAlbum('__all__'); setVaultVisibleLimit(200) }}
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
                      onClick={() => { setSelectedAlbum(albumTitle); setVaultVisibleLimit(200) }}
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
                    {selectedVaultItems.slice(0, vaultVisibleLimit).map((item: any) => (
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
                          <img src={item.url} alt="" loading="lazy" style={{
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
                  {selectedVaultItems.length > vaultVisibleLimit && (
                    <button
                      type="button"
                      onClick={() => setVaultVisibleLimit(limit => limit + 200)}
                      style={{
                        marginTop: 16, padding: '7px 12px', borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                      }}
                    >
                      Show 200 more ({selectedVaultItems.length - vaultVisibleLimit} remaining)
                    </button>
                  )}
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
                          onChange={e => setPreviewEdits(p => {
                            if (!p) return p
                            const category = e.target.value
                            const range = VAULT_CATEGORY_RANGES[category]
                            return {
                              ...p,
                              content_category: category,
                              price_min: range ? String(range.min) : p.price_min,
                              price_max: range ? String(range.max) : p.price_max,
                            }
                          })}
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
                          <option value="nude_video">Nude video ($20-110)</option>
                          <option value="striptease_video">Striptease video ($15-100)</option>
                          <option value="closeup_photo">Closeup photo ($25-130)</option>
                          <option value="closeup_video">Closeup video ($25-130)</option>
                          <option value="dictate_video">Dictate / dirty talk video ($15-50)</option>
                          <option value="solo_toy_photo">Solo / toy photo ($20-80)</option>
                          <option value="solo_toy_video">Solo / toy / orgasm video ($30-150)</option>
                          <option value="explicit_photo">Explicit solo photo ($25-130)</option>
                          <option value="explicit_video">Explicit solo video ($35-170)</option>
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
                            min={VAULT_CATEGORY_RANGES[previewEdits.content_category]?.min ?? 0}
                            max={VAULT_CATEGORY_RANGES[previewEdits.content_category]?.max}
                            value={previewEdits.price_min}
                            onChange={e => setPreviewEdits(p => p ? { ...p, price_min: e.target.value } : p)}
                            style={{ flex: 1, minWidth: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            type="number"
                            placeholder="Max"
                            min={VAULT_CATEGORY_RANGES[previewEdits.content_category]?.min ?? 0}
                            max={VAULT_CATEGORY_RANGES[previewEdits.content_category]?.max}
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

                      <div style={{ marginBottom: 14, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>CLASSIFICATION QUALITY</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Version {previewItem.classification_version ?? 0}
                          {' · '}{previewItem.classification_source || 'legacy/unknown source'}
                          {typeof previewItem.classification_confidence === 'number'
                            ? ` · ${Math.round(previewItem.classification_confidence * 100)}% evidence confidence`
                            : ''}
                        </div>
                        {previewItem.classification_model && (
                          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                            {previewItem.classification_model}
                          </div>
                        )}
                      </div>

                      {/* Re-categorize button */}
                      <button
                        onClick={async () => {
                          if (!previewItem?.id || previewSaving) return
                          setPreviewSaving(true)
                          try {
                            const res = await apiFetch(`/recategorize-item/${previewItem.id}`,
                              { method: 'POST' }
                            )
                            const data = await res.json()
                            if (!res.ok) {
                              showToast(data.detail || 'Could not re-analyze this media.', 'error')
                              return
                            }
                            if (data.status === 'ok' && data.item) {
                              setPreviewItem((prev: any) => ({ ...prev, ...data.item }))
                              setPreviewEdits((prev: any) => prev ? {
                                ...prev,
                                content_category: data.item.content_category || prev.content_category,
                                ai_description: data.item.ai_description || prev.ai_description,
                                price_min: String(data.item.price_min ?? prev.price_min),
                                price_max: String(data.item.price_max ?? prev.price_max),
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
                              if (selectedCreatorId) await loadCategorizationOverview(selectedCreatorId)
                              showToast(
                                `Media re-analyzed. ${data.manual_reanalysis?.remaining ?? 0} AI re-analyses remaining today.`
                              )
                            }
                          } finally {
                            setPreviewSaving(false)
                          }
                        }}
                        disabled={previewSaving || categorizationOverview?.manual_reanalysis.allowed === false}
                        style={{
                          width: '100%', padding: '6px', borderRadius: 6, marginBottom: 8,
                          background: 'rgba(155,143,212,0.1)', border: '1px solid rgba(155,143,212,0.3)',
                          color: 'var(--purple)', fontSize: 12, cursor: previewSaving ? 'not-allowed' : 'pointer',
                          opacity: previewSaving || categorizationOverview?.manual_reanalysis.allowed === false ? 0.6 : 1,
                        }}
                      >
                        {previewSaving
                          ? 'Analyzing...'
                          : `✦ Re-analyze with AI (${categorizationOverview?.manual_reanalysis.remaining ?? 5} left today)`}
                      </button>

                      <button
                        onClick={async () => {
                          if (!previewItem?.id || previewSaving) return
                          setPreviewSaving(true)
                          const prices = normalizedCategoryPrices(
                            previewEdits.content_category,
                            previewEdits.price_min,
                            previewEdits.price_max,
                          )
                          const { error } = await supabase.from('creator_vault_media').update({
                            content_category: previewEdits.content_category,
                            ai_description: previewEdits.ai_description,
                            price_min: prices.min,
                            price_max: prices.max,
                            scene_location: previewEdits.scene_location,
                            scene_outfit: previewEdits.scene_outfit,
                            scene_lighting: previewEdits.scene_lighting,
                            scene_id: previewEdits.scene_id,
                            classification_version: categorizationOverview?.classifier_version ?? 2,
                            classification_source: 'manual',
                            classification_confidence: 1,
                            classified_at: new Date().toISOString(),
                          }).eq('id', previewItem.id)
                          if (error) {
                            setPreviewSaving(false)
                            showToast('Could not save the media details.', 'error')
                            return
                          }
                          // Update local state
                          setVaultAlbums(prev => {
                            const next: Record<string, any[]> = {}
                            Object.entries(prev).forEach(([album, items]) => {
                              next[album] = items.map(m => m.id === previewItem.id
                                ? { ...m, ...previewEdits, price_min: prices.min, price_max: prices.max }
                                : m
                              )
                            })
                            return next
                          })
                          setPreviewItem((prev: any) => ({
                            ...prev,
                            ...previewEdits,
                            price_min: prices.min,
                            price_max: prices.max,
                          }))
                          setPreviewSaving(false)
                          setPreviewItem(null)
                          setPreviewEdits(null)
                          if (prices.adjusted) {
                            showToast(
                              'Price range was adjusted to match the selected category.',
                            )
                          }
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
                    const res = await apiFetch(`/upload-vault-media/${selectedCreatorId}`,
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
      <ConfirmDialog
        open={Boolean(pendingUpgrade)}
        title={pendingUpgrade?.title ?? ''}
        description={pendingUpgrade?.description ?? ''}
        confirmLabel={`Analyze ${pendingUpgrade?.count ?? 0} item${pendingUpgrade?.count === 1 ? '' : 's'}`}
        onCancel={() => setPendingUpgrade(null)}
        onConfirm={() => {
          const request = pendingUpgrade
          setPendingUpgrade(null)
          if (request) void startCategorization('upgrade', true, request.scope)
        }}
      />
    </div>
  )
}
