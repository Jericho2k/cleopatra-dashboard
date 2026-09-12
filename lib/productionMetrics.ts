/**
 * Keeping simulated fans out of numbers an agency reads as its business.
 *
 * Simulation state is deliberately PERSISTENT and realistic — that is the whole
 * point of a long-lived testing workspace. A test fan therefore accumulates real
 * rows: confirmed spend, purchase counts, lifecycle transitions. None of it is
 * agency revenue.
 *
 * The isolation is analytical, not a second database. Backend reads that produce
 * a production metric apply the same exclusion in Postgres; this is the
 * browser-side counterpart for the views that query Supabase directly.
 *
 * Nothing here deletes or hides anything. The Simulator shows the simulated
 * numbers, because that is what it is for.
 */

export const TEST_FAN_PREFIX = 'test_'

export type FanRevenueRow = {
  platform_fan_id?: string | null
  total_spent?: number | null
  spend_tier?: string | null
  sales_log?: unknown[] | null
}

/** Whether one fan row is an owner test fan rather than a real customer. */
export function isSimulationFan(row: FanRevenueRow | null | undefined): boolean {
  return typeof row?.platform_fan_id === 'string'
    && row.platform_fan_id.startsWith(TEST_FAN_PREFIX)
}

/** Only the real customers. */
export function productionFans<T extends FanRevenueRow>(rows: readonly T[]): T[] {
  return rows.filter(row => !isSimulationFan(row))
}

export type FanStats = {
  total: number
  revenue: number
  buyers: number
  whales: number
  /** How many rows were excluded, so the operator can be told rather than guess. */
  simulated: number
}

/**
 * Production fan statistics.
 *
 * A "buyer" is a fan with confirmed spend or at least one sale in their log,
 * which is the rule this view already used — only the population changed.
 */
export function fanStats(rows: readonly FanRevenueRow[]): FanStats {
  const real = productionFans(rows)
  return {
    total: real.length,
    revenue: real.reduce((sum, fan) => sum + Number(fan.total_spent ?? 0), 0),
    buyers: real.filter(
      fan => Number(fan.total_spent ?? 0) > 0 || (fan.sales_log?.length ?? 0) > 0,
    ).length,
    whales: real.filter(fan => fan.spend_tier === 'whale').length,
    simulated: rows.length - real.length,
  }
}
