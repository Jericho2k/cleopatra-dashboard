import { supabase } from './supabase'

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

export async function getLatestSuggestions(
  fanId: string,
  creatorId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('suggestions')
    .select('suggestions')
    .eq('fan_id', fanId)
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return []
  return data.suggestions as string[]
}
