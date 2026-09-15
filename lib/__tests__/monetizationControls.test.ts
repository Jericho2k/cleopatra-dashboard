/**
 * A switch with nothing behind it is worse than no switch.
 *
 * The Monetization page used to offer "Offer two packages", a short and a long
 * session content budget, and a minimum/maximum PPV step range. All four were
 * dials on the two-branch menu the commercial engine no longer runs: the fan is
 * shown one next unlock at a time and a sold unlock is exactly one step. Left in
 * place they would read as live controls an agency could tune, and tune nothing.
 *
 * This reads the page source rather than rendering it, because the claim is
 * about what the UI can OFFER at all — a control that exists in a collapsed
 * section or behind a feature check is still a control that exists.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MONETIZATION = readFileSync(
  join(__dirname, '..', '..', 'app', 'monetization', 'page.tsx'),
  'utf8',
)
const SIMULATION_PANEL = readFileSync(
  join(__dirname, '..', '..', 'components', 'SimulationStatePanel.tsx'),
  'utf8',
)
const FAN_PANEL = readFileSync(
  join(__dirname, '..', '..', 'components', 'FanPanel.tsx'),
  'utf8',
)

describe('the two-package controls are gone, not hidden', () => {
  it.each([
    'offer_two_packages',
    'quick_package_target_cents',
    'full_package_target_cents',
    'session_min_steps',
    'session_max_steps',
  ])('does not read or write %s', field => {
    expect(MONETIZATION).not.toContain(field)
  })

  it.each([
    'Offer two packages',
    'Short session content budget',
    'Long session content budget',
    'Minimum PPV steps',
    'Maximum PPV steps',
  ])('renders no control labelled "%s"', label => {
    expect(MONETIZATION).not.toContain(label)
  })

  it('has no help text left describing a control that no longer exists', () => {
    expect(MONETIZATION).not.toContain('quick and full approved package choices')
    expect(MONETIZATION).not.toContain('shorter session shape')
    expect(MONETIZATION).not.toContain('longer session shape')
  })

  it('has no validation left for a relationship between two budgets', () => {
    expect(MONETIZATION).not.toContain('must be higher than the quick-session price')
    expect(MONETIZATION).not.toContain('Minimum session steps cannot exceed')
  })
})

describe('one offer budget replaces the pair', () => {
  it('offers exactly one content-budget control', () => {
    expect(MONETIZATION).toContain('next_offer_target_cents')
    expect(MONETIZATION).toContain('Next-offer content budget')
    // ...and says plainly that it is not a price.
    expect(MONETIZATION).toContain('NOT the price')
  })

  it('still states the purchase-gating invariant as an invariant', () => {
    expect(MONETIZATION).toContain(
      'Purchase confirmation is required before every next unlock',
    )
  })

  it('tells the operator the fan is never shown a total', () => {
    expect(MONETIZATION).toContain('never told a session')
  })
})

describe('the fixed post-purchase cooldown is gone, not hidden', () => {
  /**
   * It configured "wait N creator messages after a purchase before offering
   * again" — a window one-unlock sessions made unreachable, because a
   * single-step plan completes ON the purchase and the completion path cleared
   * the counter on the same line that would have set it. The dial was live,
   * stored per creator, and did nothing. What replaced it is not a number an
   * operator sets: the scene re-opens on a real conversational bridge, or
   * immediately if the fan asks for more.
   */
  it('does not read or write post_purchase_cooldown_messages', () => {
    expect(MONETIZATION).not.toContain('post_purchase_cooldown_messages')
  })

  it('renders no control labelled with the old wording', () => {
    expect(MONETIZATION).not.toContain(
      'Text messages after a purchase before the next offer',
    )
  })

  it('states the behaviour as an invariant instead of a setting', () => {
    expect(MONETIZATION).toContain(
      'After a purchase the conversation continues before anything else is offered',
    )
  })

  it('leaves no cooldown row in the simulator panel reading a dead field', () => {
    expect(SIMULATION_PANEL).not.toContain('post_ppv_cooldown')
    expect(SIMULATION_PANEL).not.toContain('cooldown_messages_remaining')
  })

  it('shows the scene that actually governs the next offer', () => {
    expect(SIMULATION_PANEL).toContain('Another unlock ready')
    expect(SIMULATION_PANEL).toContain('state.scene')
  })
})

describe('the state panels show one offer, not an ordered menu', () => {
  it('reads the singular pending offer', () => {
    expect(SIMULATION_PANEL).toContain('commercial.pending_offer')
    expect(SIMULATION_PANEL).not.toContain('offered_packages')
  })

  it('reads the accepted offer rather than a selected package', () => {
    expect(SIMULATION_PANEL).toContain('commercial.accepted_offer_id')
    expect(SIMULATION_PANEL).not.toContain('selected_package_id')
    expect(FAN_PANEL).toContain('accepted_offer_label')
    expect(FAN_PANEL).not.toContain('selected_package_label')
  })
})
