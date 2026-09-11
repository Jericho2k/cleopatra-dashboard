/**
 * Simulator visibility gating.
 *
 * The backend is the security boundary; these tests cover the second half of
 * the requirement — that an ordinary agency account is never shown that the
 * feature exists. The rule under test is deliberately the strictest one: only a
 * literal `auto_simulation: true` from the backend may render anything.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  BASE_NAV,
  SIMULATOR_NAV,
  canSimulate,
  navEntries,
} from '../simulation'

describe('canSimulate', () => {
  it('is true only for an explicit backend true', () => {
    expect(canSimulate({ auto_simulation: true })).toBe(true)
  })

  it('is false for an ordinary agency account', () => {
    expect(canSimulate({ auto_simulation: false })).toBe(false)
  })

  it('is false before the backend has answered', () => {
    // null must behave exactly like false, or the entry flashes into view for
    // an account that may not have it and then disappears.
    expect(canSimulate(null)).toBe(false)
    expect(canSimulate(undefined)).toBe(false)
  })

  it('is false for anything that merely looks truthy', () => {
    const shapes = [
      { auto_simulation: 'true' },
      { auto_simulation: 1 },
      { auto_simulation: {} },
      {},
      { AUTO_SIMULATION: true },
    ]
    for (const shape of shapes) {
      expect(canSimulate(shape as never)).toBe(false)
    }
  })
})

describe('navEntries', () => {
  it('14 — the simulator entry is absent for a non-allowlisted user', () => {
    const entries = navEntries({ auto_simulation: false })
    expect(entries).toEqual(BASE_NAV)
    expect(entries.some(entry => entry.href === '/simulator')).toBe(false)
    // Nothing in the rendered navigation may even mention it.
    expect(JSON.stringify(entries).toLowerCase()).not.toContain('simulat')
  })

  it('14 — the simulator entry is absent before the backend answers', () => {
    expect(navEntries(null)).toEqual(BASE_NAV)
  })

  it('15 — the simulator entry is present for an allowlisted user', () => {
    const entries = navEntries({ auto_simulation: true })
    expect(entries).toEqual([...BASE_NAV, SIMULATOR_NAV])
    expect(entries[entries.length - 1]).toEqual({
      href: '/simulator',
      label: 'Simulator',
    })
  })

  it('leaves the ordinary navigation byte-identical either way', () => {
    // This patch must not change the normal agency UI.
    expect(navEntries({ auto_simulation: true }).slice(0, BASE_NAV.length)).toEqual(
      navEntries({ auto_simulation: false }),
    )
  })

  it('returns a copy, so a caller cannot mutate the shared navigation', () => {
    const entries = navEntries({ auto_simulation: false })
    entries.push(SIMULATOR_NAV)
    expect(navEntries({ auto_simulation: false })).toEqual(BASE_NAV)
  })
})

describe('fetchSimulationCapabilities', () => {
  const original = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = original
    vi.unstubAllEnvs()
  })

  async function load() {
    vi.doMock('../supabase', () => ({
      supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
    }))
    return import('../simulation')
  }

  it('reports the backend answer', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ auto_simulation: true }), { status: 200 }),
    ) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({ auto_simulation: true })
  })

  it('treats a non-200 as no capability', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({ auto_simulation: false })
  })

  it('treats a network failure as no capability', async () => {
    // A backend outage must never be the reason a private feature appears.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({ auto_simulation: false })
  })

  it('does not trust a truthy-but-wrong payload', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ auto_simulation: 'yes' }), { status: 200 }),
    ) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({ auto_simulation: false })
  })
})
