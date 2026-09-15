/**
 * The operator-facing half of historical import.
 *
 * These assertions exist because the old toast — "Imported 200 messages" —
 * could not distinguish "that was the whole conversation" from "that was page
 * 20 of 500 and it cost 60 credits", and those call for opposite actions.
 */

import { describe, expect, it } from 'vitest'

import {
  describeHistoryProgress,
  describeHistoryStop,
  formatCredits,
  summarizeHistoryImport,
} from '../fanHistory'

describe('formatCredits', () => {
  it('says nothing when nothing was spent', () => {
    expect(formatCredits(0)).toBe('')
    expect(formatCredits(undefined)).toBe('')
    expect(formatCredits(null)).toBe('')
  })

  it('keeps a small cost visible instead of rounding it to zero', () => {
    expect(formatCredits(3.2)).toBe('~3.2')
  })

  it('rounds a large cost, and marks every figure as an estimate', () => {
    // The tilde is load-bearing: API Fansly's Usage dashboard is authoritative.
    expect(formatCredits(1412.5)).toBe('~1,413')
  })
})

describe('describeHistoryStop', () => {
  it('reports completion when the provider cursor is exhausted', () => {
    expect(describeHistoryStop({ history: { fully_paged: true } })).toBe(
      'all history imported',
    )
  })

  it('does not make yielding to a live conversation sound like a failure', () => {
    expect(
      describeHistoryStop({ deep: { stop_reason: 'live_work_in_progress' } }),
    ).toBe('paused for live conversation')
  })

  it('names a deliberate credit budget as the reason', () => {
    expect(
      describeHistoryStop({ deep: { stop_reason: 'history_credit_budget_exhausted' } }),
    ).toBe('paused — credit budget reached')
  })

  it('surfaces a real error rather than calling it a pause', () => {
    expect(describeHistoryStop({ history: { last_error: 'HTTP 502' } })).toBe(
      'stopped: HTTP 502',
    )
  })

  it('says more remains when the import simply hit its page budget', () => {
    expect(describeHistoryStop({ deep: { stop_reason: 'page_budget' } })).toBe(
      'more history remains',
    )
  })
})

describe('summarizeHistoryImport', () => {
  it('reports what came in, what it cost, and whether there is more', () => {
    expect(
      summarizeHistoryImport({
        imported: 200,
        estimated_credits: 24,
        history: { api_calls: 20, pages_fetched: 20, fully_paged: false },
        deep: { stop_reason: 'page_budget' },
      }),
    ).toBe('Imported 200 messages · 20 API calls, ~24 credits · more history remains')
  })

  it('is honest when a second press imports nothing', () => {
    // Re-importing is idempotent, so this is the expected outcome and must not
    // read as an error.
    expect(
      summarizeHistoryImport({
        imported: 0,
        estimated_credits: 2,
        history: { api_calls: 2, pages_fetched: 22, fully_paged: true },
      }),
    ).toBe('No new messages · 2 API calls, ~2.0 credits · all history imported')
  })

  it('omits the cost clause when nothing was spent', () => {
    expect(
      summarizeHistoryImport({
        imported: 0,
        history: { fully_paged: true },
      }),
    ).toBe('No new messages · all history imported')
  })

  it('handles a singular message and a singular call', () => {
    expect(
      summarizeHistoryImport({
        imported: 1,
        estimated_credits: 1,
        history: { api_calls: 1, fully_paged: true },
      }),
    ).toBe('Imported 1 message · 1 API call, ~1.0 credits · all history imported')
  })
})

describe('describeHistoryProgress', () => {
  it('says nothing for a fan whose history was never imported', () => {
    expect(describeHistoryProgress(null)).toBe('')
    expect(describeHistoryProgress({ pages_fetched: 0 })).toBe('')
  })

  it('describes an import still in flight without inventing a total', () => {
    const line = describeHistoryProgress({
      pages_fetched: 120,
      messages_imported: 1200,
      estimated_credits: 180,
      fully_paged: false,
    })
    expect(line).toBe('History importing — 1,200 messages so far over 120 pages, ~180 credits')
    expect(line).not.toMatch(/remaining|left|of \d/)
  })

  it('describes a finished import', () => {
    expect(
      describeHistoryProgress({
        pages_fetched: 500,
        messages_imported: 5000,
        estimated_credits: 1500,
        fully_paged: true,
      }),
    ).toBe('History complete — 5,000 messages over 500 pages, ~1,500 credits')
  })
})
