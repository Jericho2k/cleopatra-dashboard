/**
 * What an operator is told when a customer cannot reach what they paid for.
 *
 * The backend answers this from evidence rather than from the complaint: the
 * delivery ledger says whether money arrived, and a read of the conversation
 * says what the platform currently shows for the message it arrived in. Turning
 * that pair into a sentence is a product decision, so it lives here and not in
 * the endpoint — the same split as lib/health.ts.
 *
 * Two rules this file exists to keep:
 *
 * 1. **Never offer a repair the backend would refuse.** A resend is only valid
 *    against a confirmed purchase. Showing the button otherwise trains an
 *    operator to click it and read an error, which is how "I can't open it"
 *    became an opening for another sale in the first place.
 *
 * 2. **Never turn "we could not check" into "nothing is wrong."** An
 *    unreachable platform, a conversation page that did not reach back far
 *    enough, and a message the platform genuinely no longer lists are three
 *    different answers, and an operator acts differently on each.
 */

export type PaidItemState =
  | 'visible'
  | 'message_not_visible'
  | 'media_not_visible'
  | 'unknown'

export type PaidItem = {
  reference: string
  media_ids: string[]
  price_cents: number
  platform_message_id: string
  purchased_at: string
  platform_state: PaidItemState
  platform_detail: string
}

export type ContentAccessEvidence = {
  fan_id: string
  creator_id: string
  frozen: boolean
  review_reason: string
  paid_items: PaidItem[]
  repairable_count: number
  platform_error: string
  has_paid_content: boolean
}

export type ContentAccessSummary = {
  /** The one line at the top of the panel. */
  headline: string
  /** What the evidence actually supports doing. */
  detail: string
  /** Whether "Resend the paid item" should be offered at all. */
  canResend: boolean
  /** True when the platform side is unknown, not when it is fine. */
  uncertain: boolean
}

function dollars(cents: number): string {
  const value = (cents || 0) / 100
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

/**
 * Read the evidence into the sentence an operator acts on.
 *
 * `null` evidence means it has not loaded yet, which is deliberately not the
 * same as "no paid content": the caller shows a loading state rather than a
 * verdict.
 */
export function summarizeContentAccess(
  evidence: ContentAccessEvidence | null | undefined,
): ContentAccessSummary | null {
  if (!evidence) return null

  if (!evidence.has_paid_content) {
    return {
      headline: 'This customer has no confirmed purchase on record',
      detail:
        'Nothing in the delivery ledger shows they paid for content, so there ' +
        'is nothing to resend. Check the conversation: they may be describing ' +
        'something they were shown rather than something they bought.',
      canResend: false,
      uncertain: false,
    }
  }

  const items = evidence.paid_items
  const newest = items[0]
  const gone = items.filter(item => item.platform_state === 'message_not_visible')
  const brokenMedia = items.filter(
    item => item.platform_state === 'media_not_visible',
  )
  const unchecked = items.filter(item => item.platform_state === 'unknown')

  if (evidence.platform_error) {
    return {
      headline: `Paid ${dollars(newest.price_cents)} — platform state unknown`,
      detail:
        `${evidence.platform_error}. The purchase itself is confirmed, so a ` +
        'resend is safe and free, but nothing here tells you whether the ' +
        'original is still on the platform.',
      canResend: evidence.repairable_count > 0,
      uncertain: true,
    }
  }

  if (gone.length > 0) {
    return {
      headline: 'The paid message is no longer on the platform',
      detail:
        `They paid ${dollars(gone[0].price_cents)} and the platform no longer ` +
        'lists the message it was delivered in. Resending sends the same media ' +
        'again at no charge.',
      canResend: evidence.repairable_count > 0,
      uncertain: false,
    }
  }

  if (brokenMedia.length > 0) {
    return {
      headline: 'The paid message lost its media',
      detail:
        `They paid ${dollars(brokenMedia[0].price_cents)} and the message is ` +
        'still there, but the platform will not return the content attached to ' +
        'it. Resending sends the same media again at no charge.',
      canResend: evidence.repairable_count > 0,
      uncertain: false,
    }
  }

  if (unchecked.length === items.length) {
    return {
      headline: `Paid ${dollars(newest.price_cents)} — not checked`,
      detail:
        'The purchase is confirmed, but it is older than the most recent page ' +
        'of this conversation, so its current state on the platform was not ' +
        'checked. A resend is still safe and free.',
      canResend: evidence.repairable_count > 0,
      uncertain: true,
    }
  }

  return {
    headline: 'The paid content still looks intact on the platform',
    detail:
      `They paid ${dollars(newest.price_cents)} and the platform still shows ` +
      'the message and its media. This may be something their app is failing ' +
      'to render. Resending a free copy is harmless if you want to rule that ' +
      'out.',
    canResend: evidence.repairable_count > 0,
    uncertain: false,
  }
}

/** The label under each paid item in the panel. */
export function describePaidItem(item: PaidItem): string {
  const when = item.purchased_at ? item.purchased_at.slice(0, 10) : 'date unknown'
  const count = item.media_ids.length
  const pieces = count === 1 ? '1 item' : `${count} items`
  return `${dollars(item.price_cents)} · ${pieces} · bought ${when}`
}
