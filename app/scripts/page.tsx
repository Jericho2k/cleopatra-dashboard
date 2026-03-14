'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const CREATOR_ID = 'cc36c60d-21aa-44fc-b0c4-67cdc7376b2c'

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<
    { id: string; title: string; content: string; category: string }[]
  >([])
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('custom')

  useEffect(() => {
    supabase
      .from('scripts')
      .select('*')
      .eq('creator_id', CREATOR_ID)
      .order('category')
      .then(({ data }) => {
        if (data) setScripts(data)
      })
  }, [])

  const addScript = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    const { data } = await supabase
      .from('scripts')
      .insert({
        creator_id: CREATOR_ID,
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
      })
      .select()
      .single()
    if (data) {
      setScripts((prev) => [...prev, data])
      setNewTitle('')
      setNewContent('')
    }
  }

  const deleteScript = async (id: string) => {
    await supabase.from('scripts').delete().eq('id', id)
    setScripts((prev) => prev.filter((s) => s.id !== id))
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
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            <span className="silver-text">Scripts</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Manage your quick-reply templates
          </div>
        </div>

        {/* Add new script */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 12,
            }}
          >
            Add Script
          </div>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title (e.g. Warm greeting)"
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              marginBottom: 8,
              boxSizing: 'border-box',
            }}
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Message content..."
            rows={3}
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              marginBottom: 8,
              resize: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '7px 12px',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            >
              {['greeting', 'upsell', 'reengagement', 'custom'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addScript}
              style={{
                padding: '7px 16px',
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
        </div>

        {/* Script list */}
        {['greeting', 'upsell', 'reengagement', 'custom'].map((cat) => {
          const catScripts = scripts.filter((s) => s.category === cat)
          if (catScripts.length === 0) return null
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  marginBottom: 8,
                }}
              >
                {cat}
              </div>
              {catScripts.map((script) => (
                <div
                  key={script.id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>
                      {script.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {script.content}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteScript(script.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-faint)',
                      cursor: 'pointer',
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
