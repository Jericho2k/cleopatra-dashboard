/**
 * A writer failure is not a decision.
 *
 * The simulator displayed "Full Auto decided to send nothing this turn."
 * whenever no creator message came back and the analyzer had not reported
 * itself degraded. During the 2026-09 writer outage — every configured writer
 * model failing, nothing sent — that sentence told the owner the product was
 * working as intended. These tests hold the three cases apart.
 */

import { describe, expect, it } from 'vitest'

import {
  turnOutcome,
  turnOutcomeMessage,
  type SimulatedTurn,
} from '../simulation'

function turn(overrides: Partial<SimulatedTurn> = {}): SimulatedTurn {
  return {
    status: 'ok',
    simulation: true,
    fan_message_id: 'msg-1',
    creator_messages: [],
    analysis_degraded: false,
    ...overrides,
  }
}

const reply = {
  id: 'msg-2',
  role: 'creator' as const,
  content: 'hey you',
  sent_at: null,
}

describe('turnOutcome', () => {
  it('uses the outcome the backend reported', () => {
    expect(turnOutcome(turn({ outcome: 'writer_failed' }))).toBe('writer_failed')
    expect(turnOutcome(turn({ outcome: 'no_send' }))).toBe('no_send')
    expect(turnOutcome(turn({ outcome: 'analyzer_degraded' }))).toBe(
      'analyzer_degraded',
    )
  })

  it('never invents a failure a backend without the field did not report', () => {
    // An older backend sends no `outcome`. The fallback must reproduce the old
    // behaviour exactly, not guess that the writer broke.
    expect(turnOutcome(turn())).toBe('no_send')
    expect(turnOutcome(turn({ analysis_degraded: true }))).toBe(
      'analyzer_degraded',
    )
    expect(turnOutcome(turn({ creator_messages: [reply] }))).toBe('replied')
  })
})

describe('turnOutcomeMessage', () => {
  it('states a writer failure as a failure', () => {
    const message = turnOutcomeMessage(turn({ outcome: 'writer_failed' }))

    expect(message).toContain('Writer generation failed')
    expect(message).toContain('no message was sent')
    // The one sentence that must never appear for a broken writer.
    expect(message).not.toContain('decided to send nothing')
  })

  it('keeps the decision wording for a legitimate no-send', () => {
    expect(turnOutcomeMessage(turn({ outcome: 'no_send' }))).toBe(
      'Full Auto decided to send nothing this turn.',
    )
  })

  it('keeps the degraded-analyzer wording distinct from both', () => {
    const message = turnOutcomeMessage(turn({ outcome: 'analyzer_degraded' }))

    expect(message).toContain('situation analyzer was degraded')
    expect(message).not.toContain('Writer generation failed')
  })

  it('says nothing at all when the turn replied', () => {
    expect(
      turnOutcomeMessage(turn({ outcome: 'replied', creator_messages: [reply] })),
    ).toBe('')
  })

  it('gives every outcome its own distinct message', () => {
    const messages = (
      [
        'no_send',
        'analyzer_degraded',
        'writer_failed',
        'owner_failed',
        'stale_generation',
        'approval_required',
        'human_review',
      ] as const
    ).map(outcome => turnOutcomeMessage(turn({ outcome })))

    expect(new Set(messages).size).toBe(messages.length)
    expect(messages.every(message => message.length > 0)).toBe(true)
  })
})
