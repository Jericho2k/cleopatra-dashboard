/**
 * An operator-sent reply says which turn produced it — or says nothing.
 *
 * The backend can now record, for every visible reply, the fan message that
 * triggered it, the context it saw, the decision behind it and the model that
 * actually wrote it. Full Auto generates and sends inside one function, so it
 * keeps that record itself. Assisted does not: a person reads the candidates in
 * between, and the send is a separate request. The suggestion token is what
 * spans that gap.
 *
 * What these tests hold is the honest half of the contract. A reply typed from
 * scratch, one sent from an older set of candidates, or one sent after the
 * token was dropped all send exactly as before, with no provenance — never with
 * provenance belonging to a different turn.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateSuggestions, sendReply } from '../api'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function capture(body: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const request = init as RequestInit
    calls.push({
      url: String(url),
      body: JSON.parse(String(request?.body ?? '{}')),
    })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return calls
}

describe('generateSuggestions carries the provenance handle', () => {
  it('reads the token from the response the suggestions came in', async () => {
    capture({
      suggestions: ['one', 'two'],
      stage: 'WARMING_UP',
      suggestion_token: 'tok-abc',
    })

    const result = await generateSuggestions('fan-1', 'creator-1', 'hey')

    expect(result.suggestions).toEqual(['one', 'two'])
    expect(result.suggestionToken).toBe('tok-abc')
  })

  it('treats a backend that does not supply one as no provenance', async () => {
    capture({ suggestions: ['one'], stage: 'WARMING_UP' })

    const result = await generateSuggestions('fan-1', 'creator-1', 'hey')

    expect(result.suggestionToken).toBe('')
  })

  it('still reports a failed generation as a failure', async () => {
    capture({ detail: 'nope' }, 500)

    await expect(generateSuggestions('fan-1', 'creator-1', 'hey')).rejects.toThrow(
      'nope',
    )
  })
})

describe('sendReply attributes a reply only when there is something to attribute', () => {
  it('sends the token, the chosen candidate and whether it was edited', async () => {
    const calls = capture({ status: 'ok', message_id: 'm-1' })

    await sendReply('fan-1', 'creator-1', 'hey you', true, {
      token: 'tok-abc',
      index: 1,
      edited: true,
    })

    expect(calls[0].body).toMatchObject({
      fan_id: 'fan-1',
      creator_id: 'creator-1',
      content: 'hey you',
      was_ai_suggested: true,
      suggestion_token: 'tok-abc',
      suggestion_index: 1,
      suggestion_edited: true,
    })
  })

  it('an unedited pick is recorded as unedited, not merely omitted', async () => {
    const calls = capture({ status: 'ok', message_id: 'm-1' })

    await sendReply('fan-1', 'creator-1', 'one', true, {
      token: 'tok-abc',
      index: 0,
      edited: false,
    })

    expect(calls[0].body.suggestion_edited).toBe(false)
  })

  it('a reply typed from scratch sends no attribution at all', async () => {
    const calls = capture({ status: 'ok', message_id: 'm-1' })

    await sendReply('fan-1', 'creator-1', 'typed by hand', false)

    expect(calls[0].body).not.toHaveProperty('suggestion_token')
    expect(calls[0].body).not.toHaveProperty('suggestion_index')
    expect(calls[0].body.was_ai_suggested).toBe(false)
  })

  it('an explicit null attribution is the same as none', async () => {
    const calls = capture({ status: 'ok', message_id: 'm-1' })

    await sendReply('fan-1', 'creator-1', 'typed by hand', false, null)

    expect(calls[0].body).not.toHaveProperty('suggestion_token')
  })

  it('a delivery failure is still reported as a failure', async () => {
    capture({ detail: 'Fansly did not accept the message' }, 502)

    await expect(
      sendReply('fan-1', 'creator-1', 'hey', true, {
        token: 'tok-abc',
        index: 0,
        edited: false,
      }),
    ).rejects.toThrow('Fansly did not accept the message')
  })
})
