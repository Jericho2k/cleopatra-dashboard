import type { Message } from '../types'

const DUPLICATE_WINDOW_MS = 15_000

function normalizedContent(message: Message): string {
  return message.content.trim().replace(/\s+/g, ' ')
}

function deliveryDuplicate(left: Message, right: Message): boolean {
  if (
    left.fan_id !== right.fan_id
    || left.creator_id !== right.creator_id
    || left.role !== right.role
    || normalizedContent(left) !== normalizedContent(right)
  ) {
    return false
  }
  if (
    left.fansly_message_id
    && right.fansly_message_id
  ) {
    return left.fansly_message_id === right.fansly_message_id
  }
  // Reconciliation duplicates have one local row without a platform identity
  // and one imported row with it. Do not collapse two genuinely unidentified
  // rows or two distinct Fansly messages with the same text.
  if (!left.fansly_message_id && !right.fansly_message_id) return false
  const leftTime = Date.parse(left.sent_at)
  const rightTime = Date.parse(right.sent_at)
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= DUPLICATE_WINDOW_MS
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

export function dedupeMessages(messages: Message[]): Message[] {
  const result: Message[] = []
  for (const message of messages) {
    const duplicateIndex = result.findIndex(existing =>
      existing.id === message.id
      || (
        Boolean(existing.fansly_message_id)
        && existing.fansly_message_id === message.fansly_message_id
      )
      || deliveryDuplicate(existing, message)
    )
    if (duplicateIndex === -1) {
      result.push(message)
    } else {
      result[duplicateIndex] = richerMessage(result[duplicateIndex], message)
    }
  }
  return result
}
