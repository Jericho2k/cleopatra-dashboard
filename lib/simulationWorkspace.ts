/**
 * The Simulator as a persistent workspace: history, test fans, PPV, state.
 *
 * Two rules shape this module.
 *
 * **There is no second message store.** The simulator reads the same `messages`
 * rows the production Chats view reads, through the same Supabase query. The
 * transcript therefore survives a refresh, leaving and returning, a browser
 * restart, and coming back tomorrow — not because anything caches it, but
 * because it was never anywhere else. The previous simulator kept its
 * transcript in React state, so every reload silently erased what looked like a
 * conversation.
 *
 * **A PPV must look like a PPV.** From the fan's side a locked PPV is a priced
 * card with a locked preview, and a purchased one is the actual media. The
 * simulator has to show both states or it cannot be used to judge how an offer
 * lands. `ppvPresentation` derives which state a message is in from the same
 * `media_context.ppv.purchased` flag the production purchase transition writes,
 * so the simulator never invents a purchase state of its own.
 *
 * Mirrored test media is a special case and stays one. A `sim:` id is not a
 * platform media id and can never be delivered; it is resolved for DISPLAY via
 * the owner-only preview endpoint, which reads the source creator's vault
 * through the mirror's provenance and writes nothing. Preview access and
 * delivery authority stay separate, which is exactly what the mirror was built
 * to guarantee.
 */

import { apiFetch } from './api'
import type { Message } from '../types'

export const SIMULATION_MEDIA_PREFIX = 'sim:'

export type SimulationTestFanSummary = {
  id: string
  display_name: string
  platform_fan_id?: string
  ai_stack_profile?: string | null
}

/** Whether one media id belongs to the owner-only simulation catalog. */
export function isSimulationMediaId(mediaId: unknown): boolean {
  return typeof mediaId === 'string' && mediaId.startsWith(SIMULATION_MEDIA_PREFIX)
}

// ---------------------------------------------------------------------------
// PPV presentation
// ---------------------------------------------------------------------------

export type PpvDetails = {
  price: number
  priceCents: number | null
  mediaIds: string[]
  purchased: boolean
  setId: string | null
  source: string | null
}

export type PpvPresentation =
  | { kind: 'none' }
  | ({ kind: 'locked' | 'unlocked' } & PpvDetails)

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * What a message's PPV should look like right now.
 *
 * `locked` before a confirmed purchase — a priced card with a locked preview,
 * which is what the fan sees. `unlocked` after one, showing the actual media.
 * `none` when the message carries no PPV at all.
 *
 * Deliberately tolerant about shape: current rows carry `media_ids`, older ones
 * a single `media_id`, and `price_cents` may be absent on either.
 */
export function ppvPresentation(mediaContext: unknown): PpvPresentation {
  if (!mediaContext || typeof mediaContext !== 'object') return { kind: 'none' }
  const ppv = (mediaContext as Record<string, unknown>).ppv
  if (!ppv || typeof ppv !== 'object') return { kind: 'none' }
  const record = ppv as Record<string, unknown>

  const ids = Array.isArray(record.media_ids)
    ? (record.media_ids as unknown[]).map(String).filter(Boolean)
    : typeof record.media_id === 'string' && record.media_id
      ? [record.media_id]
      : []
  if (ids.length === 0) return { kind: 'none' }

  const priceCents =
    record.price_cents === undefined || record.price_cents === null
      ? null
      : numberOr(record.price_cents, 0)
  const price =
    record.price === undefined || record.price === null
      ? priceCents === null
        ? 0
        : priceCents / 100
      : numberOr(record.price, 0)

  const purchased = record.purchased === true
  return {
    kind: purchased ? 'unlocked' : 'locked',
    price,
    priceCents,
    mediaIds: ids,
    purchased,
    setId: typeof record.set_id === 'string' ? record.set_id : null,
    source: typeof record.source === 'string' ? record.source : null,
  }
}

/** Every PPV media id referenced by a transcript, deduplicated, in order. */
export function collectSimulationMediaIds(messages: readonly Message[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    const presentation = ppvPresentation(message.media_context)
    if (presentation.kind === 'none') continue
    ids.push(...presentation.mediaIds)
  }
  return [...new Set(ids)]
}

/**
 * Split referenced ids by how they must be resolved.
 *
 * A `sim:` id has no row in this creator's vault under a platform media id — a
 * mirrored row deliberately carries neither a `url` nor a `fansly_media_id` —
 * so asking the ordinary vault endpoint for one can only ever return nothing.
 * They go to the owner-only preview endpoint instead, which resolves them
 * through provenance.
 */
export function partitionMediaIds(mediaIds: readonly string[]): {
  vault: string[]
  simulation: string[]
} {
  const vault: string[] = []
  const simulation: string[] = []
  for (const id of mediaIds) {
    if (isSimulationMediaId(id)) simulation.push(id)
    else vault.push(id)
  }
  return { vault, simulation }
}

// ---------------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------------

export type SimulationMedia = Record<
  string,
  { url: string | null; thumbnail_url: string | null; mimetype: string | null; source?: string | null }
>

/** Owner-only display URLs for mirrored `sim:` media. Never throws. */
export async function fetchSimulationMediaPreviews(
  creatorId: string,
  mediaIds: string[],
): Promise<SimulationMedia> {
  if (mediaIds.length === 0) return {}
  try {
    const response = await apiFetch(`/creator/${creatorId}/simulation-media-previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: mediaIds }),
    })
    if (!response.ok) return {}
    const body = await response.json().catch(() => ({}))
    return (body?.media as SimulationMedia) ?? {}
  } catch {
    return {}
  }
}

export type SimulationScheduledAction = {
  id: string
  action_type: string
  label: string
  execute_at: string | null
  status: string
  attempts: number
  last_error: string | null
  can_run_now: boolean
}

export type SimulationState = {
  fan: {
    id: string
    display_name: string
    platform_fan_id: string | null
    simulation: boolean
    auto_mode: boolean | null
    needs_human_review: boolean
    sale_paused_at: string | null
  }
  ai_stack: { ai_stack_profile: string; ai_stack_source: string } | null
  spend: {
    total_spent: number
    purchase_count: number
    total_spent_cents: number
    highest_purchase_cents: number
    spend_tier: string | null
  }
  lifecycle: Record<string, unknown> | null
  affordability: Record<string, unknown> | null
  price_learning: Record<string, unknown> | null
  commercial: Record<string, unknown>
  /**
   * The conversational scene (backend: services/experience_director.py).
   *
   * It is the half of a fan's state that OUTLIVES a purchase. A commercial
   * session is one unlock and is finished the moment it is paid, so without
   * this the panel went blank between a sale and the next offer and there was
   * no way to see why nothing was being offered.
   */
  scene: Record<string, unknown> | null
  active_session: Record<string, unknown> | null
  pending_ppv: Record<string, unknown> | null
  fan_intelligence: Record<string, unknown>
  scheduled_actions: SimulationScheduledAction[]
  generated_at: string
}

export async function fetchSimulationState(
  creatorId: string,
  fanId: string,
): Promise<SimulationState | null> {
  try {
    const response = await apiFetch(
      `/creator/${creatorId}/fan/${fanId}/simulation-state`,
    )
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return (body as SimulationState) ?? null
  } catch {
    return null
  }
}

export async function createSimulationTestFan(
  creatorId: string,
  displayName: string,
): Promise<SimulationTestFanSummary> {
  const response = await apiFetch('/simulation/test-fans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator_id: creatorId,
      display_name: displayName.trim() || null,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not create the test fan (${response.status})`,
    )
  }
  return body.fan as SimulationTestFanSummary
}

export async function runSimulationActionNow(
  creatorId: string,
  fanId: string,
  actionId: string,
): Promise<{ outcome: string; action_type: string; messages_sent: number }> {
  const response = await apiFetch(
    `/creator/${creatorId}/fan/${fanId}/simulation-actions/${actionId}/run-now`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not run that action (${response.status})`,
    )
  }
  return body as { outcome: string; action_type: string; messages_sent: number }
}

/**
 * How a run-now outcome reads to the operator.
 *
 * These are the worker's own outcome names, not a simulator invention — the
 * same strings the scheduled-actions worker records — so what the panel says is
 * what actually happened to the action.
 */
export function actionOutcomeMessage(outcome: string, messagesSent: number): string {
  switch (outcome) {
    case 'sent':
      return messagesSent > 0
        ? 'Ran and sent a message. It is in the conversation.'
        : 'Ran and completed.'
    case 'skipped':
      return 'Revalidation decided not to send. That is a real outcome, not a failure.'
    case 'postponed':
      return 'Rescheduled rather than sent — revalidation asked for a later time.'
    case 'failed':
      return 'The action failed. Check the backend logs.'
    case 'no_handler':
      return 'No handler exists for that action type.'
    default:
      return `Finished: ${outcome}.`
  }
}

/**
 * Dollar text for cents, or a dash when the value is unknown.
 *
 * null and undefined are unknown, not zero. Most of these fields — an explicit
 * budget, a highest confirmed purchase, a last declined price — mean something
 * quite different when absent than when they are genuinely $0, and rendering
 * "$0" for "he has never said" would be a misreading the operator then acts on.
 */
export function centsToDollars(cents: unknown): string {
  if (cents === null || cents === undefined || cents === '') return '—'
  const value = Number(cents)
  if (!Number.isFinite(value)) return '—'
  return `$${(value / 100).toFixed(2).replace(/\.00$/, '')}`
}

// ---------------------------------------------------------------------------
// The owner-only simulation catalog mirror
// ---------------------------------------------------------------------------
//
// A mirror copies one creator's vault METADATA into the test creator's catalog
// so simulated planning exercises the real coherence, escalation, media-type and
// allocation logic instead of a three-set toy vault.
//
// It is deliberately not a copy. Mirrored rows are marked `simulation_only` —
// live planning filters them out — and carry a rewritten `sim:` media id, which
// is not a platform media id and cannot become one. Both barriers are the
// backend's; nothing here weakens either, and this control only starts and
// removes the mirror.

/**
 * A creator whose vault may be COPIED FROM.
 *
 * Deliberately a different list from the Simulator's creator selector. That one
 * answers "who may I simulate as?" and is tenancy-scoped. This one answers
 * "whose vault may I copy metadata from?" and is owner-gated and cross-tenant,
 * because the realistic vault worth mirroring usually belongs to an
 * AGENCY-OWNED creator the platform owner is deliberately not assigned to.
 *
 * Appearing here grants nothing else: the creator does not enter the simulator
 * selector, no assignment is created, and the mirror's TARGET must still be a
 * creator the caller ordinarily holds.
 */
export type MirrorSource = {
  creator_id: string
  name: string
  approved_sets: number
  media_items: number
  /** False when there is no approved content, so mirroring would plan against nothing. */
  usable: boolean
}

/**
 * Owner-only list of mirror sources. Never throws.
 *
 * An agency account gets the same 404 as every other owner-only route, which
 * collapses to an empty list here — the control renders as having nothing to
 * offer rather than announcing a feature it may not use.
 */
export async function fetchMirrorSources(): Promise<MirrorSource[]> {
  try {
    const response = await apiFetch('/simulation/catalog/sources')
    if (!response.ok) return []
    const body = await response.json().catch(() => ({}))
    if (!Array.isArray(body?.sources)) return []
    return (body.sources as Record<string, unknown>[])
      .map(row => ({
        creator_id: String(row.creator_id ?? ''),
        name: String(row.name ?? row.creator_id ?? ''),
        approved_sets: Number(row.approved_sets ?? 0),
        media_items: Number(row.media_items ?? 0),
        usable: row.usable === true,
      }))
      .filter(row => row.creator_id !== '')
  } catch {
    return []
  }
}

/** How a source reads in the picker: name plus what is actually there. */
export function describeMirrorSource(source: MirrorSource): string {
  if (!source.usable) return `${source.name} — nothing to mirror`
  return `${source.name} — ${source.approved_sets} sets, ${source.media_items} media`
}

export type MirrorResult = {
  source_creator_id: string
  target_creator_id: string
  media_mirrored: number
  sets_mirrored: number
  media_removed: number
  sets_removed: number
}

export async function mirrorSimulationCatalog(
  sourceCreatorId: string,
  targetCreatorId: string,
): Promise<MirrorResult> {
  const response = await apiFetch('/simulation/catalog/mirror', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_creator_id: sourceCreatorId,
      target_creator_id: targetCreatorId,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not mirror the catalog (${response.status})`,
    )
  }
  return body as MirrorResult
}

export async function deleteSimulationCatalogMirror(
  sourceCreatorId: string,
  targetCreatorId: string,
): Promise<MirrorResult> {
  const response = await apiFetch('/simulation/catalog/mirror/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_creator_id: sourceCreatorId,
      target_creator_id: targetCreatorId,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not remove the mirror (${response.status})`,
    )
  }
  return body as MirrorResult
}

/** What a mirror run did, in one sentence. */
export function mirrorSummary(result: MirrorResult): string {
  const parts: string[] = []
  if (result.sets_mirrored) parts.push(`${result.sets_mirrored} sets`)
  if (result.media_mirrored) parts.push(`${result.media_mirrored} media`)
  if (result.sets_removed) parts.push(`${result.sets_removed} sets removed`)
  if (result.media_removed) parts.push(`${result.media_removed} media removed`)
  return parts.length > 0
    ? `Mirrored ${parts.join(', ')}. Marked TEST / SIMULATION and not deliverable.`
    : 'Nothing to mirror.'
}
