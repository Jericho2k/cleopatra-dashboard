/**
 * FE-007 — resolving PPV media without a fetch loop.
 *
 * The effect in ConversationView derived the media ids it still needed from
 * `ppvMediaMap`, and wrote its results into `ppvMediaMap`, with `ppvMediaMap`
 * in its dependency array. It terminated only because the server happened to
 * answer for every id it was asked about: any response that omitted one — an
 * error for a single item, a key that did not match the id requested, an empty
 * map — left that id unresolved, re-armed the effect, and requested it again,
 * forever.
 *
 * Two changes fix it, and both live here so they can be tested without
 * mounting a component:
 *
 *   1. what to request is derived from the MESSAGES and from a set of already
 *      requested ids, never from the map the effect writes;
 *   2. merging a response backfills an explicit "unresolvable" entry for every
 *      requested id the server did not answer for, so an omission is recorded
 *      rather than looking like work still to do.
 *
 * Together these give the property the tests assert directly: after merging any
 * response at all, no requested id is still pending. Termination does not
 * depend on the server behaving.
 */

/** media_id -> the vault URLs resolved for it, or nulls when unresolvable. */
export type PpvMediaMap = Record<string, {
  url: string | null
  thumbnail_url: string | null
  mimetype: string | null
}>

type MessageLike = {
  media_context?: { ppv?: { media_id?: string; media_ids?: string[] } } | null
}

const UNRESOLVED = { url: null, thumbnail_url: null, mimetype: null }

/**
 * Every PPV media id referenced by a conversation, in order, deduplicated.
 *
 * Deliberately tolerant of shape: a PPV carries either `media_ids` (current) or
 * a single `media_id` (older rows), and empty or malformed entries are dropped
 * rather than becoming requests for "".
 */
export function collectPpvMediaIds(messages: readonly MessageLike[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    const ppv = message?.media_context?.ppv
    if (!ppv) continue
    const candidates = ppv.media_ids?.length
      ? ppv.media_ids
      : (ppv.media_id ? [ppv.media_id] : [])
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate) ids.push(candidate)
    }
  }
  return [...new Set(ids)]
}

/**
 * Which of the referenced ids still need a request.
 *
 * `requested` is the authority, not the resolved map: an id that was asked
 * about and came back unanswered has been requested, and asking again would be
 * the loop.
 */
export function pendingPpvMediaIds(
  referenced: readonly string[],
  requested: ReadonlySet<string>,
): string[] {
  return referenced.filter(id => id && !requested.has(id))
}

/**
 * Fold a server response into the map, recording an explicit unresolved entry
 * for every requested id the response did not cover.
 *
 * Server-supplied values win over the backfill; ids the server volunteered that
 * were not requested are kept, since they are still true.
 */
export function mergePpvMediaResponse(
  previous: PpvMediaMap,
  requestedIds: readonly string[],
  responseMedia: PpvMediaMap | null | undefined,
): PpvMediaMap {
  const media = responseMedia ?? {}
  const merged: PpvMediaMap = { ...previous }
  for (const id of requestedIds) {
    if (!(id in media)) merged[id] = { ...UNRESOLVED }
  }
  return { ...merged, ...media }
}

/** Mark every requested id unresolvable — the request failed outright. */
export function markPpvMediaUnresolved(
  previous: PpvMediaMap,
  requestedIds: readonly string[],
): PpvMediaMap {
  const merged: PpvMediaMap = { ...previous }
  for (const id of requestedIds) merged[id] = { ...UNRESOLVED }
  return merged
}
