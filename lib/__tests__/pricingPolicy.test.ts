/**
 * The pricing UI must not pretend adaptive pricing is running when it is not.
 *
 * PRICE_LEARNING_ENABLED is a deployment gate. With it off, every offer is
 * priced from the content range alone and a strategy picker changes nothing
 * live. A UI that hid that would have operators tuning a knob wired to nothing.
 */

import { describe, expect, it } from 'vitest'

import {
  ADVANCED_PRICING_FIELDS,
  defaultScope,
  featureGateWarning,
  formatAdvancedValue,
  type PricingPolicyView,
} from '../pricingPolicy'

function view(overrides: Partial<PricingPolicyView> = {}): PricingPolicyView {
  return {
    creator_id: 'c1',
    agency_scope_id: null,
    price_learning_enabled: true,
    price_learning_env_var: 'PRICE_LEARNING_ENABLED',
    environment_defaults: {},
    agency: { settings: {}, preset: null },
    creator: { settings: {}, preset: null },
    effective: { cold_start_probe_bps: 2500 },
    effective_preset: 'balanced',
    presets: [],
    ...overrides,
  }
}

describe('featureGateWarning', () => {
  it('says nothing when adaptive pricing is on', () => {
    expect(featureGateWarning(view())).toBe('')
  })

  it('names the exact variable when the backend gate is off', () => {
    const warning = featureGateWarning(view({ price_learning_enabled: false }))

    expect(warning).toContain('PRICE_LEARNING_ENABLED=true')
    // And it does not claim the saved strategy was lost, because it was not.
    expect(warning).toContain('saved')
  })

  it('treats an unavailable policy as nothing to warn about', () => {
    expect(featureGateWarning(null)).toBe('')
  })
})

describe('defaultScope', () => {
  it('writes to the agency scope when the creator belongs to one', () => {
    expect(defaultScope(view({ agency_scope_id: 'agency-1' }))).toBe('agency')
  })

  it('falls back to the creator scope when there is no agency scope', () => {
    expect(defaultScope(view())).toBe('creator')
    expect(defaultScope(null)).toBe('creator')
  })
})

describe('advanced field presentation', () => {
  it('renders each unit in the form an operator can read', () => {
    expect(formatAdvancedValue('cents', 2500)).toBe('$25')
    expect(formatAdvancedValue('cents', 2550)).toBe('$25.50')
    expect(formatAdvancedValue('bps', 2500)).toBe('25%')
    expect(formatAdvancedValue('days', 365)).toBe('365 days')
    expect(formatAdvancedValue('count', 2)).toBe('2')
  })

  it('carries a unit and an explanation for every advanced field', () => {
    // A mislabelled unit on a pricing control is a money bug, so this asserts
    // the metadata exists rather than trusting the page to get it right.
    for (const field of ADVANCED_PRICING_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0)
      expect(field.help.length).toBeGreaterThan(0)
      expect(['bps', 'cents', 'count', 'days']).toContain(field.unit)
    }
  })
})
