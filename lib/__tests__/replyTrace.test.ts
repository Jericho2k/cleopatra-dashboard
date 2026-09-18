import { describe, expect, it } from 'vitest'

import { summarizeReplyTrace } from '../replyTrace'

describe('owner reply trace', () => {
  it('shows the actual writer and names a fallback from the requested writer', () => {
    const summary = summarizeReplyTrace({
      id: 'm-1',
      sent_at: '2026-09-18T10:00:00Z',
      trace: {
        record: {
          reply_provenance: {
            trigger: { kind: 'fan_message', text_fingerprint: 'abc123' },
            context: { packet: { content_digest: 'evidence-1' } },
            decision: { source: 'commercial_policy', action: 'continue_normal_chat' },
            writer: {
              requested: { provider: 'together', model: 'qwen' },
              actual: { provider: 'openrouter', model: 'kimi' },
              served_by_requested_model: false,
            },
            transforms: ['message_shape_applied'],
            delivery: { kind: 'text', accepted_by_platform: true, platform_message_id: 'p-1' },
          },
        },
      },
    })

    expect(summary.attributionAvailable).toBe(true)
    expect(summary.writer).toContain('openrouter / kimi')
    expect(summary.writer).toContain('fallback from together / qwen')
    expect(summary.evidenceFingerprint).toBe('evidence-1')
    expect(summary.decision).toContain('commercial policy')
    expect(summary.transformations).toEqual(['message shape applied'])
    expect(summary.delivery).toContain('accepted by platform')
  })

  it('states missing attribution instead of rendering an empty successful trace', () => {
    const summary = summarizeReplyTrace({ id: 'm-2', trace: null })

    expect(summary.attributionAvailable).toBe(false)
    expect(summary.unavailableBecause).toContain('No diagnostic record')
    expect(summary.writer).toBe('not recorded')
  })

  it('surfaces the backend reason for an explicitly unavailable Assisted trace', () => {
    const summary = summarizeReplyTrace({
      id: 'm-3',
      trace: {
        record: {
          reply_provenance: {
            attribution_available: false,
            attribution_unavailable_because: 'the record had expired',
          },
        },
      },
    })

    expect(summary.attributionAvailable).toBe(false)
    expect(summary.unavailableBecause).toBe('the record had expired')
  })
})
