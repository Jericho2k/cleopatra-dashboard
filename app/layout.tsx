'use client'

import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <nav
          style={{
            width: 56,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '16px 0',
            gap: 4,
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--silver)',
              marginBottom: 16,
              letterSpacing: '0.02em',
            }}
          >
            C
          </div>
          <NavItem href="/" icon="💬" label="Chats" />
          <NavItem href="/analytics" icon="📊" label="Analytics" />
          <NavItem href="/scripts" icon="📝" label="Scripts" />
        </nav>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </div>
      </body>
    </html>
  )
}

function NavItem({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <a
      href={href}
      title={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        textDecoration: 'none',
        color: 'var(--text-muted)',
        transition: 'background 0.15s',
      }}
    >
      {icon}
    </a>
  )
}
