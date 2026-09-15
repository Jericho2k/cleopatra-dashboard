/**
 * What an operator is told after importing a fan's conversation history.
 *
 * "Imported 200 messages" is not enough information to decide whether to press
 * the button again. API Fansly's chat-messages endpoint is capped at ten
 * messages per page (`limit min=1 max=10` — the provider's ceiling, not a
 * setting), so a long conversation is hundreds of paid round trips and an
 * import is necessarily partial and resumable.
 *
 * So the summary answers the three questions that actually matter: what came
 * in, what it cost, and whether there is more.
 */

export type FanHistoryProgress = {
  status?: string
  fully_paged?: boolean
  pages_fetched?: number
  messages_imported?: number
  messages_extracted?: number
  api_calls?: number
  estimated_credits?: number
  estimated_credits_per_page?: number | null
  last_error?: string | null
}

export type LoadHistoryResult = {
  status?: string
  imported?: number
  estimated_credits?: number
  history?: FanHistoryProgress
  deep?: { status?: string; stop_reason?: string }
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

/** Credits are estimates; the provider's Usage dashboard is authoritative. */
export function formatCredits(credits: number | null | undefined): string {
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits <= 0) return ''
  return credits >= 10 ? `~${Math.round(credits).toLocaleString()}` : `~${credits.toFixed(1)}`
}

/**
 * Why an import stopped, in the operator's terms.
 *
 * A pause is not a failure and must not read like one: yielding to a live
 * conversation is the system working correctly, and so is stopping at a credit
 * budget somebody deliberately set.
 */
export function describeHistoryStop(result: LoadHistoryResult): string {
  const reason = result.deep?.stop_reason ?? ''
  if (result.history?.fully_paged) return 'all history imported'
  if (reason === 'live_work_in_progress') return 'paused for live conversation'
  if (reason === 'history_credit_budget_exhausted') return 'paused — credit budget reached'
  if (reason === 'exhausted') return 'all history imported'
  if (result.history?.last_error) return `stopped: ${result.history.last_error}`
  return 'more history remains'
}

/** The toast line. Compact, and never silently rounds a cost to nothing. */
export function summarizeHistoryImport(result: LoadHistoryResult): string {
  const imported = Number(result.imported ?? 0)
  const history = result.history ?? {}
  const parts: string[] = [
    imported > 0 ? `Imported ${plural(imported, 'message')}` : 'No new messages',
  ]

  const calls = Number(history.api_calls ?? 0)
  const credits = formatCredits(result.estimated_credits)
  if (calls > 0) {
    parts.push(credits ? `${plural(calls, 'API call')}, ${credits} credits` : plural(calls, 'API call'))
  }
  parts.push(describeHistoryStop(result))
  return parts.join(' · ')
}

/**
 * The persistent per-fan line, for when a backfill is mid-flight.
 *
 * Deliberately says nothing about how many pages are LEFT: the provider does
 * not reveal how long a conversation is until its cursor runs out, and an
 * invented total is worse than an honest "still importing".
 */
export function describeHistoryProgress(
  history: FanHistoryProgress | null | undefined,
): string {
  if (!history || !history.pages_fetched) return ''
  const credits = formatCredits(history.estimated_credits)
  const cost = credits ? `, ${credits} credits` : ''
  const imported = Number(history.messages_imported ?? 0)
  if (history.fully_paged) {
    return `History complete — ${plural(imported, 'message')} over ${plural(
      Number(history.pages_fetched),
      'page',
    )}${cost}`
  }
  return `History importing — ${plural(imported, 'message')} so far over ${plural(
    Number(history.pages_fetched),
    'page',
  )}${cost}`
}
