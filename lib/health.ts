/**
 * Turns the backend's operational health document into one operator sentence.
 *
 * The backend reports the raw reasons; deciding what an agency operator should
 * be told is a product question, so the mapping lives here rather than in the
 * health endpoint. Anything unrecognised is deliberately ignored — a new backend
 * signal must not put a mystery banner in front of an operator.
 */

export type OperationalHealth = {
  status: 'ok' | 'degraded' | 'unhealthy' | 'unknown'
  checked_at?: string | null
  degraded_reasons?: string[]
  fatal_reasons?: string[]
  queue?: {
    pending?: number
    oldest_pending_age_seconds?: number
    pending_inbound_messages?: number
  } | null
  scheduler?: {
    seconds_since_last_cycle?: number | null
  } | null
  model?: {
    gate?: { inflight?: number; limit?: number; waiting?: number } | null
  } | null
}

export type OperationalNotice = {
  message: string
  detail: string
  critical: boolean
}

function minutes(seconds: number | undefined | null): string {
  const value = Math.round((seconds ?? 0) / 60)
  return value <= 1 ? 'about a minute' : `about ${value} minutes`
}

export function describeOperationalHealth(
  health: OperationalHealth | null | undefined,
): OperationalNotice | null {
  if (!health) return null
  if (health.status !== 'degraded' && health.status !== 'unhealthy') return null

  const reasons = health.degraded_reasons ?? []
  const fatal = health.fatal_reasons ?? []
  const parts: string[] = []

  // Confirmed, sustained inability to reach the database. The backend only
  // publishes this once repeated probes have failed for long enough, so it is
  // the one database signal worth a red banner.
  if (
    fatal.some(
      reason =>
        reason.startsWith('database_unavailable') ||
        // Pre-hysteresis name. Kept so a dashboard deployed ahead of the
        // backend does not silently stop reporting a real outage.
        reason.startsWith('database_unreachable'),
    )
  ) {
    return {
      message: 'Database unavailable. Message processing is paused.',
      detail: fatal.join(', '),
      critical: true,
    }
  }

  // Repeated failures that have not yet been confirmed as an outage. Worth
  // saying, not worth alarming: the backend is retrying and the queue is durable.
  if (reasons.some(reason => reason.startsWith('database_unstable'))) {
    return {
      message: 'Database connectivity is unstable. Cleopatra is retrying.',
      detail: [...fatal, ...reasons].join(', '),
      critical: false,
    }
  }

  // A single failed probe (``database_probe_failed_unconfirmed``) is
  // deliberately not matched here. One recycled connection is not an incident,
  // and a banner that flickers on every blip is a banner operators learn to
  // ignore — which is how a real outage gets missed.

  if (reasons.some(reason => reason.startsWith('queue_oldest_pending_age_exceeds'))) {
    parts.push(
      `Auto replies are running late — the oldest queued reply has waited ${minutes(
        health.queue?.oldest_pending_age_seconds,
      )}.`,
    )
  }
  if (reasons.some(reason => reason.startsWith('queue_depth_exceeds'))) {
    parts.push(`Auto queue is backed up (${health.queue?.pending ?? 0} waiting).`)
  }
  if (reasons.some(reason => reason.startsWith('scheduler_stale_for'))) {
    parts.push('The Auto worker has not run recently.')
  }
  if (reasons.includes('scheduler_has_not_completed_a_cycle')) {
    parts.push('The Auto worker has not started.')
  }
  if (reasons.includes('model_gate_saturated')) {
    parts.push('AI capacity is saturated; replies are queued rather than dropped.')
  }
  if (reasons.includes('message_identity_index_missing')) {
    parts.push(
      'A database migration is pending (message identity). Incoming messages are ' +
        'being de-duplicated without it, which is not race-safe.',
    )
  }

  if (parts.length === 0) return null
  return {
    message: parts.join(' '),
    detail: [...fatal, ...reasons].join(', '),
    critical: health.status === 'unhealthy' || reasons.some(r => r.startsWith('scheduler_stale_for')),
  }
}
