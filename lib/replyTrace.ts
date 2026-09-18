/** Owner-only reply provenance, shaped for an operator rather than raw JSON. */

export type ReplyTraceMessage = {
  id: string
  sent_at?: string | null
  fansly_message_id?: string | null
  trace?: {
    record?: Record<string, unknown> | null
    recorded_at?: string | null
  } | null
}

export type ReplyTraceResponse = {
  creator_id: string
  fan_id: string
  messages: ReplyTraceMessage[]
}

export type ReplyTraceSummary = {
  id: string
  sentAt: string
  attributionAvailable: boolean
  unavailableBecause: string
  trigger: string
  evidenceFingerprint: string
  writer: string
  decision: string
  transformations: string[]
  delivery: string
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function words(value: unknown): string {
  return String(value ?? '').trim().replaceAll('_', ' ')
}

export function summarizeReplyTrace(message: ReplyTraceMessage): ReplyTraceSummary {
  const record = object(message.trace?.record)
  const provenance = object(record.reply_provenance)
  const available = provenance.attribution_available !== false && Object.keys(provenance).length > 0
  const trigger = object(provenance.trigger)
  const context = object(provenance.context)
  const packet = object(context.packet)
  const writer = object(provenance.writer)
  const actual = object(writer.actual)
  const requested = object(writer.requested)
  const decision = object(provenance.decision)
  const delivery = object(provenance.delivery)
  const transforms = Array.isArray(provenance.transforms)
    ? provenance.transforms.map(words).filter(Boolean)
    : []

  const actualName = [words(actual.provider), words(actual.model)].filter(Boolean).join(' / ')
  const requestedName = [words(requested.provider), words(requested.model)].filter(Boolean).join(' / ')
  const fallback = writer.served_by_requested_model === false && requestedName
    ? ` (fallback from ${requestedName})`
    : ''

  return {
    id: message.id,
    sentAt: words(message.sent_at) || 'time not recorded',
    attributionAvailable: available,
    unavailableBecause: words(
      provenance.attribution_unavailable_because ||
      (!message.trace ? 'No diagnostic record was stored for this reply' : '')
    ),
    trigger: [words(trigger.kind), words(trigger.text_fingerprint)].filter(Boolean).join(' · ') || 'not recorded',
    evidenceFingerprint: words(packet.content_digest || context.evidence_fingerprint) || 'not recorded',
    writer: actualName ? `${actualName}${fallback}` : 'not recorded',
    decision: [words(decision.source), words(decision.action), words(decision.reason)].filter(Boolean).join(' · ') || 'not recorded',
    transformations: transforms,
    delivery: [
      words(delivery.kind),
      delivery.accepted_by_platform === true ? 'accepted by platform' : '',
      words(delivery.platform_message_id || message.fansly_message_id),
    ].filter(Boolean).join(' · ') || 'not recorded',
  }
}
