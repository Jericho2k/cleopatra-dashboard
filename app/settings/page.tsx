'use client'

import React, { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type Section = 'Creator Persona' | 'Blocked Words' | 'PPV Offers' | 'Storylines' | 'Re-engagement' | 'Vault'

const SECTIONS: Section[] = ['Creator Persona', 'Blocked Words', 'PPV Offers', 'Storylines', 'Re-engagement', 'Vault']
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
  const [personaSaving, setPersonaSaving] = useState(false)
  const [personaSaved, setPersonaSaved] = useState(false)
  const [vaultAlbums, setVaultAlbums] = useState<Record<string, any[]>>({})
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [syncingVault, setSyncingVault] = useState(false)
  const [vaultProgress, setVaultProgress] = useState<{ synced: number; total: number; album: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingChats, setSyncingChats] = useState(false)
  const [showAddCreator, setShowAddCreator] = useState(false)
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
  const [fanLists, setFanLists] = useState<{ id: string; name: string }[]>([])
  const [reengagement, setReengagement] = useState({
    enabled: false,
    hours_threshold: 24,
    max_per_week: 2,
    use_ai: true,
    ai_instructions: '',
    templates: [''],
    exclude_list_id: null as string | null,
    excluded_fan_ids: [] as string[],
  })

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchCreators() {
    const cached = sessionStorage.getItem('creators')
    if (cached) {
      const list = JSON.parse(cached)
      setCreators(list)
      if (list.length > 0) setSelectedCreatorId(list[0].id)
      else setSelectedCreatorId(null)
      setCreatorsLoading(false)
      return
    }

    setCreatorsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setCreators([])
        setSelectedCreatorId(null)
        return
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/my-creators?user_id=${user.id}`)
      const data = await res.json()
      const next = data.creators ?? []
      sessionStorage.setItem('creators', JSON.stringify(next))
      setCreators(next)
      if (next.length > 0) setSelectedCreatorId(next[0].id)
      else setSelectedCreatorId(null)
    } finally {
      setCreatorsLoading(false)
    }
  }

  async function syncChats() {
    if (!selectedCreatorId) return
    setSyncingChats(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-chats/${selectedCreatorId}`, { method: 'POST' })
      const data = await res.json()
      showToast(`Synced ${data.synced ?? 0} chats`)
      window.dispatchEvent(new CustomEvent('chats-synced', { detail: { creatorId: selectedCreatorId } }))
    } catch {
      showToast('Failed to sync chats', 'error')
    } finally {
      setSyncingChats(false)
    }
  }

  useEffect(() => {
    fetchCreators()
  }, [])

  async function connectCreator() {
    setConnecting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connect-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newCreator,
          user_id: user?.id,
        }),
      })
      const data = await res.json()

      if (data.requires_2fa) {
        setTwofaToken(data.twofa_token)
        setMaskedEmail(data.masked_email)
        setConnectStep('2fa')
      } else if (data.success) {
        sessionStorage.removeItem('creators')
        showToast('Creator connected successfully')
        window.dispatchEvent(new CustomEvent('creator-added'))
        setCreators(prev => [...prev, data.creator])
        setSelectedCreatorId(data.creator.id)
        setShowAddCreator(false)
        setConnectStep('credentials')
      }
    } finally {
      setConnecting(false)
    }
  }

  async function submit2FA() {
    setConnecting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connect-creator-2fa`, {
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
        }),
      })
      const data = await res.json()
      if (data.success) {
        sessionStorage.removeItem('creators')
        showToast('Creator connected successfully')
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
        setConnectStep('credentials')
        setTwofaCode('')
      }
    } finally {
      setConnecting(false)
    }
  }

  async function deleteCreator(id: string) {
    if (!confirm('Delete this creator and ALL their data? This cannot be undone.')) return

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/creators/${id}`, {
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
      .select('persona')
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
      })
  }

  const loadScripts = (_creatorId: string) => {
    // Placeholder for scripts/storylines settings loading.
  }

  const loadFanLists = async (creatorId: string) => {
    const { data } = await supabase
      .from('fan_lists')
      .select('id, name')
      .eq('creator_id', creatorId)
      .order('name')
    setFanLists(data ?? [])
  }

  const loadReengagement = async (creatorId: string) => {
    const { data } = await supabase
      .from('creators')
      .select('reengagement_settings')
      .eq('id', creatorId)
      .single()
    const s = (data as any)?.reengagement_settings ?? {}
    setReengagement({
      enabled: Boolean(s.enabled),
      hours_threshold: Number(s.hours_threshold ?? 24),
      max_per_week: Number(s.max_per_week ?? 2),
      use_ai: s.use_ai === undefined ? true : Boolean(s.use_ai),
      ai_instructions: (s.ai_instructions as string) ?? '',
      templates: Array.isArray(s.templates)
        ? (s.templates as string[])
        : (s.template ? [s.template as string] : ['']),
      exclude_list_id: (s.exclude_list_id as string | null) ?? null,
      excluded_fan_ids: Array.isArray(s.excluded_fan_ids) ? (s.excluded_fan_ids as string[]) : [],
    })
  }

  const loadVaultMedia = async (creatorId: string) => {
    const { data: vaultData } = await supabase
      .from('creator_vault_media')
      .select('id, filename, url, album_title, mimetype, ai_description, thumbnail_url, media_type, title, price, active')
      .eq('creator_id', creatorId)
      .order('album_title')
    const byAlbum = vaultData?.reduce((acc: Record<string, any[]>, item: any) => {
      const album = item.album_title || 'Uncategorized'
      if (!acc[album]) acc[album] = []
      acc[album].push(item)
      return acc
    }, {} as Record<string, any[]>)
    setVaultAlbums(byAlbum ?? {})
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
          loadFanLists(creatorId),
          loadReengagement(creatorId),
        ])
      } finally {
        setContentLoading(false)
      }
    }
    loadCreatorContent()
  }, [selectedCreatorId])

  useEffect(() => {
    if (!selectedCreatorId) return
    loadVaultMedia(selectedCreatorId)
  }, [selectedCreatorId])

  const updateVaultItem = async (id: string, fields: { title?: string; price?: number; active?: boolean }) => {
    await supabase.from('creator_vault_media').update(fields).eq('id', id)
    setVaultAlbums(prev => {
      const next: Record<string, any[]> = {}
      Object.entries(prev).forEach(([album, items]) => {
        next[album] = items.map(m => (m.id === id ? { ...m, ...fields } : m))
      })
      return next
    })
  }

  const savePersona = async () => {
    if (!selectedCreatorId) return
    setPersonaSaving(true)
    await supabase.from('creators').update({ persona }).eq('id', selectedCreatorId)
    setPersonaSaving(false)
    setPersonaSaved(true)
    setTimeout(() => setPersonaSaved(false), 2000)
  }

  const saveReengagement = async () => {
    if (!selectedCreatorId) return
    await supabase
      .from('creators')
      .update({ reengagement_settings: reengagement })
      .eq('id', selectedCreatorId)
    showToast('Re-engagement settings saved')
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
            <button
              type="button"
              onClick={syncChats}
              disabled={syncingChats || !selectedCreatorId}
              style={{
                padding: '5px 10px', fontSize: 11,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-muted)', cursor: syncingChats || !selectedCreatorId ? 'default' : 'pointer',
                flexShrink: 0, alignSelf: 'stretch',
                opacity: syncingChats ? 0.6 : 1,
              }}
            >
              {syncingChats ? 'Syncing...' : '↻ Sync Chats'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={() => setShowAddCreator(true)} style={{
              flex: 1, padding: '5px', fontSize: 11,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
            }}>+ Add Creator</button>
            <button type="button" onClick={() => selectedCreatorId && deleteCreator(selectedCreatorId)} style={{
              padding: '5px 10px', fontSize: 11,
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
            }}>Delete</button>
          </div>
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
                  Sent automatically to new subscribers. Also helps the AI understand the creator's opening style.
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

          {/* PPV Offers */}
          {activeSection === 'PPV Offers' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>PPV Offers</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Manage pay-per-view offers available to send to fans.
                </div>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                PPV offer management coming soon.
              </div>
            </div>
          )}

          {/* Storylines */}
          {activeSection === 'Storylines' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Storylines</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Manage conversation storylines and message sequences.
                </div>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Storyline management coming soon.
              </div>
            </div>
          )}

          {/* Re-engagement */}
          {activeSection === 'Re-engagement' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Re-engagement</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Automatically re-engage fans who go quiet.
                </div>
              </div>

              {/* Enable toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>Enable re-engagement</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Send automatic messages to inactive fans</div>
                </div>
                <button
                  type="button"
                  onClick={() => setReengagement(prev => ({ ...prev, enabled: !prev.enabled }))}
                  style={{
                    padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                    background: reengagement.enabled ? 'rgba(76,175,130,0.15)' : 'transparent',
                    border: reengagement.enabled ? '1px solid var(--green)' : '1px solid var(--border)',
                    color: reengagement.enabled ? 'var(--green)' : 'var(--text-muted)',
                  }}
                >
                  {reengagement.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {/* Hours threshold */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Re-engage after (hours of silence)
                </div>
                <select
                  value={reengagement.hours_threshold}
                  onChange={e => setReengagement(prev => ({ ...prev, hours_threshold: Number(e.target.value) }))}
                  style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                  }}
                >
                  {[12, 24, 48, 72, 96].map(h => (
                    <option key={h} value={h}>{h} hours</option>
                  ))}
                </select>
              </div>

              {/* Max per week */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Max re-engagements per fan per week
                </div>
                <select
                  value={reengagement.max_per_week}
                  onChange={e => setReengagement(prev => ({ ...prev, max_per_week: Number(e.target.value) }))}
                  style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                  }}
                >
                  {[1, 2, 3, 5].map(n => (
                    <option key={n} value={n}>{n}x per week</option>
                  ))}
                </select>
              </div>

              {/* Exclude fans from re-engagement */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Exclude fans from re-engagement
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Fans in this list will never receive re-engagement messages
                </div>
                <select
                  value={reengagement.exclude_list_id ?? ''}
                  onChange={e => setReengagement(prev => ({ ...prev, exclude_list_id: e.target.value || null }))}
                  style={{
                    width: '100%', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
                  }}
                >
                  <option value=''>No exclusions</option>
                  {fanLists.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {/* AI or template */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Message type
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {['ai', 'template'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setReengagement(prev => ({ ...prev, use_ai: type === 'ai' }))}
                      style={{
                        padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        background: (reengagement.use_ai ? 'ai' : 'template') === type ? 'rgba(155,143,212,0.15)' : 'transparent',
                        border: (reengagement.use_ai ? 'ai' : 'template') === type ? '1px solid var(--purple)' : '1px solid var(--border)',
                        color: (reengagement.use_ai ? 'ai' : 'template') === type ? 'var(--purple)' : 'var(--text-muted)',
                      }}
                    >
                      {type === 'ai' ? 'AI Generated' : 'Fixed Template'}
                    </button>
                  ))}
                </div>

                {reengagement.use_ai ? (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      Instructions for the AI
                    </div>
                    <textarea
                      value={reengagement.ai_instructions ?? ''}
                      onChange={e => setReengagement(prev => ({ ...prev, ai_instructions: e.target.value }))}
                      rows={3}
                      placeholder="e.g. Send a warm curious message referencing something from the previous conversation"
                      style={{
                        width: '100%', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)', borderRadius: 6,
                        padding: '8px 12px', color: 'var(--text-primary)',
                        fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                      }}
                    />
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                      Message templates (sent in sequence)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      First template sent after {reengagement.hours_threshold}h, then each subsequent one after another {reengagement.hours_threshold}h interval. Use {'{name}'} for fan&apos;s name.
                    </div>
                    {(reengagement.templates ?? []).map((t: string, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          minWidth: 20, paddingTop: 10,
                        }}>
                          {i + 1}.
                        </div>
                        <textarea
                          value={t}
                          onChange={e => {
                            const updated = [...(reengagement.templates ?? [])]
                            updated[i] = e.target.value
                            setReengagement(prev => ({ ...prev, templates: updated }))
                          }}
                          rows={2}
                          placeholder={`Template ${i + 1}... use {name} for fan's name`}
                          style={{
                            flex: 1, background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)', borderRadius: 6,
                            padding: '8px 12px', color: 'var(--text-primary)',
                            fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (reengagement.templates ?? []).filter((_: string, j: number) => j !== i)
                            setReengagement(prev => ({ ...prev, templates: updated }))
                          }}
                          style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--text-muted)', cursor: 'pointer',
                            fontSize: 16, padding: '0 4px', alignSelf: 'flex-start', marginTop: 8,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setReengagement(prev => ({
                        ...prev,
                        templates: [...(prev.templates ?? []), ''],
                      }))}
                      style={{
                        padding: '6px 12px', background: 'transparent',
                        border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', marginTop: 4,
                      }}
                    >
                      + Add template
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={saveReengagement}
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

          {/* Vault */}
          {activeSection === 'Vault' && (
            <div>
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
                  padding: '6px 14px', borderRadius: 6, cursor: syncingVault ? 'not-allowed' : 'pointer',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontSize: 12, marginBottom: vaultProgress ? 12 : 20,
                  opacity: syncingVault ? 0.5 : 1,
                }}
              >
                {syncingVault ? 'Syncing...' : '↻ Sync Vault'}
              </button>
              {vaultProgress && (
                <div style={{
                  marginBottom: 20,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {vaultProgress.synced >= vaultProgress.total ? '✓ Sync complete' : vaultProgress.album || 'Starting...'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {vaultProgress.synced} / {vaultProgress.total}
                    </span>
                  </div>
                  <div style={{ height: 3, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      borderRadius: 99,
                      background: 'linear-gradient(90deg, #a78bfa, #818cf8)',
                      width: `${vaultProgress.total > 0 ? Math.round((vaultProgress.synced / vaultProgress.total) * 100) : 0}%`,
                      transition: 'width 0.4s ease',
                    }} />
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
                        onClick={() => setPreviewItem(item)}
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

              {previewItem && (
                <div
                  onClick={() => setPreviewItem(null)}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.85)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
                    {previewItem.mimetype?.startsWith('video') ? (
                      <video src={previewItem.url} controls style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
                    ) : (
                      <img src={previewItem.url} style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 8 }} />
                    )}
                    {previewItem.ai_description && (
                      <div style={{
                        marginTop: 12, padding: '8px 12px',
                        background: 'rgba(0,0,0,0.6)', borderRadius: 6,
                        fontSize: 12, color: 'white',
                      }}>
                        {previewItem.ai_description}
                      </div>
                    )}
                  </div>
                </div>
              )}
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
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Connect Fansly Account</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Enter the creator&apos;s Fansly login credentials
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
                    {connecting ? 'Connecting...' : 'Connect Account'}
                  </button>
                  <button type="button" onClick={() => setShowAddCreator(false)} style={{
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
