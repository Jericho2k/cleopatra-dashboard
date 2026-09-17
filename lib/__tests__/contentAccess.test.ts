/**
 * What an operator is told when a customer cannot open what they bought.
 *
 * The two mistakes this guards against are the dashboard halves of
 * docs/autonomy_architecture_review.md §3B. Offering a repair the backend would
 * refuse trains an operator to click through errors, which is how "I can't open
 * it" became an opening for another sale. And reporting "we could not check" as
 * "nothing is wrong" hands them a false all-clear, which is the same failure the
 * review objects to in the conversation itself.
 */

import { describe, expect, it } from 'vitest'

import {
  describePaidItem,
  summarizeContentAccess,
  type ContentAccessEvidence,
  type PaidItem,
} from '../contentAccess'

function item(overrides: Partial<PaidItem> = {}): PaidItem {
  return {
    reference: 'ref-1',
    media_ids: ['m1', 'm2'],
    price_cents: 2500,
    platform_message_id: 'platform-1',
    purchased_at: '2026-09-16T10:00:00+00:00',
    platform_state: 'visible',
    platform_detail: '',
    ...overrides,
  }
}

function evidence(
  overrides: Partial<ContentAccessEvidence> = {},
): ContentAccessEvidence {
  const paid = overrides.paid_items ?? [item()]
  return {
    fan_id: 'fan-1',
    creator_id: 'creator-1',
    frozen: true,
    review_reason: 'content_access_issue',
    paid_items: paid,
    repairable_count: paid.length,
    platform_error: '',
    has_paid_content: paid.length > 0,
    ...overrides,
  }
}

describe('summarizeContentAccess', () => {
  it('shows a loading state rather than a verdict before the evidence arrives', () => {
    expect(summarizeContentAccess(null)).toBeNull()
    expect(summarizeContentAccess(undefined)).toBeNull()
  })

  it('never offers a resend when nothing was bought', () => {
    const summary = summarizeContentAccess(
      evidence({ paid_items: [], repairable_count: 0, has_paid_content: false }),
    )

    expect(summary?.canResend).toBe(false)
    expect(summary?.headline).toContain('no confirmed purchase')
  })

  it('says the paid message is gone when the platform no longer lists it', () => {
    const summary = summarizeContentAccess(
      evidence({ paid_items: [item({ platform_state: 'message_not_visible' })] }),
    )

    expect(summary?.headline).toContain('no longer on the platform')
    expect(summary?.canResend).toBe(true)
    expect(summary?.uncertain).toBe(false)
  })

  it('tells a missing message apart from one that lost its media', () => {
    const summary = summarizeContentAccess(
      evidence({ paid_items: [item({ platform_state: 'media_not_visible' })] }),
    )

    expect(summary?.headline).toContain('lost its media')
    expect(summary?.canResend).toBe(true)
  })

  it('marks an unreachable platform as uncertain, not as fine', () => {
    const summary = summarizeContentAccess(
      evidence({ platform_error: 'could not read the conversation: provider down' }),
    )

    expect(summary?.uncertain).toBe(true)
    expect(summary?.detail).toContain('provider down')
    // The purchase is still confirmed, so a free copy is still a valid answer.
    expect(summary?.canResend).toBe(true)
  })

  it('marks an unchecked older purchase as uncertain', () => {
    const summary = summarizeContentAccess(
      evidence({ paid_items: [item({ platform_state: 'unknown' })] }),
    )

    expect(summary?.uncertain).toBe(true)
    expect(summary?.headline).toContain('not checked')
  })

  it('says so plainly when the content still looks intact', () => {
    const summary = summarizeContentAccess(evidence())

    expect(summary?.headline).toContain('still looks intact')
    expect(summary?.uncertain).toBe(false)
    // Offered anyway: a free copy of something already paid for cannot
    // double-charge, and it rules out a rendering problem.
    expect(summary?.canResend).toBe(true)
  })

  it('never offers a resend the backend would refuse for lack of media', () => {
    const summary = summarizeContentAccess(
      evidence({
        paid_items: [item({ media_ids: [], platform_state: 'message_not_visible' })],
        repairable_count: 0,
      }),
    )

    expect(summary?.canResend).toBe(false)
  })
})

describe('describePaidItem', () => {
  it('names the amount, how much was in it, and when', () => {
    expect(describePaidItem(item())).toBe('$25 · 2 items · bought 2026-09-16')
  })

  it('renders a non-round amount without losing cents', () => {
    expect(describePaidItem(item({ price_cents: 1999, media_ids: ['m1'] }))).toBe(
      '$19.99 · 1 item · bought 2026-09-16',
    )
  })

  it('says the date is unknown rather than printing a blank', () => {
    expect(describePaidItem(item({ purchased_at: '' }))).toContain('date unknown')
  })
})
