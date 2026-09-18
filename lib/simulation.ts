/**
 * The Full Auto simulator: capabilities, navigation gating, and transcript.
 *
 * The backend is the security boundary. Everything here decides what to RENDER.
 *
 * TWO TIERS, and the difference is what this module exists to express.
 *
 * `auto_simulation` — this account may open the simulator and use it on the
 * creators it already holds. Ordinary agency operators have this.
 *
 * `simulation_mirror` — this account may use the CROSS-TENANT catalog mirror.
 * Owner only. An agency account must see no trace of it: no control, no
 * disabled button, no explanatory tooltip about a feature it cannot use. A
 * disabled control is still a disclosure, so the mirror UI is not rendered at
 * all rather than rendered inert.
 *
 * Every capability starts as `null` ("not answered yet") and is treated exactly
 * like `false`, so nothing flashes into view and then disappears. A failed
 * request, an offline backend, a 404 and a plain `false` all collapse to the
 * same thing: that capability does not exist for this account.
 *
 * No allowlist, user id, or environment variable ever reaches the client. The
 * only thing the client learns is three booleans about itself.
 */

import { ApiError, apiFetch, apiJson } from './api'

export type SimulationCapabilities = {
  auto_simulation: boolean
  /** May use the cross-tenant catalog mirror. Owner only. */
  simulation_mirror: boolean
  /** May see retrieval method, transfer credits and classifier internals. */
  operator_diagnostics: boolean
}

export type SimulationTestFan = {
  id: string
  display_name: string
  /** Always a `test_` id. Shown so the owner can see the boundary is real. */
  platform_fan_id?: string | null
  /**
   * This test fan's own AI Stack Profile override, or null to inherit the
   * creator's. Honoured by the backend ONLY for `test_` fans, so it can never
   * affect a real conversation. Absent on a backend whose ai_stack_profile
   * migration has not been applied yet.
   */
  ai_stack_profile?: string | null
  /** Owner-only architecture override. Null inherits creator/deployment. */
  conversation_core?: string | null
}

export type SimulationCreator = {
  id: string
  name: string
  test_fans: SimulationTestFan[]
}

export type SimulatedCreatorMessage = {
  id: string
  role: 'creator'
  content: string
  sent_at: string | null
  media_context?: Record<string, unknown> | null
}

/**
 * What one Full Auto turn actually did, as reported by the backend.
 *
 * An empty transcript is not one event but three, and the simulator used to
 * present all of them as "Full Auto decided to send nothing this turn". That
 * sentence was displayed during a total writer outage — every configured model
 * failed and nothing was sent — which is the opposite of a decision. The backend
 * now reports which of the three happened; the UI must not go back to guessing.
 */
export type SimulationOutcome =
  | 'replied'
  | 'no_send'
  | 'analyzer_degraded'
  | 'writer_failed'
  | 'plan_unrecoverable'
  | 'inventory_unsafe'
  | 'owner_failed'
  | 'stale_generation'
  | 'approval_required'
  | 'human_review'

export type SimulatedTurn = {
  status: string
  simulation: boolean
  fast?: boolean
  fan_message_id: string
  creator_messages: SimulatedCreatorMessage[]
  analysis_degraded?: boolean
  outcome?: SimulationOutcome
}

/**
 * The three states a durable simulated turn can be in, from here.
 *
 * The backend also distinguishes "recorded" from "started", which is a
 * difference only it can act on; both arrive here as `processing`.
 */
export type TurnState = 'processing' | 'completed' | 'failed'

/**
 * One durable turn, as the backend reports it.
 *
 * A turn is no longer the lifetime of a browser request. The POST records it
 * and returns; the pipeline runs behind it; this is polled until it is
 * terminal. That is the whole of the fix for the incident where the browser
 * reported `Timeout: The simulated turn did not finish within 180s` while the
 * backend was still working and went on to persist a reply — leaving the
 * screen and the database disagreeing about whether the turn had happened.
 *
 * `deadline_exceeded` is the backend's own ceiling, not a browser's. When it
 * appears, the turn really is over: nothing further will be persisted for it.
 */
export type SimulationTurn = {
  turn_id: string
  status: TurnState
  outcome?: SimulationOutcome | 'deadline_exceeded' | 'backend_error' | null
  fan_message_id?: string | null
  creator_message_ids?: string[]
  creator_messages?: SimulatedCreatorMessage[]
  analysis_degraded?: boolean
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  /** Owner diagnostics. Absent for an agency operator. */
  error?: string | null
  error_id?: string | null
  /** True only on the response that CREATED the turn, never on a poll. */
  created?: boolean
}

export function turnIsTerminal(turn: SimulationTurn | null): boolean {
  return turn?.status === 'completed' || turn?.status === 'failed'
}

/**
 * How often to ask, while a turn is running.
 *
 * Two seconds: fast enough that a turn which finished in five feels immediate,
 * slow enough that a turn spending a minute on writer recovery costs about
 * thirty reads rather than hundreds. A poll is a pure read on the backend — it
 * never starts a generation — so the only cost of being wrong here is noise.
 */
export const TURN_POLL_INTERVAL_MS = 2_000

/**
 * When the wait stops being ordinary.
 *
 * Below this the operator is told the reply is being generated, which is all
 * they need. Above it, silence starts to read as a hang, so the UI explains —
 * at PRODUCT level. An agency operator is never told that a provider is rate
 * limiting, which provider it is, which model is being pursued, or that a
 * fallback exists. "The primary writer is temporarily busy" is true, useful,
 * and says none of it.
 */
export const SLOW_TURN_NOTICE_MS = 45_000

export function turnProgressMessage(elapsedMs: number): string {
  return elapsedMs >= SLOW_TURN_NOTICE_MS
    ? 'Still generating — the primary writer is temporarily busy.'
    : 'Generating reply…'
}

/**
 * What to tell the operator about a turn that ended without a reply.
 *
 * A failed turn is terminal in the strong sense: the backend will not persist
 * anything for it afterwards, so "try again" is safe advice rather than the
 * duplicate-reply trap the old timeout message set.
 */
export function turnFailureMessage(turn: SimulationTurn): string {
  if (turn.status !== 'failed') return ''
  if (turn.outcome === 'deadline_exceeded') {
    return (
      'The turn ran past the backend time limit and was stopped. Nothing was ' +
      'sent, and nothing will arrive later — it is safe to try again.'
    )
  }
  const reference = turn.error_id ? ` (error ${turn.error_id})` : ''
  return `The simulated turn failed in the backend${reference}. Nothing was sent.`
}

/**
 * The turn's result, expressed in the existing outcome vocabulary.
 *
 * A completed turn reports what Full Auto decided; a failed one is a backend
 * failure and is not one of those decisions.
 */
export function completedTurnMessage(turn: SimulationTurn): string {
  if (turn.status === 'failed') return turnFailureMessage(turn)
  if (turn.status !== 'completed') return ''
  if ((turn.creator_messages ?? []).length > 0) return ''
  return turnOutcomeMessage({
    status: 'ok',
    simulation: true,
    fan_message_id: turn.fan_message_id ?? '',
    creator_messages: turn.creator_messages ?? [],
    analysis_degraded: turn.analysis_degraded,
    outcome: (turn.outcome ?? undefined) as SimulationOutcome | undefined,
  })
}

/**
 * The outcome of a turn, tolerating a backend that has not deployed yet.
 *
 * An older backend sends no `outcome`. Falling back to `analysis_degraded` and
 * then to `no_send` reproduces exactly the old behaviour rather than inventing a
 * failure the server never reported.
 */
export function turnOutcome(turn: SimulatedTurn): SimulationOutcome {
  if (turn.outcome) return turn.outcome
  if (turn.creator_messages.length > 0) return 'replied'
  return turn.analysis_degraded ? 'analyzer_degraded' : 'no_send'
}

/**
 * What to tell the operator when a turn produced no creator message.
 *
 * Returns an empty string when the turn replied, because there is nothing to
 * report. A writer failure is stated as a failure: it means the deployment is
 * broken and needs looking at, not that Full Auto exercised judgement.
 */
export function turnOutcomeMessage(turn: SimulatedTurn): string {
  switch (turnOutcome(turn)) {
    case 'replied':
      return ''
    case 'writer_failed':
      return 'Writer generation failed — no message was sent. Every configured writer model failed or returned unusable output; check the backend logs.'
    case 'owner_failed':
      return 'The semantic decision owner failed closed. No legacy controller ran and no message was sent.'
    case 'stale_generation':
      return 'Conversation or transaction state changed during generation, so the stale decision was discarded.'
    case 'approval_required':
      return 'The exact locked message is waiting for operator approval. Nothing was presented or delivered yet.'
    case 'human_review':
      return 'The conversation was handed to a person. No automated message or commercial operation was sent.'
    case 'analyzer_degraded':
      return 'Full Auto sent nothing: the situation analyzer was degraded and failed closed.'
    case 'plan_unrecoverable':
      return 'A commercial plan could not be produced and recovery could not repair it, so nothing was sent. That names a broken sale, not a decision.'
    case 'inventory_unsafe':
      return 'Every candidate promised media that does not exist, and repairing them left nothing sendable. Nothing was sent, which is correct: the promise must never go out instead.'
    case 'no_send':
    default:
      return 'Full Auto decided to send nothing this turn.'
  }
}

export type NavEntry = {
  href: string
  label: string
}

/** The navigation every account sees, in order. */
export const BASE_NAV: NavEntry[] = [
  { href: '/', label: 'Chats' },
  { href: '/analytics', label: 'Overview' },
  { href: '/scripts', label: 'Sets' },
  { href: '/vault', label: 'Vault' },
  { href: '/monetization', label: 'Monetization' },
  { href: '/settings', label: 'Settings' },
]

export const SIMULATOR_NAV: NavEntry = { href: '/simulator', label: 'Simulator' }

/**
 * Whether simulator UI may render at all.
 *
 * `null` means the backend has not answered yet and must be treated exactly
 * like `false`, so the entry never flashes into view and then disappears.
 */
export function canSimulate(
  capabilities: SimulationCapabilities | null | undefined,
): boolean {
  return capabilities?.auto_simulation === true
}

/**
 * Whether the cross-tenant mirror controls may render.
 *
 * Deliberately a separate question from `canSimulate`. An agency operator gets
 * `true` from that and `false` from this, and the mirror panel is then absent
 * rather than disabled — a greyed-out "Mirror from another creator" control
 * would tell an agency that other creators exist and that somebody can copy
 * between them, which is exactly what the backend refuses to disclose.
 */
export function canMirrorCatalog(
  capabilities: SimulationCapabilities | null | undefined,
): boolean {
  return capabilities?.simulation_mirror === true
}

/**
 * Whether low-level retrieval/cost diagnostics may render.
 *
 * Not a security boundary — the data describes the caller's own creators
 * either way — but noise for an agency operator, who wants to know that an
 * analysis was partial, not which retrieval method produced it.
 */
export function canSeeOperatorDiagnostics(
  capabilities: SimulationCapabilities | null | undefined,
): boolean {
  return capabilities?.operator_diagnostics === true
}

/**
 * The navigation for this account. Identical to BASE_NAV for every ordinary
 * tenant — the Simulator entry is appended only on an explicit true.
 */
export function navEntries(
  capabilities: SimulationCapabilities | null | undefined,
): NavEntry[] {
  return canSimulate(capabilities) ? [...BASE_NAV, SIMULATOR_NAV] : [...BASE_NAV]
}

/**
 * Ask the backend what this authenticated account may do.
 *
 * Never throws: any failure is "no capability", because a network error must
 * not be the reason a private feature becomes visible.
 */
const NO_CAPABILITIES: SimulationCapabilities = {
  auto_simulation: false,
  simulation_mirror: false,
  operator_diagnostics: false,
}

export async function fetchSimulationCapabilities(): Promise<SimulationCapabilities> {
  try {
    const response = await apiFetch('/simulation-capabilities')
    if (!response.ok) return { ...NO_CAPABILITIES }
    const body = await response.json().catch(() => ({}))
    return {
      auto_simulation: body?.auto_simulation === true,
      // An older backend sends neither field. Absent is false, so a deployment
      // mid-rollout hides the mirror rather than showing a control whose
      // endpoints would refuse it.
      simulation_mirror: body?.simulation_mirror === true,
      operator_diagnostics: body?.operator_diagnostics === true,
    }
  } catch {
    return { ...NO_CAPABILITIES }
  }
}

export async function fetchSimulationCreators(): Promise<SimulationCreator[]> {
  const response = await apiFetch('/simulation/creators')
  if (!response.ok) return []
  const body = await response.json().catch(() => ({}))
  if (!Array.isArray(body?.creators)) return []
  return body.creators
    .filter((creator: unknown) => !!creator && typeof creator === 'object')
    .map((creator: Record<string, unknown>) => ({
      id: String(creator.id ?? ''),
      name: String(creator.name ?? creator.id ?? ''),
      test_fans: Array.isArray(creator.test_fans)
        ? (creator.test_fans as Record<string, unknown>[]).map(fan => ({
            id: String(fan.id ?? ''),
            display_name: String(fan.display_name ?? fan.id ?? ''),
            platform_fan_id:
              typeof fan.platform_fan_id === 'string' ? fan.platform_fan_id : null,
            ai_stack_profile:
              typeof fan.ai_stack_profile === 'string' ? fan.ai_stack_profile : null,
            conversation_core:
              typeof fan.conversation_core === 'string' ? fan.conversation_core : null,
          }))
        : [],
    }))
    .filter((creator: SimulationCreator) => creator.id !== '')
}

/**
 * A key identifying ONE press of Send.
 *
 * Sent with the submission and reused if it has to be sent again, so a double
 * click, a retried POST and a browser that reconnects mid-request all resolve
 * to the same turn on the backend. Without it, "the request failed, try again"
 * is how one fan message becomes two creator replies.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** Raised when the fan already has a turn running. Carries the one to watch. */
export class SimulationTurnBusyError extends Error {
  readonly turnId: string | null

  constructor(turnId: string | null) {
    super('A simulated turn is still running for this fan.')
    this.name = 'SimulationTurnBusyError'
    this.turnId = turnId
  }
}

/**
 * Submit one simulated fan message. Returns as soon as the turn is RECORDED.
 *
 * Deliberately does not wait for the reply. A turn runs the analyzer, the
 * writer — including its whole provider-recovery ladder — and the extractor,
 * and that can legitimately outlast any request a browser is willing to hold
 * open. The turn is durable, so the answer is polled rather than awaited, and
 * a timeout on THIS call now means only "the submission did not land", which
 * is a thing the operator can safely retry with the same key.
 *
 * A short ceiling for the same reason: recording a turn is one insert.
 */
export async function startSimulatedTurn(
  creatorId: string,
  fanId: string,
  message: string,
  fast: boolean,
  idempotencyKey: string,
): Promise<SimulationTurn> {
  try {
    return await apiJson<SimulationTurn>(
      `/creator/${creatorId}/fan/${fanId}/simulate-inbound`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          fast,
          idempotency_key: idempotencyKey,
        }),
      },
      { label: 'The simulated turn', timeoutMs: 30_000 },
    )
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 409) {
      throw new SimulationTurnBusyError(caught.turnId ?? null)
    }
    throw caught
  }
}

/**
 * Read one turn. A pure read: it never starts or restarts a generation.
 */
export async function fetchSimulationTurn(
  creatorId: string,
  fanId: string,
  turnId: string,
): Promise<SimulationTurn> {
  return apiJson<SimulationTurn>(
    `/creator/${creatorId}/fan/${fanId}/simulation/turn/${turnId}`,
    {},
    { label: 'The simulated turn', timeoutMs: 30_000 },
  )
}

/**
 * The newest turn for this conversation, or null if there has never been one.
 *
 * What a reloaded browser asks. It knows which fan it is looking at and
 * nothing else, and it needs either to resume watching a turn still in flight
 * or to render the one that finished while it was away — which is exactly the
 * state the old design could not represent at all.
 */
export async function fetchLatestSimulationTurn(
  creatorId: string,
  fanId: string,
): Promise<SimulationTurn | null> {
  const body = await apiJson<SimulationTurn & { turn_id: string | null }>(
    `/creator/${creatorId}/fan/${fanId}/simulation/turn`,
    {},
    { label: 'The simulated turn', timeoutMs: 30_000 },
  )
  return body.turn_id ? body : null
}

export async function simulatePpvOutcome(
  creatorId: string,
  fanId: string,
  outcome: 'purchase' | 'decline',
): Promise<Record<string, unknown>> {
  return apiJson<Record<string, unknown>>(
    `/creator/${creatorId}/fan/${fanId}/simulate-${outcome}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
    { label: `The simulated ${outcome}`, timeoutMs: 60_000 },
  )
}

/**
 * One line the operator can act on, from whatever the call threw.
 *
 * The kind is what matters: a network failure means look at connectivity, a
 * server failure means look at the backend logs (and the error id says which
 * line), a timeout means the SUBMISSION did not land.
 *
 * That last one changed meaning entirely and the advice with it. A timeout no
 * longer means "a turn may be running somewhere you cannot see" — the turn is
 * durable, so pressing Send again either starts the one that never began or is
 * refused with the id of the one that did, and either way exactly one turn
 * exists. Retrying is now the correct thing to do rather than the thing that
 * produced a duplicate reply.
 */
export function describeSimulationFailure(caught: unknown): string {
  if (caught instanceof SimulationTurnBusyError) {
    return 'That fan already has a turn running. Waiting for it to finish.'
  }
  if (caught instanceof ApiError) {
    const suffix = caught.errorId ? ` (error ${caught.errorId})` : ''
    switch (caught.kind) {
      case 'network':
        return `Network: ${caught.message}`
      case 'timeout':
        return (
          `Timeout: ${caught.message} Press Send again — a turn that did start ` +
          'will be picked up rather than duplicated.'
        )
      case 'server':
        return `Backend ${caught.status ?? 500}: ${caught.message}${suffix}`
      case 'malformed':
        return `Malformed response: ${caught.message}`
      case 'client':
      default:
        return `Rejected ${caught.status ?? ''}: ${caught.message}${suffix}`.trim()
    }
  }
  return caught instanceof Error ? caught.message : String(caught)
}
