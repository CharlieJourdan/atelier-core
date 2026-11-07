// The beta's first gate (desktop app only): Atelier opens on the welcome screen until it is signed in to Atelier Cloud or
// the person chose « Continuer sans compte » (setting `app.offline`). Signing out, or « Se connecter » from the offline
// sidebar, clears that choice and brings the welcome back.
//
// Then the first-run onboarding: a workspace that never finished it (database setting `app.onboarded`, read through
// `app.onboarding`, so a team computer reached through the relay answers for its own workspace) opens it as soon as the
// gate is passed, in this session or at a later launch. Never in the presentation mode (the demo workspace), where the
// onboarding only shows when replayed by hand (the store's `onboarded`).
import { useCallback, useEffect, useState } from 'react'
import type { EventContract } from '../../../shared/api'
import { isDesktopApp } from '@/proto/live/desktop'
import type { DataMode } from '@/proto/store'
import { call, useEvent } from '@/state/client'

export const OFFLINE_KEY = 'app.offline'

export type GateState = 'loading' | 'welcome' | 'ready'

/** What the window shows. */
export type MainScreen = 'loading' | 'welcome' | 'onboarding' | 'app'

/** Pure: where the app stands from the Cloud status and the offline choice. */
export function gateOf(connected: boolean | null, offline: boolean | null): GateState {
  if (connected === null || offline === null) return 'loading'
  return connected || offline ? 'ready' : 'welcome'
}

export interface ScreenInput {
  gate: GateState
  mode: DataMode
  /** The workspace finished the first-run onboarding (null while it is being read). */
  firstRunDone: boolean | null
  /** The store's flag: false while the onboarding is replayed by hand. */
  onboarded: boolean
}

/** Pure: the welcome first, then the first-run onboarding (real mode only), else the app (or a replayed onboarding). */
export function mainScreenOf(i: ScreenInput): MainScreen {
  if (i.gate !== 'ready') return i.gate
  if (i.mode === 'live') {
    if (i.firstRunDone === null) return 'loading'
    if (!i.firstRunDone) return 'onboarding'
  }
  return i.onboarded ? 'app' : 'onboarding'
}

function useDesktopGate(): GateState {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [offline, setOffline] = useState<boolean | null>(null)
  const load = useCallback(() => {
    call('cloud.status')
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false))
    call('settings.get', OFFLINE_KEY)
      .then((v) => setOffline(v === true))
      .catch(() => setOffline(false))
  }, [])
  useEffect(() => load(), [load])
  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (p.topic === 'cloud' || p.topic === 'settings') load()
    },
    [load]
  )
  useEvent('atelier:changed', onChanged)
  return gateOf(connected, offline)
}

const DESKTOP = isDesktopApp()

/** The web demo and unit renders have no account to sign in to: always ready. */
export const useAccountGate: () => GateState = DESKTOP ? useDesktopGate : () => 'ready'

export interface FirstRun {
  /** Finished (or counted as such); null while being read. */
  done: boolean | null
  /** Stores that the onboarding is over (finished, « Plus tard », or skipped). */
  finish: () => void
}

/**
 * Read each time the gate opens in real mode, not on every change: the onboarding itself creates a channel, which must not
 * close it half-way. After `finish` it stays done for the session, before the database even answers.
 */
function useDesktopFirstRun(active: boolean): FirstRun {
  const [done, setDone] = useState<boolean | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    call('app.onboarding')
      .then((s) => live && setDone((prev) => prev === true || s.done))
      // unreadable (an older team computer without the method): never trap the person in the onboarding
      .catch(() => live && setDone(true))
    return () => {
      live = false
    }
  }, [active])
  const finish = useCallback(() => {
    setDone(true)
    call('app.finishOnboarding').catch(() => undefined)
  }, [])
  return { done: active ? done : null, finish }
}

const NO_FIRST_RUN: FirstRun = { done: true, finish: () => undefined }

/** The first-run state of the workspace; the web demo and unit renders have none (always done). */
export const useFirstRun: (active: boolean) => FirstRun = DESKTOP ? useDesktopFirstRun : () => NO_FIRST_RUN

/** Back to the welcome screen (sign out, or sign in from offline). */
export async function backToWelcome(signOut: boolean): Promise<void> {
  if (signOut) await call('cloud.disconnect')
  await call('settings.set', OFFLINE_KEY, false)
}
