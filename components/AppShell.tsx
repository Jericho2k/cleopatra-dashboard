'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import SystemHealthBanner from './SystemHealthBanner'
import {
  canSimulate,
  fetchSimulationCapabilities,
  type SimulationCapabilities,
} from '../lib/simulation'

/**
 * The application frame.
 *
 * Desktop is the rail this app has always had: a 48px icon strip that expands
 * to 180px and remembers that choice. Below 768px the same <nav> is a drawer
 * behind a fixed top bar, because a permanent rail plus a three-pane workspace
 * inside 390px is what made the phone experience unusable.
 *
 * Which one is in force is decided entirely by a media query in
 * app/responsive.css. This component renders one tree, never measures the
 * window, and therefore cannot produce a hydration mismatch or a layout that
 * flashes on first paint.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  // Desktop rail: collapsed or labelled. Persisted, as before.
  const [expanded, setExpanded] = useState(false)
  // Phone drawer: open or shut. Deliberately NOT persisted — restoring a
  // half-open drawer on every page load is not a feature.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // null = the backend has not answered yet. Treated exactly like false, so the
  // entry never flashes into view for an account that may not have it.
  const [capabilities, setCapabilities] = useState<SimulationCapabilities | null>(
    null,
  )
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'

  useEffect(() => {
    const saved = localStorage.getItem('nav-expanded')
    if (saved === 'true') setExpanded(true)
  }, [])

  useEffect(() => {
    if (isLoginPage) return
    let cancelled = false
    void fetchSimulationCapabilities().then(value => {
      if (!cancelled) setCapabilities(value)
    })
    return () => {
      cancelled = true
    }
  }, [isLoginPage])

  // Navigating closes the drawer. The nav entries are plain <a> elements, so
  // most transitions are full loads anyway; this covers the rest.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  /**
   * Publish the height the software keyboard is covering as --cleo-kb-inset.
   *
   * The shell is a fixed-height, non-scrolling box, which is what keeps a chat
   * composer pinned to the bottom. On a phone that is also what puts the
   * composer *behind* the keyboard, because the layout viewport does not
   * shrink when the keyboard opens — only the visual viewport does. Subtracting
   * this value from the shell height keeps the composer, and whatever input has
   * focus, on screen.
   *
   * This is the only place in the app that reads viewport geometry, and it
   * reads height, never width: no responsive branching happens in JavaScript.
   */
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      // Browser chrome collapsing also moves these numbers by a few pixels;
      // only treat a substantial overlap as a keyboard.
      const inset = covered > 120 ? Math.round(covered) : 0
      root.style.setProperty('--cleo-kb-inset', `${inset}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.setProperty('--cleo-kb-inset', '0px')
    }
  }, [])

  const toggle = useCallback(() => {
    setExpanded(v => {
      localStorage.setItem('nav-expanded', String(!v))
      return !v
    })
  }, [])

  if (isLoginPage) return <>{children}</>

  return (
    <>
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

      {/* Fixed top bar. Phone only (display is flipped on by the media query);
          it is what opens the drawer, since there is no permanent rail. */}
      <header className="cleo-topbar">
        <button
          type="button"
          className="cleo-topbar-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect y="2" width="16" height="1.5" rx="0.75" fill="currentColor" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" fill="currentColor" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>
        <span className="cleo-topbar-title">CLEOPATRA AI</span>
      </header>

      <div className="cleo-shell">
        <nav
          className="cleo-nav"
          data-expanded={expanded ? 'true' : 'false'}
          data-open={drawerOpen ? 'true' : 'false'}
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
          {/* Drawer header. Phone only — the rail's hamburger is hidden there,
              so this carries the close control. */}
          <div className="cleo-nav-drawer-head">
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--silver)',
                fontFamily: 'var(--font-display)',
                whiteSpace: 'nowrap',
                paddingLeft: 6,
              }}
            >
              CLEOPATRA AI
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              style={{
                width: 38,
                height: 38,
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 20,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          {/* Hamburger — collapses/expands the desktop rail. */}
          <button
            type="button"
            className="nav-btn cleo-nav-hamburger"
            onClick={toggle}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
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
            <span
              className="cleo-nav-label"
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
          </button>

          <NavItem
            href="/"
            pathname={pathname}
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
            pathname={pathname}
            label="Overview"
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
            pathname={pathname}
            label="Sets"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="2" y="7" width="8" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="2" y="11" width="10" height="1.5" rx="0.75" fill="currentColor" />
              </svg>
            }
          />
          <NavItem
            href="/vault"
            pathname={pathname}
            label="Vault"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 8h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
          />
          <NavItem
            href="/monetization"
            pathname={pathname}
            label="Monetization"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.4 5.2c-.55-.45-1.3-.7-2.18-.7-1.28 0-2.22.62-2.22 1.55 0 2.3 4.45 1.05 4.45 3.35 0 .98-.94 1.65-2.35 1.65-.94 0-1.82-.3-2.5-.88M8 3.3v9.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
            }
          />
          {/*
            Owner-only. Rendered ONLY after the backend has positively said
            auto_simulation: true for this authenticated account. For every
            ordinary agency account the element below does not exist at all —
            not disabled, not an access-denied screen, absent. The backend
            enforces the same rule independently; this is presentation only.
          */}
          {canSimulate(capabilities) && (
            <NavItem
              href="/simulator"
              pathname={pathname}
              label="Simulator"
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="3" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M4.75 6.25L6.5 7.5 4.75 8.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8.25 9h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                </svg>
              }
            />
          )}
          <NavItem
            href="/settings"
            pathname={pathname}
            label="Settings"
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
          />
          <div style={{ marginTop: 'auto', paddingBottom: 8 }}>
            <button
              type="button"
              className="cleo-nav-signout"
              onClick={async () => {
                const { createBrowserClient } = await import('@supabase/ssr')
                const supabase = createBrowserClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
                )
                await supabase.auth.signOut()
                sessionStorage.removeItem('creators')
                for (let index = localStorage.length - 1; index >= 0; index -= 1) {
                  const key = localStorage.key(index)
                  if (key?.startsWith('convos_')) localStorage.removeItem(key)
                }
                window.location.href = '/login'
              }}
              title="Sign out"
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
                color: 'var(--text-muted)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="cleo-nav-label" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                Sign out
              </span>
            </button>
          </div>
        </nav>

        {/* Drawer scrim. Only ever visible on a phone with the drawer open. */}
        <div
          className="cleo-nav-scrim"
          data-open={drawerOpen ? 'true' : 'false'}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <div className="cleo-main">
          <SystemHealthBanner />
          {children}
        </div>
      </div>
    </>
  )
}

function NavItem({
  href,
  icon,
  label,
  pathname,
}: {
  href: string
  icon: React.ReactNode
  label: string
  pathname: string | null
}) {
  // Was `typeof window !== 'undefined' && window.location.pathname === href`,
  // which is false during SSR and true on the client for the current route —
  // a guaranteed hydration mismatch on every page. usePathname is stable
  // across both renders.
  const isActive = pathname === href
  return (
    <a
      href={href}
      className="nav-item"
      aria-current={isActive ? 'page' : undefined}
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
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span className="cleo-nav-label" style={{ fontSize: 13 }}>{label}</span>
    </a>
  )
}
