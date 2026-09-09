/**
 * A single minute-tick shared by every relative timestamp on the page.
 *
 * FE-004 - Sidebar ran `setInterval(() => setNow(Date.now()), 60_000)` in the
 * component that renders the whole conversation list, so once a minute every
 * row re-rendered, the filter re-ran, and every membership `.includes()` ran
 * again - all to change "3m" into "4m".
 *
 * One interval now lives here, shared by all subscribers, and only the little
 * <RelativeTime> spans subscribe to it. The interval exists only while
 * something is listening.
 */

import { useEffect, useState } from 'react'

const TICK_MS = 60 * 1000

const subscribers = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(callback: () => void): () => void {
  subscribers.add(callback)
  if (timer === null) {
    timer = setInterval(() => {
      for (const notify of subscribers) notify()
    }, TICK_MS)
  }
  return () => {
    subscribers.delete(callback)
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

// Captured at import so a component can seed its clock without calling
// Date.now() during render, which React's compiler rules forbid.
const INITIAL_NOW = Date.now()

/**
 * The current time, refreshed once a minute, and only where a relative
 * timestamp is actually shown.
 */
export function useMinuteTick(): number {
  const [now, setNow] = useState(INITIAL_NOW)
  useEffect(() => subscribe(() => setNow(Date.now())), [])
  return now
}

/**
 * "now", "4m", "3h", "2d", or a date once it is a week old.
 *
 * Pure, so it is unit-testable without rendering anything.
 */
export function formatRelativeTime(value: Date, now: number): string {
  const diff = now - value.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff >= 7 * day) return value.toLocaleDateString()
  if (diff >= day) return `${Math.floor(diff / day)}d`
  if (diff >= hour) return `${Math.floor(diff / hour)}h`
  if (diff >= minute) return `${Math.floor(diff / minute)}m`
  return 'now'
}

/** A timestamp before this is a placeholder, not a real conversation time. */
export function isRealTimestamp(value: Date): boolean {
  return value.getFullYear() > 2000
}
