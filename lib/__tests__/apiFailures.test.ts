/**
 * "Failed to fetch" is not a diagnosis.
 *
 * The Simulator surfaced exactly that string and nothing else while the backend
 * had already logged a full traceback. Two causes, both invisible from the UI:
 * `fetch` rejects with a bare TypeError for every network-layer outcome there
 * is, and an unhandled backend exception used to answer with a response that
 * never passed through the CORS layer — which the browser then refuses to read
 * and reports as... the same bare TypeError.
 *
 * The backend half is fixed in main.py. This is the client half: every failure
 * comes back saying which layer failed, and a server failure carries the id that
 * ties it to the log line.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiJson } from '../api'
import { describeSimulationFailure } from '../simulation'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.useRealTimers()
})

function respond(status: number, body: string, contentType = 'application/json') {
  globalThis.fetch = vi.fn(async () =>
    new Response(body, { status, headers: { 'content-type': contentType } }),
  ) as unknown as typeof fetch
}

describe('apiJson classifies what actually failed', () => {
  it('reports a rejected fetch as a network failure, not as a decision', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(apiJson('/x', {}, { label: 'The simulated turn' })).rejects.toMatchObject({
      kind: 'network',
    })
    await apiJson('/x', {}, { label: 'The simulated turn' }).catch((error: ApiError) => {
      expect(error.message).toContain('never reached the backend')
      expect(error.message).not.toBe('Failed to fetch')
    })
  })

  it('reports a backend 500 as a server failure and keeps its error id', async () => {
    respond(
      500,
      JSON.stringify({
        detail: 'The simulated turn failed inside the backend (KeyError).',
        error_id: 'abc123def456',
        error_type: 'KeyError',
      }),
    )

    const error = await apiJson('/x').catch((caught: ApiError) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
    expect((error as ApiError).status).toBe(500)
    expect((error as ApiError).errorId).toBe('abc123def456')
    expect((error as ApiError).message).toContain('KeyError')
  })

  it('reports a 4xx separately from a 5xx', async () => {
    respond(404, JSON.stringify({ detail: 'Not found' }))
    const error = await apiJson('/x').catch((caught: ApiError) => caught)
    expect((error as ApiError).kind).toBe('client')
    expect((error as ApiError).status).toBe(404)
  })

  it('reports a body it cannot read as malformed, not as success', async () => {
    respond(200, '<html>gateway</html>', 'text/html')
    const error = await apiJson('/x').catch((caught: ApiError) => caught)
    expect((error as ApiError).kind).toBe('malformed')
  })

  it('reports an abort as a timeout and says the backend may still be running', async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    ) as unknown as typeof fetch

    const error = await apiJson('/x', {}, { timeoutMs: 5, label: 'The simulated turn' }).catch(
      (caught: ApiError) => caught,
    )
    expect((error as ApiError).kind).toBe('timeout')
    expect((error as ApiError).message).toContain('may still be working on it')
  })

  it('returns the parsed body on success', async () => {
    respond(200, JSON.stringify({ status: 'ok', creator_messages: [] }))
    await expect(apiJson<{ status: string }>('/x')).resolves.toMatchObject({ status: 'ok' })
  })
})

describe('describeSimulationFailure names the layer', () => {
  it('prefixes a network failure', () => {
    expect(describeSimulationFailure(new ApiError('gone', 'network'))).toMatch(/^Network: /)
  })

  it('prefixes a server failure with its status and quotes the error id', () => {
    const text = describeSimulationFailure(
      new ApiError('boom', 'server', { status: 500, errorId: 'abc123' }),
    )
    expect(text).toContain('Backend 500')
    expect(text).toContain('abc123')
  })

  it('prefixes a timeout', () => {
    expect(describeSimulationFailure(new ApiError('slow', 'timeout'))).toMatch(/^Timeout: /)
  })

  it('still renders an ordinary Error unchanged', () => {
    expect(describeSimulationFailure(new Error('something else'))).toBe('something else')
  })
})
