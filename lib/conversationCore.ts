import { apiFetch } from './api'
import type { SimulationCapabilities } from './simulation'

export type ConversationCore = { id: string; name: string }
export type ConversationCoreRegistry = {
  cores: ConversationCore[]
  environment_core: string
}

/** Architecture rollout is platform-owner authority, never an agency control. */
export function canSelectConversationCore(
  capabilities: SimulationCapabilities | null | undefined,
): boolean {
  return capabilities?.operator_diagnostics === true
}

export async function fetchConversationCores(): Promise<ConversationCoreRegistry | null> {
  try {
    const response = await apiFetch('/conversation-cores')
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    if (!body || !Array.isArray(body.cores)) return null
    return {
      cores: body.cores
        .filter((row: unknown) => !!row && typeof row === 'object')
        .map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          name: String(row.name ?? row.id ?? ''),
        }))
        .filter((row: ConversationCore) => row.id !== ''),
      environment_core: String(body.environment_core ?? 'legacy'),
    }
  } catch {
    return null
  }
}

export async function saveSimulationFanConversationCore(
  creatorId: string,
  fanId: string,
  coreId: string | null,
): Promise<string | null> {
  const response = await apiFetch(
    `/creator/${creatorId}/fan/${fanId}/conversation-core`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_core: coreId }),
    },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Could not save the conversation core (${response.status})`,
    )
  }
  return (body?.conversation_core as string | null) ?? null
}
