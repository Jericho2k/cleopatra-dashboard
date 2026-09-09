import type { Message } from '../types'

const DUPLICATE_WINDOW_MS = 15_000

/**
 * How many messages one conversation keeps in browser memory.
 *
 * This bounds growth that happens WITHOUT the operator asking for it - a tab
 * left open on a busy fan for a whole shift. It is deliberately not applied to
 * "load more": that is the operator explicitly asking to read history, and
 * silently discarding what they just requested is a worse bug than the memory
 * it saves. See capRetainedMessages.
 *
 * Nothing here deletes anything. Messages that fall out of the window are still
 * in the database and still reachable by scrolling back.
 */
export const MAX_RETAINED_MESSAGES = 1000

function normalizedContent(message: Message): string {
  return message.content.trim().replace(/\s+/g, ' ')
}

/**
 * One entry in the working index: a message plus the values the duplicate rules
 * compare, computed once instead of on every comparison.
 *
 * The original allocated two new strings per comparison via
 * `.trim().replace(...)` on both sides, with no memoisation, inside a
 * `findIndex` over the whole result. That is where the quadratic cost lived.
 */
type Entry = {
  message: Message
  normalized: string
  timestamp: number
}

function entryFor(message: Message): Entry {
  return {
    message,
    normalized: normalizedContent(message),
    timestamp: Date.parse(message.sent_at),
  }
}

/**
 * Whether these two are the same delivery seen twice.
 *
 * Unchanged in meaning from the original - it just reads pre-computed values.
 * Reconciliation duplicates have one local row without a platform identity and
 * one imported row with it. Two genuinely unidentified rows, and two distinct
 * Fansly messages that happen to share text, are NOT duplicates: someone typing
 * "hey" twice sent two messages.
 */
function deliveryDuplicate(left: Entry, right: Entry): boolean {
  const a = left.message
  const b = right.message
  if (
    a.fan_id !== b.fan_id
    || a.creator_id !== b.creator_id
    || a.role !== b.role
    || left.normalized !== right.normalized
  ) {
    return false
  }
  if (a.fansly_message_id && b.fansly_message_id) {
    return a.fansly_message_id === b.fansly_message_id
  }
  if (!a.fansly_message_id && !b.fansly_message_id) return false
  return (
    Number.isFinite(left.timestamp)
    && Number.isFinite(right.timestamp)
    && Math.abs(left.timestamp - right.timestamp) <= DUPLICATE_WINDOW_MS
  )
}

function richerMessage(left: Message, right: Message): Message {
  const preferred = right.fansly_message_id ? right : left
  const fallback = preferred === right ? left : right
  return {
    ...fallback,
    ...preferred,
    media_context: preferred.media_context ?? fallback.media_context,
  }
}

/**
 * The bucket key for the reconciliation case.
 *
 * Reconciliation requires identical fan, creator, role and normalised content,
 * so those form the key. Time is bucketed at the width of the duplicate window,
 * and a lookup checks the neighbouring slots too, which bounds the candidate
 * scan to messages with identical text sent within about thirty seconds of each
 * other. That is a handful of rows even in a conversation of ten thousand.
 *
 * Over-inclusion in a bucket is harmless: deliveryDuplicate still decides. Only
 * under-inclusion would change behaviour, which is why a merged row is
 * re-registered if its timestamp moved it to a different slot.
 */
function bucketKey(entry: Entry, slot: number): string {
  const message = entry.message
  return `${message.fan_id} ${message.creator_id} ${message.role} ${slot} ${entry.normalized}`
}

function slotOf(entry: Entry): number {
  return Number.isFinite(entry.timestamp)
    ? Math.floor(entry.timestamp / DUPLICATE_WINDOW_MS)
    : Number.NaN
}

class MessageIndex {
  readonly entries: Entry[] = []
  private readonly byId = new Map<string, number>()
  private readonly byPlatformId = new Map<string, number>()
  private readonly buckets = new Map<string, number[]>()

  /**
   * The index of the existing message this one duplicates, or -1.
   *
   * The original took the FIRST matching position in the result array, checking
   * three rules at each position. Three lookups replace that scan, and the
   * smallest matching index is taken so "first" still means first.
   */
  private duplicateIndex(entry: Entry): number {
    const message = entry.message
    const candidates: number[] = []

    const byId = this.byId.get(message.id)
    if (byId !== undefined) candidates.push(byId)

    if (message.fansly_message_id) {
      const byPlatform = this.byPlatformId.get(message.fansly_message_id)
      if (byPlatform !== undefined) candidates.push(byPlatform)
    }

    const slot = slotOf(entry)
    const slots = Number.isFinite(slot)
      ? [slot - 1, slot, slot + 1]
      // No parseable timestamp: it can still match on identity, never on the
      // time-window rule, exactly as before.
      : [Number.NaN]
    for (const neighbour of slots) {
      const bucket = this.buckets.get(bucketKey(entry, neighbour))
      if (!bucket) continue
      for (const index of bucket) {
        if (deliveryDuplicate(this.entries[index], entry)) candidates.push(index)
      }
    }

    if (candidates.length === 0) return -1
    return Math.min(...candidates)
  }

  private register(index: number, entry: Entry): void {
    this.byId.set(entry.message.id, index)
    if (entry.message.fansly_message_id) {
      this.byPlatformId.set(entry.message.fansly_message_id, index)
    }
    const key = bucketKey(entry, slotOf(entry))
    const bucket = this.buckets.get(key)
    if (bucket) bucket.push(index)
    else this.buckets.set(key, [index])
  }

  add(message: Message): void {
    const entry = entryFor(message)
    const existingIndex = this.duplicateIndex(entry)

    if (existingIndex === -1) {
      this.entries.push(entry)
      this.register(this.entries.length - 1, entry)
      return
    }

    const previous = this.entries[existingIndex]
    const merged = entryFor(richerMessage(previous.message, message))
    this.entries[existingIndex] = merged

    // The merged row may carry a different id and a different timestamp. Drop
    // the stale id so it no longer identifies this slot - the original lost it
    // too, because it compared against the merged row - and re-register under
    // whatever the row now looks like.
    if (previous.message.id !== merged.message.id) {
      this.byId.delete(previous.message.id)
    }
    this.register(existingIndex, merged)
  }
}

/**
 * Collapse duplicate deliveries, preserving arrival order.
 *
 * Approximately O(n) for a whole collection: one pass, three indexed lookups
 * per message, and a bucket scan bounded by how many messages share identical
 * text within thirty seconds. The original ran a full `findIndex` over the
 * result for every message and re-normalised both sides of every comparison,
 * which measured 118 ms at 1,000 messages and 12 s at 10,000 - and the realtime
 * handler runs it twice per incoming message.
 */
export function dedupeMessages(messages: Message[]): Message[] {
  const index = new MessageIndex()
  for (const message of messages) index.add(message)
  return index.entries.map(entry => entry.message)
}

/**
 * Bound what one conversation keeps in memory, newest first.
 *
 * Call this where messages arrive on their own - realtime inserts, reconnect
 * catch-up - and NOT after "load more". Older messages stay in the database and
 * remain loadable by scrolling back; falling out of this window is not deletion
 * and not inaccessibility.
 */
export function capRetainedMessages(
  messages: Message[],
  limit: number = MAX_RETAINED_MESSAGES,
): Message[] {
  if (messages.length <= limit) return messages
  return messages.slice(messages.length - limit)
}
