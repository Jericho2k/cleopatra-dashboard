/**
 * Owner-only Full Auto simulator: capability, navigation gating, and transcript.
 *
 * The backend is the security boundary. Everything here decides what to RENDER,
 * and renders nothing by default: an ordinary agency account must see no trace
 * that the simulator exists — no sidebar entry, no controls, no "access denied"
 * screen that advertises a feature it cannot use.
 *
 * The capability therefore starts as `null` ("not answered yet") rather than
 * `false`, and the navigation only grows the extra entry once the backend has
 * positively said `auto_simulation: true`. A failed request, an offline backend,
 * a 404 and a plain `false` all collapse to the same thing: the feature does not
 * exist for this account.
 *
 * No allowlist, user id, or environment variable ever reaches the client. The
 * only thing the client learns is one boolean about itself.
 */

import { ApiError, apiFetch, apiJson } from './api'

export type SimulationCapabilities = {
  auto_simulation: boolean
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
export async function fetchSimulationCapabilities(): Promise<SimulationCapabilities> {
  try {
    const response = await apiFetch('/simulation-capabilities')
    if (!response.ok) return { auto_simulation: false }
    const body = await response.json().catch(() => ({}))
    return { auto_simulation: body?.auto_simulation === true }
  } catch {
    return { auto_simulation: false }
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
          }))
        : [],
    }))
    .filter((creator: SimulationCreator) => creator.id !== '')
}

/**
 * Send one simulated fan message and wait for the Auto turn it triggers.
 *
 * A turn runs the analyzer, the writer (including its retry schedule) and the
 * extractor inside one request, so it is genuinely slow and needs its own
 * ceiling rather than the browser's. Every failure comes back as an `ApiError`
 * that says which layer failed, so the UI never has to render "Failed to fetch".
 */
export async function sendSimulatedFanMessage(
  creatorId: string,
  fanId: string,
  message: string,
  fast: boolean,
): Promise<SimulatedTurn> {
  return apiJson<SimulatedTurn>(
    `/creator/${creatorId}/fan/${fanId}/simulate-inbound`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, fast }),
    },
    { label: 'The simulated turn' },
  )
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
 * line), a timeout means the turn is probably still running.
 */
export function describeSimulationFailure(caught: unknown): string {
  if (caught instanceof ApiError) {
    const suffix = caught.errorId ? ` (error ${caught.errorId})` : ''
    switch (caught.kind) {
      case 'network':
        return `Network: ${caught.message}`
      case 'timeout':
        return `Timeout: ${caught.message}`
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
