/**
 * Simulator visibility gating, across two tiers.
 *
 * The backend is the security boundary; these tests cover the second half of
 * the requirement — that nothing an account may not use is ever rendered to it,
 * not even inert.
 *
 * `auto_simulation` now covers ordinary agency operators, so the simulator
 * entry SHOULD appear for them. `simulation_mirror` is the owner tier, and the
 * strict rule moved there: only a literal `simulation_mirror: true` may render
 * any cross-tenant mirror control.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import type { SimulationCapabilities } from '../simulation'
import {
  BASE_NAV,
  SIMULATOR_NAV,
  canMirrorCatalog,
  canSeeOperatorDiagnostics,
  canSimulate,
  navEntries,
} from '../simulation'

/** Build a full capability object; tests only care about one field at a time. */
function caps(partial: Partial<SimulationCapabilities>): SimulationCapabilities {
  return {
    auto_simulation: false,
    simulation_mirror: false,
    operator_diagnostics: false,
    ...partial,
  }
}

describe('canSimulate', () => {
  it('is true only for an explicit backend true', () => {
    expect(canSimulate(caps({ auto_simulation: true }))).toBe(true)
  })

  it('is false when the backend says the simulator is off', () => {
    expect(canSimulate(caps({ auto_simulation: false }))).toBe(false)
  })

  it('is true for an ordinary agency account the backend has allowed', () => {
    // The point of this sprint: an agency operator is no longer excluded.
    expect(
      canSimulate(caps({ auto_simulation: true, simulation_mirror: false })),
    ).toBe(true)
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
  it('the simulator entry is absent when the backend says no', () => {
    const entries = navEntries(caps({ auto_simulation: false }))
    expect(entries).toEqual(BASE_NAV)
    expect(entries.some(entry => entry.href === '/simulator')).toBe(false)
    // Nothing in the rendered navigation may even mention it.
    expect(JSON.stringify(entries).toLowerCase()).not.toContain('simulat')
  })

  it('14 — the simulator entry is absent before the backend answers', () => {
    expect(navEntries(null)).toEqual(BASE_NAV)
  })

  it('the simulator entry is present for any authorized account', () => {
    const entries = navEntries(caps({ auto_simulation: true }))
    expect(entries).toEqual([...BASE_NAV, SIMULATOR_NAV])
    expect(entries[entries.length - 1]).toEqual({
      href: '/simulator',
      label: 'Simulator',
    })
  })

  it('leaves the ordinary navigation byte-identical either way', () => {
    // This patch must not change the normal agency UI.
    expect(navEntries(caps({ auto_simulation: true })).slice(0, BASE_NAV.length)).toEqual(
      navEntries(caps({ auto_simulation: false })),
    )
  })

  it('returns a copy, so a caller cannot mutate the shared navigation', () => {
    const entries = navEntries(caps({ auto_simulation: false }))
    entries.push(SIMULATOR_NAV)
    expect(navEntries(caps({ auto_simulation: false }))).toEqual(BASE_NAV)
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
    expect(await mod.fetchSimulationCapabilities()).toEqual({
      auto_simulation: true,
      // Absent in the payload, so false: a deployment mid-rollout hides the
      // mirror rather than showing a control its endpoints would refuse.
      simulation_mirror: false,
      operator_diagnostics: false,
    })
  })

  it('reports the owner tier when the backend grants it', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          auto_simulation: true,
          simulation_mirror: true,
          operator_diagnostics: true,
        }),
        { status: 200 },
      ),
    ) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({
      auto_simulation: true,
      simulation_mirror: true,
      operator_diagnostics: true,
    })
  })

  it('treats a non-200 as no capability', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({
      auto_simulation: false,
      simulation_mirror: false,
      operator_diagnostics: false,
    })
  })

  it('treats a network failure as no capability', async () => {
    // A backend outage must never be the reason a private feature appears.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({
      auto_simulation: false,
      simulation_mirror: false,
      operator_diagnostics: false,
    })
  })

  it('does not trust a truthy-but-wrong payload', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ auto_simulation: 'yes' }), { status: 200 }),
    ) as never
    const mod = await load()
    expect(await mod.fetchSimulationCapabilities()).toEqual({
      auto_simulation: false,
      simulation_mirror: false,
      operator_diagnostics: false,
    })
  })
})


describe('canMirrorCatalog', () => {
  it('is true only for an explicit owner-tier true', () => {
    expect(canMirrorCatalog(caps({ simulation_mirror: true }))).toBe(true)
  })

  it('is false for an agency account that may otherwise simulate', () => {
    // The important case. Simulating is allowed; mirroring across tenants is
    // not, and the UI must render nothing at all rather than something inert.
    expect(
      canMirrorCatalog(caps({ auto_simulation: true, simulation_mirror: false })),
    ).toBe(false)
  })

  it('is false before the backend has answered', () => {
    expect(canMirrorCatalog(null)).toBe(false)
    expect(canMirrorCatalog(undefined)).toBe(false)
  })

  it('is false for anything that merely looks truthy', () => {
    const shapes = [
      { simulation_mirror: 'true' },
      { simulation_mirror: 1 },
      { simulation_mirror: {} },
      {},
      { SIMULATION_MIRROR: true },
      // An older backend that only knows the single legacy flag must not be
      // read as granting the cross-tenant tier.
      { auto_simulation: true },
    ]
    for (const shape of shapes) {
      expect(canMirrorCatalog(shape as never)).toBe(false)
    }
  })
})

describe('canSeeOperatorDiagnostics', () => {
  it('follows its own flag, not the simulator one', () => {
    expect(canSeeOperatorDiagnostics(caps({ operator_diagnostics: true }))).toBe(true)
    expect(
      canSeeOperatorDiagnostics(caps({ auto_simulation: true })),
    ).toBe(false)
    expect(canSeeOperatorDiagnostics(null)).toBe(false)
  })
})
