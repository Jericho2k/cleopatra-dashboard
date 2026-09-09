import { describe, expect, it } from 'vitest'
import { formatRelativeTime, isRealTimestamp } from '../relativeTime'

const NOW = Date.parse('2026-01-10T12:00:00.000Z')

describe('formatRelativeTime', () => {
  it('says now for the last minute', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000), NOW)).toBe('now')
  })

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(new Date(NOW - 4 * 60_000), NOW)).toBe('4m')
    expect(formatRelativeTime(new Date(NOW - 3 * 3_600_000), NOW)).toBe('3h')
    expect(formatRelativeTime(new Date(NOW - 2 * 86_400_000), NOW)).toBe('2d')
  })

  it('falls back to a date after a week', () => {
    const old = new Date(NOW - 8 * 86_400_000)
    expect(formatRelativeTime(old, NOW)).toBe(old.toLocaleDateString())
  })
})

describe('isRealTimestamp', () => {
  it('rejects the epoch placeholder the conversation list uses', () => {
    expect(isRealTimestamp(new Date(0))).toBe(false)
    expect(isRealTimestamp(new Date(NOW))).toBe(true)
  })
})
