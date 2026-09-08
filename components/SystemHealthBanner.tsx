'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { describeOperationalHealth, type OperationalHealth } from '../lib/health'

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
// The delivery queue moves on a scale of seconds, so it is polled far more often
// than the six-hourly provider catalog check.
const OPERATIONAL_REFRESH_MS = 60 * 1000

export default function SystemHealthBanner() {
  const [health, setHealth] = useState<ModelHealth | null>(null)
  const [operational, setOperational] = useState<OperationalHealth | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/model-runtime-health')
      if (!response.ok) return
      setHealth(await response.json())
    } catch {
      // Backend reachability is already handled by page-level error states.
    }
  }, [])

  const refreshOperational = useCallback(async () => {
    try {
      const response = await apiFetch('/health')
      if (!response.ok) return
      setOperational(await response.json())
    } catch {
      // Same as above: a page-level error state already covers unreachability.
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh()
      void refreshOperational()
    }, 0)
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    const operationalInterval = window.setInterval(
      () => void refreshOperational(),
      OPERATIONAL_REFRESH_MS,
    )
    const onFocus = () => {
      void refresh()
      void refreshOperational()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.clearInterval(operationalInterval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshOperational])

  const operationalNotice = describeOperationalHealth(operational)
  const modelBannerVisible =
    health !== null && health.status !== 'healthy' && health.status !== 'unknown'

  if (!modelBannerVisible && !operationalNotice) {
    return null
  }

  let message: string
  let critical: boolean
  let title: string | undefined

  if (modelBannerVisible && health) {
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
    critical = ['unavailable', 'misconfigured'].includes(health.status)
    message = health.status === 'degraded'
      ? `AI provider degraded — issue detected with ${affectedNames || ordinary?.model || 'a configured writer'}${ordinaryAffected && fallback?.available ? `; ${fallback.model} fallback is available` : ''}.`
      : health.status === 'unavailable'
        ? 'AI replies unavailable — neither the primary writer nor its fallback is available.'
        : health.status === 'misconfigured'
          ? 'AI provider is not configured correctly. Auto replies may not be generated.'
          : 'AI provider availability could not be verified. Existing fallback behavior remains active.'
    title = health.detail
    if (operationalNotice) {
      message = `${message} ${operationalNotice.message}`
      critical = critical || operationalNotice.critical
    }
  } else {
    message = operationalNotice!.message
    critical = operationalNotice!.critical
    title = operationalNotice!.detail
  }

  const checkedAt = operational?.checked_at ?? health?.checked_at ?? null

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
      title={title}
    >
      {message}
      {checkedAt && (
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
          Checked {new Date(checkedAt).toLocaleString()}
        </span>
      )}
    </div>
  )
}
