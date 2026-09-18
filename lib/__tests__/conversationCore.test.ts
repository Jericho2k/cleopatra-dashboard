import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canSelectConversationCore,
  fetchConversationCores,
  saveSimulationFanConversationCore,
} from '../conversationCore'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('conversation-core rollout control', () => {
  it('is absent for agency simulation and available only to the owner tier', () => {
    expect(
      canSelectConversationCore({
        auto_simulation: true,
        simulation_mirror: false,
        operator_diagnostics: false,
      }),
    ).toBe(false)
    expect(
      canSelectConversationCore({
        auto_simulation: true,
        simulation_mirror: true,
        operator_diagnostics: true,
      }),
    ).toBe(true)
    expect(canSelectConversationCore(null)).toBe(false)
  })

  it('loads stable runtime ids and their operator labels', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          cores: [
            { id: 'legacy', name: 'Legacy controller stack' },
            { id: 'semantic_v1', name: 'Semantic owner v1' },
          ],
          environment_core: 'legacy',
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch

    await expect(fetchConversationCores()).resolves.toEqual({
      cores: [
        { id: 'legacy', name: 'Legacy controller stack' },
        { id: 'semantic_v1', name: 'Semantic owner v1' },
      ],
      environment_core: 'legacy',
    })
  })

  it('persists a test-fan selection and sends null for immediate rollback', async () => {
    const bodies: unknown[] = []
    globalThis.fetch = vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          status: 'ok',
          conversation_core:
            (bodies.at(-1) as { conversation_core: string | null })
              .conversation_core,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await expect(
      saveSimulationFanConversationCore('creator-1', 'fan-1', 'semantic_v1'),
    ).resolves.toBe('semantic_v1')
    await expect(
      saveSimulationFanConversationCore('creator-1', 'fan-1', null),
    ).resolves.toBeNull()
    expect(bodies).toEqual([
      { conversation_core: 'semantic_v1' },
      { conversation_core: null },
    ])
  })
})
