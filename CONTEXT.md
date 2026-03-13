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
types/
  index.ts          → all TypeScript types

## Strict rules
- One file per Cursor request
- All types in types/index.ts only
- All API calls in lib/api.ts only
- Supabase client only in lib/supabase.ts
- No inline styles except where Tailwind can't reach
- Never modify files not mentioned in the request