/**
 * The duplicate semantics dedupeMessages has to preserve.
 *
 * These were written BEFORE replacing the O(n²) implementation, against the
 * original, so the rewrite is measured against real behaviour rather than
 * against a description of it. Every case below distinguishes two situations
 * that look similar and must not be collapsed.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_RETAINED_MESSAGES,
  capRetainedMessages,
  dedupeMessages,
} from '../messages'
import type { Message } from '../../types'

function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    fansly_message_id: null,
    fan_id: 'fan-1',
    creator_id: 'creator-1',
    role: 'fan',
    content: 'hey',
    sent_at: '2026-01-01T00:00:00.000Z',
    was_ai_suggested: false,
    was_selected: false,
    media_context: null,
    ...overrides,
  }
}

describe('dedupeMessages', () => {
  it('keeps a single message untouched', () => {
    const rows = [message({ id: 'a' })]
    expect(dedupeMessages(rows)).toEqual(rows)
  })

  it('collapses an exact local id duplicate', () => {
    const result = dedupeMessages([
      message({ id: 'a' }),
      message({ id: 'a' }),
    ])
    expect(result).toHaveLength(1)
  })

  it('collapses two rows carrying the same platform message id', () => {
    const result = dedupeMessages([
      message({ id: 'a', fansly_message_id: 'f-1' }),
      message({ id: 'b', fansly_message_id: 'f-1' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].fansly_message_id).toBe('f-1')
  })

  it('reconciles an optimistic local row with its imported platform row', () => {
    const result = dedupeMessages([
      message({ id: 'local', role: 'creator', content: 'on my way' }),
      message({
        id: 'imported',
        fansly_message_id: 'f-9',
        role: 'creator',
        content: 'on my way',
        sent_at: '2026-01-01T00:00:03.000Z',
      }),
    ])

    expect(result).toHaveLength(1)
    // The richer reconciled row wins: it carries the platform identity.
    expect(result[0].fansly_message_id).toBe('f-9')
    expect(result[0].id).toBe('imported')
  })

  it('keeps a reconciled row that arrives before its local row', () => {
    const result = dedupeMessages([
      message({
        id: 'imported',
        fansly_message_id: 'f-9',
        role: 'creator',
        content: 'on my way',
      }),
      message({
        id: 'local',
        role: 'creator',
        content: 'on my way',
        sent_at: '2026-01-01T00:00:03.000Z',
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].fansly_message_id).toBe('f-9')
  })

  it('preserves media_context when the reconciled row lacks it', () => {
    const result = dedupeMessages([
      message({
        id: 'local',
        role: 'creator',
        content: 'unlocked',
        media_context: { ppv: { media_id: 'm-1' } },
      }),
      message({
        id: 'imported',
        fansly_message_id: 'f-9',
        role: 'creator',
        content: 'unlocked',
        sent_at: '2026-01-01T00:00:02.000Z',
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].media_context).toEqual({ ppv: { media_id: 'm-1' } })
  })

  it('does NOT collapse two independent messages with the same text', () => {
    // Someone typing "hey" twice is two messages, not one.
    const result = dedupeMessages([
      message({ id: 'a', content: 'hey' }),
      message({ id: 'b', content: 'hey' }),
    ])
    expect(result).toHaveLength(2)
  })

  it('does NOT collapse two rows that both lack a platform id', () => {
    const result = dedupeMessages([
      message({ id: 'a', content: 'hey', sent_at: '2026-01-01T00:00:00.000Z' }),
      message({ id: 'b', content: 'hey', sent_at: '2026-01-01T00:00:01.000Z' }),
    ])
    expect(result).toHaveLength(2)
  })

  it('does NOT collapse two distinct Fansly messages with the same text', () => {
    const result = dedupeMessages([
      message({ id: 'a', fansly_message_id: 'f-1', content: 'hey' }),
      message({
        id: 'b',
        fansly_message_id: 'f-2',
        content: 'hey',
        sent_at: '2026-01-01T00:00:01.000Z',
      }),
    ])
    expect(result).toHaveLength(2)
  })

  it('does not reconcile across the 15 second window', () => {
    const result = dedupeMessages([
      message({ id: 'local', content: 'hey', sent_at: '2026-01-01T00:00:00.000Z' }),
      message({
        id: 'imported',
        fansly_message_id: 'f-1',
        content: 'hey',
        sent_at: '2026-01-01T00:00:20.000Z',
      }),
    ])
    expect(result).toHaveLength(2)
  })

  it('reconciles just inside the 15 second window', () => {
    const result = dedupeMessages([
      message({ id: 'local', content: 'hey', sent_at: '2026-01-01T00:00:00.000Z' }),
      message({
        id: 'imported',
        fansly_message_id: 'f-1',
        content: 'hey',
        sent_at: '2026-01-01T00:00:14.000Z',
      }),
    ])
    expect(result).toHaveLength(1)
  })

  it('normalises whitespace when comparing content', () => {
    const result = dedupeMessages([
      message({ id: 'local', content: '  hey   you  ' }),
      message({
        id: 'imported',
        fansly_message_id: 'f-1',
        content: 'hey you',
        sent_at: '2026-01-01T00:00:02.000Z',
      }),
    ])
    expect(result).toHaveLength(1)
  })

  it('does NOT reconcile across roles', () => {
    const result = dedupeMessages([
      message({ id: 'a', role: 'fan', content: 'hey' }),
      message({
        id: 'b',
        role: 'creator',
        fansly_message_id: 'f-1',
        content: 'hey',
        sent_at: '2026-01-01T00:00:02.000Z',
      }),
    ])
    expect(result).toHaveLength(2)
  })

  it('does NOT reconcile across fans', () => {
    const result = dedupeMessages([
      message({ id: 'a', fan_id: 'fan-1', content: 'hey' }),
      message({
        id: 'b',
        fan_id: 'fan-2',
        fansly_message_id: 'f-1',
        content: 'hey',
        sent_at: '2026-01-01T00:00:02.000Z',
      }),
    ])
    expect(result).toHaveLength(2)
  })

  it('does NOT reconcile across creators', () => {
    const result = dedupeMessages([
      message({ id: 'a', creator_id: 'creator-1', content: 'hey' }),
      message({
        id: 'b',
        creator_id: 'creator-2',
        fansly_message_id: 'f-1',
        content: 'hey',
        sent_at: '2026-01-01T00:00:02.000Z',
      }),
    ])
    expect(result).toHaveLength(2)
  })

  it('preserves arrival order', () => {
    const result = dedupeMessages([
      message({ id: 'a', content: 'one' }),
      message({ id: 'b', content: 'two' }),
      message({ id: 'c', content: 'three' }),
    ])
    expect(result.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the position of the row it reconciles into', () => {
    const result = dedupeMessages([
      message({ id: 'a', content: 'one' }),
      message({ id: 'local', role: 'creator', content: 'two' }),
      message({ id: 'c', content: 'three' }),
      message({
        id: 'imported',
        role: 'creator',
        fansly_message_id: 'f-2',
        content: 'two',
        sent_at: '2026-01-01T00:00:05.000Z',
      }),
    ])

    expect(result).toHaveLength(3)
    expect(result[1].fansly_message_id).toBe('f-2')
    expect(result.map(row => row.content)).toEqual(['one', 'two', 'three'])
  })

  it('handles an empty list', () => {
    expect(dedupeMessages([])).toEqual([])
  })

  it('collapses a three-way duplicate down to one', () => {
    const result = dedupeMessages([
      message({ id: 'a', fansly_message_id: 'f-1' }),
      message({ id: 'b', fansly_message_id: 'f-1' }),
      message({ id: 'a', fansly_message_id: 'f-1' }),
    ])
    expect(result).toHaveLength(1)
  })
})

describe('capRetainedMessages', () => {
  const thread = (count: number) =>
    Array.from({ length: count }, (_unused, index) =>
      message({
        id: `msg-${index}`,
        content: `message ${index}`,
        sent_at: new Date(1767225600000 + index * 60_000).toISOString(),
      }),
    )

  it('leaves a normal conversation alone', () => {
    const rows = thread(200)
    expect(capRetainedMessages(rows)).toBe(rows)
  })

  it('keeps the newest messages when the window overflows', () => {
    const capped = capRetainedMessages(thread(1200))

    expect(capped).toHaveLength(MAX_RETAINED_MESSAGES)
    // The live end of the conversation is what an operator is working in.
    expect(capped[capped.length - 1].id).toBe('msg-1199')
    expect(capped[0].id).toBe('msg-200')
  })

  it('respects an explicit limit', () => {
    expect(capRetainedMessages(thread(100), 10)).toHaveLength(10)
  })

  it('preserves order', () => {
    const capped = capRetainedMessages(thread(1500))
    const times = capped.map(row => Date.parse(row.sent_at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})
