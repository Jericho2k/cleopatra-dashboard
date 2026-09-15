/**
 * AI Stack Profiles in the dashboard: read the registry, set an override.
 *
 * An AI Stack Profile is the whole conversational AI configuration — every
 * model-powered stage's provider, model, fallback, prompt version, reasoning
 * setting and generation parameters. It is NOT "an AI model", and this module
 * deliberately offers no way to name one: the only thing the client ever sends
 * is a stable profile identifier from the backend registry, which the backend
 * validates. There is no free-text provider or model field anywhere in this UI,
 * by construction.
 *
 * TWO DEPTHS, DECIDED BY THE BACKEND
 * ----------------------------------
 * An agency operator selects a stack in the Simulator, so it reads the registry
 * — but only ever as `{ id, name }`. The routing behind each profile (provider,
 * model, fallbacks, stage routing, prompt version, generation settings) is
 * platform-owner diagnostics and the backend does not send it to anyone else.
 *
 * So `summary` and `stages` are OPTIONAL here. That is not defensive typing: it
 * is the contract. Any UI that reads them is owner-gated already, and code that
 * assumes they exist would be assuming an authorization result it does not
 * have. `registry.diagnostics` says plainly which depth arrived.
 *
 * The redaction is the server's, not this module's. Nothing here can restore a
 * field the response did not carry, which is the point: a value the dashboard
 * merely declines to render has still reached the browser.
 *
 * Selection and override routes stay gated by the simulator allowlist, and an
 * account that may not simulate gets the same 404 the simulator itself gives —
 * so this module resolves to "no capability" on any failure and the UI renders
 * nothing rather than an access-denied screen advertising a feature the account
 * may not use.
 */

import { apiFetch } from './api'

/** One model-powered stage of one profile, fully resolved by the backend. */
export type AIStackStage = {
  stage: string
  label: string
  provider: string
  model: string
  fallback_provider: string | null
  fallback_model: string | null
  prompt_version: string
  reasoning: boolean
  output_mode: string
  max_tokens: number
  temperature: number | null
  env_overridable: boolean
  notes: string
}

export type AIStackProfile = {
  /** The stable identifier sent back when this profile is selected. */
  id: string
  /** The product-level display name, e.g. "Cleo V3". */
  name: string
  /** Owner-only diagnostics. Absent for an agency account. */
  summary?: string
  /** Owner-only diagnostics. Absent for an agency account. */
  stages?: AIStackStage[]
}

export type AIStackRegistry = {
  profiles: AIStackProfile[]
  /** What AI_STACK_PROFILE currently resolves to on the deployment. */
  environment_profile: string
  /** Owner-only: the name of the deployment variable behind it. */
  environment_variable?: string
  /** Whether this account received the routing detail at all. */
  diagnostics: boolean
}

export type CreatorAIStack = {
  creator_id: string
  /** null means "inherit the production default". */
  override: string | null
  environment_profile: string
  effective: { ai_stack_profile: string; ai_stack_source: string }
}

/**
 * Human wording for where an effective profile came from.
 *
 * Shown next to the effective profile so the owner never has to work out why a
 * creator is on one brain rather than another.
 */
export function describeSource(source: string | undefined | null): string {
  switch (source) {
    case 'simulation_fan':
      return 'Test-fan override'
    case 'creator':
      return 'Creator override'
    case 'environment':
      return 'Production default'
    default:
      return 'Production default'
  }
}

export function profileLabel(
  registry: AIStackRegistry | null,
  profileId: string | null | undefined,
): string {
  if (!profileId) return '—'
  return findProfile(registry, profileId)?.name ?? profileId
}

export function findProfile(
  registry: AIStackRegistry | null,
  profileId: string | null | undefined,
): AIStackProfile | null {
  if (!registry || !profileId) return null
  return registry.profiles.find(profile => profile.id === profileId) ?? null
}

/**
 * The one-line summary of a stage for the read-only detail view.
 *
 * e.g. "moonshotai/kimi-k2.6 / openrouter · prompt writer_v2 · reasoning off".
 * Fallback is reported separately by the caller, because a stage with no
 * fallback is a fact worth seeing rather than an omission.
 */
export function describeStage(stage: AIStackStage): string {
  const parts = [
    `${stage.model} / ${stage.provider}`,
    `prompt: ${stage.prompt_version}`,
    `reasoning: ${stage.reasoning ? 'on' : 'off'}`,
  ]
  if (stage.temperature !== null && stage.temperature !== undefined) {
    parts.push(`temperature: ${stage.temperature}`)
  }
  parts.push(`max tokens: ${stage.max_tokens}`)
  return parts.join(' · ')
}

/**
 * One registry row, at whatever depth the backend served it.
 *
 * Returns null for a row with no usable identifier, which is dropped rather
 * than rendered as a nameless option nobody can select.
 */
export function normalizeProfile(raw: unknown): AIStackProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  // `profile_id`/`label` are the owner payload's names for the same two facts.
  // Accepted so one shape serves both depths and a backend that has not shipped
  // the reduced view yet still fills the dropdown.
  const id = typeof row.id === 'string' ? row.id : row.profile_id
  const name = typeof row.name === 'string' ? row.name : row.label
  if (typeof id !== 'string' || !id) return null
  const profile: AIStackProfile = {
    id,
    name: typeof name === 'string' && name ? name : id,
  }
  if (typeof row.summary === 'string') profile.summary = row.summary
  if (Array.isArray(row.stages)) profile.stages = row.stages as AIStackStage[]
  return profile
}

/**
 * Read the registry. Returns null when the account may not see it.
 *
 * Never throws: a failure and a refusal are the same thing to the UI, which
 * renders nothing in either case.
 */
export async function fetchAIStackRegistry(): Promise<AIStackRegistry | null> {
  try {
    const response = await apiFetch('/ai-stack/profiles')
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    if (!body || !Array.isArray(body.profiles)) return null
    const profiles = (body.profiles as unknown[])
      .map(normalizeProfile)
      .filter((profile): profile is AIStackProfile => profile !== null)
    return {
      profiles,
      environment_profile: String(body.environment_profile ?? ''),
      environment_variable:
        typeof body.environment_variable === 'string'
          ? body.environment_variable
          : undefined,
      // An older backend sends neither the flag nor the reduced shape, so the
      // presence of stage detail is what it means by "diagnostics".
      diagnostics:
        typeof body.diagnostics === 'boolean'
          ? body.diagnostics
          : profiles.some(profile => profile.stages !== undefined),
    }
  } catch {
    return null
  }
}

export async function fetchCreatorAIStack(
  creatorId: string,
): Promise<CreatorAIStack | null> {
  try {
    const response = await apiFetch(`/creator/${creatorId}/ai-stack`)
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    if (!body) return null
    return body as CreatorAIStack
  } catch {
    return null
  }
}

/**
 * Persist a creator's override. `null` clears it.
 *
 * Throws on failure, because unlike a read this is an action the operator just
 * took and silently doing nothing would be worse than an error message.
 */
export async function saveCreatorAIStack(
  creatorId: string,
  profileId: string | null,
): Promise<CreatorAIStack> {
  const response = await apiFetch(`/creator/${creatorId}/ai-stack`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_stack_profile: profileId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not save the AI stack override (${response.status})`,
    )
  }
  return body as CreatorAIStack
}

/** Pin one TEST fan to a profile, or clear it. Simulator only. */
export async function saveSimulationFanAIStack(
  creatorId: string,
  fanId: string,
  profileId: string | null,
): Promise<string | null> {
  const response = await apiFetch(`/creator/${creatorId}/fan/${fanId}/ai-stack`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_stack_profile: profileId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not save the test fan's AI stack (${response.status})`,
    )
  }
  return (body?.ai_stack_profile as string | null) ?? null
}

/**
 * Which AI stack produced one persisted creator message, if it says.
 *
 * The backend records this inside `messages.media_context.ai_stack`. Older rows
 * predate it and return null, which is reported as "unknown" rather than being
 * attributed to whatever profile happens to be current.
 *
 * `profile` is the only field an agency account ever receives: the backend
 * redacts the rest of the marker out of the simulated-turn response, exactly as
 * it redacts the registry. Everything after `profile` is therefore optional and
 * owner-only, and the UI reading it is gated accordingly.
 */
export type MessageAIStack = {
  profile: string
  route?: string
  prompt_version?: string
  provider?: string
  model?: string
}

export function messageAIStack(mediaContext: unknown): MessageAIStack | null {
  if (!mediaContext || typeof mediaContext !== 'object') return null
  const marker = (mediaContext as Record<string, unknown>).ai_stack
  if (!marker || typeof marker !== 'object') return null
  const profile = (marker as Record<string, unknown>).profile
  if (typeof profile !== 'string' || !profile) return null
  const record = marker as Record<string, unknown>
  const text = (key: string): string | undefined =>
    typeof record[key] === 'string' ? (record[key] as string) : undefined
  return {
    profile,
    route: text('route'),
    prompt_version: text('prompt_version'),
    provider: text('provider'),
    model: text('model'),
  }
}
