import type { ConversationSummary } from '../types'

/**
 * How long a creator's conversation list stays trustworthy after it was read.
 *
 * FE-005 - the realtime channel is subscribed with
 * `filter: creator_id=eq.${activeTab.creatorId}`, so a tab for any OTHER
 * creator receives no events at all. The conversation-load effect then
 * short-circuited on `if (activeTab.conversations.length > 0) return` and the
 * cache still held the list from twenty minutes ago, so switching back showed
 * stale last-messages and stale unread counts indefinitely.
 *
 * Any real absence therefore has to trigger a catch-up. This window exists only
 * so that flicking between two tabs does not re-query on every click.
 */
export const CONVERSATION_FRESHNESS_MS = 15_000

export function conversationsAreStale(
  fetchedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (fetchedAt === undefined) return true
  return now - fetchedAt > CONVERSATION_FRESHNESS_MS
}

/**
 * Fold a freshly read conversation list into the one already on screen.
 *
 * The summaries view carries no unread flag - unread is entirely client state,
 * accumulated from realtime events - so a plain replace would silently clear
 * every unread marker the operator had not read yet. Instead:
 *
 *   - a conversation whose last message has moved on since we last looked is
 *     marked unread, because something arrived while this tab was blind;
 *   - a conversation that has not changed keeps exactly the unread state it
 *     had;
 *   - a conversation we have never seen is new, so it is unread;
 *   - the fan currently open is never marked unread, because the operator is
 *     looking straight at it.
 *
 * Ordering comes from the fresh read, which is sorted by last_message_time.
 */
export function mergeConversationSummaries(
  previous: ConversationSummary[],
  fresh: ConversationSummary[],
  activeFanId: string | null = null,
): ConversationSummary[] {
  const before = new Map(previous.map(row => [row.fan.id, row]))

  return fresh.map(row => {
    const existing = before.get(row.fan.id)
    if (!existing) {
      return {
        ...row,
        unread: row.fan.id !== activeFanId,
        unread_count: row.fan.id === activeFanId ? 0 : 1,
      }
    }

    const previousTime = Date.parse(existing.last_message_time)
    const freshTime = Date.parse(row.last_message_time)
    const advanced =
      Number.isFinite(previousTime)
      && Number.isFinite(freshTime)
      && freshTime > previousTime

    if (row.fan.id === activeFanId) {
      return { ...row, unread: false, unread_count: 0 }
    }
    if (!advanced) {
      return {
        ...row,
        unread: existing.unread,
        unread_count: existing.unread_count ?? 0,
      }
    }
    // At least one message landed while we were not listening. The exact count
    // is not knowable from a summary row, so this reports "something new"
    // rather than inventing a number.
    return {
      ...row,
      unread: true,
      unread_count: Math.max(existing.unread_count ?? 0, 0) + 1,
    }
  })
}
