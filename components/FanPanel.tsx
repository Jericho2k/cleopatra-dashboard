'use client'

import React from 'react'
import type { Fan } from '../types'

export interface FanPanelProps {
  fan: Fan | null
}

export default function FanPanel({ fan }: FanPanelProps) {
  if (fan === null) {
    return (
      <aside
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 320,
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
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
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
            justifyContent: 'flex-end',
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
