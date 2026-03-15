'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const CREATOR_ID = 'cc36c60d-21aa-44fc-b0c4-67cdc7376b2c'

const LABEL = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 16 }
const CARD = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalMessages: 0,
    fanMessages: 0,
    creatorMessages: 0,
    aiSuggested: 0,
    manualReplies: 0,
    totalFans: 0,
    totalRevenue: 0,
    whales: 0,
    active: 0,
    casual: 0,
    cold: 0,
    avgResponseTime: 0,
  })
  const [topFans, setTopFans] = useState<{ display_name: string; total_spent: number; spend_tier: string; message_count?: number }[]>([])
  const [dailyMessages, setDailyMessages] = useState<{ date: string; fan: number; creator: number; ai: number }[]>([])
  const [stageBreakdown, setStageBreakdown] = useState<{ name: string; value: number; color: string }[]>([])
  const [activeFansList, setActiveFansList] = useState<{ display_name: string; count: number }[]>([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const now = new Date()
      let since = new Date(0)
      if (period === 'today') since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      else if (period === 'week') since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      else if (period === 'month') since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const [messagesRes, fansRes, suggestionsRes] = await Promise.all([
        supabase.from('messages').select('role, was_ai_suggested, sent_at, fan_id').eq('creator_id', CREATOR_ID).gte('sent_at', since.toISOString()).order('sent_at', { ascending: true }),
        supabase.from('fans').select('id, display_name, total_spent, spend_tier').eq('creator_id', CREATOR_ID),
        supabase.from('suggestions').select('stage, created_at').eq('creator_id', CREATOR_ID).gte('created_at', since.toISOString()),
      ])

      const messages = messagesRes.data ?? []
      const fans = fansRes.data ?? []
      const suggestions = suggestionsRes.data ?? []

      const fanMessages = messages.filter((m) => m.role === 'fan')
      const creatorMessages = messages.filter((m) => m.role === 'creator')
      const aiSuggested = creatorMessages.filter((m) => m.was_ai_suggested).length
      const totalRevenue = fans.reduce((sum, f) => sum + (f.total_spent ?? 0), 0)

      // Avg response time
      let totalResponseTime = 0
      let responseCount = 0
      for (let i = 1; i < messages.length; i++) {
        if (messages[i].role === 'creator' && messages[i - 1].role === 'fan') {
          const diff = new Date(messages[i].sent_at).getTime() - new Date(messages[i - 1].sent_at).getTime()
          if (diff > 0 && diff < 1000 * 60 * 60) {
            totalResponseTime += diff
            responseCount++
          }
        }
      }
      const avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount / 1000) : 0

      // Daily messages chart
      const dayMap: Record<string, { fan: number; creator: number; ai: number }> = {}
      messages.forEach((m) => {
        const day = m.sent_at.slice(0, 10)
        if (!dayMap[day]) dayMap[day] = { fan: 0, creator: 0, ai: 0 }
        if (m.role === 'fan') dayMap[day].fan++
        else {
          dayMap[day].creator++
          if (m.was_ai_suggested) dayMap[day].ai++
        }
      })
      const dailyData = Object.entries(dayMap).map(([date, v]) => ({
        date: date.slice(5),
        fan: v.fan,
        creator: v.creator,
        ai: v.ai,
      }))

      // Stage breakdown
      const stageCounts: Record<string, number> = {}
      suggestions.forEach((s) => {
        const stage = s.stage ?? 'WARMING_UP'
        stageCounts[stage] = (stageCounts[stage] ?? 0) + 1
      })
      const stageColors: Record<string, string> = {
        COLD_OPEN: '#6b7280',
        WARMING_UP: '#4caf82',
        FLIRTING: '#9b8fd4',
        PRE_UPSELL: '#f59e0b',
        UPSELL_ACTIVE: '#ef4444',
        OBJECTION: '#f97316',
        RETENTION: '#3b82f6',
        HIGH_VALUE: '#c8c8c8',
      }
      const stageData = Object.entries(stageCounts).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        value,
        color: stageColors[name] ?? '#6b7280',
      }))

      // Most active fans by message count
      const fanMsgCount: Record<string, number> = {}
      fanMessages.forEach((m) => {
        fanMsgCount[m.fan_id] = (fanMsgCount[m.fan_id] ?? 0) + 1
      })
      const activeFans = fans
        .map((f) => ({ ...f, message_count: fanMsgCount[f.id] ?? 0 }))
        .sort((a, b) => b.message_count - a.message_count)
        .slice(0, 5)

      setStats({
        totalMessages: messages.length,
        fanMessages: fanMessages.length,
        creatorMessages: creatorMessages.length,
        aiSuggested,
        manualReplies: creatorMessages.length - aiSuggested,
        totalFans: fans.length,
        totalRevenue,
        whales: fans.filter((f) => f.spend_tier === 'whale').length,
        active: fans.filter((f) => f.spend_tier === 'active').length,
        casual: fans.filter((f) => f.spend_tier === 'casual').length,
        cold: fans.filter((f) => f.spend_tier === 'cold').length,
        avgResponseTime,
      })
      setTopFans([...fans].sort((a, b) => b.total_spent - a.total_spent).slice(0, 5))
      setDailyMessages(dailyData)
      setStageBreakdown(stageData)
      setActiveFansList(activeFans.map((f) => ({ display_name: f.display_name, count: f.message_count ?? 0 })))
      setLoading(false)
    }
    load()
  }, [period])

  const aiRate =
    stats.aiSuggested + stats.manualReplies > 0
      ? Math.round((stats.aiSuggested / (stats.aiSuggested + stats.manualReplies)) * 100)
      : 0

  const formatTime = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)

  const tooltipStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 12,
  }

  return (
    <div
      style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg-base)', padding: 32, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}
    >
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>
              <span className="silver-text">Analytics</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Performance overview</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['today', 'week', 'month', 'all'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: period === p ? '1px solid var(--silver)' : '1px solid var(--border)',
                  background: period === p ? 'rgba(200,200,200,0.1)' : 'transparent',
                  color: period === p ? 'var(--silver)' : 'var(--text-muted)',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Top stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Messages', value: stats.totalMessages },
            { label: 'Fan Messages', value: stats.fanMessages },
            { label: 'AI Usage Rate', value: `${aiRate}%` },
            { label: 'Avg Response', value: loading ? '—' : formatTime(stats.avgResponseTime) },
            { label: 'Total Revenue', value: `$${stats.totalRevenue}` },
          ].map(({ label, value }) => (
            <div key={label} style={CARD}>
              <div style={{ ...LABEL, marginBottom: 8 }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--silver)' }}>
                {loading ? '—' : value}
              </div>
            </div>
          ))}
        </div>

        {/* Messages over time chart */}
        <div style={{ ...CARD, marginBottom: 24 }}>
          <div style={LABEL}>Messages Over Time</div>
          {loading || dailyMessages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, height: 160, display: 'flex', alignItems: 'center' }}>
              No data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={dailyMessages} barGap={2} style={{ outline: 'none' }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(200,200,200,0.05)' }} />
                <Bar dataKey="fan" name="Fan" fill="#4caf82" radius={[3, 3, 0, 0]} />
                <Bar dataKey="creator" name="Creator" fill="#9b8fd4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* AI usage chart */}
        <div style={{ ...CARD, marginBottom: 24 }}>
          <div style={LABEL}>AI Suggestions Used Per Day</div>
          {loading || dailyMessages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, height: 120, display: 'flex', alignItems: 'center' }}>
              No data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={dailyMessages} style={{ outline: 'none' }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="ai" name="AI Used" stroke="var(--silver)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 3 column row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Fan tier breakdown */}
          <div style={CARD}>
            <div style={LABEL}>Fan Breakdown</div>
            {[
              { label: 'Whale', count: stats.whales, color: 'var(--silver)' },
              { label: 'Active', count: stats.active, color: 'var(--green)' },
              { label: 'Casual', count: stats.casual, color: 'var(--purple)' },
              { label: 'Cold', count: stats.cold, color: 'var(--text-faint)' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${stats.totalFans > 0 ? (count / stats.totalFans) * 100 : 0}%`, height: '100%', background: color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', width: 16, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Top fans by spend */}
          <div style={CARD}>
            <div style={LABEL}>Top Fans by Spend</div>
            {topFans.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet.</div>
            ) : topFans.map((fan, i) => (
              <a key={fan.display_name} href="/" onClick={() => localStorage.setItem('open-fan', fan.display_name)}
                style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 16 }}>#{i + 1}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{fan.display_name}</span>
                </div>
                <span style={{ fontSize: 13, color: 'var(--green)', fontFamily: 'var(--font-display)' }}>${fan.total_spent}</span>
              </a>
            ))}
          </div>

          {/* Most active fans */}
          <div style={CARD}>
            <div style={LABEL}>Most Active Fans</div>
            {activeFansList.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet.</div>
            ) : activeFansList.map((fan, i) => (
              <a key={fan.display_name} href="/" onClick={() => localStorage.setItem('open-fan', fan.display_name)}
                style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 16 }}>#{i + 1}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{fan.display_name}</span>
                </div>
                <span style={{ fontSize: 13, color: 'var(--purple)' }}>{fan.count} msgs</span>
              </a>
            ))}
          </div>
        </div>

        {/* Bottom row - stage + reply breakdown + response */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {/* Stage distribution */}
          {stageBreakdown.length > 0 && (
            <div style={CARD}>
              <div style={LABEL}>Conversation Stage Distribution</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <PieChart width={140} height={140}>
                  <Pie data={stageBreakdown} cx={65} cy={65} innerRadius={40} outerRadius={62} dataKey="value" paddingAngle={3}>
                    {stageBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stageBreakdown.map((s) => (
                    <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({s.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reply method + response performance stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={CARD}>
              <div style={LABEL}>Reply Method</div>
              <div style={{ display: 'flex', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--green)' }}>{stats.aiSuggested}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>AI SUGGESTED</div>
                </div>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--purple)' }}>{stats.manualReplies}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>MANUAL</div>
                </div>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--silver)' }}>{aiRate}%</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>AI RATE</div>
                </div>
              </div>
            </div>
            <div style={CARD}>
              <div style={LABEL}>Response Performance</div>
              <div style={{ display: 'flex', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--silver)' }}>
                    {loading ? '—' : formatTime(stats.avgResponseTime)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>AVG RESPONSE TIME</div>
                </div>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--green)' }}>{stats.totalFans}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>TOTAL FANS</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
