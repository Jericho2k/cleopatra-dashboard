'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

type ModelHealth = {
  status: 'unknown' | 'healthy' | 'degraded' | 'unavailable' | 'misconfigured' | 'check_failed'
  checked_at: string | null
  detail: string
  models: Array<{
    role: string
    provider: string
    model: string
    available: boolean | null
    runtime?: {
      consecutive_failures?: number
    } | null
  }>
}

const REFRESH_MS = 15 * 60 * 1000

export default function SystemHealthBanner() {
  const [health, setHealth] = useState<ModelHealth | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/model-runtime-health')
      if (!response.ok) return
      setHealth(await response.json())
    } catch {
      // Backend reachability is already handled by page-level error states.
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  if (!health || health.status === 'healthy' || health.status === 'unknown') {
    return null
  }

  const ordinary = health.models.find(model => model.role === 'ordinary_writer')
  const fallback = health.models.find(
    model => model.role === 'complex_writer_and_fallback',
  )
  const affectedModels = health.models.filter(
    model => model.available === false || (model.runtime?.consecutive_failures ?? 0) >= 2,
  )
  const affectedNames = affectedModels.map(model => model.model).join(', ')
  const ordinaryAffected = affectedModels.some(
    model => model.role === 'ordinary_writer',
  )
  const critical = ['unavailable', 'misconfigured'].includes(health.status)
  const message = health.status === 'degraded'
    ? `AI provider degraded — issue detected with ${affectedNames || ordinary?.model || 'a configured writer'}${ordinaryAffected && fallback?.available ? `; ${fallback.model} fallback is available` : ''}.`
    : health.status === 'unavailable'
      ? 'AI replies unavailable — neither the primary writer nor its fallback is available.'
      : health.status === 'misconfigured'
        ? 'AI provider is not configured correctly. Auto replies may not be generated.'
        : 'AI provider availability could not be verified. Existing fallback behavior remains active.'

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        zIndex: 500,
        top: 0,
        left: 0,
        right: 0,
        padding: '8px 16px',
        borderBottom: `1px solid ${critical ? 'rgba(229,118,137,0.65)' : 'rgba(240,165,0,0.55)'}`,
        background: critical ? 'rgba(229,118,137,0.12)' : 'rgba(240,165,0,0.10)',
        color: critical ? '#e57689' : '#d9aa52',
        fontSize: 12,
        lineHeight: 1.4,
      }}
      title={health.detail}
    >
      {message}
      {health.checked_at && (
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
          Checked {new Date(health.checked_at).toLocaleString()}
        </span>
      )}
    </div>
  )
}
