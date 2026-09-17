import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

// Deployment identifier retained for defense in depth. Creator authorization is
// enforced by the signed-in Supabase access token attached below.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? ''

/** Absolute URL for a backend path. */
export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** Backend fetch with both deployment and signed-in operator identity attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  if (API_KEY) headers.set('X-API-Key', API_KEY)
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(apiUrl(path), { ...init, headers })
}

/**
 * What actually went wrong with a backend call, rather than "Failed to fetch".
 *
 * `fetch` rejects with a bare TypeError for every network-layer outcome there
 * is: the backend being unreachable, a request that was cut off, a CORS-blocked
 * response (which is what an unhandled 500 used to look like), and an abort.
 * Rendering that message verbatim is what left the Simulator saying "Failed to
 * fetch" while the backend had already logged a full traceback — with nothing
 * on screen to say whether to look at the network, the server, or neither.
 */
export type ApiFailureKind =
  | 'network'
  | 'timeout'
  | 'server'
  | 'client'
  | 'malformed'

export class ApiError extends Error {
  readonly kind: ApiFailureKind
  readonly status?: number
  /** Correlates with the backend log line for the same failure, when it sent one. */
  readonly errorId?: string
  /**
   * The durable turn this refusal is about, when the backend named one.
   *
   * A 409 from the Simulator is not a dead end — it means "that fan already
   * has a turn running, and here it is". The id travels on a response header
   * so the UI can go and watch the right thing instead of telling the
   * operator to try again, which is how one fan message becomes two replies.
   */
  readonly turnId?: string

  constructor(
    message: string,
    kind: ApiFailureKind,
    options: { status?: number; errorId?: string; turnId?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
    this.errorId = options.errorId
    this.turnId = options.turnId
  }
}

/**
 * Default ceiling for a backend call.
 *
 * Was 180s, because a simulated turn ran the whole Full Auto pipeline inside
 * one request. It no longer does: a turn is recorded and polled, so nothing
 * here waits on model recovery and no request needs a three-minute budget.
 * Every remaining caller is a read or a single write.
 */
export const LONG_REQUEST_TIMEOUT_MS = 60_000

/**
 * A backend call whose failures are legible: does the caller need to look at
 * the network, the server, or the response body?
 *
 * Returns the parsed JSON body on success and throws an `ApiError` otherwise,
 * so callers never have to distinguish a rejected promise from a non-ok
 * response themselves.
 */
export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? LONG_REQUEST_TIMEOUT_MS
  const label = options.label ?? 'The request'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await apiFetch(path, { ...init, signal: controller.signal })
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(
        `${label} did not finish within ${Math.round(timeoutMs / 1000)}s and was ` +
          'cancelled. The backend may still be working on it — check the server logs.',
        'timeout',
      )
    }
    throw new ApiError(
      `${label} never reached the backend (network error, backend unreachable, ` +
        'or a response the browser refused to read). Nothing was processed.',
      'network',
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text().catch(() => '')
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const detail = typeof record.detail === 'string' ? record.detail : ''
  const errorId = typeof record.error_id === 'string' ? record.error_id : undefined

  if (!response.ok) {
    const kind: ApiFailureKind = response.status >= 500 ? 'server' : 'client'
    const fallback =
      kind === 'server'
        ? `The backend failed handling ${label.toLowerCase()} (HTTP ${response.status}).`
        : `${label} was rejected (HTTP ${response.status}).`
    throw new ApiError(detail || fallback, kind, {
      status: response.status,
      errorId,
      turnId: response.headers.get('X-Simulation-Turn-Id') ?? undefined,
    })
  }

  if (body === undefined) {
    throw new ApiError(
      `${label} returned HTTP ${response.status} with a body the browser could ` +
        'not read as JSON.',
      'malformed',
      { status: response.status },
    )
  }
  return body as T
}

export async function warmBackend() {
  apiFetch('/health').catch(() => {})
}

/**
 * Which generated turn an operator-sent reply came from.
 *
 * The backend holds the turn's provenance record — the fan message that
 * triggered it, the context it saw, and the model that actually wrote the
 * candidates — behind an opaque token returned with the suggestions. Handing
 * the token back on send is what lets that record close with the delivery
 * receipt instead of the sent message having no attributable origin.
 *
 * Every field is optional, and a send with none of them is an ordinary send.
 * A reply typed from scratch genuinely has no suggestion behind it, and saying
 * so is the accurate answer, not a gap to paper over.
 */
export type ReplyAttribution = {
  /** The token from the SuggestionResponse these candidates arrived in. */
  token: string
  /** Which candidate the operator picked, 0-based. */
  index: number
  /** Whether they changed the text before sending it. */
  edited: boolean
}

// 2. Send a selected reply back to the backend (apifansly) to save and deliver
export async function sendReply(
  fanId: string,
  creatorId: string,
  content: string,
  wasAiSuggested: boolean,
  attribution?: ReplyAttribution | null,
): Promise<{ status: string; message_id: string }> {
  const response = await apiFetch('/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fan_id: fanId,
      creator_id: creatorId,
      content,
      was_ai_suggested: wasAiSuggested,
      ...(attribution
        ? {
            suggestion_token: attribution.token,
            suggestion_index: attribution.index,
            suggestion_edited: attribution.edited,
          }
        : {}),
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.detail || `Message delivery failed (${response.status})`)
  }
  return body as { status: string; message_id: string }
}

export type GeneratedSuggestions = {
  suggestions: string[]
  stage: string
  /**
   * The provenance handle for this turn, or '' when the backend did not supply
   * one. It is opaque: never parsed, never displayed, and only ever handed back
   * to sendReply.
   */
  suggestionToken: string
}

/**
 * Ask for fresh candidates.
 *
 * The same candidates also arrive over the Supabase realtime subscription, and
 * that path is what a second operator's tab sees. The response is read here
 * anyway because it is the only place the provenance token exists: the
 * suggestions table row carries the text, not the handle.
 */
export async function generateSuggestions(
  fanId: string,
  creatorId: string,
  fanMessage: string,
): Promise<GeneratedSuggestions> {
  const response = await apiFetch('/regenerate-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fan_id: fanId,
      creator_id: creatorId,
      message: fanMessage,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.detail || `Suggestion generation failed (${response.status})`)
  }
  return {
    suggestions: Array.isArray(body.suggestions) ? (body.suggestions as string[]) : [],
    stage: typeof body.stage === 'string' ? body.stage : 'WARMING_UP',
    // An older backend has no such field; that reply simply sends unattributed.
    suggestionToken: typeof body.suggestion_token === 'string' ? body.suggestion_token : '',
  }
}

export async function getLatestSuggestions(
  fanId: string,
  creatorId: string
): Promise<{ suggestions: string[]; stage: string }> {
  const { data, error } = await supabase
    .from('suggestions')
    .select('suggestions, stage')
    .eq('fan_id', fanId)
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return { suggestions: [], stage: 'WARMING_UP' }
  return {
    suggestions: data.suggestions as string[],
    stage: (data.stage as string) ?? 'WARMING_UP',
  }
}
