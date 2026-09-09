/**
 * FE-004 - the conversation-list filter, before and after.
 *
 * The audit measured the filter running inline in JSX on every render, doing
 * `fanLists.find(...)?.member_fan_ids.includes(c.fan.id)` per conversation - a
 * linear scan of the active list for every row. It ran on every realtime event,
 * every minute for the clock, and on every hover.
 *
 * The point of this benchmark is not the microseconds. It is the answer to
 * "does 1,000 rows still need virtualisation once the cheap fixes are in?"
 *
 * Usage:
 *   node scripts/bench-sidebar-filter.mjs
 *   node scripts/bench-sidebar-filter.mjs --json
 */

const CASES = [
  { conversations: 200, members: 100 },
  { conversations: 1000, members: 500 },
  { conversations: 5000, members: 2500 },
]

function build(conversationCount, memberCount) {
  const conversations = Array.from({ length: conversationCount }, (_unused, index) => ({
    fan: {
      id: `fan-${index}`,
      spend_tier: ['whale', 'active', 'casual', 'cold'][index % 4],
      auto_mode: index % 3 === 0 ? true : index % 3 === 1 ? false : null,
    },
    unread: index % 5 === 0,
  }))
  const memberIds = conversations
    .slice(0, memberCount)
    .map(conversation => conversation.fan.id)
  return { conversations, fanLists: [{ id: 'list-1', member_fan_ids: memberIds }] }
}

function filterBefore(conversations, fanLists, activeListId, activeFilter, globalAutoMode) {
  return conversations.filter(c => {
    if (
      activeListId
      && !fanLists.find(l => l.id === activeListId)?.member_fan_ids.includes(c.fan.id)
    ) return false
    if (activeFilter === 'unread') return c.unread
    if (activeFilter === 'all') return true
    if (activeFilter === 'auto_on') {
      return c.fan.auto_mode === true || (globalAutoMode && c.fan.auto_mode !== false)
    }
    if (activeFilter === 'auto_off') return c.fan.auto_mode === false
    return c.fan.spend_tier === activeFilter
  })
}

function filterAfter(conversations, fanLists, activeListId, activeFilter, globalAutoMode) {
  // The Set is built once per list change, not once per render; building it
  // here on every call is therefore pessimistic, and it still wins.
  const list = activeListId ? fanLists.find(l => l.id === activeListId) : null
  const members = activeListId ? new Set(list ? list.member_fan_ids : []) : null
  return conversations.filter(c => {
    if (members && !members.has(c.fan.id)) return false
    if (activeFilter === 'unread') return c.unread
    if (activeFilter === 'all') return true
    if (activeFilter === 'auto_on') {
      return c.fan.auto_mode === true || (globalAutoMode && c.fan.auto_mode !== false)
    }
    if (activeFilter === 'auto_off') return c.fan.auto_mode === false
    return c.fan.spend_tier === activeFilter
  })
}

function time(fn, iterations) {
  fn()
  const started = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) fn()
  return Number(process.hrtime.bigint() - started) / 1e6 / iterations
}

const results = CASES.map(({ conversations: count, members }) => {
  const { conversations, fanLists } = build(count, members)
  const iterations = count >= 5000 ? 20 : 200
  return {
    conversations: count,
    list_members: members,
    before_ms: Number(
      time(() => filterBefore(conversations, fanLists, 'list-1', 'all', true), iterations)
        .toFixed(4),
    ),
    after_ms: Number(
      time(() => filterAfter(conversations, fanLists, 'list-1', 'all', true), iterations)
        .toFixed(4),
    ),
  }
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  const header =
    `${'convos'.padStart(8)}${'members'.padStart(9)}${'before ms'.padStart(12)}${'after ms'.padStart(11)}`
  console.log('Sidebar filter cost, per render')
  console.log()
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const row of results) {
    console.log(
      `${String(row.conversations).padStart(8)}${String(row.list_members).padStart(9)}` +
        `${row.before_ms.toFixed(3).padStart(12)}${row.after_ms.toFixed(3).padStart(11)}`,
    )
  }
  console.log()
  console.log('The filter also runs far less often now: memoised, so an unrelated')
  console.log('realtime event does not re-run it, hover is CSS, and the minute')
  console.log('tick only re-renders the timestamps.')
}
