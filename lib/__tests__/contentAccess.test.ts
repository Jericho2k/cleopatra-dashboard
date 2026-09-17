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
  initialSelection,
  repairOffer,
  summarizeContentAccess,
  type ContentAccessEvidence,
  type PaidItem,
  type RepairState,
} from '../contentAccess'

function repair(overrides: Partial<RepairState> = {}): RepairState {
  const status = overrides.status ?? 'confirmed'
  return {
    id: 'repair-1',
    reference: 'ref-1',
    review_case_id: 'case-1',
    status,
    media_ids: ['m1', 'm2'],
    platform_message_id: 'platform-resend-1',
    claimed_by: 'operator-7',
    detail: '',
    claimed_at: '2026-09-17T10:00:00+00:00',
    resolved_at: '2026-09-17T10:00:01+00:00',
    settled: status === 'confirmed' || status === 'failed',
    needs_operator_decision: status === 'unknown',
    ...overrides,
  }
}

function item(overrides: Partial<PaidItem> = {}): PaidItem {
  return {
    reference: 'ref-1',
    media_ids: ['m1', 'm2'],
    price_cents: 2500,
    platform_message_id: 'platform-1',
    purchased_at: '2026-09-16T10:00:00+00:00',
    platform_state: 'visible',
    platform_detail: '',
    repair: null,
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
    review_case_id: 'case-1',
    paid_items: paid,
    repairable_count: paid.length,
    platform_error: '',
    has_paid_content: paid.length > 0,
    selection_required: paid.filter(entry => entry.media_ids.length > 0).length > 1,
    repairs: [],
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


/**
 * Choosing WHICH purchase, and seeing what already happened to it.
 *
 * The backend used to answer an unqualified resend with the most recent
 * purchase. A complaint about an older item therefore resent a newer one: the
 * customer received a second copy of something that was working, still could
 * not open what they wrote in about, and the hold was cleared as though it had
 * been repaired. The backend now refuses; these are the panel's half.
 */
describe('choosing which purchase to repair', () => {
  const two = [item({ reference: 'ref-1' }), item({ reference: 'ref-2' })]

  it('selects nothing when more than one purchase could be the one they mean', () => {
    // A pre-selected default is the same mistake in a nicer coat: the operator
    // confirms a choice that was made for them.
    expect(initialSelection(evidence({ paid_items: two }))).toBe('')
  })

  it('selects the only repairable purchase when there is nothing to choose', () => {
    expect(initialSelection(evidence())).toBe('ref-1')
  })

  it('does not select a purchase that records no media', () => {
    const unusable = evidence({
      paid_items: [item({ media_ids: [] })],
      repairable_count: 0,
    })
    expect(initialSelection(unusable)).toBe('')
  })

  it('selects nothing before the evidence arrives', () => {
    expect(initialSelection(null)).toBe('')
    expect(initialSelection(undefined)).toBe('')
  })

  it('tells the panel a selection is required', () => {
    expect(summarizeContentAccess(evidence({ paid_items: two }))?.selectionRequired)
      .toBe(true)
    expect(summarizeContentAccess(evidence())?.selectionRequired).toBe(false)
  })

  it('never requires a selection when there is nothing to resend', () => {
    const summary = summarizeContentAccess(
      evidence({ paid_items: [], repairable_count: 0, has_paid_content: false }),
    )
    expect(summary?.selectionRequired).toBe(false)
    expect(summary?.canResend).toBe(false)
  })
})

describe('repairOffer', () => {
  it('offers a resend for a purchase nothing has happened to', () => {
    const offer = repairOffer(item())
    expect(offer.canResend).toBe(true)
    expect(offer.note).toBe('')
  })

  it('refuses a purchase that records no media', () => {
    expect(repairOffer(item({ media_ids: [] })).canResend).toBe(false)
  })

  it('will not offer a second copy of something already resent', () => {
    const offer = repairOffer(item({ repair: repair({ status: 'confirmed' }) }))
    expect(offer.canResend).toBe(false)
    expect(offer.note).toContain('second copy')
    expect(offer.needsDecision).toBe(false)
  })

  it('will not start a second resend while one is in flight', () => {
    // Two operators pressing this is how two copies used to go out.
    const offer = repairOffer(item({ repair: repair({ status: 'claimed' }) }))
    expect(offer.canResend).toBe(false)
    expect(offer.note).toContain('in progress')
  })

  it('puts an unprovable outcome to the operator instead of hiding it', () => {
    // The one state where resending again has a real cost, so it is a decision
    // and not a disabled button with no explanation.
    const offer = repairOffer(item({ repair: repair({ status: 'unknown' }) }))
    expect(offer.canResend).toBe(false)
    expect(offer.needsDecision).toBe(true)
    expect(offer.note).toContain('not known whether they received it')
  })

  it('reopens a purchase whose attempt provably sent nothing', () => {
    const offer = repairOffer(
      item({ repair: repair({ status: 'failed', detail: 'route missing' }) }),
    )
    expect(offer.canResend).toBe(true)
    expect(offer.note).toContain('Nothing reached them')
    expect(offer.note).toContain('route missing')
  })

  it('judges each purchase on its own repair, not on the customer\'s', () => {
    const done = item({ reference: 'ref-1', repair: repair({ status: 'confirmed' }) })
    const untouched = item({ reference: 'ref-2' })
    expect(repairOffer(done).canResend).toBe(false)
    expect(repairOffer(untouched).canResend).toBe(true)
  })
})
