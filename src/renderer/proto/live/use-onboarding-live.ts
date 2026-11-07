// React side of the real-mode onboarding: one session per flow (null in demo mode and in the web demo) and a hook that
// reads its state. See onboarding-live.ts for what the session does.
import { useState, useSyncExternalStore } from 'react'
import { useProto } from '../store'
import { LiveOnboardingSession, onboardingDeps, type LiveOnboardingState } from './onboarding-live'

/** True when the onboarding does real work: real mode in the desktop app. */
export function useIsLiveOnboarding(): boolean {
  const { mode } = useProto()
  return mode === 'live' && onboardingDeps() !== null
}

/** The session of this flow, decided when the flow opens (switching the data mode mid-flow does not change it). */
export function useLiveSession(): LiveOnboardingSession | null {
  const { mode } = useProto()
  const [session] = useState<LiveOnboardingSession | null>(() => {
    const deps = onboardingDeps()
    return mode === 'live' && deps ? new LiveOnboardingSession(deps) : null
  })
  return session
}

const NO_SUBSCRIPTION = (): (() => void) => () => undefined

/** The state of a session (null when there is none). */
export function useLiveState(session: LiveOnboardingSession | null | undefined): LiveOnboardingState | null {
  return useSyncExternalStore(session ? session.subscribe : NO_SUBSCRIPTION, session ? session.getState : () => null, session ? session.getState : () => null)
}
