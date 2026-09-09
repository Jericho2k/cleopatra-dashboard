# Cleopatra Dashboard — Frontend

## What this is
Next.js chatter dashboard for Cleopatra AI.
Chatters see fan conversations and AI reply suggestions.

## Stack
- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Supabase JS (realtime subscriptions)
- No component libraries — custom CSS only

## Design
- Dark luxury aesthetic
- Colors: #0a0a0b background, #0d0d0e surfaces, 
  #c8c8c8 silver accents, #4caf82 green for active states
- Font: DM Sans (body), Syne (headings/numbers)
- Everything in one page — no routing needed for MVP

## File structure
app/
  page.tsx          → main dashboard page
  layout.tsx        → root layout, imports fonts
  globals.css       → global styles and CSS variables
components/
  Sidebar.tsx       → fan conversation list
  ConversationView.tsx → message thread + suggestions
  FanPanel.tsx      → fan profile, stats, notes
lib/
  supabase.ts       → supabase client singleton
  api.ts            → functions that call Railway backend
  messages.ts       → conversation dedupe + retained-history bound
  conversations.ts  → conversation-list freshness and catch-up merge
  vault.ts          → vault projections, image source selection, row patching
  relativeTime.ts   → one shared minute tick for relative timestamps
  fanLists.ts       → fan list labelling and sorting
  health.ts         → operational health banner text
types/
  index.ts          → all TypeScript types
scripts/            → performance harnesses, run with node (or npx vite-node)
  bench-dedupe.mjs           → dedupe cost by conversation length
  bench-sidebar-filter.mjs   → conversation filter cost
  bench-vault-loading.mjs    → vault rows/requests/JSON, before vs after
  bench-apifansly-calls.mjs  → provider calls per hour per open tab

## Performance notes (Sprint 3)

Numbers, harnesses and rationale live in the backend repo at
`docs/sprint3_optimization.md`. Four things are load-bearing here:

- **Dedupe is indexed, not quadratic.** `lib/messages.ts` keeps maps by local id
  and platform message id plus small time buckets. Its duplicate semantics are
  pinned by tests written against the original implementation — change the
  predicate only with those tests in front of you.
- **The vault page never holds the whole vault.** Album counts come from the
  `vault_album_summary` aggregate (with a fallback for a database that has not
  had `db/vault_album_summary_v1.sql` applied); media arrives 200 rows at a
  time; heavy columns are read for one item when its modal opens.
- **Sidebar is memoised, so its props must stay stable.** The handlers in
  `app/page.tsx` are `useCallback` reading live state from refs. An inline arrow
  passed to `<Sidebar>` silently undoes the memo.
- **API Fansly reconciliation is recovery, not a heartbeat.** Every
  `POST /sync-fan-messages` is a real provider call. Add a trigger only for a
  reason to believe something was missed, and it is rate limited per fan.

## Strict rules
- One file per Cursor request
- All types in types/index.ts only
- All API calls in lib/api.ts only
- Supabase client only in lib/supabase.ts
- No inline styles except where Tailwind can't reach
- Never modify files not mentioned in the request