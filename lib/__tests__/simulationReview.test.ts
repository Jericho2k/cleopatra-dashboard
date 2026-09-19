import { afterEach, expect, it, vi } from 'vitest'
import { resumeSimulationReview } from '../simulationWorkspace'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))
afterEach(() => vi.unstubAllGlobals())

it('resumes through the existing recovery route without replaying an inbound turn', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'resumed' }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  await resumeSimulationReview('test-fan')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toContain('/fan/test-fan/resolve-review')
  expect(JSON.parse(init.body)).toEqual({ resolution: 'resume_ai' })
})

it('preserves a recovery refusal rather than pretending the pause was cleared', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ detail: 'Resolve the pending receipt first.' }), { status: 409 },
  )))
  await expect(resumeSimulationReview('test-fan')).rejects.toThrow('Resolve the pending receipt first.')
})
