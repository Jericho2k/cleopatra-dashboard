'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function SettingsPage() {
  const [words, setWords] = useState<{ id: string; word: string }[]>([])
  const [newWord, setNewWord] = useState('')
  const [loading, setLoading] = useState(true)
  const [creatorId, setCreatorId] = useState<string>('')
  const [persona, setPersona] = useState({
    character: '',
    communication_style: '',
    example_phrases: '',
    upsell_style: '',
    hard_limits: '',
    emoji_style: '',
  })
  const [personaSaving, setPersonaSaving] = useState(false)
  const [personaSaved, setPersonaSaved] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('chatter_creators')
        .select('creator_id')
        .eq('chatter_id', user.id)
        .limit(1)
        .single()
        .then(({ data }) => {
          if (data) setCreatorId((data as any).creator_id as string)
        })
    })
  }, [])

  useEffect(() => {
    if (!creatorId) return
    supabase
      .from('blocked_words')
      .select('id, word')
      .eq('creator_id', creatorId)
      .order('word')
      .then(({ data }) => {
        if (data) setWords(data)
        setLoading(false)
      })
    supabase
      .from('creators')
      .select('persona')
      .eq('id', creatorId)
      .single()
      .then(({ data }) => {
        if (data?.persona) {
          setPersona(prev => ({ ...prev, ...data.persona }))
        }
      })
  }, [creatorId])

  const savePersona = async () => {
    if (!creatorId) return
    setPersonaSaving(true)
    await supabase.from('creators').update({ persona }).eq('id', creatorId)
    setPersonaSaving(false)
    setPersonaSaved(true)
    setTimeout(() => setPersonaSaved(false), 2000)
  }

  const addWord = async () => {
    const w = newWord.trim().toLowerCase()
    if (!w || words.some((x) => x.word === w)) return
    const { data } = await supabase
      .from('blocked_words')
      .insert({ creator_id: creatorId, word: w })
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
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        padding: 32,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            <span className="silver-text">Settings</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Manage your workspace preferences
          </div>
        </div>

        {/* Creator Persona section */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>
            Creator Persona
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Define how this creator communicates. Used by the AI to generate on-brand replies.
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

        {/* Blocked words section */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            Blocked Words
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Messages containing these words will be flagged before sending.
          </div>

          {/* Add new word */}
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

          {/* Word list */}
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
          ) : words.length === 0 ? (
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
      </div>
    </div>
  )
}
