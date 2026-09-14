/**
 * What a set actually costs, and what the operator is allowed to change.
 *
 * The Sets UI used to show one number — "$50" — and writing it set four columns
 * at once:
 *
 *     suggested_price, base_price_cents, min_price_cents, max_price_cents
 *
 * all to the same value. That is not "the price is $50". It is "collapse this
 * set's entire allowed range to a single point", which silently turns off every
 * bit of dynamic pricing for that set and throws away the category-derived
 * bounds the classifier worked out. An operator nudging a number had no way to
 * know they had done it.
 *
 * A set's real pricing contract has four parts:
 *
 *   anchor   where pricing starts from (base_price_cents)
 *   minimum  the lowest the engine may ever offer it for
 *   maximum  the highest
 *   dynamic  whether the engine may move inside that range at all
 *
 * This module models that contract, derives sensible bounds from the content
 * category when a set has none of its own, and — the point of the whole
 * exercise — produces a patch that changes ONLY what the operator actually
 * edited. Collapsing the range is still possible, but only by explicitly
 * choosing fixed price.
 */

export type CategoryRange = {
  category: string
  label: string
  min_dollars: number
  max_dollars: number
  priced: boolean
}

export type SetPricingRow = {
  suggested_price: number | null
  base_price_cents: number | null
  min_price_cents: number | null
  max_price_cents: number | null
  dynamic_pricing_enabled?: boolean | null
  tags?: string[] | null
  content_category?: string | null
}

export type PricingContract = {
  anchorCents: number
  minCents: number
  maxCents: number
  dynamic: boolean
  /** Where the min/max came from, for the "Range source" line. */
  rangeSource: 'custom' | 'category' | 'anchor'
  /** The category the range was derived from, when it was. */
  categoryLabel: string | null
  /** True when min and max are equal: one price, no room to move. */
  collapsed: boolean
}

function centsOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

/**
 * Which approved category range this set falls under.
 *
 * Mirrors the backend's `row_category_range_cents`: a set's classifier category
 * is written into its tags, and the MOST VALUABLE matching category wins,
 * because a mixed set is worth at least what its strongest content is worth.
 * Free/teaser/unclear categories are not approved commercial ranges and are
 * skipped.
 */
export function categoryRangeFor(
  row: SetPricingRow,
  categories: readonly CategoryRange[],
): CategoryRange | null {
  const candidates = new Set<string>()
  if (row.content_category) candidates.add(normalizeCategory(row.content_category))
  for (const tag of row.tags ?? []) candidates.add(normalizeCategory(tag))

  let best: CategoryRange | null = null
  for (const category of categories) {
    if (!category.priced) continue
    if (!candidates.has(normalizeCategory(category.category))) continue
    if (
      !best
      || category.max_dollars > best.max_dollars
      || (category.max_dollars === best.max_dollars
        && category.min_dollars > best.min_dollars)
    ) {
      best = category
    }
  }
  return best
}

function normalizeCategory(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, '_')
}

/** The set's effective pricing contract, with its bounds' provenance. */
export function pricingContract(
  row: SetPricingRow,
  categories: readonly CategoryRange[],
): PricingContract {
  const suggestedCents = Math.round(Math.max(0, row.suggested_price ?? 0) * 100)
  const anchorCents = centsOr(row.base_price_cents, suggestedCents)
  const category = categoryRangeFor(row, categories)

  const storedMin = centsOr(row.min_price_cents, 0)
  const storedMax = centsOr(row.max_price_cents, 0)
  const hasStoredRange = storedMin > 0 && storedMax > 0 && storedMax !== storedMin

  let minCents = storedMin
  let maxCents = storedMax
  let rangeSource: PricingContract['rangeSource'] = 'custom'

  if (!hasStoredRange) {
    if (category) {
      // The stored values are a collapsed point (the old behaviour) or absent.
      // The category's approved range is the honest default in both cases.
      minCents = category.min_dollars * 100
      maxCents = category.max_dollars * 100
      rangeSource = 'category'
    } else if (storedMin > 0 || storedMax > 0 || anchorCents > 0) {
      minCents = storedMin || anchorCents
      maxCents = storedMax || anchorCents
      rangeSource = 'anchor'
    }
  }

  return {
    anchorCents,
    minCents,
    maxCents,
    // A set with no explicit flag is dynamic: that is the column default, and
    // it is what the engine does.
    dynamic: row.dynamic_pricing_enabled !== false,
    rangeSource,
    categoryLabel: category?.label ?? null,
    collapsed: minCents > 0 && minCents === maxCents,
  }
}

export type SetPricingPatch = {
  suggested_price?: number
  base_price_cents?: number
  min_price_cents?: number
  max_price_cents?: number
  dynamic_pricing_enabled?: boolean
}

/**
 * Change the anchor WITHOUT collapsing the range.
 *
 * This is the fix for the old behaviour. Editing the visible price now moves
 * the anchor and, if it has been pushed outside the current bounds, widens the
 * bound it crossed — because an anchor the engine may never offer is not a
 * price, it is a contradiction. Everything else is left exactly as it was.
 */
export function anchorPatch(
  contract: PricingContract,
  dollars: number,
): SetPricingPatch {
  const anchorCents = Math.max(0, Math.round(dollars * 100))
  const patch: SetPricingPatch = {
    // suggested_price stays in step with the anchor: legacy readers still use
    // it, and leaving it behind would make two columns disagree about the
    // same fact.
    suggested_price: Math.round(anchorCents) / 100,
    base_price_cents: anchorCents,
  }
  if (contract.minCents > 0 && anchorCents < contract.minCents) {
    patch.min_price_cents = anchorCents
  }
  if (contract.maxCents > 0 && anchorCents > contract.maxCents) {
    patch.max_price_cents = anchorCents
  }
  return patch
}

/** Set an explicit custom range, keeping the anchor inside it. */
export function rangePatch(
  contract: PricingContract,
  minDollars: number,
  maxDollars: number,
): SetPricingPatch {
  const minCents = Math.max(0, Math.round(minDollars * 100))
  const maxCents = Math.max(minCents, Math.round(maxDollars * 100))
  const anchorCents = Math.min(Math.max(contract.anchorCents, minCents), maxCents)
  return {
    min_price_cents: minCents,
    max_price_cents: maxCents,
    base_price_cents: anchorCents,
    suggested_price: anchorCents / 100,
    dynamic_pricing_enabled: true,
  }
}

/**
 * Fixed price: one amount, no range. The ONLY thing that may collapse a range.
 *
 * Explicit, and it says what it does. The old UI did this on every price edit,
 * without asking and without telling.
 */
export function fixedPricePatch(dollars: number): SetPricingPatch {
  const cents = Math.max(0, Math.round(dollars * 100))
  return {
    suggested_price: cents / 100,
    base_price_cents: cents,
    min_price_cents: cents,
    max_price_cents: cents,
    dynamic_pricing_enabled: false,
  }
}

/** Restore the category's approved range and re-enable dynamic pricing. */
export function restoreCategoryRangePatch(
  contract: PricingContract,
  category: CategoryRange,
): SetPricingPatch {
  return rangePatch(contract, category.min_dollars, category.max_dollars)
}

export function dollars(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

/** Where the anchor sits inside the range, 0-1, for the marker position. */
export function anchorPosition(contract: PricingContract): number {
  const span = contract.maxCents - contract.minCents
  if (span <= 0) return 0.5
  const offset = contract.anchorCents - contract.minCents
  return Math.min(1, Math.max(0, offset / span))
}

/**
 * Whether the engine may automatically SELL this set — and if not, why.
 *
 * Mirrors the backend's one authoritative predicate
 * (`models/content_pricing.paid_sellable_block_reason`) field for field,
 * including the order of authority:
 *
 *   1. `paid_sellable === false` is a human or classifier decision and wins.
 *   2. Any genuinely priced category makes the set sellable at that range —
 *      a mixed shoot tagged both `teaser_clothed` and `nude_photo` is a nude
 *      set, exactly as `categoryRangeFor` already prices it.
 *   3. Only then does a free-only marker block it, regardless of what price
 *      columns the row happens to carry.
 *
 * It exists here so the Sets UI can stop OFFERING pricing controls for content
 * the engine will never sell. A price box on a teaser set is not a harmless
 * extra field: it reads as "set this and it will be sold", and it was possible
 * to fill it in and have nothing happen.
 */

/** Classifier categories the agency priced $0-$0 on purpose. */
const FREE_ONLY_CATEGORIES = new Set(['teaser_clothed', 'teaser_bundle'])

/**
 * Free-only markers that appear as a plain tag on hand-curated and legacy
 * rows. Matched on the WHOLE normalized tag: `striptease_video` is a priced
 * category and must not be caught by the word "tease" inside it.
 */
const FREE_ONLY_TAGS = new Set([
  'tease',
  'teaser',
  'teasers',
  'teaser_only',
  'free',
  'free_only',
  'not_for_sale',
])

export type SellabilityRow = SetPricingRow & { paid_sellable?: boolean | null }

export function paidSellableBlockReason(
  row: SellabilityRow,
  categories: readonly CategoryRange[],
): string | null {
  if (row.paid_sellable === false) return 'marked_not_paid_sellable'

  const tokens = new Set<string>()
  if (row.content_category) tokens.add(normalizeCategory(row.content_category))
  for (const tag of row.tags ?? []) tokens.add(normalizeCategory(tag))

  for (const category of categories) {
    if (category.priced && tokens.has(normalizeCategory(category.category))) return null
  }

  for (const token of tokens) {
    if (FREE_ONLY_CATEGORIES.has(token) || FREE_ONLY_TAGS.has(token)) {
      return `free_only_content:${token}`
    }
  }
  return null
}

export function isPaidSellable(
  row: SellabilityRow,
  categories: readonly CategoryRange[],
): boolean {
  return paidSellableBlockReason(row, categories) === null
}
