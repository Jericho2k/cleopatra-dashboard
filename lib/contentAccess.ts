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
  /** The repair already attempted for THIS purchase under the current hold. */
  repair?: RepairState | null
}

/**
 * One durable repair attempt, as the backend records it.
 *
 * Four outcomes, and `unknown` is the one that matters: a send whose result
 * could not be proven is neither a failure to retry nor a success to report.
 * The backend refuses to repeat it on its own, and the panel has to say so
 * rather than showing a button that will be rejected.
 */
export type RepairState = {
  id: string
  reference: string
  review_case_id: string
  status: 'claimed' | 'confirmed' | 'failed' | 'unknown'
  media_ids: string[]
  platform_message_id: string | null
  claimed_by: string
  detail: string
  claimed_at: string
  resolved_at: string | null
  settled: boolean
  needs_operator_decision: boolean
}

export type ContentAccessEvidence = {
  fan_id: string
  creator_id: string
  frozen: boolean
  review_reason: string
  /**
   * The identity of the hold this evidence describes.
   *
   * Sent back with the resolution so the backend applies the decision to the
   * hold that was on screen. Without it, a hold cleared and re-raised — or a
   * crisis hold raised meanwhile — is indistinguishable from the one the
   * operator read, and the resolution lands on the wrong one.
   */
  review_case_id: string
  paid_items: PaidItem[]
  repairable_count: number
  platform_error: string
  has_paid_content: boolean
  /** True when more than one purchase could be the one they mean. */
  selection_required: boolean
  /** Every repair attempted for this customer, newest first. */
  repairs: RepairState[]
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
  /**
   * Whether the operator must choose WHICH purchase before resending.
   *
   * The backend refuses an unqualified resend when more than one purchase is
   * repairable. It used to assume the most recent, so a complaint about an
   * older item resent a newer one: the customer got a second copy of something
   * that worked, still could not open what they wrote in about, and the hold
   * was cleared as though it had been repaired.
   */
  selectionRequired: boolean
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
      selectionRequired: false,
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
      selectionRequired: evidence.selection_required,
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
      selectionRequired: evidence.selection_required,
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
      selectionRequired: evidence.selection_required,
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
      selectionRequired: evidence.selection_required,
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
    selectionRequired: evidence.selection_required,
  }
}

/** The label under each paid item in the panel. */
export function describePaidItem(item: PaidItem): string {
  const when = item.purchased_at ? item.purchased_at.slice(0, 10) : 'date unknown'
  const count = item.media_ids.length
  const pieces = count === 1 ? '1 item' : `${count} items`
  return `${dollars(item.price_cents)} · ${pieces} · bought ${when}`
}


/**
 * What the panel may do about one purchase, given what already happened to it.
 *
 * The backend is the authority and refuses the rest, but an operator reading a
 * button that will be rejected learns to ignore the panel. So the same four
 * outcomes are spelled out here, in the words an operator needs:
 *
 * - **confirmed** — already resent, and the platform acknowledged it. Offering
 *   the button again offers a second copy.
 * - **claimed** — in flight. Two operators pressing this is exactly how two
 *   copies used to go out.
 * - **unknown** — the send may or may not have arrived. This is the only state
 *   where resending again is a real decision with a real cost, so it is put to
 *   the operator instead of being hidden behind a disabled button.
 * - **failed** — nothing left the backend, so there is nothing to undo.
 */
export type RepairOffer = {
  /** Whether the resend button is live for this item. */
  canResend: boolean
  /** One line under the item. Empty when there is nothing to report. */
  note: string
  /** True when the operator is being asked to decide, not merely informed. */
  needsDecision: boolean
}

export function repairOffer(item: PaidItem): RepairOffer {
  const repairable = item.media_ids.length > 0
  const repair = item.repair
  if (!repair) {
    return {
      canResend: repairable,
      note: repairable
        ? ''
        : 'The purchase does not record which media it delivered, so there is ' +
          'nothing safe to resend.',
      needsDecision: false,
    }
  }
  if (repair.status === 'confirmed') {
    return {
      canResend: false,
      note:
        'Already resent for this hold, and the platform confirmed it. Sending ' +
        'again would give them a second copy.',
      needsDecision: false,
    }
  }
  if (repair.status === 'claimed') {
    return {
      canResend: false,
      note: 'A resend for this item is in progress. Reload in a moment.',
      needsDecision: false,
    }
  }
  if (repair.status === 'unknown') {
    return {
      canResend: false,
      note:
        'A resend reached the platform but could not be confirmed, so it is ' +
        'not known whether they received it. Check the conversation before ' +
        'sending again — this is the one case where a retry may deliver twice.',
      needsDecision: true,
    }
  }
  return {
    canResend: repairable,
    note: repair.detail
      ? `An earlier attempt did not send (${repair.detail}). Nothing reached them.`
      : 'An earlier attempt did not send. Nothing reached them.',
    needsDecision: false,
  }
}

/**
 * Which purchase the panel should have selected when it opens.
 *
 * Deliberately nothing when more than one is repairable. A pre-selected
 * default is the same mistake as the backend's old "assume the most recent" —
 * the operator confirms what was already chosen for them, and the complaint
 * about the older item is answered by resending the newer one.
 */
export function initialSelection(
  evidence: ContentAccessEvidence | null | undefined,
): string {
  if (!evidence) return ''
  const repairable = evidence.paid_items.filter(item => item.media_ids.length > 0)
  if (repairable.length !== 1) return ''
  return repairable[0].reference
}
