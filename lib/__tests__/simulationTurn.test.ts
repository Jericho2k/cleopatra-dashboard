/**
 * A simulated turn is polled, not awaited.
 *
 * THE INCIDENT
 * ------------
 * The Simulator ran one whole Full Auto turn inside one browser request. When
 * the V3 writer started pursuing its own model properly — retrying a
 * rate-limited provider, then trying the same model on another host — a turn
 * could legitimately outlive the browser's 180-second ceiling. The screen then
 * said:
 *
 *     Timeout: The simulated turn did not finish within 180s and was cancelled
 *
 * Both halves of that sentence were false. Nothing had been cancelled, and the
 * turn had not failed: the backend went on, the fallback answered, and a reply
 * was persisted. The operator, looking at "failed", presses Send again — and
 * one fan message becomes two contradictory creator replies.
 *
 * These tests hold the client half closed: the submission returns a turn id
 * rather than a reply, the result arrives by polling, a poll never starts
 * anything, one press of Send can only ever be one turn, and what the operator
 * is told while waiting names no provider and no model.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api'
import {
  SLOW_TURN_NOTICE_MS,
  SimulationTurnBusyError,
  TURN_POLL_INTERVAL_MS,
  completedTurnMessage,
  fetchLatestSimulationTurn,
  fetchSimulationTurn,
  newIdempotencyKey,
  startSimulatedTurn,
  turnFailureMessage,
  turnIsTerminal,
  turnProgressMessage,
  type SimulationTurn,
} from '../simulation'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

type Call = { url: string; init: RequestInit }

function serve(responses: Array<[number, unknown, Record<string, string>?]>) {
  const calls: Call[] = []
  let index = 0
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const [status, body, headers] = responses[Math.min(index, responses.length - 1)]
    index += 1
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return calls
}

function turn(overrides: Partial<SimulationTurn> = {}): SimulationTurn {
  return {
    turn_id: 'turn-1',
    status: 'processing',
    ...overrides,
  }
}

// --- the submission returns a turn, not a reply -----------------------------

describe('startSimulatedTurn', () => {
  it('returns as soon as the turn is recorded, carrying its id', async () => {
    const calls = serve([
      [200, { turn_id: 'turn-1', status: 'processing', created: true }],
    ])

    const started = await startSimulatedTurn('c1', 'f1', 'hii', true, 'send-1')

    expect(started.turn_id).toBe('turn-1')
    expect(started.status).toBe('processing')
    expect(calls[0].url).toContain('/creator/c1/fan/f1/simulate-inbound')
    expect(calls[0].init.method).toBe('POST')
  })

  it('sends the idempotency key, so a retried POST cannot become a second turn', async () => {
    const calls = serve([[200, { turn_id: 'turn-1', status: 'processing' }]])

    await startSimulatedTurn('c1', 'f1', 'hii', true, 'send-1')

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: 'hii',
      fast: true,
      idempotency_key: 'send-1',
    })
  })

  it('does not hold a request open for the length of the pipeline', async () => {
    // A submission is one insert. The old 180s ceiling existed only because
    // the request waited on model recovery, and nothing here does any more.
    const timeouts: number[] = []
    const spy = vi.spyOn(globalThis, 'setTimeout')
    serve([[200, { turn_id: 'turn-1', status: 'processing' }]])

    await startSimulatedTurn('c1', 'f1', 'hii', true, 'send-1')

    for (const call of spy.mock.calls) {
      if (typeof call[1] === 'number') timeouts.push(call[1])
    }
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(30_000)
  })

  it('turns a 409 into the turn the operator should be watching', async () => {
    serve([
      [
        409,
        { detail: 'A simulated turn is still running for this fan.' },
        { 'X-Simulation-Turn-Id': 'turn-already-running' },
      ],
    ])

    const caught = await startSimulatedTurn('c1', 'f1', 'hii', true, 'send-2').catch(
      error => error,
    )

    expect(caught).toBeInstanceOf(SimulationTurnBusyError)
    expect(caught.turnId).toBe('turn-already-running')
  })

  it('still reports an ordinary backend failure as one', async () => {
    serve([[500, { detail: 'boom', error_id: 'abc123' }]])

    const caught = await startSimulatedTurn('c1', 'f1', 'hii', true, 'send-1').catch(
      error => error,
    )

    expect(caught).toBeInstanceOf(ApiError)
    expect(caught.kind).toBe('server')
    expect(caught.errorId).toBe('abc123')
  })
})

describe('newIdempotencyKey', () => {
  it('is different for every press of Send', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()))
    expect(keys.size).toBe(50)
  })

  it('works without crypto.randomUUID', () => {
    // An insecure context, or an older browser. Losing idempotency there
    // would mean losing the guarantee that one Send is one turn, which is
    // exactly the guarantee an unreliable connection needs most.
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue(
      undefined as unknown as Crypto,
    )

    expect(newIdempotencyKey()).toMatch(/^turn-\d+-[a-z0-9]+$/)
  })
})

// --- polling ----------------------------------------------------------------

describe('fetchSimulationTurn', () => {
  it('reads the turn without posting anything', async () => {
    const calls = serve([[200, { turn_id: 'turn-1', status: 'completed' }]])

    const polled = await fetchSimulationTurn('c1', 'f1', 'turn-1')

    expect(polled.status).toBe('completed')
    expect(calls[0].url).toContain('/creator/c1/fan/f1/simulation/turn/turn-1')
    expect(calls[0].init.method).toBeUndefined()
    expect(calls[0].init.body).toBeUndefined()
  })

  it('brings the persisted reply back with the completed turn', async () => {
    serve([
      [
        200,
        {
          turn_id: 'turn-1',
          status: 'completed',
          outcome: 'replied',
          creator_messages: [
            { id: 'm1', role: 'creator', content: 'hey you', sent_at: null },
          ],
        },
      ],
    ])

    const polled = await fetchSimulationTurn('c1', 'f1', 'turn-1')

    // No manual Refresh: the reply arrives with the turn that produced it.
    expect(polled.creator_messages?.[0].content).toBe('hey you')
  })
})

describe('fetchLatestSimulationTurn', () => {
  it('recovers the turn a reloaded browser was watching', async () => {
    serve([[200, { turn_id: 'turn-1', status: 'processing' }]])

    const recovered = await fetchLatestSimulationTurn('c1', 'f1')

    expect(recovered?.turn_id).toBe('turn-1')
    expect(turnIsTerminal(recovered)).toBe(false)
  })

  it('returns null for a conversation that has never had a turn', async () => {
    serve([[200, { status: 'ok', simulation: true, turn_id: null }]])

    expect(await fetchLatestSimulationTurn('c1', 'f1')).toBeNull()
  })
})

describe('turnIsTerminal', () => {
  it('distinguishes running from finished', () => {
    expect(turnIsTerminal(turn({ status: 'processing' }))).toBe(false)
    expect(turnIsTerminal(turn({ status: 'completed' }))).toBe(true)
    expect(turnIsTerminal(turn({ status: 'failed' }))).toBe(true)
    expect(turnIsTerminal(null)).toBe(false)
  })
})

describe('the poll interval', () => {
  it('is frequent enough to feel immediate and cheap enough to leave running', () => {
    expect(TURN_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(1_000)
    expect(TURN_POLL_INTERVAL_MS).toBeLessThanOrEqual(5_000)
  })
})

// --- what the operator is told ----------------------------------------------

describe('turnProgressMessage', () => {
  it('says the reply is being generated, and then that it is taking a while', () => {
    expect(turnProgressMessage(0)).toBe('Generating reply…')
    expect(turnProgressMessage(SLOW_TURN_NOTICE_MS - 1)).toBe('Generating reply…')
    expect(turnProgressMessage(SLOW_TURN_NOTICE_MS)).toBe(
      'Still generating — the primary writer is temporarily busy.',
    )
  })

  it('never names a provider, a model, or the fallback', () => {
    // Agency operators see this. Which host is throttling, which model is
    // being pursued and that a second model exists are all operator
    // diagnostics — the same boundary the persisted message marker respects.
    for (const elapsed of [0, 1_000, 44_999, 45_000, 120_000, 600_000]) {
      const message = turnProgressMessage(elapsed).toLowerCase()
      for (const secret of [
        'inceptron',
        'openrouter',
        'kimi',
        'qwen',
        'moonshot',
        'together',
        'provider',
        '429',
        'rate limit',
        'fallback',
      ]) {
        expect(message).not.toContain(secret)
      }
    }
  })

  it('never claims a timeout while the backend is still working', () => {
    for (const elapsed of [0, 180_000, 600_000]) {
      expect(turnProgressMessage(elapsed).toLowerCase()).not.toContain('timeout')
      expect(turnProgressMessage(elapsed).toLowerCase()).not.toContain('cancelled')
    }
  })
})

describe('turnFailureMessage', () => {
  it('is empty for a turn that has not failed', () => {
    expect(turnFailureMessage(turn({ status: 'processing' }))).toBe('')
    expect(turnFailureMessage(turn({ status: 'completed' }))).toBe('')
  })

  it('says a deadline failure is final, so retrying is safe', () => {
    // The whole point of the terminal state: a failed turn will not wake up
    // later and persist a reply, so "try again" is honest advice rather than
    // the duplicate-reply trap the old timeout message set.
    const message = turnFailureMessage(
      turn({ status: 'failed', outcome: 'deadline_exceeded' }),
    )

    expect(message).toContain('nothing will arrive later')
    expect(message).toContain('safe to try again')
    expect(message.toLowerCase()).not.toContain('kimi')
  })

  it('quotes the correlating id for a backend failure', () => {
    const message = turnFailureMessage(
      turn({ status: 'failed', outcome: 'backend_error', error_id: 'abc123' }),
    )

    expect(message).toContain('abc123')
  })
})

describe('completedTurnMessage', () => {
  it('shows a persisted owner review reason on a completed turn', () => {
    const result = completedTurnMessage(turn({
      status: 'completed', outcome: 'human_review', creator_messages: [],
      error: 'semantic_execution_refused: selected_set_unavailable',
    }))
    expect(result).toContain('selected_set_unavailable')
    expect(result).toContain('paused for review')
    expect(result).not.toContain('handed to a person')
    expect(result).not.toContain('safe to try again')
  })
  it('says nothing when the turn produced a reply', () => {
    expect(
      completedTurnMessage(
        turn({
          status: 'completed',
          outcome: 'replied',
          creator_messages: [
            { id: 'm1', role: 'creator', content: 'hey you', sent_at: null },
          ],
        }),
      ),
    ).toBe('')
  })

  it('reports a writer failure as a failure, not as a decision', () => {
    const message = completedTurnMessage(
      turn({ status: 'completed', outcome: 'writer_failed', creator_messages: [] }),
    )

    expect(message).toContain('Writer generation failed')
    expect(message).not.toContain('decided to send nothing')
  })

  it('still reports a genuine no-send decision as one', () => {
    expect(
      completedTurnMessage(
        turn({ status: 'completed', outcome: 'no_send', creator_messages: [] }),
      ),
    ).toBe('Full Auto decided to send nothing this turn.')
  })

  it('reports a failed turn through the failure vocabulary', () => {
    expect(
      completedTurnMessage(turn({ status: 'failed', outcome: 'deadline_exceeded' })),
    ).toContain('backend time limit')
  })

  it('says nothing about a turn that is still running', () => {
    expect(completedTurnMessage(turn({ status: 'processing' }))).toBe('')
  })
})

// Semantic V1 receipts use the durable production PPV shape. Polling returns
// that attachment, so the next render can show the card without a Refresh.
describe('semantic locked offer completion', () => {
  it('returns the exact PPV card with its natural caption on the completion poll', async () => {
    const { ppvPresentation } = await import('../simulationWorkspace')
    serve([[200, {
      turn_id: 'semantic-1', status: 'completed', outcome: 'replied',
      creator_messages: [{
        id: 'ppv-1', role: 'creator', content: 'knew you would 😏', sent_at: null,
        media_context: { ppv: {
          media_ids: ['approved-1', 'approved-2'], price_cents: 3000,
          set_id: 'set-1', payment_reference: 'payment-1', access_type: 'ppv',
        } },
      }],
    }]])
    const completed = await fetchSimulationTurn('c1', 'f1', 'semantic-1')
    const message = completed.creator_messages![0]
    expect(message.content).toBe('knew you would 😏')
    expect(completedTurnMessage(completed)).toBe('')
    expect(ppvPresentation(message.media_context)).toMatchObject({
      kind: 'locked', price: 30, priceCents: 3000,
      mediaIds: ['approved-1', 'approved-2'], setId: 'set-1', purchased: false,
    })
  })

  it('shows exhausted semantic repair as controlled human review, not a failed turn', () => {
    const completed = turn({ status: 'completed', outcome: 'human_review', creator_messages: [] })
    expect(turnIsTerminal(completed)).toBe(true)
    expect(completedTurnMessage(completed)).toContain('paused for review')
    expect(completedTurnMessage(completed)).not.toContain('handed to a person')
    expect(turnFailureMessage(completed)).toBe('')
    expect(completedTurnMessage(completed)).not.toContain('safe to try again')
  })
})
