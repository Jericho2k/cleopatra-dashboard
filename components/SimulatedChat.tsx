'use client'

/**
 * The Simulator's centre pane: the complete, DB-backed test conversation.
 *
 * This renders the SAME `messages` rows the production Chats view renders. It
 * is not a second history store and not a second source of truth — the previous
 * simulator kept its transcript in React state, so a refresh silently erased
 * what looked like a conversation and the operator could not tell a lost
 * transcript from a fan who had said nothing.
 *
 * A PPV looks like a PPV here, in both of its states:
 *
 *   LOCKED (before a simulated purchase)  — a priced card with a locked preview,
 *                                           which is what the fan sees.
 *   UNLOCKED (after one)                  — the actual image or video.
 *
 * Which state a message is in comes from `media_context.ppv.purchased`, the same
 * flag the production purchase transition writes. The simulator never invents a
 * purchase state of its own.
 *
 * Mirrored `sim:` test media is resolved for DISPLAY only, through the
 * owner-only preview endpoint, which reads the source creator's vault via the
 * mirror's provenance. Nothing here can make such a row deliverable: a `sim:` id
 * is not a platform media id, it is refused by every delivery path, and no
 * platform id is ever written onto the simulation creator's catalog.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { apiFetch } from '../lib/api'
import { messageAIStack } from '../lib/aiStack'
import {
  collectSimulationMediaIds,
  fetchSimulationMediaPreviews,
  partitionMediaIds,
  ppvPresentation,
  type SimulationMedia,
} from '../lib/simulationWorkspace'
import type { Message } from '../types'

type Props = {
  creatorId: string
  fanName: string
  messages: Message[]
  loading: boolean
  showDebug: boolean
  /**
   * Whether this account may see the AI stack's ROUTING, not just which
   * profile answered.
   *
   * This used to be the only thing standing between an agency operator and the
   * supply chain. The transcript is read straight from the `messages` table
   * (app/simulator/page.tsx), not through a redacted response, and the marker
   * was persisted there in full — so a UI gate was all there was, and a UI gate
   * never removed the value from the browser that rendered it.
   *
   * The backend now splits routing out of `messages.media_context` before the
   * row is written, into a table the browser has no grant on at all
   * (db/owner_only_diagnostics_v1.sql). A row written by a current deployment
   * therefore carries `{ profile }` and nothing else, and this flag has nothing
   * left to hide.
   *
   * It stays because rows written before that migration ran still carry the
   * full marker, and because a gate that costs nothing is worth keeping on the
   * side of the boundary that can be read by a person.
   */
  operatorDiagnostics: boolean
}

const UNRESOLVED = { url: null, thumbnail_url: null, mimetype: null }

export default function SimulatedChat({
  creatorId,
  fanName,
  messages,
  loading,
  showDebug,
  operatorDiagnostics,
}: Props) {
  const [media, setMedia] = useState<SimulationMedia>({})
  // FE-007's rule, applied here too: what to request is derived from the
  // MESSAGES and from a set of ids already asked about, never from the map this
  // effect writes. An id the server did not answer for is recorded as
  // unresolvable rather than looking like work still to do, so a server that
  // omits one cannot make this loop forever.
  const requested = useRef<Set<string>>(new Set())
  // Which conversation those requested ids belong to. Resolution is per
  // creator+fan, so switching conversation has to start a fresh set; doing it
  // inside the resolution effect rather than in a second effect that calls
  // setState keeps this to one render pass.
  const resolvedFor = useRef('')
  const endRef = useRef<HTMLDivElement | null>(null)

  const referenced = useMemo(
    () => collectSimulationMediaIds(messages),
    [messages],
  )

  useEffect(() => {
    const conversationKey = `${creatorId}:${fanName}`
    const switched = resolvedFor.current !== conversationKey
    if (switched) {
      resolvedFor.current = conversationKey
      requested.current = new Set()
    }
    const pending = referenced.filter(id => !requested.current.has(id))
    if (!creatorId || (pending.length === 0 && !switched)) return
    pending.forEach(id => requested.current.add(id))

    const { vault, simulation } = partitionMediaIds(pending)
    let cancelled = false

    const resolve = async () => {
      const merged: SimulationMedia = {}
      if (vault.length > 0) {
        try {
          const response = await apiFetch(`/vault-media-urls/${creatorId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_ids: vault }),
          })
          if (response.ok) {
            const body = await response.json().catch(() => ({}))
            Object.assign(merged, body?.media ?? {})
          }
        } catch {
          // Falls through to the unresolved backfill below.
        }
      }
      if (simulation.length > 0) {
        Object.assign(
          merged,
          await fetchSimulationMediaPreviews(creatorId, simulation),
        )
      }
      if (cancelled) return
      setMedia(previous => {
        // A conversation switch discards the previous map rather than merging
        // into it: those ids belong to a different fan.
        const next = switched ? {} : { ...previous }
        for (const id of pending) next[id] = merged[id] ?? { ...UNRESOLVED }
        return next
      })
    }

    void resolve()
    return () => {
      cancelled = true
    }
  }, [referenced, creatorId, fanName])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages.length])

  if (loading && messages.length === 0) {
    return <Empty>Loading the persisted conversation…</Empty>
  }
  if (messages.length === 0) {
    return (
      <Empty>
        No messages yet. Type below as the fan and the real Full Auto pipeline
        will answer. Everything is persisted, so this conversation will still be
        here tomorrow.
      </Empty>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 4px' }}>
      {messages.map(message => (
        <Bubble
          key={message.id}
          message={message}
          fanName={fanName}
          media={media}
          showDebug={showDebug}
          operatorDiagnostics={operatorDiagnostics}
        />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {children}
    </div>
  )
}

function Bubble({
  message,
  fanName,
  media,
  showDebug,
  operatorDiagnostics,
}: {
  message: Message
  fanName: string
  media: SimulationMedia
  showDebug: boolean
  operatorDiagnostics: boolean
}) {
  const isFan = message.role === 'fan'
  const ppv = ppvPresentation(message.media_context)
  const stack = messageAIStack(message.media_context)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isFan ? 'flex-start' : 'flex-end',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}
      >
        {isFan ? fanName || 'Fan' : 'Creator'}
      </div>
      <div
        style={{
          maxWidth: '78%',
          background: isFan ? 'var(--bg-elevated)' : 'rgba(155,143,212,0.12)',
          border: `1px solid ${isFan ? 'var(--border)' : 'rgba(155,143,212,0.35)'}`,
          borderRadius: 12,
          padding: message.content ? '9px 12px' : 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.content}
      </div>

      {ppv.kind !== 'none' && (
        <PpvCard presentation={ppv} media={media} showDebug={showDebug} />
      )}

      {/* Which stack answered is a product-level fact and stays. What it
          routed to is owner diagnostics, and on a current row it is not here to
          render — the backend keeps it out of the table this transcript reads.
          The gate covers rows written before that change. */}
      {showDebug && stack && (
        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          {stack.profile}
          {operatorDiagnostics && (
            <>
              {stack.route ? ` · ${stack.route}` : ''}
              {stack.model ? ` · ${stack.model}` : ''}
              {stack.prompt_version ? ` · ${stack.prompt_version}` : ''}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A PPV as the fan would meet it.
 *
 * Locked: the price is the headline and the media is covered. Unlocked: the
 * media is the headline and the price is a footnote, because that is the actual
 * difference between the two experiences.
 */
function PpvCard({
  presentation,
  media,
  showDebug,
}: {
  presentation: Exclude<ReturnType<typeof ppvPresentation>, { kind: 'none' }>
  media: SimulationMedia
  showDebug: boolean
}) {
  const locked = presentation.kind === 'locked'
  const width = presentation.mediaIds.length > 1 ? '32.5%' : '100%'

  return (
    <div
      style={{
        width: 260,
        maxWidth: '78%',
        border: `1px solid ${locked ? 'rgba(155,143,212,0.45)' : 'var(--border-strong)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, lineHeight: 0 }}>
        {presentation.mediaIds.map(mediaId => {
          const resolved = media[mediaId]
          const source = resolved?.thumbnail_url ?? resolved?.url ?? null
          const isVideo = (resolved?.mimetype ?? '').startsWith('video')
          return (
            <div
              key={mediaId}
              style={{
                position: 'relative',
                width,
                aspectRatio: '3/4',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              {source ? (
                <img
                  src={source}
                  alt={locked ? 'Locked PPV preview' : 'Unlocked PPV content'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    // The locked state is a real visual treatment, not a badge:
                    // the operator has to see what the fan sees before deciding
                    // whether an offer lands.
                    filter: locked ? 'blur(14px) brightness(0.55)' : 'none',
                    transform: locked ? 'scale(1.1)' : 'none',
                  }}
                  onError={event => {
                    ;(event.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                  }}
                >
                  {locked ? '🔒' : '…'}
                </div>
              )}
              {locked && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                  }}
                >
                  🔒
                </div>
              )}
              {!locked && isVideo && (
                <div
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    fontSize: 14,
                  }}
                >
                  🎬
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ padding: '8px 11px' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: locked ? 'var(--purple)' : 'var(--green)',
          }}
        >
          {locked ? '🔒 Locked' : '✓ Unlocked'} · ${presentation.price.toFixed(2).replace(/\.00$/, '')}
          {presentation.mediaIds.length > 1 ? ` · ${presentation.mediaIds.length} pcs` : ''}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {locked
            ? 'Use Simulate purchase or Simulate decline to move it on.'
            : 'Purchased in simulation.'}
        </div>
        {showDebug && (
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              color: 'var(--text-faint)',
              wordBreak: 'break-all',
            }}
          >
            {presentation.mediaIds.join(', ')}
            {presentation.setId ? ` · set ${presentation.setId}` : ''}
            {presentation.priceCents !== null
              ? ` · ${presentation.priceCents}c`
              : ''}
          </div>
        )}
      </div>
    </div>
  )
}
