'use client'

import React, { useState, useEffect } from 'react'
import type { Fan, ConversationSummary } from '../types'

export interface SidebarProps {
  conversations: ConversationSummary[]
  activeFanId: string | null
  onSelectFan: (fan: Fan) => void
}

export default function Sidebar({ conversations, activeFanId, onSelectFan }: SidebarProps) {
  const [now, setNow] = useState(Date.now())
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'whale' | 'active' | 'casual' | 'cold'>('all')

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <style>{`
        @keyframes sidebar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <aside
        style={{
          height: '100vh',
          width: '100%',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '20px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            <span className="silver-text">CLEOPATRA</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>AI</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginLeft: 'auto',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--green)',
                  animation: 'sidebar-pulse 1.5s ease-in-out infinite',
                }}
              />
              {conversations.length}
            </span>
          </div>
        </header>

        <div style={{ padding: '8px 8px 0', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              paddingBottom: 8,
            }}
          >
            {(['all', 'unread', 'whale', 'active', 'casual', 'cold'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: activeFilter === f ? '1px solid var(--silver)' : '1px solid var(--border)',
                  background: activeFilter === f ? 'rgba(200,200,200,0.1)' : 'transparent',
                  color: activeFilter === f ? 'var(--silver)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <ul
          style={{
            flex: 1,
            overflow: 'auto',
            listStyle: 'none',
            padding: '0 8px 16px',
          }}
        >
          {(() => {
            const filtered = conversations.filter((c) => {
              if (activeFilter === 'unread') return c.unread
              if (activeFilter === 'all') return true
              return c.fan.spend_tier === activeFilter
            })
            return filtered.map((c) => {
            const isActive = c.fan.id === activeFanId
            const preview = c.last_message.length > 40 ? c.last_message.slice(0, 40) + '…' : c.last_message
            const iso = c.last_message_time
            const diff = now - new Date(iso).getTime()
            const m = 60 * 1000
            const h = 60 * m
            const dMs = 24 * h
            let timeSince = 'now'
            if (diff >= 7 * dMs) timeSince = new Date(iso).toLocaleDateString()
            else if (diff >= dMs) timeSince = `${Math.floor(diff / dMs)}d`
            else if (diff >= h) timeSince = `${Math.floor(diff / h)}h`
            else if (diff >= m) timeSince = `${Math.floor(diff / m)}m`
            const tier = c.fan.spend_tier
            const tierStyles: React.CSSProperties =
              tier === 'whale'
                ? { border: '1px solid var(--silver)', color: 'var(--silver)' }
                : tier === 'active'
                  ? { border: '1px solid var(--green)', color: 'var(--green)' }
                  : tier === 'casual'
                    ? { border: '1px solid var(--purple)', color: 'var(--purple)' }
                    : { border: '1px solid var(--text-faint)', color: 'var(--text-faint)' }
            return (
              <li key={c.fan.id}>
                <button
                  type="button"
                  onClick={() => onSelectFan(c.fan)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 10px',
                    marginBottom: 4,
                    background: isActive ? 'var(--bg-hover)' : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '3px solid var(--silver)' : '3px solid transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.unread && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--green)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {c.fan.display_name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-display)' }}>
                        ${c.fan.total_spent}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {timeSince}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginBottom: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {preview}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '2px 6px',
                      borderRadius: 4,
                      ...tierStyles,
                    }}
                  >
                    {c.fan.spend_tier}
                  </span>
                </button>
              </li>
            )
            })
          })()}
        </ul>
      </aside>
    </>
  )
}
