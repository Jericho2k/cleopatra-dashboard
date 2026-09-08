import { describe, expect, it } from 'vitest'
import { describeOperationalHealth } from '../health'

describe('describeOperationalHealth', () => {
  it('says nothing when the deployment is healthy', () => {
    expect(describeOperationalHealth(null)).toBeNull()
    expect(describeOperationalHealth({ status: 'ok' })).toBeNull()
  })

  it('reports a delayed Auto queue in operator language', () => {
    const notice = describeOperationalHealth({
      status: 'degraded',
      degraded_reasons: ['queue_oldest_pending_age_exceeds_900s'],
      queue: { pending: 40, oldest_pending_age_seconds: 1320 },
    })
    expect(notice?.message).toContain('Auto replies are running late')
    expect(notice?.message).toContain('about 22 minutes')
    expect(notice?.critical).toBe(false)
  })

  it('reports queue depth', () => {
    const notice = describeOperationalHealth({
      status: 'degraded',
      degraded_reasons: ['queue_depth_exceeds_500'],
      queue: { pending: 812 },
    })
    expect(notice?.message).toContain('812 waiting')
  })

  it('treats a stale worker as critical', () => {
    const notice = describeOperationalHealth({
      status: 'degraded',
      degraded_reasons: ['scheduler_stale_for_3600s'],
    })
    expect(notice?.message).toContain('Auto worker has not run recently')
    expect(notice?.critical).toBe(true)
  })

  it('explains model saturation as queueing, not loss', () => {
    const notice = describeOperationalHealth({
      status: 'degraded',
      degraded_reasons: ['model_gate_saturated'],
    })
    expect(notice?.message).toContain('queued rather than dropped')
  })

  it('surfaces an unreachable database above everything else', () => {
    const notice = describeOperationalHealth({
      status: 'unhealthy',
      fatal_reasons: ['database_unreachable:timeout'],
      degraded_reasons: ['queue_unreadable'],
    })
    expect(notice?.message).toContain('cannot reach its database')
    expect(notice?.critical).toBe(true)
  })

  it('ignores backend reasons it does not recognise', () => {
    expect(
      describeOperationalHealth({
        status: 'degraded',
        degraded_reasons: ['some_future_signal'],
      }),
    ).toBeNull()
  })

  it('does not treat a provider incident as a Cleopatra outage', () => {
    const notice = describeOperationalHealth({
      status: 'degraded',
      degraded_reasons: ['model_unavailable'],
    })
    // The model banner already covers provider state; this must not duplicate it.
    expect(notice).toBeNull()
  })
})
