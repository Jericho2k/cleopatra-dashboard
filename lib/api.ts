import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

// Deployment identifier retained for defense in depth. Creator authorization is
// enforced by the signed-in Supabase access token attached below.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? ''

/** Absolute URL for a backend path. */
export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** Backend fetch with both deployment and signed-in operator identity attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  if (API_KEY) headers.set('X-API-Key', API_KEY)
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
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
