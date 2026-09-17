/**
 * What the conversation remembers, as an operator needs to read it.
 *
 * These records are fed to a model on every turn. That is the whole reason
 * this view exists and the whole reason its presentation matters: a wrong
 * record keeps being fed to the model, and surfaces as it behaving strangely
 * for reasons nobody can trace. Until this panel there was no way to see that
 * the system was carrying an obligation at all, let alone that it was wrong.
 *
 * Two rules this file keeps, both learned from lib/contentAccess.ts:
 *
 * 1. **Never present a guess as a fact.** A record read out of an ambiguous
 *    message and one the customer stated outright are different claims. The
 *    backend says which; this file makes sure an operator sees the difference
 *    without having to know what `evidence_type` means.
 *
 * 2. **Never offer a control the backend would refuse.** A closed obligation
 *    has no buttons, because showing them teaches an operator to click and
 *    read an error.
 */

export type ThreadKind =
  | 'question'
  | 'promise'
  | 'deferred_topic'
  | 'complaint'
  | 'correction'

export type EvidenceType = 'stated' | 'inferred' | 'platform_confirmed' | 'operator'

export type MemoryThread = {
  id: string
  kind: ThreadKind
  raised_by: 'fan' | 'creator'
  summary: string
  resolution_condition: string
  status: 'open' | 'fulfilled' | 'cancelled' | 'superseded'
  evidence_type: EvidenceType
  confidence: number
  source_turn_id: string
  source_message_fingerprint: string
  first_seen_at: string | null
  last_seen_at: string | null
  expires_at: string | null
  /** Said outright by the backend, so this file never derives it from an enum. */
  was_read_rather_than_said: boolean
  /** Whose move it is. Answering the wrong one is a named failure. */
  waiting_on_us: boolean
}

export type MemoryEpisode = {
  id: string
  summary: string
  ended_with: 'resolved' | 'went_quiet' | 'said_goodbye' | 'interrupted' | 'unknown'
  first_message_at: string | null
  last_message_at: string | null
  message_count: number
  evidence_type: EvidenceType
  was_read_rather_than_said: boolean
}

export type ConversationMemory = {
  creator_id: string
  fan_id: string
  open_threads: MemoryThread[]
  episodes: MemoryEpisode[]
  /** Stated rather than inferred from an empty list: "carrying nothing" and
   * "could not read it" lead an operator to different actions. */
  carrying_anything: boolean
}

/** What each kind of unfinished business is, in an operator's words. */
const KIND_LABEL: Record<ThreadKind, string> = {
  question: 'Unanswered question',
  promise: 'Promised',
  deferred_topic: 'Put off until later',
  complaint: 'Complaint',
  correction: 'He corrected us',
}

export function describeKind(kind: ThreadKind): string {
  return KIND_LABEL[kind] ?? 'Carried'
}

/**
 * Where this record came from, in a sentence an operator can act on.
 *
 * The distinction that matters is whether somebody SAID it or the system READ
 * it, because only the second can be wrong about what happened. Confidence is
 * mentioned only when it is low enough to change the answer — a "0.92" beside
 * every line is noise that trains people to ignore the ones that say 0.3.
 */
export function describeSource(thread: MemoryThread): string {
  if (thread.evidence_type === 'operator') return 'You recorded this'
  if (thread.evidence_type === 'platform_confirmed') return 'Confirmed by the platform'
  if (thread.was_read_rather_than_said) {
    return thread.confidence < 0.7
      ? 'Read out of the conversation, and not clearly'
      : 'Read out of the conversation, not said outright'
  }
  return thread.raised_by === 'fan' ? 'He said this' : 'She said this'
}

/**
 * Whether this record is worth an operator's attention before the next reply.
 *
 * Something read out of the conversation with low confidence is the case this
 * panel exists for: it is being fed to the model every turn and nobody has
 * ever looked at it.
 */
export function needsAttention(thread: MemoryThread): boolean {
  return thread.was_read_rather_than_said && thread.confidence < 0.7
}

export type MemorySummary = {
  /** The one line at the top of the panel. */
  headline: string
  /** What it means for the next reply. */
  detail: string
  /** How many records an operator should look at before trusting the rest. */
  attention: number
}

/**
 * Read the memory into the sentence an operator acts on.
 *
 * `null` means it has not loaded, which is deliberately not the same as
 * "carrying nothing" — the caller shows a loading state rather than an
 * all-clear.
 */
export function summarizeMemory(
  memory: ConversationMemory | null | undefined,
): MemorySummary | null {
  if (!memory) return null

  const threads = memory.open_threads
  const attention = threads.filter(needsAttention).length
  const ours = threads.filter(thread => thread.waiting_on_us).length

  if (!memory.carrying_anything) {
    return {
      headline: 'Nothing is being carried forward',
      detail:
        'No unanswered question, promise or correction is open, so the next ' +
        'reply is working from the transcript alone.',
      attention: 0,
    }
  }

  const parts: string[] = []
  if (ours) parts.push(ours === 1 ? '1 waiting on us' : `${ours} waiting on us`)
  const theirs = threads.length - ours
  if (theirs) parts.push(theirs === 1 ? '1 waiting on him' : `${theirs} waiting on him`)

  return {
    headline:
      threads.length === 1
        ? '1 thing is being carried forward'
        : `${threads.length} things are being carried forward`,
    detail:
      `${parts.join(', ')}. Every one of these is given to the AI on each ` +
      'reply, so a record that is wrong keeps being used until somebody ' +
      'corrects it.',
    attention,
  }
}

/** The label under each earlier stretch of conversation. */
export function describeEpisode(episode: MemoryEpisode): string {
  const when = episode.last_message_at ? episode.last_message_at.slice(0, 10) : ''
  const ending = {
    resolved: 'sorted out',
    went_quiet: 'he went quiet',
    said_goodbye: 'he said goodbye',
    interrupted: 'cut short',
    unknown: '',
  }[episode.ended_with]
  const head = when ? `${when} · ` : ''
  return ending ? `${head}${episode.summary} (${ending})` : `${head}${episode.summary}`
}

/**
 * What an operator may do to one record.
 *
 * Mirrors the backend exactly, including the absence of a delete: a record
 * somebody disagrees with is resolved or corrected, both of which say what
 * happened, and a deleted one leaves the next reader wondering whether it was
 * ever there.
 */
export type ThreadControls = {
  canResolve: boolean
  canCancel: boolean
  canCorrect: boolean
}

export function controlsFor(thread: MemoryThread): ThreadControls {
  const open = thread.status === 'open'
  return { canResolve: open, canCancel: open, canCorrect: open }
}
