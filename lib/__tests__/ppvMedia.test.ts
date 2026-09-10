/**
 * FE-007 — the PPV media effect must not be able to loop.
 *
 * The effect derived the ids it still needed from `ppvMediaMap`, wrote its
 * results into `ppvMediaMap`, and listed `ppvMediaMap` as a dependency. It
 * terminated only because the server answered for every id it was asked about.
 * A response that omitted one — an error for a single item, keys that did not
 * match the ids requested, an empty map — left that id unresolved, re-armed the
 * effect, and requested it again indefinitely.
 *
 * The invariant that makes that impossible is asserted directly below: after
 * merging ANY response, no requested id is still pending. The final test runs
 * the actual request/merge cycle to a fixed point against a deliberately
 * uncooperative server and asserts it converges — with a round cap, so a
 * regression fails the test instead of hanging the suite.
 */

import { describe, expect, it } from 'vitest'
import {
  type PpvMediaMap,
  collectPpvMediaIds,
  markPpvMediaUnresolved,
  mergePpvMediaResponse,
  pendingPpvMediaIds,
} from '../ppvMedia'

const resolved = (id: string) => ({
  url: `https://vault/${id}`,
  thumbnail_url: `https://vault/${id}/thumb`,
  mimetype: 'image/jpeg',
})

function ppvMessage(ids: string[]) {
  return { media_context: { ppv: { media_ids: ids } } }
}

describe('collectPpvMediaIds', () => {
  it('collects ids from media_ids and legacy media_id alike', () => {
    const messages = [
      ppvMessage(['a', 'b']),
      { media_context: { ppv: { media_id: 'c' } } },
      { media_context: null },
      {},
    ]

    expect(collectPpvMediaIds(messages)).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates ids referenced by several messages', () => {
    expect(collectPpvMediaIds([ppvMessage(['a']), ppvMessage(['a', 'b'])]))
      .toEqual(['a', 'b'])
  })

  it('never produces an empty id to request', () => {
    const messages = [
      { media_context: { ppv: { media_ids: ['', 'a'] } } },
      { media_context: { ppv: { media_id: '' } } },
    ]

    expect(collectPpvMediaIds(messages)).toEqual(['a'])
  })
})

describe('pendingPpvMediaIds', () => {
  it('asks only for ids not already requested', () => {
    expect(pendingPpvMediaIds(['a', 'b', 'c'], new Set(['a']))).toEqual(['b', 'c'])
  })

  it('asks for nothing when everything has been requested', () => {
    expect(pendingPpvMediaIds(['a', 'b'], new Set(['a', 'b']))).toEqual([])
  })

  it('is driven by what was requested, not by what resolved', () => {
    // An id that was asked about and came back unanswered has been requested.
    // Asking again because it is unresolved is precisely the loop.
    expect(pendingPpvMediaIds(['a'], new Set(['a']))).toEqual([])
  })
})

describe('mergePpvMediaResponse', () => {
  it('records every requested id when the server answers for all of them', () => {
    const merged = mergePpvMediaResponse({}, ['a', 'b'], {
      a: resolved('a'),
      b: resolved('b'),
    })

    expect(Object.keys(merged).sort()).toEqual(['a', 'b'])
    expect(merged.a.url).toBe('https://vault/a')
  })

  it('backfills ids the server answered for only partially', () => {
    const merged = mergePpvMediaResponse({}, ['a', 'b', 'c'], { a: resolved('a') })

    expect(merged.b).toEqual({ url: null, thumbnail_url: null, mimetype: null })
    expect(merged.c).toEqual({ url: null, thumbnail_url: null, mimetype: null })
  })

  it('backfills every id when the server returns an empty map', () => {
    const merged = mergePpvMediaResponse({}, ['a', 'b'], {})

    expect(Object.keys(merged).sort()).toEqual(['a', 'b'])
  })

  it('backfills every id when the response has no media at all', () => {
    expect(Object.keys(mergePpvMediaResponse({}, ['a'], undefined))).toEqual(['a'])
    expect(Object.keys(mergePpvMediaResponse({}, ['a'], null))).toEqual(['a'])
  })

  it('records requested ids even when the response keys do not match them', () => {
    // The exact shape that used to loop: the server answers, but about
    // something else entirely.
    const merged = mergePpvMediaResponse({}, ['a', 'b'], {
      'something-else': resolved('something-else'),
    })

    expect(merged.a).toEqual({ url: null, thumbnail_url: null, mimetype: null })
    expect(merged.b).toEqual({ url: null, thumbnail_url: null, mimetype: null })
    expect(merged['something-else'].url).toBeTruthy()
  })

  it('lets a real answer win over the backfill', () => {
    const merged = mergePpvMediaResponse({}, ['a'], { a: resolved('a') })

    expect(merged.a.url).toBe('https://vault/a')
  })

  it('keeps entries resolved earlier', () => {
    const previous: PpvMediaMap = { old: resolved('old') }

    expect(mergePpvMediaResponse(previous, ['a'], {}).old.url).toBe('https://vault/old')
  })

  it('does not mutate the previous map', () => {
    const previous: PpvMediaMap = {}

    mergePpvMediaResponse(previous, ['a'], {})

    expect(previous).toEqual({})
  })
})

describe('markPpvMediaUnresolved', () => {
  it('records every requested id when the request fails outright', () => {
    const merged = markPpvMediaUnresolved({}, ['a', 'b'])

    expect(merged.a).toEqual({ url: null, thumbnail_url: null, mimetype: null })
    expect(merged.b).toEqual({ url: null, thumbnail_url: null, mimetype: null })
  })
})

describe('the effect cannot loop', () => {
  /**
   * Runs request -> merge to a fixed point exactly as the effect does, against
   * a server chosen to be as unhelpful as it is allowed to be. Returns the
   * number of rounds; a regression shows up as hitting the cap rather than as
   * a hung test run.
   */
  function runToFixedPoint(
    messages: ReturnType<typeof ppvMessage>[],
    server: (ids: string[]) => PpvMediaMap | null | undefined,
    maxRounds = 20,
  ): { rounds: number; requests: string[][]; map: PpvMediaMap } {
    const requested = new Set<string>()
    const requests: string[][] = []
    let map: PpvMediaMap = {}
    let rounds = 0

    while (rounds < maxRounds) {
      const pending = pendingPpvMediaIds(collectPpvMediaIds(messages), requested)
      if (pending.length === 0) break
      rounds += 1
      requests.push(pending)
      pending.forEach(id => requested.add(id))
      map = mergePpvMediaResponse(map, pending, server(pending))
    }
    return { rounds, requests, map }
  }

  it('stops after one round when the server answers fully', () => {
    const outcome = runToFixedPoint(
      [ppvMessage(['a', 'b'])],
      ids => Object.fromEntries(ids.map(id => [id, resolved(id)])),
    )

    expect(outcome.rounds).toBe(1)
    expect(outcome.requests).toEqual([['a', 'b']])
  })

  it('stops after one round when the server answers only partially', () => {
    const outcome = runToFixedPoint(
      [ppvMessage(['a', 'b', 'c'])],
      () => ({ a: resolved('a') }),
    )

    expect(outcome.rounds).toBe(1)
  })

  it('stops after one round when the server returns an empty map', () => {
    const outcome = runToFixedPoint([ppvMessage(['a', 'b'])], () => ({}))

    expect(outcome.rounds).toBe(1)
  })

  it('stops after one round when the server returns unrelated keys', () => {
    const outcome = runToFixedPoint(
      [ppvMessage(['a', 'b'])],
      () => ({ 'not-what-was-asked': resolved('x') }),
    )

    expect(outcome.rounds).toBe(1)
  })

  it('requests each unresolved id at most once per recovery cycle', () => {
    const outcome = runToFixedPoint([ppvMessage(['a', 'b', 'c'])], () => ({}))

    const everyRequestedId = outcome.requests.flat()
    expect(everyRequestedId).toEqual([...new Set(everyRequestedId)])
  })

  it('re-requests after a recovery cycle clears the requested set', () => {
    // Signed vault URLs expire, so a realtime reconnect has to be able to ask
    // again — bounded, once per cycle, not continuously.
    const messages = [ppvMessage(['a'])]
    const first = runToFixedPoint(messages, () => ({}))
    expect(first.rounds).toBe(1)

    const second = runToFixedPoint(messages, () => ({ a: resolved('a') }))
    expect(second.rounds).toBe(1)
    expect(second.map.a.url).toBe('https://vault/a')
  })

  it('picks up a new message without re-requesting the old ids', () => {
    const requested = new Set(['a'])
    const messages = [ppvMessage(['a']), ppvMessage(['b'])]

    expect(pendingPpvMediaIds(collectPpvMediaIds(messages), requested)).toEqual(['b'])
  })
})
