/**
 * Agency pricing strategy: read the effective policy, write a preset.
 *
 * Railway's PRICE_LEARNING_* variables are DEPLOYMENT DEFAULTS. Strategy is
 * configured here, and the backend already resolves it in the order
 *
 *     creator override  →  agency policy  →  Railway defaults
 *
 * A preset is a named set of values for policy fields that already exist. It
 * introduces no pricing mode and changes no formula. "Aggressive" means "probe
 * higher inside the range each item is already approved for" — never "allowed
 * more": approved content maximums, a fan's explicitly stated budget ceiling and
 * every deterministic safety rule still bound it.
 *
 * Basis points are deliberately not the normal UI. They appear only in the
 * advanced view, for operators who want the exact numbers.
 */

import { apiFetch } from './api'

export type PricingPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom'

export type PricingPresetInfo = {
  preset: Exclude<PricingPreset, 'custom'>
  label: string
  description: string
  settings: Record<string, number>
}

export type PricingPolicyView = {
  creator_id: string
  agency_scope_id: string | null
  /**
   * Whether the backend's adaptive-pricing gate is on at all.
   *
   * When false, nothing on this page changes live behaviour, and the UI has to
   * say so rather than presenting a strategy as active.
   */
  price_learning_enabled: boolean
  price_learning_env_var: string
  environment_defaults: Record<string, number>
  agency: { settings: Record<string, number>; preset: PricingPreset | null }
  creator: { settings: Record<string, number>; preset: PricingPreset | null }
  effective: Record<string, number>
  effective_preset: PricingPreset
  presets: PricingPresetInfo[]
}

/**
 * The advanced fields, with wording that says what each one actually does.
 *
 * Kept here rather than in the page so the labels and the units travel
 * together: every one of these is in basis points or cents, and a mislabelled
 * unit on a pricing control is a real money bug.
 */
export const ADVANCED_PRICING_FIELDS: {
  key: string
  label: string
  unit: 'bps' | 'cents' | 'count' | 'days'
  help: string
}[] = [
  {
    key: 'cold_start_probe_bps',
    label: 'Opening probe position',
    unit: 'bps',
    help: 'Where inside an item’s approved range a fan with no purchase history is first asked. 2,500 bps on a $15-$80 set is about $31.',
  },
  {
    key: 'max_step_up_bps',
    label: 'Maximum step up',
    unit: 'bps',
    help: 'The most one confirmed purchase may raise the next ask.',
  },
  {
    key: 'repeat_buyer_uplift_bps',
    label: 'Repeat-buyer uplift',
    unit: 'bps',
    help: 'Extra room allowed once a fan is a confirmed repeat buyer.',
  },
  {
    key: 'vip_uplift_bps',
    label: 'VIP uplift',
    unit: 'bps',
    help: 'Extra room allowed for a VIP-stage fan.',
  },
  {
    key: 'first_purchase_target_cents',
    label: 'First-purchase target',
    unit: 'cents',
    help: 'Where a first purchase is aimed when nothing else is known about the fan.',
  },
  {
    key: 'effortless_purchase_streak',
    label: 'Effortless purchases before extra uplift',
    unit: 'count',
    help: 'How many confirmed easy purchases in a row before additional uplift applies. A higher number is more conservative.',
  },
  {
    key: 'min_offer_cents',
    label: 'Absolute minimum offer',
    unit: 'cents',
    help: 'No offer is ever built below this, whatever the content range says.',
  },
  {
    key: 'max_offer_cents',
    label: 'Absolute maximum offer',
    unit: 'cents',
    help: 'No offer is ever built above this, whatever the content range says.',
  },
  {
    key: 'customer_price_step_cents',
    label: 'Customer price grid',
    unit: 'cents',
    help: 'Prices are rounded onto this grid so a customer sees $25, not $24.63.',
  },
  {
    key: 'evidence_lookback_days',
    label: 'Evidence window',
    unit: 'days',
    help: 'How far back purchase evidence is counted.',
  },
]

export function formatAdvancedValue(unit: string, value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'cents') return `$${(value / 100).toFixed(2).replace(/\.00$/, '')}`
  if (unit === 'bps') return `${(value / 100).toFixed(2).replace(/\.?0+$/, '')}%`
  if (unit === 'days') return `${value} days`
  return String(value)
}

export async function fetchPricingPolicy(
  creatorId: string,
): Promise<PricingPolicyView | null> {
  try {
    const response = await apiFetch(`/creator/${creatorId}/pricing-policy`)
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return (body as PricingPolicyView) ?? null
  } catch {
    return null
  }
}

export async function savePricingPolicy(
  creatorId: string,
  update: {
    scope?: 'creator' | 'agency'
    preset?: PricingPreset | null
    settings?: Record<string, number>
  },
): Promise<void> {
  const response = await apiFetch(`/creator/${creatorId}/pricing-policy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: update.scope ?? 'creator',
      preset: update.preset ?? null,
      settings: update.settings ?? null,
    }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not save the pricing strategy (${response.status})`,
    )
  }
}

/**
 * What the operator should be told about the feature gate.
 *
 * Empty when adaptive pricing is on. When it is off the message says so
 * plainly and names the variable, because the alternative — a strategy picker
 * that looks live while the backend ignores it — is the dishonest UI this
 * exists to prevent.
 */
export function featureGateWarning(view: PricingPolicyView | null): string {
  if (!view || view.price_learning_enabled) return ''
  return (
    `Adaptive pricing is switched off for this deployment. Your strategy is `
    + `saved, but every offer is priced from the content range alone until `
    + `${view.price_learning_env_var}=true is set in Railway.`
  )
}

/** Which scope a change should be written to, given what exists. */
export function defaultScope(
  view: PricingPolicyView | null,
): 'creator' | 'agency' {
  return view?.agency_scope_id ? 'agency' : 'creator'
}
