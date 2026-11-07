// The beta, desktop app only (renders nothing):
// - the « Mode présentation » setting (`app.presentation`, Réglages › Avancé) decides the data mode: off (the default) =
//   real, on = the demo workspace; read at start and again whenever the main process reports a settings change;
// - in real mode, the Cloud account (`cloud.profile`) fills the workspace the sidebar and the screens show, refreshed on
//   the 'cloud' and 'spend' topics (sign-in, sign-out, credits spent).
import { useCallback, useEffect, useRef } from 'react'
import type { CloudProfile, EventContract } from '../../../shared/api'
import { call, useEvent } from '@/state/client'
import { useProto, useProtoActions } from '../store'
import { workspaceOf } from './account'

export const PRESENTATION_KEY = 'app.presentation'

export function BetaSync() {
  const { mode } = useProto()
  const { setMode, setWorkspace } = useProtoActions()
  const lastProfile = useRef<CloudProfile | null>(null)

  const loadMode = useCallback(() => {
    call('settings.get', PRESENTATION_KEY)
      .then((v) => setMode(v === true ? 'demo' : 'live'))
      .catch(() => undefined)
  }, [setMode])

  const loadAccount = useCallback(() => {
    void (async () => {
      const status = await call('cloud.status').catch(() => null)
      let profile: CloudProfile | null = null
      if (status?.connected) {
        try {
          profile = await call('cloud.profile')
        } catch {
          // unreachable for a moment: keep what was known
          profile = lastProfile.current
        }
      }
      lastProfile.current = profile
      setWorkspace(workspaceOf(profile, status))
    })()
  }, [setWorkspace])

  useEffect(() => loadMode(), [loadMode])
  useEffect(() => {
    if (mode === 'live') loadAccount()
  }, [mode, loadAccount])

  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (p.topic === 'settings') loadMode()
      if (mode === 'live' && (p.topic === 'cloud' || p.topic === 'spend')) loadAccount()
    },
    [mode, loadMode, loadAccount]
  )
  useEvent('atelier:changed', onChanged)
  return null
}
