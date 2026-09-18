'use client'

import { useRef, useState } from 'react'

import SimulatedChat from '../../components/SimulatedChat'
import { completedTurnMessage, type SimulationTurn } from '../../lib/simulation'
import type { Message } from '../../types'

import {
  ContentAccessResolution,
  ConversationMemoryPanel,
  ReplyTracePanel,
  type ReviewResolution,
} from '../../components/FanPanel'
import type {
  ContentAccessEvidence,
  RepairState,
} from '../../lib/contentAccess'
import type {
  ConversationMemory,
  MemoryThread,
} from '../../lib/conversationMemory'
import type { ReplyTraceResponse } from '../../lib/replyTrace'

const initialEvidence: ContentAccessEvidence = {
  fan_id: 'fan-1',
  creator_id: 'creator-1',
  frozen: true,
  review_reason: 'content_access_issue',
  review_case_id: 'case-access',
  repairable_count: 2,
  platform_error: '',
  has_paid_content: true,
  selection_required: true,
  repairs: [],
  paid_items: [
    {
      reference: 'purchase-new',
      media_ids: ['media-new'],
      price_cents: 2500,
      platform_message_id: 'message-new',
      purchased_at: '2026-09-17T10:00:00Z',
      platform_state: 'visible',
      platform_detail: '',
    },
    {
      reference: 'purchase-old',
      media_ids: ['media-old'],
      price_cents: 1500,
      platform_message_id: 'message-old',
      purchased_at: '2026-08-01T10:00:00Z',
      platform_state: 'message_not_visible',
      platform_detail: '',
    },
  ],
}

const initialMemory: ConversationMemory = {
  creator_id: 'creator-1',
  fan_id: 'fan-1',
  carrying_anything: true,
  episodes: [],
  open_threads: [
    {
      id: 'thread-question', kind: 'question', raised_by: 'fan',
      summary: 'whether she ever visits Chicago', resolution_condition: 'she answers it',
      status: 'open', evidence_type: 'stated', confidence: 1,
      source_turn_id: 'turn-1', source_message_fingerprint: 'fingerprint-1',
      first_seen_at: null, last_seen_at: null, expires_at: null,
      was_read_rather_than_said: false, waiting_on_us: true,
    },
    {
      id: 'thread-preference', kind: 'correction', raised_by: 'fan',
      summary: 'he prefers outdoor sets', resolution_condition: 'the wording is corrected',
      status: 'open', evidence_type: 'inferred', confidence: 0.55,
      source_turn_id: 'turn-2', source_message_fingerprint: 'fingerprint-2',
      first_seen_at: null, last_seen_at: null, expires_at: null,
      was_read_rather_than_said: true, waiting_on_us: false,
    },
  ],
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`adapter failed (${response.status})`)
  return response.json()
}

export default function OperatorFlowHarness() {
  const [evidence, setEvidence] = useState(initialEvidence)
  const [selection, setSelection] = useState('')
  const [repairBusy, setRepairBusy] = useState<string | null>(null)
  const [hold, setHold] = useState('content_access_issue · case-access')
  const [memory, setMemory] = useState(initialMemory)
  const [memoryBusy, setMemoryBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState('original suggestion')
  const [trace, setTrace] = useState<ReplyTraceResponse | null>(null)
  const [generation, setGeneration] = useState('idle')
  const takeover = useRef(false)
  const [simulationMessages, setSimulationMessages] = useState<Message[]>([])
  const [simulationNotice, setSimulationNotice] = useState('')

  async function pollSemanticTurn() {
    const result: SimulationTurn = await json('/__adapter/semantic-turn')
    setSimulationMessages((result.creator_messages ?? []).map(row => ({
      ...row, fan_id: 'fan-1', creator_id: 'creator-1',
      sent_at: row.sent_at ?? '', was_ai_suggested: true, was_selected: true,
    })))
    setSimulationNotice(completedTurnMessage(result))
  }

  async function resolveRepair(resolution: ReviewResolution) {
    if (resolution !== 'resend_paid_content') return
    setRepairBusy(resolution)
    const result = await json('/__adapter/repair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution, reference: selection, review_case_id: evidence.review_case_id }),
    })
    const repair: RepairState = result.repair
    setEvidence(current => ({
      ...current,
      paid_items: current.paid_items.map(item => item.reference === selection ? { ...item, repair } : item),
      repairs: [repair, ...current.repairs],
    }))
    if (result.current_hold) setHold(result.current_hold)
    setRepairBusy(null)
  }

  async function actOnThread(thread: MemoryThread, action: 'resolve' | 'cancel' | 'correct') {
    const correction = action === 'correct' ? window.prompt('Correct wording', thread.summary)?.trim() : ''
    if (action === 'correct' && !correction) return
    setMemoryBusy(thread.id)
    await json('/__adapter/memory', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: thread.id, action, correction }),
    })
    setMemory(current => {
      const openThreads = action === 'correct'
        ? current.open_threads.map(item => item.id === thread.id ? { ...item, summary: correction! } : item)
        : current.open_threads.filter(item => item.id !== thread.id)
      return { ...current, open_threads: openThreads, carrying_anything: openThreads.length > 0 }
    })
    setMemoryBusy(null)
  }

  async function approveAssisted() {
    await json('/__adapter/reply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: draft, suggestion_token: 'suggestion-1', suggestion_edited: draft !== 'original suggestion' }),
    })
    setTrace(await json('/__adapter/reply-trace'))
  }

  async function generate() {
    setGeneration('generating')
    const result = await json('/__adapter/generate', { method: 'POST' })
    setGeneration(takeover.current ? 'discarded after takeover' : `accepted: ${result.reply}`)
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#11131a', color: '#edf0f7' }}>
      <h1>Operator flow adapter</h1>
      <section aria-label="content repair">
        <h2>Content repair</h2>
        <div data-testid="active-hold">Active hold: {hold}</div>
        <ContentAccessResolution evidence={evidence} error="" busy={repairBusy} selection={selection} onSelect={setSelection} onResolve={resolveRepair} />
      </section>
      <section aria-label="conversation memory">
        <h2>Conversation memory</h2>
        <ConversationMemoryPanel memory={memory} error="" busy={memoryBusy} onAct={actOnThread} />
      </section>
      <section aria-label="assisted reply">
        <h2>Assisted reply</h2>
        <textarea aria-label="Assisted reply text" value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="button" onClick={() => void approveAssisted()}>Approve Assisted reply</button>
        {trace && <ReplyTracePanel trace={trace} error="" />}
      </section>
      <section aria-label="semantic simulator">
        <h2>Semantic simulator</h2>
        <button type="button" onClick={() => void pollSemanticTurn()}>Poll semantic turn</button>
        <div data-testid="simulation-notice">{simulationNotice}</div>
        <SimulatedChat creatorId="creator-1" fanName="Test Fan" messages={simulationMessages}
          loading={false} showDebug={false} operatorDiagnostics={false} />
      </section>
      <section aria-label="takeover and rollback">
        <h2>Takeover and rollback</h2>
        <div data-testid="generation-state">{generation}</div>
        <button type="button" onClick={() => void generate()}>Generate</button>
        <button type="button" onClick={() => { takeover.current = true; setGeneration('operator takeover') }}>Take over</button>
        <button type="button" onClick={() => { takeover.current = false; setGeneration('rolled back to supervised') }}>Rollback takeover</button>
      </section>
    </main>
  )
}
