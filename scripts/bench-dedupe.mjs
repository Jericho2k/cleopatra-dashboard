/**
 * FE-001 — what dedupeMessages costs as a conversation grows.
 *
 * Two numbers matter, and the second is the one operators feel:
 *
 *   full        rebuilding the whole collection (a load-more, a reload)
 *   append-one  adding ONE realtime message to an already-loaded thread
 *
 * The append case is the hot path: app/page.tsx calls dedupeMessages twice per
 * incoming message — once for the cache, once for the tab — synchronously on
 * the main thread inside a setTabs updater. Double the append column to get the
 * freeze an operator actually sees.
 *
 * Node is a friendlier environment than a browser main thread carrying React,
 * so these are optimistic.
 *
 * Usage:
 *   node scripts/bench-dedupe.mjs
 *   node scripts/bench-dedupe.mjs --json
 */

import { dedupeMessages } from '../lib/messages.ts'

const SIZES = [50, 200, 500, 1000, 2000, 5000, 10000]

function build(count) {
  const rows = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: `msg-${index}`,
      fansly_message_id: index % 3 === 0 ? null : `f-${index}`,
      fan_id: 'fan-1',
      creator_id: 'creator-1',
      role: index % 2 === 0 ? 'fan' : 'creator',
      // Repeated text on purpose: the content comparison is the expensive part
      // of the original, and identical text is what forced it to run.
      content: index % 7 === 0 ? 'hey' : `message number ${index}`,
      sent_at: new Date(1767225600000 + index * 60000).toISOString(),
      was_ai_suggested: false,
      was_selected: false,
      media_context: null,
    })
  }
  return rows
}

function time(fn, iterations) {
  // One warm-up pass so JIT compilation is not attributed to the measurement.
  fn()
  const started = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) fn()
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6
  return elapsed / iterations
}

const results = []
for (const size of SIZES) {
  const rows = build(size)
  const loaded = dedupeMessages(rows)
  const incoming = {
    ...rows[0],
    id: `msg-incoming-${size}`,
    fansly_message_id: `f-incoming-${size}`,
    content: 'a brand new message',
    sent_at: new Date(1767225600000 + (size + 1) * 60000).toISOString(),
  }

  // Big sizes are slow enough that one pass is a stable measurement, and
  // repeating a 60-second call is not useful.
  const iterations = size >= 5000 ? 1 : size >= 1000 ? 3 : 20

  results.push({
    messages: size,
    full_ms: Number(time(() => dedupeMessages(rows), iterations).toFixed(3)),
    append_one_ms: Number(
      time(() => dedupeMessages([...loaded, incoming]), iterations).toFixed(3),
    ),
  })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  const header = `${'messages'.padStart(9)}${'full ms'.padStart(12)}${'append-one ms'.padStart(16)}`
  console.log('dedupeMessages cost')
  console.log()
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const row of results) {
    console.log(
      `${String(row.messages).padStart(9)}${row.full_ms.toFixed(2).padStart(12)}${row.append_one_ms
        .toFixed(2)
        .padStart(16)}`,
    )
  }
  console.log()
  console.log('The realtime handler runs the append case TWICE per message.')
}
