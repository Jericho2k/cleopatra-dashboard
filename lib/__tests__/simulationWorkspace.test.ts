/**
 * A PPV has to look like a PPV, and simulated fans must not be agency revenue.
 *
 * Two properties are asserted here because both were wrong before:
 *
 *   1. the simulator showed a tiny badge and a media id where a fan sees a
 *      priced, locked card — so it could not be used to judge whether an offer
 *      lands, which is the main thing it exists for;
 *   2. a test fan's persisted spend counted toward the agency's confirmed
 *      revenue, because simulation state is deliberately real and nothing
 *      excluded it.
 */

import { describe, expect, it } from 'vitest'

import { fanStats, isSimulationFan, productionFans } from '../productionMetrics'
import {
  actionOutcomeMessage,
  centsToDollars,
  collectSimulationMediaIds,
  isSimulationMediaId,
  partitionMediaIds,
  ppvPresentation,
} from '../simulationWorkspace'
import type { Message } from '../../types'

function message(mediaContext: unknown): Message {
  return {
    id: 'm1',
    fan_id: 'f1',
    creator_id: 'c1',
    role: 'creator',
    content: 'here it is',
    sent_at: '2026-09-12T10:00:00Z',
    was_ai_suggested: true,
    was_selected: true,
    media_context: mediaContext,
  }
}

describe('ppvPresentation', () => {
  it('is locked before a confirmed purchase', () => {
    const result = ppvPresentation({
      ppv: { media_ids: ['111'], price: 25, price_cents: 2500 },
    })

    expect(result.kind).toBe('locked')
    if (result.kind === 'none') throw new Error('expected a PPV')
    expect(result.price).toBe(25)
    expect(result.mediaIds).toEqual(['111'])
    expect(result.purchased).toBe(false)
  })

  it('is unlocked once the production purchase transition marked it bought', () => {
    const result = ppvPresentation({
      ppv: { media_ids: ['111'], price: 25, purchased: true },
    })

    expect(result.kind).toBe('unlocked')
  })

  it('reads an older single-media row', () => {
    const result = ppvPresentation({ ppv: { media_id: '999', price_cents: 4000 } })

    if (result.kind === 'none') throw new Error('expected a PPV')
    expect(result.mediaIds).toEqual(['999'])
    // price is derived from cents when the dollar field is absent.
    expect(result.price).toBe(40)
  })

  it('is none for a message with no PPV, or a PPV with no media', () => {
    expect(ppvPresentation(null).kind).toBe('none')
    expect(ppvPresentation({}).kind).toBe('none')
    expect(ppvPresentation({ ppv: { price: 10 } }).kind).toBe('none')
    // The AI-stack marker is ordinary metadata and must not read as a PPV.
    expect(ppvPresentation({ ai_stack: { profile: 'cleo_v2' } }).kind).toBe('none')
  })

  it('collects every referenced media id once, in order', () => {
    const messages = [
      message({ ppv: { media_ids: ['a', 'b'] } }),
      message({ ppv: { media_ids: ['b', 'c'] } }),
      message(null),
    ]

    expect(collectSimulationMediaIds(messages)).toEqual(['a', 'b', 'c'])
  })
})

describe('mirrored test media', () => {
  it('recognises a sim: id', () => {
    expect(isSimulationMediaId('sim:abc123:99887')).toBe(true)
    expect(isSimulationMediaId('99887')).toBe(false)
    expect(isSimulationMediaId(null)).toBe(false)
  })

  it('routes sim: ids to the owner-only preview, not the vault endpoint', () => {
    // A mirrored row carries no url and no platform media id, so asking the
    // ordinary vault endpoint about one could only ever return nothing.
    const { vault, simulation } = partitionMediaIds(['111', 'sim:abc:222', '333'])

    expect(vault).toEqual(['111', '333'])
    expect(simulation).toEqual(['sim:abc:222'])
  })
})

describe('run-now outcomes', () => {
  it('reports a skip as a real outcome rather than a failure', () => {
    expect(actionOutcomeMessage('skipped', 0)).toContain('not a failure')
    expect(actionOutcomeMessage('sent', 1)).toContain('conversation')
    expect(actionOutcomeMessage('failed', 0)).toContain('failed')
  })
})

describe('production metrics exclude simulated fans', () => {
  const rows = [
    { platform_fan_id: '55512', total_spent: 120, spend_tier: 'whale', sales_log: [{}] },
    { platform_fan_id: 'test_a1b2c3', total_spent: 900, spend_tier: 'whale', sales_log: [{}, {}] },
    { platform_fan_id: '88123', total_spent: 0, spend_tier: 'cold', sales_log: [] },
  ]

  it('identifies a test fan by its platform id', () => {
    expect(isSimulationFan(rows[1])).toBe(true)
    expect(isSimulationFan(rows[0])).toBe(false)
    expect(isSimulationFan({ platform_fan_id: null })).toBe(false)
  })

  it('keeps simulated spend out of revenue, buyers and whales', () => {
    const stats = fanStats(rows)

    expect(stats.revenue).toBe(120)
    expect(stats.total).toBe(2)
    expect(stats.buyers).toBe(1)
    expect(stats.whales).toBe(1)
    // Reported rather than hidden: the operator is told what was left out.
    expect(stats.simulated).toBe(1)
  })

  it('does not delete anything — the rows are still there', () => {
    expect(productionFans(rows)).toHaveLength(2)
    expect(rows).toHaveLength(3)
  })
})

describe('centsToDollars', () => {
  it('formats money and reports unknown as a dash', () => {
    expect(centsToDollars(2500)).toBe('$25')
    expect(centsToDollars(2550)).toBe('$25.50')
    expect(centsToDollars(null)).toBe('—')
  })
})
