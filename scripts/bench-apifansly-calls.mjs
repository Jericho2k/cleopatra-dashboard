/**
 * API-002 - API Fansly calls per hour caused by open dashboard tabs.
 *
 * Every POST /sync-fan-messages/{creator}/{fan} makes one real
 * list_chat_messages request upstream, so the browser's polling cadence is a
 * provider bill. This computes the rate for the old heartbeat and the new
 * recovery-driven design.
 *
 * Reasons are counted at their expected frequency; the per-fan rate limit means
 * several reasons firing together still cost one call, so the model takes the
 * limit into account rather than adding the reasons up naively.
 *
 * Usage:
 *   node scripts/bench-apifansly-calls.mjs
 *   node scripts/bench-apifansly-calls.mjs --json
 */

const HOUR_MS = 60 * 60 * 1000

// BEFORE
const RECENT_POLL_MS = 45_000
const IDLE_POLL_MS = 3 * 60_000

// AFTER
const SAFETY_INTERVAL_MS = 15 * 60_000
const MIN_INTERVAL_MS = 60_000

// Assumed operator behaviour over one hour, per open tab.
const CONVERSATIONS_OPENED_PER_HOUR = 12
const RECONNECTS_PER_HOUR = 1
const TAB_REFOCUSES_PER_HOUR = 6

function before() {
  return {
    active_tab: Math.round(HOUR_MS / RECENT_POLL_MS),
    idle_tab: Math.round(HOUR_MS / IDLE_POLL_MS),
    // The old loop kept its timer running while hidden; it rescheduled at the
    // idle interval and polled again as soon as the tab came back.
    background_tab: Math.round(HOUR_MS / IDLE_POLL_MS),
  }
}

function after() {
  const safety = Math.round(HOUR_MS / SAFETY_INTERVAL_MS)
  const eventDriven =
    CONVERSATIONS_OPENED_PER_HOUR + RECONNECTS_PER_HOUR + TAB_REFOCUSES_PER_HOUR
  // No fan is reconciled more than once a minute however many reasons fire.
  const ceiling = Math.round(HOUR_MS / MIN_INTERVAL_MS)
  return {
    active_tab: Math.min(safety + eventDriven, ceiling),
    // An idle conversation opens nothing new; only the safety interval fires.
    idle_tab: safety,
    // A hidden tab makes no provider calls at all: the reconciler checks
    // document.visibilityState before asking.
    background_tab: 0,
  }
}

const OPERATORS = 25
const beforeRates = before()
const afterRates = after()

const results = {
  assumptions: {
    conversations_opened_per_hour: CONVERSATIONS_OPENED_PER_HOUR,
    realtime_reconnects_per_hour: RECONNECTS_PER_HOUR,
    tab_refocuses_per_hour: TAB_REFOCUSES_PER_HOUR,
    per_fan_minimum_interval_seconds: MIN_INTERVAL_MS / 1000,
    safety_interval_minutes: SAFETY_INTERVAL_MS / 60_000,
  },
  per_tab_per_hour: {
    active_conversation: { before: beforeRates.active_tab, after: afterRates.active_tab },
    idle_conversation: { before: beforeRates.idle_tab, after: afterRates.idle_tab },
    background_tab: { before: beforeRates.background_tab, after: afterRates.background_tab },
  },
  twenty_five_active_operators_per_hour: {
    before: beforeRates.active_tab * OPERATORS,
    after: afterRates.active_tab * OPERATORS,
  },
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log('API Fansly calls per hour from dashboard polling')
  console.log()
  const header = `${'scenario'.padEnd(26)}${'before'.padStart(9)}${'after'.padStart(8)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const [name, row] of Object.entries(results.per_tab_per_hour)) {
    console.log(
      `${name.replace(/_/g, ' ').padEnd(26)}${String(row.before).padStart(9)}${String(row.after).padStart(8)}`,
    )
  }
  console.log()
  console.log(
    `25 active operator tabs: ${results.twenty_five_active_operators_per_hour.before}/hour ` +
      `-> ${results.twenty_five_active_operators_per_hour.after}/hour`,
  )
  console.log()
  console.log('Behavioural assumptions (conversations opened, reconnects, refocuses)')
  console.log('are estimates; the intervals and the rate limit are exact.')
}
