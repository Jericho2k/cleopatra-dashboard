import type { Metadata, Viewport } from 'next'
import React from 'react'
import AppShell from '../components/AppShell'
import './globals.css'
import './responsive.css'

export const metadata: Metadata = {
  title: 'Cleopatra AI',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the page paint under the notch and the home indicator, which is what
  // makes env(safe-area-inset-*) report anything other than 0. Zoom is left
  // enabled on purpose: the fix for unreadable text is layout, not taking
  // pinch-zoom away from people who need it.
  viewportFit: 'cover',
  themeColor: '#0a0a0b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
