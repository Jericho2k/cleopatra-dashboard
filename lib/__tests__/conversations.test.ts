/**
 * FE-005 - a creator tab that was not the active one receives no realtime
 * events, so switching back has to make it current without a page reload.
 */

import { describe, expect, it } from 'vitest'
import type { ConversationSummary } from '../../types'
import {
  CONVERSATION_FRESHNESS_MS,
  conversationsAreStale,
  mergeConversationSummaries,
} from '../conversations'

function summary(
  id: string,
  time: string,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    fan: {
      id,
      display_name: id,
      total_spent: 0,
      spend_tier: 'cold',
      last_active: null,
      preferences: [],
      notes: '',
      age: '',
      payday: '',
      hobbies: '',
      relationship_status: '',
    },
    last_message: `message at ${time}`,
    last_message_time: time,
    unread: false,
    unread_count: 0,
    ...overrides,
  }
}

describe('conversationsAreStale', () => {
  it('treats a list we have never read as stale', () => {
    expect(conversationsAreStale(undefined)).toBe(true)
  })

  it('trusts a list read a moment ago', () => {
    const now = 1_000_000
    expect(conversationsAreStale(now - 1_000, now)).toBe(false)
  })

  it('distrusts a list read before the freshness window', () => {
    const now = 1_000_000
    expect(
      conversationsAreStale(now - CONVERSATION_FRESHNESS_MS - 1, now),
    ).toBe(true)
  })

  it('distrusts a list read twenty minutes ago', () => {
    // The exact case the audit describes: an operator working creator A while
    // creator B's tab sits blind.
    const now = 1_000_000
    expect(conversationsAreStale(now - 20 * 60_000, now)).toBe(true)
  })
})

describe('mergeConversationSummaries', () => {
  it('marks a conversation unread when its last message moved on', () => {
    const previous = [summary('fan-1', '2026-01-01T10:00:00.000Z')]
    const fresh = [summary('fan-1', '2026-01-01T10:20:00.000Z')]

    const merged = mergeConversationSummaries(previous, fresh)

    expect(merged[0].unread).toBe(true)
    expect(merged[0].unread_count).toBe(1)
    expect(merged[0].last_message).toBe('message at 2026-01-01T10:20:00.000Z')
  })

  it('preserves unread state on a conversation that has not changed', () => {
    // A plain replace would have cleared this: the summaries view carries no
    // unread flag, so unread is entirely client state.
    const previous = [
      summary('fan-1', '2026-01-01T10:00:00.000Z', { unread: true, unread_count: 3 }),
    ]
    const fresh = [summary('fan-1', '2026-01-01T10:00:00.000Z')]

    const merged = mergeConversationSummaries(previous, fresh)

    expect(merged[0].unread).toBe(true)
    expect(merged[0].unread_count).toBe(3)
  })

  it('adds to an existing unread count rather than resetting it', () => {
    const previous = [
      summary('fan-1', '2026-01-01T10:00:00.000Z', { unread: true, unread_count: 2 }),
    ]
    const fresh = [summary('fan-1', '2026-01-01T11:00:00.000Z')]

    expect(mergeConversationSummaries(previous, fresh)[0].unread_count).toBe(3)
  })

  it('treats a conversation we have never seen as new and unread', () => {
    const merged = mergeConversationSummaries(
      [],
      [summary('fan-new', '2026-01-01T10:00:00.000Z')],
    )

    expect(merged[0].unread).toBe(true)
    expect(merged[0].unread_count).toBe(1)
  })

  it('never marks the open conversation unread', () => {
    const previous = [summary('fan-1', '2026-01-01T10:00:00.000Z')]
    const fresh = [summary('fan-1', '2026-01-01T10:20:00.000Z')]

    const merged = mergeConversationSummaries(previous, fresh, 'fan-1')

    expect(merged[0].unread).toBe(false)
    expect(merged[0].unread_count).toBe(0)
    // ...but it still gets the fresh content.
    expect(merged[0].last_message_time).toBe('2026-01-01T10:20:00.000Z')
  })

  it('drops a conversation that is no longer in the fresh read', () => {
    const merged = mergeConversationSummaries(
      [summary('gone', '2026-01-01T10:00:00.000Z')],
      [summary('fan-1', '2026-01-01T10:00:00.000Z')],
    )

    expect(merged.map(row => row.fan.id)).toEqual(['fan-1'])
  })

  it('takes its ordering from the fresh read', () => {
    const previous = [
      summary('fan-1', '2026-01-01T10:00:00.000Z'),
      summary('fan-2', '2026-01-01T09:00:00.000Z'),
    ]
    const fresh = [
      summary('fan-2', '2026-01-01T12:00:00.000Z'),
      summary('fan-1', '2026-01-01T10:00:00.000Z'),
    ]

    expect(mergeConversationSummaries(previous, fresh).map(row => row.fan.id))
      .toEqual(['fan-2', 'fan-1'])
  })

  it('takes the fresh fan profile', () => {
    const previous = [summary('fan-1', '2026-01-01T10:00:00.000Z')]
    const fresh = [summary('fan-1', '2026-01-01T10:00:00.000Z')]
    fresh[0].fan.display_name = 'Renamed'
    fresh[0].fan.spend_tier = 'whale'

    const merged = mergeConversationSummaries(previous, fresh)

    expect(merged[0].fan.display_name).toBe('Renamed')
    expect(merged[0].fan.spend_tier).toBe('whale')
  })

  it('survives an unparseable timestamp without inventing an unread', () => {
    const previous = [summary('fan-1', 'not a date')]
    const fresh = [summary('fan-1', 'still not a date')]

    expect(mergeConversationSummaries(previous, fresh)[0].unread).toBe(false)
  })
})
