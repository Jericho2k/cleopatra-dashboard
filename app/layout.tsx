'use client'

import React, { useState, useEffect } from 'react'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('nav-expanded')
    if (saved === 'true') setExpanded(true)
  }, [])

  const toggle = () => {
    setExpanded((v) => {
      localStorage.setItem('nav-expanded', String(!v))
      return !v
    })
  }

  return (
    <html lang="en">
      <body style={{ display: 'flex', height: '100vh', overflow: 'hidden', margin: 0 }}>
        <style>{`
  .nav-item:hover { background: var(--bg-hover) !important; }
  .nav-btn:hover { 
    text-shadow: 0 0 12px rgba(200, 200, 200, 0.8);
    color: var(--silver) !important;
  }
  .nav-btn:hover svg rect {
    filter: drop-shadow(0 0 4px rgba(200, 200, 200, 0.6));
  }
`}</style>
        <nav
          style={{
            width: expanded ? 180 : 48,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 4px',
            gap: 2,
            flexShrink: 0,
            transition: 'width 0.2s ease',
            overflow: 'hidden',
          }}
        >
          {/* Hamburger */}
          <button
            type="button"
            className="nav-btn"
            onClick={toggle}
            style={{
              width: '100%',
              height: 40,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 12,
              padding: '0 10px',
              marginBottom: 8,
              color: 'var(--text-secondary)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <rect y="2" width="16" height="1.5" rx="0.75" fill="currentColor" />
              <rect y="7.25" width="16" height="1.5" rx="0.75" fill="currentColor" />
              <rect y="12.5" width="16" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
            {expanded && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--silver)',
                  fontFamily: 'var(--font-display)',
                  whiteSpace: 'nowrap',
                }}
              >
                CLEOPATRA AI
              </span>
            )}
          </button>

          <NavItem
            href="/"
            expanded={expanded}
            label="Chats"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 2h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/analytics"
            expanded={expanded}
            label="Analytics"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="9" width="3" height="6" rx="0.75" fill="currentColor" />
                <rect x="6" y="5" width="3" height="10" rx="0.75" fill="currentColor" />
                <rect x="11" y="1" width="3" height="14" rx="0.75" fill="currentColor" />
              </svg>
            }
          />
          <NavItem
            href="/scripts"
            expanded={expanded}
            label="Scripts"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="2" y="7" width="8" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="2" y="11" width="10" height="1.5" rx="0.75" fill="currentColor" />
              </svg>
            }
          />
        </nav>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </div>
      </body>
    </html>
  )
}

function NavItem({
  href,
  icon,
  label,
  expanded,
}: {
  href: string
  icon: React.ReactNode
  label: string
  expanded: boolean
}) {
  const isActive = typeof window !== 'undefined' && window.location.pathname === href
  return (
    <a
      href={href}
      className="nav-item"
      style={{
        width: '100%',
        height: 40,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 12,
        padding: '0 10px',
        textDecoration: 'none',
        color: isActive ? 'var(--silver)' : 'var(--text-muted)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        margin: '0',
      }}
    >
      {icon}
      {expanded && <span style={{ fontSize: 13 }}>{label}</span>}
    </a>
  )
}
