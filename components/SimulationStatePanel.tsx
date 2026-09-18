'use client'

/**
 * The Simulator's right pane: the persisted state of the selected test fan.
 *
 * Every value here is read from the authoritative system that owns it —
 * lifecycle, the affordability ledger, price learning, commercial state, the
 * session, fan intelligence, the durable scheduled-actions table. There is no
 * simulator-only version of any of them. When a number looks wrong in this
 * panel, the number is wrong in production too, which is the point.
 *
 * The scheduled-actions block is how delayed behaviour is tested without a fake
 * clock. "Run now" fires the pending action through the worker's own handler,
 * inside the simulation scope, so the selected runtime's real revalidation,
 * owner, writer, executor and state transitions all run and only the wait is
 * skipped.
 */

import React from 'react'

import {
  actionOutcomeMessage,
  centsToDollars,
  type SimulationScheduledAction,
  type SimulationState,
} from '../lib/simulationWorkspace'

type Props = {
  state: SimulationState | null
  loading: boolean
  busyActionId: string | null
  lastActionResult: string
  onRunAction: (action: SimulationScheduledAction) => void
  aiStackControl?: React.ReactNode
}

export default function SimulationStatePanel({
  state,
  loading,
  busyActionId,
  lastActionResult,
  onRunAction,
  aiStackControl,
}: Props) {
  if (!state) {
    return (
      <Section title="Test state">
        <Muted>
          {loading
            ? 'Loading…'
            : 'Select a test fan to see its persisted state.'}
        </Muted>
      </Section>
    )
  }

  const commercial = state.commercial ?? {}
  const priceLearning = state.price_learning ?? null
  const affordability = state.affordability ?? null
  const lifecycle = state.lifecycle ?? null
  const session = state.active_session ?? null
  const scene = state.scene ?? null
  const facts = (state.fan_intelligence?.facts as Record<string, unknown>[]) ?? []

  const plan = Array.isArray((session as Record<string, unknown>)?.plan)
    ? ((session as Record<string, unknown>).plan as unknown[])
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {aiStackControl}

      <Section title="AI stack">
        <Row
          label="Answering as"
          value={state.ai_stack?.ai_stack_profile ?? 'unknown'}
        />
        <Row label="Selected by" value={sourceLabel(state.ai_stack?.ai_stack_source)} />
      </Section>

      <Section title="Conversation runtime">
        <Row
          label="Selected core"
          value={state.conversation_core?.conversation_core ?? 'unknown'}
        />
        <Row
          label="Selected by"
          value={state.conversation_core?.conversation_core_source ?? 'unknown'}
        />
      </Section>

      <Section title="Lifecycle & spend">
        <Row label="Stage" value={text(lifecycle?.stage) ?? 'PROSPECT'} />
        <Row
          label="Confirmed spend"
          value={`$${Number(state.spend.total_spent ?? 0).toFixed(2).replace(/\.00$/, '')}`}
          hint="Simulated. Excluded from every production revenue view."
        />
        <Row label="Purchases" value={String(state.spend.purchase_count ?? 0)} />
        <Row
          label="Highest confirmed"
          value={centsToDollars(state.spend.highest_purchase_cents)}
          hint="Demonstrated willingness to pay: the largest purchase actually confirmed."
        />
        <Row label="Spend tier" value={text(state.spend.spend_tier) ?? '—'} />
      </Section>

      <Section title="Price learning">
        {priceLearning ? (
          <>
            <Row label="Mode" value={text(priceLearning.mode) ?? '—'} />
            <Row label="Confidence" value={text(priceLearning.confidence) ?? '—'} />
            <Row
              label="Recommended"
              value={rangeText(
                priceLearning.recommended_floor_cents,
                priceLearning.recommended_target_cents,
                priceLearning.recommended_ceiling_cents,
              )}
            />
            <Row
              label="Evidence"
              value={`${Number(priceLearning.confirmed_purchase_count ?? 0)} confirmed · ${Number(priceLearning.resistance_signal_count ?? 0)} resistance`}
            />
          </>
        ) : (
          <Muted>No price-learning profile yet.</Muted>
        )}
      </Section>

      <Section title="Affordability">
        {affordability ? (
          <>
            <Row
              label="Explicit budget"
              value={centsToDollars(affordability.confirmed_budget_cents)}
              hint="Only what the fan actually stated. Never an inferred ceiling."
            />
            <Row
              label="Highest confirmed"
              value={centsToDollars(affordability.highest_confirmed_purchase_cents)}
            />
            <Row label="Payday" value={text(affordability.payday_raw) ?? '—'} />
          </>
        ) : (
          <Muted>No affordability evidence yet.</Muted>
        )}
      </Section>

      <Section title="Commercial status">
        <Row label="Status" value={text(commercial.status) ?? 'IDLE'} />
        <Row label="Wants" value={text(commercial.desired_experience) ?? '—'} />
        {/* One offer, singular. The row used to join an ordered array with
            "·" because the fan was shown two at once; there is no array to
            join any more, and no ordinal for him to pick from. */}
        <Row
          label="Pending offer"
          value={
            commercial.pending_offer && typeof commercial.pending_offer === 'object'
              ? (() => {
                  const offer = commercial.pending_offer as Record<string, unknown>
                  return `${text(offer.label) ?? 'offer'} ${centsToDollars(offer.price_cents)}`
                })()
              : 'none'
          }
        />
        <Row
          label="Accepted"
          value={
            commercial.accepted_offer_id
              ? `${text(commercial.accepted_offer_label) ?? 'offer'} ${centsToDollars(commercial.accepted_offer_price_cents)}`
              : 'none'
          }
        />
        <Row
          label="Last declined"
          value={centsToDollars(commercial.last_declined_price_cents)}
        />
        <Row
          label="Selling paused"
          value={state.fan.sale_paused_at ? 'yes' : 'no'}
        />
      </Section>

      <Section title="Active session">
        {session ? (
          <Row
            label="Step"
            value={`${Number((session as Record<string, unknown>).current_index ?? 0) + 1} of ${plan.length || '?'}`}
          />
        ) : (
          <Muted>No paid session is active.</Muted>
        )}
      </Section>

      {/* The "Cooldown: N messages left" row used to live above. It read a
          counter that one-unlock sessions made unreachable — the plan completes
          on the purchase and the completion path cleared the counter — so it
          showed "no" forever. The Scene below is the state that actually
          governs when another offer may appear, and unlike the counter it
          survives the session it came from. */}
      <Section title="Scene">
        {scene ? (
          <>
            <Row label="Beat" value={String(scene.beat ?? '—')} />
            <Row label="Premise" value={String(scene.premise || '—')} />
            <Row
              label="His last reaction"
              value={String(scene.last_fan_reaction ?? 'NONE')}
            />
            <Row
              label="Reaction answered"
              value={scene.reaction_processed ? 'yes' : 'not yet'}
            />
            <Row
              label="Intimacy / tension"
              value={`${Number(scene.intimacy_level ?? 0)} / ${Number(scene.tension_level ?? 0)}`}
            />
            <Row label="Open hook" value={String(scene.open_hook || '—')} />
            <Row
              label="Where he is steering"
              value={String(scene.desired_direction || '—')}
            />
            <Row
              label="Another unlock ready"
              value={scene.another_unlock_ready ? 'yes' : 'no'}
            />
            <Row
              label="Unlocks this scene"
              value={String(Number(scene.unlocks_in_scene ?? 0))}
            />
            <Row label="Why" value={String(scene.transition_reason ?? '—')} />
          </>
        ) : (
          <Muted>No scene has started yet.</Muted>
        )}
      </Section>

      <Section title="Pending PPV">
        {state.pending_ppv ? (
          <>
            <Row
              label="Price"
              value={centsToDollars(
                (state.pending_ppv as Record<string, unknown>).price_cents,
              )}
            />
            <Row
              label="Expires"
              value={
                dateText((state.pending_ppv as Record<string, unknown>).expires_at)
                ?? '—'
              }
            />
          </>
        ) : (
          <Muted>Nothing awaiting payment.</Muted>
        )}
      </Section>

      <Section title="Known about him">
        {facts.length === 0 ? (
          <Muted>Nothing learned yet.</Muted>
        ) : (
          facts.slice(0, 12).map((fact, index) => (
            <Row
              key={`${text(fact.fact_key) ?? index}-${index}`}
              label={text(fact.fact_key) ?? 'fact'}
              value={text(fact.value) ?? String(fact.value ?? '—')}
            />
          ))
        )}
      </Section>

      <Section title="Scheduled actions">
        {state.scheduled_actions.length === 0 ? (
          <Muted>Nothing scheduled. Delayed behaviour appears here when the commercial layer promises it.</Muted>
        ) : (
          state.scheduled_actions.map(action => (
            <div
              key={action.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 10px',
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                {action.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {action.status.toLowerCase()} ·{' '}
                {dateText(action.execute_at) ?? 'no time set'}
              </div>
              {action.last_error && (
                <div style={{ fontSize: 10, color: '#ff8b8b', marginTop: 4 }}>
                  {action.last_error}
                </div>
              )}
              {action.can_run_now ? (
                <button
                  type="button"
                  onClick={() => onRunAction(action)}
                  disabled={busyActionId !== null}
                  style={{
                    marginTop: 6,
                    padding: '3px 10px',
                    fontSize: 11,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 6,
                    color: 'var(--silver)',
                    cursor: busyActionId ? 'wait' : 'pointer',
                  }}
                >
                  {busyActionId === action.id ? 'Running…' : 'Run now'}
                </button>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
                  Not runnable early — this one is driven by the conversation, not
                  by waiting.
                </div>
              )}
            </div>
          ))
        )}
        {lastActionResult && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {lastActionResult}
          </div>
        )}
      </Section>
    </div>
  )
}

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case 'simulation_fan':
      return 'This test fan’s own override'
    case 'creator':
      return 'Creator override'
    default:
      return 'Production default (AI_STACK_PROFILE)'
  }
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const asString = String(value).trim()
  return asString ? asString : null
}

function dateText(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return raw
  return new Date(parsed).toLocaleString()
}

function rangeText(floor: unknown, target: unknown, ceiling: unknown): string {
  const parts = [floor, target, ceiling].map(centsToDollars)
  if (parts.every(part => part === '—')) return '—'
  return `${parts[0]} → ${parts[1]} → ${parts[2]}`
}

export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div style={{ marginBottom: 6 }} title={hint}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-primary)',
            textAlign: 'right',
            wordBreak: 'break-word',
          }}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

export { actionOutcomeMessage }
