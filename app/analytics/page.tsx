'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const CREATOR_ID = 'cc36c60d-21aa-44fc-b0c4-67cdc7376b2c'

export default function AnalyticsPage() {
  const [stats, setStats] = useState({
    totalMessages: 0,
    aiSuggested: 0,
    manualReplies: 0,
    totalFans: 0,
    totalRevenue: 0,
    whales: 0,
    active: 0,
    casual: 0,
    cold: 0,
  })
  const [topFans, setTopFans] = useState<{ display_name: string; total_spent: number; spend_tier: string }[]>([])
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const now = new Date()
      let since = new Date(0)
      if (period === 'today') since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      else if (period === 'week') since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      else if (period === 'month') since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const [messagesRes, fansRes] = await Promise.all([
        supabase.from('messages').select('role, was_ai_suggested').eq('creator_id', CREATOR_ID).gte('sent_at', since.toISOString()),
        supabase.from('fans').select('display_name, total_spent, spend_tier').eq('creator_id', CREATOR_ID),
      ])

      const messages = messagesRes.data ?? []
      const fans = fansRes.data ?? []

      const creatorMessages = messages.filter((m) => m.role === 'creator')
      const aiSuggested = creatorMessages.filter((m) => m.was_ai_suggested).length
      const totalRevenue = fans.reduce((sum, f) => sum + (f.total_spent ?? 0), 0)

      setStats({
        totalMessages: messages.length,
        aiSuggested,
        manualReplies: creatorMessages.length - aiSuggested,
        totalFans: fans.length,
        totalRevenue,
        whales: fans.filter((f) => f.spend_tier === 'whale').length,
        active: fans.filter((f) => f.spend_tier === 'active').length,
        casual: fans.filter((f) => f.spend_tier === 'casual').length,
        cold: fans.filter((f) => f.spend_tier === 'cold').length,
      })
      setTopFans([...fans].sort((a, b) => b.total_spent - a.total_spent).slice(0, 5))
      setLoading(false)
    }
    load()
  }, [period])

  const aiRate = stats.aiSuggested + stats.manualReplies > 0
    ? Math.round((stats.aiSuggested / (stats.aiSuggested + stats.manualReplies)) * 100)
    : 0

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
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>
              <span className="silver-text">CLEOPATRA</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> AI</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Analytics</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['today', 'week', 'month', 'all'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: period === p ? '1px solid var(--silver)' : '1px solid var(--border)',
                  background: period === p ? 'rgba(200,200,200,0.1)' : 'transparent',
                  color: period === p ? 'var(--silver)' : 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Messages', value: stats.totalMessages },
            { label: 'AI Suggestions Used', value: stats.aiSuggested },
            { label: 'AI Usage Rate', value: `${aiRate}%` },
            { label: 'Total Revenue', value: `$${stats.totalRevenue}` },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                {label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--silver)' }}>
                {loading ? '—' : value}
              </div>
            </div>
          ))}
        </div>

        {/* Fan tier breakdown + top fans */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
              Fan Breakdown
            </div>
            {[
              { label: 'Whale', count: stats.whales, color: 'var(--silver)' },
              { label: 'Active', count: stats.active, color: 'var(--green)' },
              { label: 'Casual', count: stats.casual, color: 'var(--purple)' },
              { label: 'Cold', count: stats.cold, color: 'var(--text-faint)' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 120,
                      height: 4,
                      background: 'var(--bg-elevated)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${stats.totalFans > 0 ? (count / stats.totalFans) * 100 : 0}%`,
                        height: '100%',
                        background: color,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', width: 16, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
              Top Fans
            </div>
            {topFans.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet.</div>
            ) : (
              topFans.map((fan, i) => (
                <a
                  key={fan.display_name}
                  href="/"
                  onClick={() => localStorage.setItem('open-fan', fan.display_name)}
                  style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 16 }}>#{i + 1}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{fan.display_name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--green)', fontFamily: 'var(--font-display)' }}>${fan.total_spent}</span>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
