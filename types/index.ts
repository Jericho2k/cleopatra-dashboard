export type SpendTier = 'whale' | 'active' | 'casual' | 'cold'

export type StageType =
  | 'COLD_OPEN'
  | 'WARMING_UP'
  | 'FLIRTING'
  | 'PRE_UPSELL'
  | 'UPSELL_ACTIVE'
  | 'OBJECTION'
  | 'RETENTION'
  | 'HIGH_VALUE'

export interface Fan {
  id: string
  display_name: string
  total_spent: number
  spend_tier: SpendTier
  last_active: string | null
  preferences: string[]
  notes: string
}

export interface Message {
  id: string
  fan_id: string
  creator_id: string
  role: 'fan' | 'creator'
  content: string
  sent_at: string
  was_ai_suggested: boolean
  was_selected: boolean
}

export interface Creator {
  id: string
  name: string
  platform_username: string
  platform: string
}

export interface SuggestionResponse {
  suggestions: string[]
}

export interface ConversationSummary {
  fan: Fan
  last_message: string
  last_message_time: string
  unread: boolean
}
