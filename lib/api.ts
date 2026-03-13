import type { SuggestionResponse } from '../types'

// 1. Get AI suggestions for a fan message
export async function getSuggestions(
  fanId: string,
  creatorId: string,
  message: string
): Promise<SuggestionResponse> {
  const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fan_id: fanId,
      creator_id: creatorId,
      message,
    }),
  })
  if (!res.ok) throw new Error('Suggestions request failed')
  return res.json() as Promise<SuggestionResponse>
}

// 2. Send a selected reply back to the backend to save
export async function sendReply(
  fanId: string,
  creatorId: string,
  content: string,
  wasAiSuggested: boolean
): Promise<void> {
  try {
    await fetch(process.env.NEXT_PUBLIC_API_URL + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fan_id: fanId,
        creator_id: creatorId,
        content,
        was_ai_suggested: wasAiSuggested,
      }),
    })
  } catch {
    // Silently fail
  }
}
