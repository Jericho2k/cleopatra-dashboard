'use client'

import React, { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/api'

type Section = 'Creator Persona' | 'Voice Calibration' | 'Blocked Words' | 'Auto Audience' | 'Sleep Hours' | 'Limits'

const SECTIONS: Section[] = ['Creator Persona', 'Voice Calibration', 'Blocked Words', 'Auto Audience', 'Sleep Hours', 'Limits']
type AutoAudiencePolicy = {
  scope: 'all' | 'new_only' | 'matching'
  match_mode: 'any' | 'all'
  include_list_ids: string[]
  exclude_list_ids: string[]
  spend_tiers: string[]
  include_new_fans: boolean
  min_total_spend: number | null
  max_total_spend: number | null
}

type AutoAudiencePreview = {
  eligible: number
  ineligible: number
  total: number
  creator_auto_mode: boolean
  reasons: Record<string, number>
  eligible_if_creator_on?: number
  ineligible_if_creator_on?: number
  reasons_if_creator_on?: Record<string, number>
}

type VoiceCalibrationCandidate = {
  id: string
  content: string
  sent_at: string | null
  approved: boolean
}

type VoiceCalibration = {
  enabled: boolean
  approved_message_ids: string[]
  approved_samples: string[]
  candidates: VoiceCalibrationCandidate[]
}

const DEFAULT_VOICE_CALIBRATION: VoiceCalibration = {
  enabled: false,
  approved_message_ids: [],
  approved_samples: [],
  candidates: [],
}

const DEFAULT_AUTO_AUDIENCE: AutoAudiencePolicy = {
  scope: 'all', match_mode: 'any', include_list_ids: [], exclude_list_ids: [],
  spend_tiers: [], include_new_fans: false, min_total_spend: null, max_total_spend: null,
}

function audienceReasonLabel(reason: string): string {
  return ({
    all_fans: 'Included by All chats',
    fan_override_on: 'Per-fan On',
    fan_override_off: 'Per-fan Off',
    creator_auto_off: 'Inheriting creator Off',
    needs_human_review: 'Needs human review',
    excluded_list: 'Excluded list',
    new_fan: 'New chat',
    not_new: 'Not a new chat',
    rules_matched: 'Rules matched',
    rules_not_matched: 'Rules not matched',
    no_matching_rules: 'No matching criteria',
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ')
}
const PROXY_COUNTRIES = [
  { code: 'US', label: '🇺🇸 United States' },
  { code: 'CA', label: '🇨🇦 Canada' },
  { code: 'MX', label: '🇲🇽 Mexico' },
  { code: 'GB', label: '🇬🇧 United Kingdom' },
  { code: 'AT', label: '🇦🇹 Austria' },
  { code: 'BE', label: '🇧🇪 Belgium' },
  { code: 'FR', label: '🇫🇷 France' },
  { code: 'UA', label: '🇺🇦 Ukraine' },
  { code: 'RU', label: '🇷🇺 Russia' },
  { code: 'PL', label: '🇵🇱 Poland' },
  { code: 'BR', label: '🇧🇷 Brazil' },
  { code: 'DK', label: '🇩🇰 Denmark' },
  { code: 'EE', label: '🇪🇪 Estonia' },
  { code: 'FI', label: '🇫🇮 Finland' },
  { code: 'DE', label: '🇩🇪 Germany' },
  { code: 'IE', label: '🇮🇪 Ireland' },
  { code: 'NL', label: '🇳🇱 Netherlands' },
  { code: 'NO', label: '🇳🇴 Norway' },
  { code: 'ES', label: '🇪🇸 Spain' },
  { code: 'SE', label: '🇸🇪 Sweden' },
  { code: 'AU', label: '🇦🇺 Australia' },
]

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>('Creator Persona')
  const [words, setWords] = useState<{ id: string; word: string }[]>([])
  const [newWord, setNewWord] = useState('')
  const [creatorsLoading, setCreatorsLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [creators, setCreators] = useState<any[]>([])
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null)
  const [persona, setPersona] = useState({
    character: '',
    communication_style: '',
    example_phrases: '',
    upsell_style: '',
    hard_limits: '',
    emoji_style: '',
    welcome_message: '',
  })
  const [sleepHours, setSleepHours] = useState({ start: 0, end: 7 })
  const [caps, setCaps] = useState<{ enabled: boolean; maxPpv: string; maxSpend: string; crisisPolicy: string; whaleHandoff: string }>({
    enabled: false, maxPpv: '', maxSpend: '', crisisPolicy: 'continue', whaleHandoff: '',
  })
  const [personaSaving, setPersonaSaving] = useState(false)
  const [personaSaved, setPersonaSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [autoAvailable, setAutoAvailable] = useState<boolean | null>(null)
  const [approvedSetsCount, setApprovedSetsCount] = useState<number>(0)
  const [showAddCreator, setShowAddCreator] = useState(false)
  const [reconnectCreatorId, setReconnectCreatorId] = useState<string | null>(null)
  const [connectStep, setConnectStep] = useState<'credentials' | '2fa' | 'done'>('credentials')
  const [twofaToken, setTwofaToken] = useState('')
  const [twofaCode, setTwofaCode] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [newCreator, setNewCreator] = useState({
    name: '',
    email: '',
    password: '',
    countryCode: 'US',
  })
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [audiencePolicy, setAudiencePolicy] = useState<AutoAudiencePolicy>(DEFAULT_AUTO_AUDIENCE)
  const [audienceLists, setAudienceLists] = useState<{ id: string; name: string }[]>([])
  const [audiencePreview, setAudiencePreview] = useState<AutoAudiencePreview | null>(null)
  const [audienceSaving, setAudienceSaving] = useState(false)
  const [fullAutoSaving, setFullAutoSaving] = useState(false)
  const [voiceCalibration, setVoiceCalibration] = useState<VoiceCalibration>(DEFAULT_VOICE_CALIBRATION)
  const [voiceCalibrationSaving, setVoiceCalibrationSaving] = useState(false)

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  function openAddCreator() {
    setReconnectCreatorId(null)
    setNewCreator({ name: '', email: '', password: '', countryCode: 'US' })
    setConnectStep('credentials')
    setShowAddCreator(true)
  }

  function openReconnectCreator() {
    const creator = creators.find(c => c.id === selectedCreatorId)
    if (!creator) return
    setReconnectCreatorId(creator.id)
    setNewCreator({
      name: creator.platform_username ?? '',
      email: '',
      password: '',
      countryCode: 'US',
    })
    setConnectStep('credentials')
    setShowAddCreator(true)
  }

  async function fetchCreators() {
    setCreatorsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setCreators([])
        setSelectedCreatorId(null)
        return
      }
      const res = await apiFetch('/my-creators')
      const data = await res.json()
      const next = data.creators ?? []
      setCreators(next)
      if (next.length > 0) setSelectedCreatorId(next[0].id)
      else setSelectedCreatorId(null)
    } finally {
      setCreatorsLoading(false)
    }
  }



  useEffect(() => {
    fetchCreators()
  }, [])

  async function connectCreator() {
    setConnecting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await apiFetch(`/connect-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newCreator,
          user_id: user?.id,
          creator_id: reconnectCreatorId,
        }),
      })
      const data = await res.json()

      if (data.requires_2fa) {
        setTwofaToken(data.twofa_token)
        setMaskedEmail(data.masked_email)
        setConnectStep('2fa')
      } else if (data.success) {
        sessionStorage.removeItem('creators')
        showToast(reconnectCreatorId ? 'Fansly connection refreshed' : 'Creator connected successfully')
        window.dispatchEvent(new CustomEvent('creator-added'))
        setCreators(prev => reconnectCreatorId
          ? prev.map(creator => creator.id === reconnectCreatorId ? data.creator : creator)
          : [...prev, data.creator])
        setSelectedCreatorId(data.creator.id)
        setShowAddCreator(false)
        setReconnectCreatorId(null)
        setConnectStep('credentials')
      } else {
        showToast(data.error || 'Could not connect this Fansly account', 'error')
      }
    } finally {
      setConnecting(false)
    }
  }

  async function submit2FA() {
    setConnecting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await apiFetch(`/connect-creator-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twofa_token: twofaToken,
          code: twofaCode,
          name: newCreator.name,
          email: newCreator.email,
          password: newCreator.password,
          countryCode: newCreator.countryCode,
          user_id: user?.id,
          creator_id: reconnectCreatorId,
        }),
      })
      const data = await res.json()
      if (data.success) {
        sessionStorage.removeItem('creators')
        showToast(reconnectCreatorId ? 'Fansly connection refreshed' : 'Creator connected successfully')
        window.dispatchEvent(new CustomEvent('creator-added'))
        const { data: creatorsData } = await supabase
          .from('creators')
          .select('id, platform_username, fansly_account_id, apifansly_account_id')
          .order('created_at')

        if (creatorsData) {
          setCreators(creatorsData)
          setSelectedCreatorId(data.creator.id)
        }
        setShowAddCreator(false)
        setReconnectCreatorId(null)
        setConnectStep('credentials')
        setTwofaCode('')
      } else {
        showToast(data.error || 'Could not verify this Fansly account', 'error')
      }
    } finally {
      setConnecting(false)
    }
  }

  async function deleteCreator(id: string) {
    if (!confirm('Delete this creator and ALL their data? This cannot be undone.')) return

    const res = await apiFetch(`/creators/${id}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      showToast('Failed to delete creator', 'error')
      return
    }

    sessionStorage.removeItem('creators')

    const remaining = creators.filter(c => c.id !== id)
    setCreators(remaining)
    setSelectedCreatorId(remaining[0]?.id ?? null)

    showToast('Creator deleted')

    window.dispatchEvent(new CustomEvent('creator-added'))
  }

  const loadBlockedWords = (creatorId: string) => {
    return supabase
      .from('blocked_words')
      .select('id, word')
      .eq('creator_id', creatorId)
      .order('word')
      .then(({ data }) => {
        if (data) setWords(data)
      })
  }

  const loadPersona = (creatorId: string) => {
    return supabase
      .from('creators')
      .select('persona, sleep_hours_start, sleep_hours_end, caps_enabled, max_ppv_per_fan_per_day, max_spend_per_fan_per_day, crisis_policy, whale_handoff_threshold')
      .eq('id', creatorId)
      .single()
      .then(({ data }) => {
        // Reset to defaults first, then apply creator's persona
        setPersona({
          character: '',
          communication_style: '',
          example_phrases: '',
          upsell_style: '',
          hard_limits: '',
          emoji_style: '',
          welcome_message: '',
          ...(data?.persona ?? {}),
        })
        setSleepHours({
          start: data?.sleep_hours_start ?? 0,
          end: data?.sleep_hours_end ?? 7,
        })
        setCaps({
          enabled: data?.caps_enabled ?? false,
          maxPpv: data?.max_ppv_per_fan_per_day != null ? String(data.max_ppv_per_fan_per_day) : '',
          maxSpend: data?.max_spend_per_fan_per_day != null ? String(data.max_spend_per_fan_per_day) : '',
          crisisPolicy: data?.crisis_policy ?? 'continue',
          whaleHandoff: data?.whale_handoff_threshold != null ? String(data.whale_handoff_threshold) : '',
        })
      })
  }

  const loadAutoAudience = async (creatorId: string) => {
    const [policyResponse, previewResponse, listsResponse] = await Promise.all([
      apiFetch(`/creator/${creatorId}/auto-audience-policy`),
      apiFetch(`/creator/${creatorId}/auto-audience-preview`),
      supabase.from('fan_lists').select('id, name').eq('creator_id', creatorId).order('name'),
    ])
    if (policyResponse.ok) {
      const body = await policyResponse.json()
      setAudiencePolicy({ ...DEFAULT_AUTO_AUDIENCE, ...(body.policy ?? {}) })
    }
    if (previewResponse.ok) setAudiencePreview(await previewResponse.json())
    setAudienceLists(listsResponse.data ?? [])
  }

  const loadVoiceCalibration = async (creatorId: string) => {
    try {
      const response = await apiFetch(`/creator/${creatorId}/voice-calibration`)
      if (!response.ok) throw new Error(await response.text())
      const body = await response.json()
      setVoiceCalibration({
        enabled: Boolean(body.enabled),
        approved_message_ids: body.approved_message_ids ?? [],
        approved_samples: body.approved_samples ?? [],
        candidates: body.candidates ?? [],
      })
    } catch {
      setVoiceCalibration(DEFAULT_VOICE_CALIBRATION)
    }
  }

  const loadScripts = (_creatorId: string) => {
    // Placeholder for scripts/storylines settings loading.
  }

  useEffect(() => {
    if (!selectedCreatorId) return
    const creatorId = selectedCreatorId
    async function loadCreatorContent() {
      setContentLoading(true)
      try {
        await Promise.all([
          loadPersona(creatorId),
          loadBlockedWords(creatorId),
          Promise.resolve(loadScripts(creatorId)),
          loadAutoAudience(creatorId),
          loadVoiceCalibration(creatorId),
        ])
      } finally {
        setContentLoading(false)
      }
    }
    loadCreatorContent()
  }, [selectedCreatorId])

  // Auto-mode availability: gated on at least one approved set existing.
  useEffect(() => {
    if (!selectedCreatorId) { setAutoAvailable(null); return }
    let cancelled = false
    ;(async () => {
      const { count } = await supabase
        .from('vault_sets')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', selectedCreatorId)
        .eq('status', 'approved')
      if (cancelled) return
      const n = count ?? 0
      setApprovedSetsCount(n)
      setAutoAvailable(n > 0)
    })()
    return () => { cancelled = true }
  }, [selectedCreatorId])

  const savePersona = async () => {
    if (!selectedCreatorId) return
    setPersonaSaving(true)
    await supabase.from('creators').update({
      persona,
    }).eq('id', selectedCreatorId)
    setPersonaSaving(false)
    setPersonaSaved(true)
    setTimeout(() => setPersonaSaved(false), 2000)
  }

  const saveAutoAudience = async () => {
    if (!selectedCreatorId) return
    setAudienceSaving(true)
    try {
      const response = await apiFetch(`/creator/${selectedCreatorId}/auto-audience-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audiencePolicy),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not save audience rules')
      await loadAutoAudience(selectedCreatorId)
      showToast('Auto audience rules saved')
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error), 'error')
    } finally {
      setAudienceSaving(false)
    }
  }

  const saveVoiceCalibration = async () => {
    if (!selectedCreatorId) return
    setVoiceCalibrationSaving(true)
    try {
      const response = await apiFetch(`/creator/${selectedCreatorId}/voice-calibration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: voiceCalibration.enabled,
          approved_message_ids: voiceCalibration.approved_message_ids,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not save voice calibration')
      await loadVoiceCalibration(selectedCreatorId)
      showToast(body.enabled ? 'Voice calibration enabled' : 'Voice calibration saved')
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error), 'error')
    } finally {
      setVoiceCalibrationSaving(false)
    }
  }

  const toggleVoiceSample = (messageId: string) => {
    setVoiceCalibration(previous => {
      const selected = previous.approved_message_ids.includes(messageId)
      if (!selected && previous.approved_message_ids.length >= 30) {
        showToast('Voice calibration supports up to 30 approved messages', 'error')
        return previous
      }
      return {
        ...previous,
        approved_message_ids: selected
          ? previous.approved_message_ids.filter(id => id !== messageId)
          : [...previous.approved_message_ids, messageId],
      }
    })
  }

  const setCreatorFullAuto = async (enabled: boolean) => {
    if (!selectedCreatorId || fullAutoSaving) return
    if (enabled && !autoAvailable) {
      showToast('Approve at least one vault set before enabling Full Auto', 'error')
      return
    }
    setFullAutoSaving(true)
    try {
      const { error } = await supabase
        .from('creators')
        .update({ auto_mode: enabled })
        .eq('id', selectedCreatorId)
      if (error) throw error
      setCreators(current => current.map(creator => (
        creator.id === selectedCreatorId ? { ...creator, auto_mode: enabled } : creator
      )))
      await loadAutoAudience(selectedCreatorId)
      showToast(`Creator Full Auto ${enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error), 'error')
    } finally {
      setFullAutoSaving(false)
    }
  }

  const addWord = async () => {
    if (!selectedCreatorId) return
    const w = newWord.trim().toLowerCase()
    if (!w || words.some((x) => x.word === w)) return
    const { data } = await supabase
      .from('blocked_words')
      .insert({ creator_id: selectedCreatorId, word: w })
      .select('id, word')
      .single()
    if (data) {
      setWords((prev) => [...prev, data].sort((a, b) => a.word.localeCompare(b.word)))
      setNewWord('')
    }
  }

  const deleteWord = async (id: string) => {
    await supabase.from('blocked_words').delete().eq('id', id)
    setWords((prev) => prev.filter((w) => w.id !== id))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addWord()
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      background: 'var(--bg-base)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-body)',
      overflow: 'hidden',
    }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '20px 16px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: 'var(--silver)',
          }}>
            SETTINGS
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Workspace preferences
          </div>
        </div>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            Creator
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {creatorsLoading ? (
              <div style={{
                flex: 1,
                padding: '8px 12px', fontSize: 12,
                color: 'var(--text-muted)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}>
                Loading creators...
              </div>
            ) : (
              <select
                value={selectedCreatorId ?? ''}
                onChange={e => setSelectedCreatorId(e.target.value)}
                style={{
                  flex: 1, minWidth: 0, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text-primary)', padding: '6px 10px', fontSize: 13,
                }}
              >
                {creators.map(c => (
                  <option key={c.id} value={c.id}>{c.platform_username}</option>
                ))}
              </select>
            )}
          </div>
          {/* Add / Delete creator */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={openAddCreator} style={{
              flex: 1, padding: '5px', fontSize: 11,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
            }}>+ Add Creator</button>
            <button type="button" onClick={openReconnectCreator} disabled={!selectedCreatorId} style={{
              flex: 1, padding: '5px', fontSize: 11,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-secondary)',
              cursor: selectedCreatorId ? 'pointer' : 'not-allowed',
              opacity: selectedCreatorId ? 1 : 0.5,
            }}>Reconnect Fansly</button>
            <button type="button" onClick={() => selectedCreatorId && deleteCreator(selectedCreatorId)} style={{
              padding: '5px 10px', fontSize: 11,
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
            }}>Delete</button>
          </div>

          {/* Auto-mode availability warning */}
          {selectedCreatorId && autoAvailable === false && (
            <a href="/scripts" style={{
              display: 'block', textDecoration: 'none',
              marginTop: 10, padding: '8px 10px', borderRadius: 6,
              background: 'rgba(255,180,60,0.10)', border: '1px solid rgba(255,180,60,0.35)',
              color: '#e0a83a', fontSize: 11, lineHeight: 1.4, cursor: 'pointer',
            }}>
              ⚠ Auto mode is unavailable — no approved sets. Approve at least one set to enable it →
            </a>
          )}

        </div>

        <ul style={{ listStyle: 'none', padding: '8px', margin: 0, flex: 1 }}>
          {SECTIONS.map(section => (
            <li key={section}>
              <button
                type="button"
                onClick={() => setActiveSection(section)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 10px',
                  marginBottom: 2,
                  background: activeSection === section ? 'var(--bg-hover)' : 'transparent',
                  border: 'none',
                  borderLeft: activeSection === section ? '3px solid var(--silver)' : '3px solid transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: activeSection === section ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: activeSection === section ? 500 : 400,
                }}
              >
                {section}
                {section === 'Voice Calibration' && (
                  <span style={{ marginLeft: 7, padding: '1px 5px', borderRadius: 4, fontSize: 8, letterSpacing: '0.06em', background: 'rgba(155,143,212,0.14)', color: 'var(--purple)' }}>
                    BETA
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
        <div style={{ maxWidth: 600 }}>
          {!selectedCreatorId ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Select a creator to load settings.</div>
          ) : contentLoading ? (
            <div>
              <div style={{ height: 22, width: 180, background: 'var(--bg-elevated)', borderRadius: 6, marginBottom: 12 }} />
              <div style={{ height: 14, width: 320, background: 'var(--bg-elevated)', borderRadius: 6, marginBottom: 24 }} />
              <div style={{ height: 72, width: '100%', background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 12 }} />
              <div style={{ height: 72, width: '100%', background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 12 }} />
              <div style={{ height: 72, width: '100%', background: 'var(--bg-elevated)', borderRadius: 8 }} />
            </div>
          ) : (
            <>

          {/* Creator Persona */}
          {activeSection === 'Creator Persona' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Creator Persona</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Define how this creator communicates. Used by the AI to generate on-brand replies.
                </div>
              </div>

              {([
                { key: 'character', label: 'Character', placeholder: 'Who is this creator in 2-3 sentences' },
                { key: 'communication_style', label: 'Communication Style', placeholder: 'How do they text' },
                { key: 'example_phrases', label: 'Example Phrases', placeholder: '5 things they actually say' },
                { key: 'upsell_style', label: 'Upsell Style', placeholder: 'How do they push paid content' },
                { key: 'hard_limits', label: 'Hard Limits', placeholder: 'What they never say/do' },
                { key: 'emoji_style', label: 'Emoji Style', placeholder: 'How they use emojis' },
              ] as const).map(({ key, label, placeholder }) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                  </div>
                  <textarea
                    value={persona[key]}
                    onChange={e => setPersona(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    rows={2}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)', borderRadius: 6,
                      padding: '8px 12px', color: 'var(--text-primary)',
                      fontSize: 13, outline: 'none', resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Welcome Message
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontStyle: 'italic' }}>
                  Sent automatically to new subscribers. Also helps the AI understand the creator&apos;s opening style.
                </div>
                <textarea
                  value={persona.welcome_message ?? ''}
                  onChange={e => setPersona(prev => ({ ...prev, welcome_message: e.target.value }))}
                  placeholder="Welcome! I'm Lina, tell me your name and where you're from 😉"
                  rows={4}
                  style={{
                    width: '100%', background: 'var(--bg-surface)',
                    border: '1px solid var(--border)', borderRadius: 8,
                    padding: '8px 12px', color: 'var(--text-primary)',
                    fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>

              <button
                type="button"
                onClick={savePersona}
                disabled={personaSaving}
                style={{
                  padding: '8px 20px',
                  background: personaSaved ? 'rgba(76,175,130,0.15)' : 'rgba(200,200,200,0.1)',
                  border: personaSaved ? '1px solid var(--green)' : '1px solid var(--silver)',
                  borderRadius: 6,
                  color: personaSaved ? 'var(--green)' : 'var(--silver)',
                  fontSize: 13, cursor: personaSaving ? 'default' : 'pointer',
                  opacity: personaSaving ? 0.6 : 1,
                }}
              >
                {personaSaved ? '✓ Saved' : personaSaving ? 'Saving...' : 'Save Persona'}
              </button>
            </div>
          )}

          {/* Voice Calibration */}
          {activeSection === 'Voice Calibration' && (
            <div>
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>Voice Calibration</div>
                  <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, letterSpacing: '0.08em', background: 'rgba(155,143,212,0.14)', color: 'var(--purple)' }}>
                    BETA
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Approve real messages written by this creator or an operator. When enabled, Cleopatra uses their combined rhythm, casing, punctuation, question frequency, and emoji habits as style evidence.
                </div>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18,
                padding: '14px 15px', marginBottom: 16, borderRadius: 9,
                border: `1px solid ${voiceCalibration.enabled ? 'rgba(155,143,212,0.5)' : 'var(--border)'}`,
                background: voiceCalibration.enabled ? 'rgba(155,143,212,0.08)' : 'var(--bg-elevated)',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>Influence generated replies</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
                    Turning this off keeps your approvals but removes their influence immediately.
                  </div>
                </div>
                <button type="button" onClick={() => {
                  if (!voiceCalibration.enabled && voiceCalibration.approved_message_ids.length === 0) {
                    showToast('Approve at least one real message first', 'error')
                    return
                  }
                  setVoiceCalibration(previous => ({ ...previous, enabled: !previous.enabled }))
                }} style={{
                  flexShrink: 0, minWidth: 72, padding: '7px 12px', borderRadius: 7, cursor: 'pointer',
                  border: voiceCalibration.enabled ? '1px solid var(--purple)' : '1px solid var(--border)',
                  background: voiceCalibration.enabled ? 'rgba(155,143,212,0.14)' : 'var(--bg-main)',
                  color: voiceCalibration.enabled ? 'var(--purple)' : 'var(--text-secondary)',
                }}>
                  {voiceCalibration.enabled ? 'On' : 'Off'}
                </button>
              </div>

              <div style={{ padding: '11px 13px', marginBottom: 14, borderRadius: 8, border: '1px solid rgba(224,168,58,0.35)', background: 'rgba(224,168,58,0.07)', color: 'var(--text-secondary)', fontSize: 11.5, lineHeight: 1.5 }}>
                Select only messages you know were written by a real creator or operator. Imported history can include unknown authorship; nothing is used until you approve it. Fan facts, prices, and topics inside a sample are never treated as current-conversation facts.
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent eligible messages</div>
                <div style={{ fontSize: 11, color: voiceCalibration.approved_message_ids.length >= 3 ? 'var(--green)' : 'var(--text-muted)' }}>
                  {voiceCalibration.approved_message_ids.length}/30 approved
                  {voiceCalibration.approved_message_ids.length < 3 ? ' · 3+ recommended' : ''}
                </div>
              </div>

              {voiceCalibration.candidates.length === 0 ? (
                <div style={{ padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
                  No eligible creator messages are available yet. Sync conversation history or send operator-written messages first.
                </div>
              ) : (
                <div style={{ maxHeight: 430, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-elevated)' }}>
                  {voiceCalibration.candidates.slice(0, 80).map((candidate, index) => {
                    const checked = voiceCalibration.approved_message_ids.includes(candidate.id)
                    return (
                      <label key={candidate.id} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', cursor: 'pointer',
                        borderBottom: index === Math.min(voiceCalibration.candidates.length, 80) - 1 ? 'none' : '1px solid var(--border-subtle)',
                        background: checked ? 'rgba(155,143,212,0.08)' : 'transparent',
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleVoiceSample(candidate.id)} style={{ marginTop: 3 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{candidate.content}</div>
                          {candidate.sent_at && (
                            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>{new Date(candidate.sent_at).toLocaleString()}</div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}

              <button type="button" onClick={() => void saveVoiceCalibration()} disabled={voiceCalibrationSaving} style={{
                marginTop: 16, padding: '8px 20px', borderRadius: 6,
                background: voiceCalibrationSaving ? 'var(--bg-elevated)' : 'rgba(155,143,212,0.12)',
                border: '1px solid var(--purple)', color: 'var(--purple)',
                fontSize: 13, cursor: voiceCalibrationSaving ? 'wait' : 'pointer',
                opacity: voiceCalibrationSaving ? 0.6 : 1,
              }}>
                {voiceCalibrationSaving ? 'Saving…' : 'Save voice calibration'}
              </button>
            </div>
          )}

          {/* Blocked Words */}
          {activeSection === 'Blocked Words' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Blocked Words</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Messages containing these words will be flagged before sending.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Add a word..."
                  style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={addWord}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(200,200,200,0.1)',
                    border: '1px solid var(--silver)',
                    borderRadius: 6,
                    color: 'var(--silver)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Add
                </button>
              </div>

              {words.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No blocked words yet.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {words.map((w) => (
                    <div
                      key={w.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        background: 'rgba(255, 80, 80, 0.1)',
                        border: '1px solid rgba(255, 80, 80, 0.3)',
                        borderRadius: 999,
                        fontSize: 12,
                        color: '#ff6b6b',
                      }}
                    >
                      {w.word}
                      <button
                        type="button"
                        onClick={() => deleteWord(w.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 14,
                          lineHeight: 1,
                          opacity: 0.7,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Auto Audience */}
          {activeSection === 'Auto Audience' && (
            <div>
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Auto audience</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Choose which synced fans Full Auto may handle when they message you. These rules do not start conversations or send a bulk message.
                </div>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18,
                padding: '13px 14px', marginBottom: 18, borderRadius: 9,
                border: `1px solid ${audiencePreview?.creator_auto_mode ? 'rgba(76,175,130,0.45)' : 'var(--border)'}`,
                background: audiencePreview?.creator_auto_mode ? 'rgba(76,175,130,0.07)' : 'var(--bg-elevated)',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>Creator Full Auto</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                    The master switch activates your audience rules. Per-fan Off and human review still block automation; a deliberate per-fan On remains active independently.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void setCreatorFullAuto(!audiencePreview?.creator_auto_mode)}
                  disabled={fullAutoSaving || (autoAvailable === false && !audiencePreview?.creator_auto_mode)}
                  style={{
                    flexShrink: 0, minWidth: 92, padding: '8px 12px', borderRadius: 7,
                    border: audiencePreview?.creator_auto_mode ? '1px solid var(--green)' : '1px solid var(--border)',
                    background: audiencePreview?.creator_auto_mode ? 'rgba(76,175,130,0.13)' : 'var(--bg-main)',
                    color: audiencePreview?.creator_auto_mode ? 'var(--green)' : 'var(--text-secondary)',
                    cursor: fullAutoSaving ? 'wait' : 'pointer',
                    opacity: fullAutoSaving || (autoAvailable === false && !audiencePreview?.creator_auto_mode) ? 0.55 : 1,
                  }}
                >
                  {fullAutoSaving ? 'Saving…' : audiencePreview?.creator_auto_mode ? 'On' : 'Off'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 20 }}>
                {([
                  ['all', 'All chats', 'Every fan unless explicitly excluded'],
                  ['new_only', 'Only new chats', 'Synced fans with no creator reply yet'],
                  ['matching', 'Matching rules', 'Lists, spend, tiers, or new fans'],
                ] as const).map(([scope, title, detail]) => (
                  <button key={scope} type="button" onClick={() => setAudiencePolicy(p => ({ ...p, scope }))}
                    style={{
                      textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer',
                      background: audiencePolicy.scope === scope ? 'rgba(155,143,212,0.12)' : 'var(--bg-elevated)',
                      border: audiencePolicy.scope === scope ? '1px solid var(--purple)' : '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{detail}</div>
                  </button>
                ))}
              </div>

              {audiencePolicy.scope === 'matching' && (
                <div style={{ padding: 14, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-elevated)', marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>A fan must match</span>
                    {(['any', 'all'] as const).map(mode => (
                      <button key={mode} type="button" onClick={() => setAudiencePolicy(p => ({ ...p, match_mode: mode }))}
                        style={{
                          padding: '4px 9px', borderRadius: 5, cursor: 'pointer', textTransform: 'uppercase', fontSize: 10,
                          background: audiencePolicy.match_mode === mode ? 'rgba(155,143,212,0.15)' : 'transparent',
                          border: audiencePolicy.match_mode === mode ? '1px solid var(--purple)' : '1px solid var(--border)',
                          color: audiencePolicy.match_mode === mode ? 'var(--purple)' : 'var(--text-muted)',
                        }}>{mode}</button>
                    ))}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>enabled criteria</span>
                  </div>

                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 16, color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={audiencePolicy.include_new_fans}
                      onChange={event => setAudiencePolicy(p => ({ ...p, include_new_fans: event.target.checked }))} />
                    Include fans with no creator reply yet
                  </label>

                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase' }}>Spend tiers</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                    {['cold', 'casual', 'active', 'whale'].map(tier => {
                      const active = audiencePolicy.spend_tiers.includes(tier)
                      return <button key={tier} type="button" onClick={() => setAudiencePolicy(p => ({
                        ...p, spend_tiers: active ? p.spend_tiers.filter(value => value !== tier) : [...p.spend_tiers, tier],
                      }))} style={{ padding: '5px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 11, background: active ? 'rgba(76,175,130,0.13)' : 'transparent', border: active ? '1px solid var(--green)' : '1px solid var(--border)', color: active ? 'var(--green)' : 'var(--text-muted)' }}>{tier}</button>
                    })}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Minimum total spend ($)
                      <input type="number" min="0" value={audiencePolicy.min_total_spend ?? ''} onChange={event => setAudiencePolicy(p => ({ ...p, min_total_spend: event.target.value === '' ? null : Number(event.target.value) }))}
                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 5, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }} />
                    </label>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Maximum total spend ($)
                      <input type="number" min="0" value={audiencePolicy.max_total_spend ?? ''} onChange={event => setAudiencePolicy(p => ({ ...p, max_total_spend: event.target.value === '' ? null : Number(event.target.value) }))}
                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 5, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)' }} />
                    </label>
                  </div>

                  {audienceLists.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      {([
                        ['include_list_ids', 'Include lists'],
                        ['exclude_list_ids', 'Exclude lists'],
                      ] as const).map(([key, title]) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase' }}>{title}</div>
                          {audienceLists.map(list => (
                            <label key={list.id} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, marginBottom: 6, color: 'var(--text-secondary)' }}>
                              <input type="checkbox" checked={audiencePolicy[key].includes(list.id)} onChange={event => setAudiencePolicy(p => ({
                                ...p,
                                [key]: event.target.checked ? [...p[key], list.id] : p[key].filter(id => id !== list.id),
                              }))} />
                              {list.name}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {audiencePreview && (
                <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', marginBottom: 14, fontSize: 12 }}>
                  {audiencePreview.creator_auto_mode ? (
                    <div style={{ lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>{audiencePreview.eligible}</span> of {audiencePreview.total} synced fans can receive automatic replies now.
                      {' '}{audiencePreview.ineligible} are blocked by an exclusion, per-fan Off, human review, or the selected rules.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ padding: 10, borderRadius: 7, background: 'var(--bg-main)' }}>
                        <div style={{ color: '#e0a83a', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Active now — master switch Off</div>
                        <div><span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{audiencePreview.eligible}</span> fans are explicitly enabled per fan.</div>
                      </div>
                      <div style={{ padding: 10, borderRadius: 7, background: 'var(--bg-main)' }}>
                        <div style={{ color: 'var(--purple)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>If Creator Full Auto is turned On</div>
                        <div><span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{audiencePreview.eligible_if_creator_on ?? audiencePreview.eligible}</span> of {audiencePreview.total} synced fans would be covered.</div>
                      </div>
                    </div>
                  )}
                  <div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 10, lineHeight: 1.45 }}>
                    Counts are fan profiles synchronized into Cleopatra—not messages. Eligibility is checked when that fan sends a message.
                  </div>
                  {Object.entries(
                    audiencePreview.creator_auto_mode
                      ? (audiencePreview.reasons ?? {})
                      : (audiencePreview.reasons_if_creator_on ?? audiencePreview.reasons ?? {})
                  ).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                      {Object.entries(
                        audiencePreview.creator_auto_mode
                          ? (audiencePreview.reasons ?? {})
                          : (audiencePreview.reasons_if_creator_on ?? audiencePreview.reasons ?? {})
                      ).map(([reason, count]) => (
                        <span key={reason} style={{ padding: '3px 7px', borderRadius: 5, background: 'var(--bg-main)', color: 'var(--text-muted)', fontSize: 10.5 }}>
                          {audienceReasonLabel(reason)}: {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button type="button" onClick={() => void saveAutoAudience()} disabled={audienceSaving || !autoAvailable}
                style={{ padding: '8px 20px', borderRadius: 6, cursor: audienceSaving ? 'wait' : 'pointer', background: 'rgba(200,200,200,0.1)', border: '1px solid var(--silver)', color: 'var(--silver)', opacity: !autoAvailable ? 0.5 : 1 }}>
                {audienceSaving ? 'Saving…' : 'Save audience rules'}
              </button>
            </div>
          )}

          {/* Sleep Hours */}
          {activeSection === 'Sleep Hours' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Sleep Hours</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  AI will not auto-reply during these hours. Times are in UTC.
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quiet window</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>From</div>
                    <select
                      value={sleepHours.start}
                      onChange={e => setSleepHours(p => ({ ...p, start: Number(e.target.value) }))}
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13 }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ color: 'var(--text-muted)', paddingTop: 20 }}>→</div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>To</div>
                    <select
                      value={sleepHours.end}
                      onChange={e => setSleepHours(p => ({ ...p, end: Number(e.target.value) }))}
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13 }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {sleepHours.start === sleepHours.end
                    ? '⚡ No sleep hours set — AI replies 24/7'
                    : `🌙 AI will be quiet for ${sleepHours.end - sleepHours.start > 0 ? sleepHours.end - sleepHours.start : 24 + sleepHours.end - sleepHours.start} hours (${String(sleepHours.start).padStart(2, '0')}:00 → ${String(sleepHours.end).padStart(2, '0')}:00 UTC)`
                  }
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!selectedCreatorId) return
                  await supabase.from('creators').update({
                    sleep_hours_start: sleepHours.start,
                    sleep_hours_end: sleepHours.end,
                  }).eq('id', selectedCreatorId)
                  showToast('Sleep hours saved')
                }}
                style={{
                  padding: '8px 20px', background: 'rgba(200,200,200,0.1)',
                  border: '1px solid var(--silver)', borderRadius: 6,
                  color: 'var(--silver)', fontSize: 13, cursor: 'pointer',
                }}
              >
                Save
              </button>
            </div>
          )}

          {/* Limits */}
          {activeSection === 'Limits' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Limits</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Optional autonomy caps for auto mode. Leave a field blank for no limit.
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ fontSize: 13 }}>Enable limits</div>
                <button
                  type="button"
                  onClick={() => setCaps(p => ({ ...p, enabled: !p.enabled }))}
                  style={{
                    padding: '2px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                    background: caps.enabled ? 'rgba(76,175,130,0.15)' : 'transparent',
                    border: caps.enabled ? '1px solid var(--green)' : '1px solid var(--border)',
                    color: caps.enabled ? 'var(--green)' : 'var(--text-muted)',
                  }}
                >
                  {caps.enabled ? 'On' : 'Off'}
                </button>
              </div>

              <div style={{ opacity: caps.enabled ? 1 : 0.5, pointerEvents: caps.enabled ? 'auto' : 'none' }}>
                {([
                  ['maxPpv', 'Max PPV sends per fan / day', 'e.g. 3'],
                  ['maxSpend', 'Max spend per fan / day ($)', 'e.g. 200'],
                ] as const).map(([key, label, ph]) => (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                    <input
                      type="number" min="0" inputMode="numeric"
                      value={caps[key]} placeholder={ph}
                      onChange={e => setCaps(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width: 140, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13 }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8, marginBottom: 24, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sensitive situations</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                  What auto mode does if a fan expresses genuine self-harm or a real threat (not roleplay/kink).
                </div>
                <select
                  value={caps.crisisPolicy}
                  onChange={e => setCaps(p => ({ ...p, crisisPolicy: e.target.value }))}
                  style={{ width: '100%', maxWidth: 420, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', padding: '10px 12px', fontSize: 13 }}
                >
                  <option value="continue">Keep going — AI responds with care, stops selling, no human needed</option>
                  <option value="freeze">Freeze chat — AI stops, flags the conversation for a human to take over</option>
                </select>
              </div>

              <div style={{ marginTop: 8, marginBottom: 24, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Whale handoff</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Hand a fan over to a human once their total spend crosses this amount, so your team closes the big spenders personally. Leave blank to disable.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>$</span>
                  <input
                    type="number" min="0" inputMode="numeric"
                    value={caps.whaleHandoff} placeholder="e.g. 500"
                    onChange={e => setCaps(p => ({ ...p, whaleHandoff: e.target.value }))}
                    style={{ width: 160, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13 }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!selectedCreatorId) return
                  const toIntOrNull = (v: string) => {
                    const n = parseInt(v, 10)
                    return Number.isFinite(n) && n >= 0 ? n : null
                  }
                  await supabase.from('creators').update({
                    caps_enabled: caps.enabled,
                    max_ppv_per_fan_per_day: toIntOrNull(caps.maxPpv),
                    max_spend_per_fan_per_day: toIntOrNull(caps.maxSpend),
                    crisis_policy: caps.crisisPolicy,
                    whale_handoff_threshold: toIntOrNull(caps.whaleHandoff),
                  }).eq('id', selectedCreatorId)
                  showToast('Limits saved')
                }}
                style={{
                  padding: '8px 20px', background: 'rgba(200,200,200,0.1)',
                  border: '1px solid var(--silver)', borderRadius: 6,
                  color: 'var(--silver)', fontSize: 13, cursor: 'pointer',
                }}
              >
                Save
              </button>
            </div>
          )}

            </>
          )}

        </div>
      </div>
      {showAddCreator && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 24, width: 400,
          }}>
            {connectStep === 'credentials' ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                  {reconnectCreatorId ? 'Reconnect Fansly Account' : 'Connect Fansly Account'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  {reconnectCreatorId
                    ? 'Refresh this creator under the current API Fansly key without creating a duplicate.'
                    : 'Enter the creator’s Fansly login credentials.'}
                </div>
                {[
                  { label: 'Creator Name', key: 'name', placeholder: 'Display name', type: 'text' },
                  { label: 'Fansly Email', key: 'email', placeholder: 'email@example.com', type: 'email' },
                  { label: 'Password', key: 'password', placeholder: '••••••••', type: 'password' },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                    {key === 'password' ? (
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={newCreator.password}
                          onChange={e => setNewCreator(prev => ({ ...prev, password: e.target.value }))}
                          placeholder="••••••••"
                          style={{
                            width: '100%', background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)', borderRadius: 6,
                            color: 'var(--text-primary)', padding: '8px 36px 8px 12px',
                            fontSize: 13, boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          style={{
                            position: 'absolute', right: 10, top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none', border: 'none',
                            cursor: 'pointer', color: 'var(--text-muted)',
                            padding: 0, display: 'flex', alignItems: 'center',
                          }}
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    ) : (
                      <input
                        type={type}
                        value={(newCreator as any)[key]}
                        onChange={e => setNewCreator(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        style={{
                          width: '100%', background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)', borderRadius: 6,
                          color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                          boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </div>
                ))}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Proxy Region</div>
                  <select
                    value={newCreator.countryCode}
                    onChange={e => setNewCreator(prev => ({ ...prev, countryCode: e.target.value }))}
                    style={{
                      width: '100%', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  >
                    {PROXY_COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={connectCreator} disabled={connecting} style={{
                    flex: 1, padding: '8px', background: 'var(--purple)',
                    border: 'none', borderRadius: 6, color: 'white',
                    fontSize: 13, cursor: connecting ? 'default' : 'pointer',
                    opacity: connecting ? 0.7 : 1,
                  }}>
                    {connecting ? 'Connecting...' : reconnectCreatorId ? 'Reconnect Account' : 'Connect Account'}
                  </button>
                  <button type="button" onClick={() => {
                    setShowAddCreator(false)
                    setReconnectCreatorId(null)
                  }} style={{
                    padding: '8px 16px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Two-Factor Authentication</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  {maskedEmail
                    ? `Enter the code sent to ${maskedEmail}`
                    : 'Enter the code from your authenticator app (Google Authenticator, etc.)'
                  }
                </div>
                <input
                  value={twofaCode}
                  onChange={e => setTwofaCode(e.target.value)}
                  placeholder="Enter 2FA code"
                  style={{
                    width: '100%', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                    boxSizing: 'border-box', marginBottom: 16,
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={submit2FA} disabled={connecting} style={{
                    flex: 1, padding: '8px', background: 'var(--purple)',
                    border: 'none', borderRadius: 6, color: 'white',
                    fontSize: 13, cursor: connecting ? 'default' : 'pointer',
                  }}>
                    {connecting ? 'Verifying...' : 'Verify'}
                  </button>
                  <button type="button" onClick={() => setConnectStep('credentials')} style={{
                    padding: '8px 16px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
                  }}>Back</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          padding: '12px 20px', borderRadius: 8, zIndex: 999,
          background: toast.type === 'success' ? 'rgba(76,175,130,0.9)' : 'rgba(255,80,80,0.9)',
          color: 'white', fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          transition: 'opacity 0.3s ease',
        }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.message}
        </div>
      )}
    </div>
  )
}
