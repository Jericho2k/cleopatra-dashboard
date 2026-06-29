'use client'

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Supabase realtime sockets die silently when a tab is backgrounded for a while
 * (browser throttling + server-side idle drop) or when the network drops, and
 * the JWT used to authenticate the socket can expire in the meantime. Nothing
 * resubscribes on its own, so live INSERT/UPDATE events stop arriving — the UI
 * looks frozen until a manual refresh.
 *
 * This module installs a single set of `visibilitychange` / `online` listeners
 * (deduped at module scope so we never refresh the session more than once per
 * recovery) and broadcasts a tick to every subscriber once the session has been
 * re-validated. Components include the returned tick in the dependency array of
 * any useEffect that creates a realtime channel, so the channel tears down and
 * resubscribes on a fresh, authenticated socket.
 */

let installed = false
let recovering = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

async function recover() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (recovering) return
  recovering = true
  try {
    // getSession() reads from storage and transparently refreshes an expired
    // token, so the realtime socket can re-authenticate on resubscribe.
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) {
      try {
        supabase.realtime.setAuth(token)
      } catch {
        // best effort — older/newer client versions vary
      }
    }
  } catch {
    // best effort — if recovery fails we still emit so channels resubscribe
  } finally {
    recovering = false
    emit()
  }
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const onVisible = () => {
    if (document.visibilityState === 'visible') void recover()
  }
  const onOnline = () => void recover()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
}

/**
 * Returns a counter that increments after the realtime connection is recovered
 * (tab refocused or network restored, session re-validated). Include the value
 * in the dependency array of any useEffect that creates a Supabase realtime
 * channel so it resubscribes on the refreshed socket.
 */
export function useRealtimeRecovery(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    install()
    const bump = () => setTick((t) => t + 1)
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])
  return tick
}
