// Real mode, the loop: in the desktop app, registers the IPC driver and, while the mode is « réel », loads a snapshot of
// the runtime and the app, then reloads it whenever the main process reports a change (agents, tasks, chat, runs,
// channels) — debounced — and every 20 s as a safety net. In the web demo there is no main process: real mode falls
// back to demo. Renders nothing.
import { useCallback, useEffect, useRef } from 'react'
import type { ChangeTopic, EventContract } from '../../../shared/api'
import { call, useEvent } from '@/state/client'
import { useProto, useProtoActions } from '../store'
import { desktopDriver, isDesktop } from './driver'
import { setOnboardingDeps } from './onboarding-live'
import { liveDriver, setLiveDriver } from './registry'
import { BetaSync } from './BetaSync'

const TOPICS: readonly ChangeTopic[] = ['orchestra', 'chat', 'production', 'channels', 'videos', 'agents', 'ideas', 'spend', 'money', 'cloud', 'google']
const DEBOUNCE_MS = 300
const POLL_MS = 20_000

function Sync() {
  const { mode, principalName } = useProto()
  const { applyLive, setLive, setMode } = useProtoActions()
  const timer = useRef<number | null>(null)
  const busy = useRef(false)
  const again = useRef(false)
  const nameRef = useRef(principalName)
  useEffect(() => {
    nameRef.current = principalName
  }, [principalName])

  const load = useCallback(async () => {
    const driver = liveDriver()
    if (!driver) return
    if (busy.current) {
      // a change arrived during a load: one more pass when it ends
      again.current = true
      return
    }
    busy.current = true
    try {
      do {
        again.current = false
        try {
          applyLive(await driver.load(nameRef.current))
        } catch (err) {
          setLive({ loading: false, error: err instanceof Error ? err.message : String(err) })
        }
      } while (again.current)
    } finally {
      busy.current = false
    }
  }, [applyLive, setLive])

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void load()
    }, DEBOUNCE_MS)
  }, [load])

  // Real mode without a main process (web demo): back to demo.
  useEffect(() => {
    if (mode === 'live' && !liveDriver()) setMode('demo')
  }, [mode, setMode])

  useEffect(() => {
    if (mode !== 'live' || !liveDriver()) return
    void load()
    const poll = window.setInterval(() => void load(), POLL_MS)
    return () => {
      window.clearInterval(poll)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [mode, load])

  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (mode === 'live' && TOPICS.includes(p.topic)) schedule()
    },
    [mode, schedule]
  )
  useEvent('atelier:changed', onChanged)
  return null
}

// The driver is registered once, at module load, in the desktop app only.
if (isDesktop()) {
  setLiveDriver(desktopDriver)
  setOnboardingDeps({ call, startRun: desktopDriver.startRun })
}

export function LiveSync() {
  return (
    <>
      <Sync />
      {isDesktop() && <BetaSync />}
    </>
  )
}

/** True when the real mode can be offered (desktop app). */
export function canGoLive(): boolean {
  return liveDriver() !== null
}
