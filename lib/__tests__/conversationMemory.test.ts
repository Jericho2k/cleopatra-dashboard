/**
 * What an operator is told about what the conversation remembers.
 *
 * Every record in this panel is given to the AI on each reply. That is the
 * reason the panel exists and the reason its presentation matters: a wrong
 * record keeps being used, and surfaces as the model behaving strangely for
 * reasons nobody can trace. Until this view there was no way to see that an
 * obligation was being carried at all, let alone that it was wrong.
 *
 * The two mistakes guarded against are the ones lib/contentAccess.ts guards
 * against, in a new place: presenting a guess as a fact, and offering a
 * control the backend would refuse.
 */

import { describe, expect, it } from 'vitest'

import {
  controlsFor,
  describeEpisode,
  describeKind,
  describeSource,
  needsAttention,
  summarizeMemory,
  type ConversationMemory,
  type MemoryEpisode,
  type MemoryThread,
} from '../conversationMemory'

function thread(overrides: Partial<MemoryThread> = {}): MemoryThread {
  return {
    id: 'thread-1',
    kind: 'question',
    raised_by: 'fan',
    summary: 'whether she ever gets to chicago',
    resolution_condition: '',
    status: 'open',
    evidence_type: 'stated',
    confidence: 1,
    source_turn_id: 'turn-7',
    source_message_fingerprint: 'fp-7',
    first_seen_at: '2026-09-17T12:00:00+00:00',
    last_seen_at: '2026-09-17T12:00:00+00:00',
    expires_at: null,
    was_read_rather_than_said: false,
    waiting_on_us: true,
    ...overrides,
  }
}

function memory(overrides: Partial<ConversationMemory> = {}): ConversationMemory {
  const threads = overrides.open_threads ?? [thread()]
  return {
    creator_id: 'creator-1',
    fan_id: 'fan-1',
    open_threads: threads,
    episodes: [],
    carrying_anything: threads.length > 0,
    ...overrides,
  }
}

describe('summarizeMemory', () => {
  it('shows a loading state rather than an all-clear before it arrives', () => {
    // "Carrying nothing" and "not read yet" lead an operator to different
    // actions, so they must not render the same.
    expect(summarizeMemory(null)).toBeNull()
    expect(summarizeMemory(undefined)).toBeNull()
  })

  it('says plainly when nothing is being carried', () => {
    const summary = summarizeMemory(
      memory({ open_threads: [], carrying_anything: false }),
    )

    expect(summary?.headline).toContain('Nothing')
    expect(summary?.attention).toBe(0)
  })

  it('separates what is waiting on us from what is waiting on him', () => {
    // Answering the wrong one is a named failure, so the split is in the
    // summary rather than something an operator has to count.
    const summary = summarizeMemory(
      memory({
        open_threads: [
          thread({ id: 'a', waiting_on_us: true }),
          thread({ id: 'b', waiting_on_us: true }),
          thread({ id: 'c', waiting_on_us: false }),
        ],
      }),
    )

    expect(summary?.headline).toBe('3 things are being carried forward')
    expect(summary?.detail).toContain('2 waiting on us')
    expect(summary?.detail).toContain('1 waiting on him')
  })

  it('says why a wrong record matters', () => {
    // The operator has to know these are fed to the model every turn, or the
    // panel reads as trivia.
    expect(summarizeMemory(memory())?.detail).toContain('given to the AI on each')
  })

  it('counts the records worth checking before trusting the rest', () => {
    const summary = summarizeMemory(
      memory({
        open_threads: [
          thread({ id: 'a' }),
          thread({ id: 'b', was_read_rather_than_said: true, confidence: 0.3 }),
        ],
      }),
    )

    expect(summary?.attention).toBe(1)
  })
})

describe('describeSource', () => {
  it('tells something the customer said from something the system read', () => {
    // Only the second can be wrong about what happened, and that is the whole
    // question an operator is answering.
    expect(describeSource(thread({ raised_by: 'fan' }))).toBe('He said this')
    expect(
      describeSource(thread({ was_read_rather_than_said: true, confidence: 0.9 })),
    ).toContain('Read out of the conversation')
  })

  it('says when something was read and not clearly', () => {
    const line = describeSource(
      thread({ was_read_rather_than_said: true, confidence: 0.3 }),
    )

    expect(line).toContain('not clearly')
  })

  it('does not put a confidence number beside every line', () => {
    // "0.92" on every record trains people to ignore the ones that say 0.3.
    expect(describeSource(thread({ confidence: 0.92 }))).not.toContain('0.92')
  })

  it('names an operator correction as the operator’s own', () => {
    expect(describeSource(thread({ evidence_type: 'operator' }))).toBe(
      'You recorded this',
    )
  })

  it('tells the creator’s own words from the customer’s', () => {
    expect(describeSource(thread({ raised_by: 'creator' }))).toBe('She said this')
  })
})

describe('needsAttention', () => {
  it('flags what was read out of the conversation and not clearly', () => {
    // The case this panel exists for: fed to the model every turn, and nobody
    // has ever looked at it.
    expect(
      needsAttention(thread({ was_read_rather_than_said: true, confidence: 0.4 })),
    ).toBe(true)
  })

  it('does not flag something the customer stated outright', () => {
    expect(needsAttention(thread({ confidence: 1 }))).toBe(false)
  })

  it('does not flag a confident reading', () => {
    expect(
      needsAttention(thread({ was_read_rather_than_said: true, confidence: 0.95 })),
    ).toBe(false)
  })
})

describe('controlsFor', () => {
  it('offers all three on an open record', () => {
    expect(controlsFor(thread())).toEqual({
      canResolve: true,
      canCancel: true,
      canCorrect: true,
    })
  })

  it('offers nothing on a closed one', () => {
    // Showing a button the backend would refuse teaches an operator to click
    // and read an error.
    for (const status of ['fulfilled', 'cancelled', 'superseded'] as const) {
      expect(controlsFor(thread({ status }))).toEqual({
        canResolve: false,
        canCancel: false,
        canCorrect: false,
      })
    }
  })

  it('has no delete, matching the backend', () => {
    // A record somebody disagrees with is resolved or corrected, both of which
    // say what happened. A deleted one leaves the next reader wondering
    // whether it was ever there.
    expect(Object.keys(controlsFor(thread()))).not.toContain('canDelete')
  })
})

describe('describeKind', () => {
  it('names each kind in an operator’s words', () => {
    expect(describeKind('question')).toBe('Unanswered question')
    expect(describeKind('correction')).toBe('He corrected us')
    expect(describeKind('deferred_topic')).toBe('Put off until later')
  })

  it('falls back rather than rendering a raw enum', () => {
    expect(describeKind('something_new' as never)).toBe('Carried')
  })
})

describe('describeEpisode', () => {
  function episode(overrides: Partial<MemoryEpisode> = {}): MemoryEpisode {
    return {
      id: 'ep-1',
      summary: 'an evening about his sister’s wedding',
      ended_with: 'went_quiet',
      first_message_at: '2026-09-10T09:00:00+00:00',
      last_message_at: '2026-09-10T11:00:00+00:00',
      message_count: 6,
      evidence_type: 'inferred',
      was_read_rather_than_said: true,
      ...overrides,
    }
  }

  it('reads as one line with when and how it ended', () => {
    const line = describeEpisode(episode())

    expect(line).toContain('2026-09-10')
    expect(line).toContain('wedding')
    expect(line).toContain('he went quiet')
    expect(line).not.toContain('\n')
  })

  it('says nothing about an ending it does not know', () => {
    expect(describeEpisode(episode({ ended_with: 'unknown' }))).not.toContain('(')
  })

  it('tolerates an episode with no timestamps', () => {
    const line = describeEpisode(
      episode({ first_message_at: null, last_message_at: null }),
    )

    expect(line).toContain('wedding')
  })
})
