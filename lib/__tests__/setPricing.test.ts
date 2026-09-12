/**
 * Editing one visible price must not silently collapse a set's whole range.
 *
 * The old Sets UI wrote suggested_price, base_price_cents, min_price_cents and
 * max_price_cents all to the same number whenever the operator touched the price
 * field. That turned "this set is worth about $50" into "this set may only ever
 * be $50", switched off dynamic pricing for it, and threw away the
 * category-derived bounds — with nothing on screen saying so.
 */

import { describe, expect, it } from 'vitest'

import {
  anchorPatch,
  anchorPosition,
  categoryRangeFor,
  fixedPricePatch,
  pricingContract,
  rangePatch,
  restoreCategoryRangePatch,
  type CategoryRange,
  type SetPricingRow,
} from '../setPricing'

const CATEGORIES: CategoryRange[] = [
  { category: 'nude_photo', label: 'Nude photo', min_dollars: 15, max_dollars: 80, priced: true },
  { category: 'nude_video', label: 'Nude video', min_dollars: 20, max_dollars: 110, priced: true },
  { category: 'teaser_clothed', label: 'Clothed teaser (free)', min_dollars: 0, max_dollars: 0, priced: false },
]

function set(overrides: Partial<SetPricingRow> = {}): SetPricingRow {
  return {
    suggested_price: 50,
    base_price_cents: 5000,
    min_price_cents: 1500,
    max_price_cents: 8000,
    dynamic_pricing_enabled: true,
    tags: ['nude_photo'],
    ...overrides,
  }
}

describe('pricingContract', () => {
  it('reports the stored range, not just the anchor', () => {
    const contract = pricingContract(set(), CATEGORIES)

    expect(contract.anchorCents).toBe(5000)
    expect(contract.minCents).toBe(1500)
    expect(contract.maxCents).toBe(8000)
    expect(contract.dynamic).toBe(true)
    expect(contract.collapsed).toBe(false)
  })

  it('falls back to the category range when the stored bounds were collapsed', () => {
    // Exactly what the old UI left behind: three equal columns.
    const collapsed = set({
      base_price_cents: 5000,
      min_price_cents: 5000,
      max_price_cents: 5000,
    })

    const contract = pricingContract(collapsed, CATEGORIES)

    expect(contract.minCents).toBe(1500)
    expect(contract.maxCents).toBe(8000)
    expect(contract.rangeSource).toBe('category')
    expect(contract.categoryLabel).toBe('Nude photo')
  })

  it('treats a missing dynamic flag as on, because that is the column default', () => {
    expect(pricingContract(set({ dynamic_pricing_enabled: null }), CATEGORIES).dynamic).toBe(true)
    expect(pricingContract(set({ dynamic_pricing_enabled: false }), CATEGORIES).dynamic).toBe(false)
  })

  it('picks the most valuable matching category for a mixed set', () => {
    const mixed = set({ tags: ['nude_photo', 'nude_video'] })

    expect(categoryRangeFor(mixed, CATEGORIES)?.category).toBe('nude_video')
  })

  it('never derives a range from a free or unpriced category', () => {
    const teaser = set({
      tags: ['teaser_clothed'],
      min_price_cents: 0,
      max_price_cents: 0,
    })

    expect(categoryRangeFor(teaser, CATEGORIES)).toBeNull()
  })

  it('places the anchor marker inside the range', () => {
    expect(anchorPosition(pricingContract(set(), CATEGORIES))).toBeCloseTo(
      (5000 - 1500) / (8000 - 1500),
      5,
    )
  })
})

describe('anchorPatch', () => {
  it('moves the anchor and leaves the range alone', () => {
    const contract = pricingContract(set(), CATEGORIES)

    const patch = anchorPatch(contract, 60)

    expect(patch.base_price_cents).toBe(6000)
    expect(patch.suggested_price).toBe(60)
    // The regression this whole module exists to prevent.
    expect(patch.min_price_cents).toBeUndefined()
    expect(patch.max_price_cents).toBeUndefined()
    expect(patch.dynamic_pricing_enabled).toBeUndefined()
  })

  it('widens only the bound an out-of-range anchor crossed', () => {
    const contract = pricingContract(set(), CATEGORIES)

    expect(anchorPatch(contract, 100).max_price_cents).toBe(10_000)
    expect(anchorPatch(contract, 100).min_price_cents).toBeUndefined()
    expect(anchorPatch(contract, 5).min_price_cents).toBe(500)
    expect(anchorPatch(contract, 5).max_price_cents).toBeUndefined()
  })
})

describe('explicit range and fixed price', () => {
  it('keeps the anchor inside a newly set range', () => {
    const contract = pricingContract(set(), CATEGORIES)

    const patch = rangePatch(contract, 60, 90)

    expect(patch.min_price_cents).toBe(6000)
    expect(patch.max_price_cents).toBe(9000)
    expect(patch.base_price_cents).toBe(6000)
    expect(patch.dynamic_pricing_enabled).toBe(true)
  })

  it('orders an inverted range rather than storing it backwards', () => {
    const patch = rangePatch(pricingContract(set(), CATEGORIES), 90, 60)

    expect(patch.min_price_cents).toBe(9000)
    expect(patch.max_price_cents).toBe(9000)
  })

  it('collapses the range ONLY when fixed price is chosen deliberately', () => {
    const patch = fixedPricePatch(45)

    expect(patch.base_price_cents).toBe(4500)
    expect(patch.min_price_cents).toBe(4500)
    expect(patch.max_price_cents).toBe(4500)
    expect(patch.dynamic_pricing_enabled).toBe(false)
  })

  it('restores the category default and re-enables dynamic pricing', () => {
    const fixed = set({
      dynamic_pricing_enabled: false,
      min_price_cents: 5000,
      max_price_cents: 5000,
    })
    const contract = pricingContract(fixed, CATEGORIES)

    const patch = restoreCategoryRangePatch(contract, CATEGORIES[0])

    expect(patch.min_price_cents).toBe(1500)
    expect(patch.max_price_cents).toBe(8000)
    expect(patch.dynamic_pricing_enabled).toBe(true)
  })
})
