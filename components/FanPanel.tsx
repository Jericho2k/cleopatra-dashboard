'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { Fan } from '../types'
import { supabase } from '../lib/supabase'

export interface FanPanelProps {
  fan: Fan | null
}

export default function FanPanel({ fan }: FanPanelProps) {
  const [details, setDetails] = useState({
    age: fan?.age ?? '',
    payday: fan?.payday ?? '',
    hobbies: fan?.hobbies ?? '',
    relationship_status: fan?.relationship_status ?? '',
  })

  useEffect(() => {
    setDetails({
      age: fan?.age ?? '',
      payday: fan?.payday ?? '',
      hobbies: fan?.hobbies ?? '',
      relationship_status: fan?.relationship_status ?? '',
    })
  }, [fan?.id])

  const handleDetailBlur = async (field: string, value: string) => {
    if (!fan) return
    await supabase.from('fans').update({ [field]: value }).eq('id', fan.id)
  }

  if (fan === null) {
    return (
      <aside
        style={{
          height: '100vh',
          width: '100%',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        Select a conversation.
      </aside>
    )
  }

  const tierStyles: React.CSSProperties =
    fan.spend_tier === 'whale'
      ? { border: '1px solid var(--silver)', color: 'var(--silver)' }
      : fan.spend_tier === 'active'
        ? { border: '1px solid var(--green)', color: 'var(--green)' }
        : fan.spend_tier === 'casual'
          ? { border: '1px solid var(--purple)', color: 'var(--purple)' }
          : { border: '1px solid var(--text-faint)', color: 'var(--text-faint)' }

  return (
    <aside
      style={{
        height: '100vh',
        width: '100%',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        overflow: 'auto',
        padding: 24,
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
        FAN PROFILE
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            flex: 1,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Total spent</div>
          <span className="silver-text" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>
            ${fan.total_spent}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Tier</div>
          <span
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '4px 8px',
              borderRadius: 4,
              alignSelf: 'flex-start',
              ...tierStyles,
            }}
          >
            {fan.spend_tier}
          </span>
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        NOTES
      </div>
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          padding: 16,
          color: 'var(--text-secondary)',
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 24,
          minHeight: 80,
        }}
      >
        {fan.notes.trim() ? fan.notes : 'No notes yet.'}
      </div>

      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 12,
          marginTop: 24,
        }}
      >
        FAN DETAILS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'Age', field: 'age' },
          { label: 'Pay day', field: 'payday' },
          { label: 'Hobbies', field: 'hobbies' },
          { label: 'Relationship', field: 'relationship_status' },
        ].map(({ label, field }) => (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                width: 80,
                flexShrink: 0,
              }}
            >
              {label}
            </span>
            <input
              type="text"
              value={details[field as keyof typeof details]}
              onChange={(e) => setDetails((prev) => ({ ...prev, [field]: e.target.value }))}
              onBlur={(e) => handleDetailBlur(field, e.target.value)}
              placeholder="—"
              style={{
                flex: 1,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '5px 10px',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        PREFERENCES
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {fan.preferences.length > 0 ? (
          fan.preferences.map((pref) => (
            <span
              key={pref}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 999,
                background: 'rgba(155, 143, 212, 0.15)',
                color: 'var(--purple)',
                border: '1px solid rgba(155, 143, 212, 0.3)',
              }}
            >
              {pref}
            </span>
          ))
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>None yet.</span>
        )}
      </div>
    </aside>
  )
}
