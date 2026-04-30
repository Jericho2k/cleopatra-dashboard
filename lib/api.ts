import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export async function warmBackend() {
  fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`).catch(() => {})
}

// 2. Send a selected reply back to the backend (apifansly) to save and deliver
export async function sendReply(
  fanId: string,
  creatorId: string,
  content: string,
  wasAiSuggested: boolean
) {
  await fetch(`${API_URL}/reply`, {
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
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/regenerate-suggestions`, {
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
