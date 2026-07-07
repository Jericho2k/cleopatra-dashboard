import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

// Shared secret proving the caller is our dashboard. NOTE: this is a NEXT_PUBLIC_
// value, so it ships in the browser bundle — it raises the bar (blocks scanners,
// curl-from-nowhere, casual pokers) but is not a true secret. The real data
// protection is Supabase RLS (authenticated-only). Upgrade path when we have live
// agencies: move backend calls behind Next.js server routes that hold the secret.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? ''

/** Absolute URL for a backend path. */
export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** fetch() to the backend with the dashboard API key attached. Use for every
 *  backend call so auth stays centralized. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  if (API_KEY) headers.set('X-API-Key', API_KEY)
  return fetch(apiUrl(path), { ...init, headers })
}

export async function warmBackend() {
  apiFetch('/health').catch(() => {})
}

// 2. Send a selected reply back to the backend (apifansly) to save and deliver
export async function sendReply(
  fanId: string,
  creatorId: string,
  content: string,
  wasAiSuggested: boolean
) {
  await apiFetch('/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fan_id: fanId, creator_id: creatorId, content, was_ai_suggested: wasAiSuggested }),
  })
}

export async function generateSuggestions(
  fanId: string,
  creatorId: string,
  fanMessage: string,
): Promise<void> {
  await apiFetch('/regenerate-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fan_id: fanId,
      creator_id: creatorId,
      message: fanMessage,
    }),
  })
  // Response comes via Supabase realtime subscription
}

export async function getLatestSuggestions(
  fanId: string,
  creatorId: string
): Promise<{ suggestions: string[]; stage: string }> {
  const { data, error } = await supabase
    .from('suggestions')
    .select('suggestions, stage')
    .eq('fan_id', fanId)
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return { suggestions: [], stage: 'WARMING_UP' }
  return {
    suggestions: data.suggestions as string[],
    stage: (data.stage as string) ?? 'WARMING_UP',
  }
}