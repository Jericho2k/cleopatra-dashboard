/**
 * Teaser content must not LOOK sellable either.
 *
 * The backend stopped offering it (models/content_pricing.is_paid_sellable),
 * but the Sets UI still rendered a price anchor, a range slider and a "Fixed
 * price" control on a teaser set — an operator could type $20 into a box on
 * $0-$0 content and nothing would ever happen. A control that implies
 * something can be sold when it cannot is the same class of defect as the
 * fixed post-purchase cooldown: a switch with nothing behind it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isPaidSellable,
  paidSellableBlockReason,
  type CategoryRange,
  type SellabilityRow,
} from '../setPricing'

const SETS_PAGE = readFileSync(
  join(__dirname, '..', '..', 'app', 'scripts', 'page.tsx'),
  'utf8',
)

/** The real shape /content-price-ranges returns, trimmed to what matters. */
const CATEGORIES: CategoryRange[] = [
  { category: 'teaser_clothed', label: 'Clothed teaser (free)', min_dollars: 0, max_dollars: 0, priced: false },
  { category: 'teaser_bundle', label: 'Teaser bundle no nudity (free)', min_dollars: 0, max_dollars: 0, priced: false },
  { category: 'other', label: 'Other / unclear', min_dollars: 0, max_dollars: 0, priced: false },
  { category: 'lingerie_photo', label: 'Lingerie photo', min_dollars: 10, max_dollars: 80, priced: true },
  { category: 'nude_photo', label: 'Nude photo', min_dollars: 15, max_dollars: 80, priced: true },
  { category: 'striptease_video', label: 'Striptease video', min_dollars: 15, max_dollars: 100, priced: true },
]

function row(extra: Partial<SellabilityRow> = {}): SellabilityRow {
  return {
    suggested_price: 20,
    base_price_cents: 2000,
    min_price_cents: 1500,
    max_price_cents: 8000,
    ...extra,
  }
}

describe('the predicate agrees with the backend, case for case', () => {
  it.each(['teaser_clothed', 'teaser_bundle'])('blocks %s', category => {
    expect(isPaidSellable(row({ content_category: category }), CATEGORIES)).toBe(false)
  })

  it('blocks the category carried as a set tag, which is the live form', () => {
    expect(isPaidSellable(row({ tags: ['teaser_clothed', 'bathroom'] }), CATEGORIES)).toBe(false)
  })

  it('blocks a bare tease/free tag on a hand-curated row', () => {
    for (const tag of ['tease', 'teaser', 'free_only', 'not_for_sale']) {
      expect(isPaidSellable(row({ tags: [tag] }), CATEGORIES)).toBe(false)
    }
  })

  it('does NOT block striptease, which is a priced category containing the word', () => {
    expect(isPaidSellable(row({ content_category: 'striptease_video' }), CATEGORIES)).toBe(true)
    expect(isPaidSellable(row({ tags: ['striptease', 'nude_photo'] }), CATEGORIES)).toBe(true)
  })

  it('prices a mixed shoot by its strongest content', () => {
    expect(isPaidSellable(row({ tags: ['teaser_clothed', 'nude_photo'] }), CATEGORIES)).toBe(true)
  })

  it('leaves a hand-curated set with no category evidence alone', () => {
    expect(isPaidSellable(row(), CATEGORIES)).toBe(true)
  })

  it('lets an explicit decision outrank every inference', () => {
    const marked = row({ content_category: 'nude_photo', paid_sellable: false })
    expect(paidSellableBlockReason(marked, CATEGORIES)).toBe('marked_not_paid_sellable')
  })

  it('does not treat a price on teaser content as permission', () => {
    const priced = row({
      content_category: 'teaser_clothed',
      base_price_cents: 2500,
      min_price_cents: 2500,
      max_price_cents: 2500,
      dynamic_pricing_enabled: false,
    })
    expect(isPaidSellable(priced, CATEGORIES)).toBe(false)
  })
})

describe('the Sets UI offers no pricing control it cannot honour', () => {
  it('checks sellability before rendering the pricing contract', () => {
    expect(SETS_PAGE).toContain('paidSellableBlockReason')
    expect(SETS_PAGE).toContain('Not automatically sellable')
  })

  it('says plainly why, and that the content is kept rather than deleted', () => {
    expect(SETS_PAGE).toContain('never offered automatically, never priced')
    expect(SETS_PAGE).toContain('can still be used as a free reward')
  })

  it('marks the set on the card itself, not only inside a collapsed section', () => {
    expect(SETS_PAGE).toContain('NOT SELLABLE')
  })
})
