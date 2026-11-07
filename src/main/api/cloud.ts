import os from 'node:os'
import type { ApiHandlers } from '../../shared/api'
import { EngineError } from '../../engine/errors'
import type { ApiContext } from './context'

type CloudMethods =
  | 'cloud.status'
  | 'cloud.connect'
  | 'cloud.reopenLogin'
  | 'cloud.loginState'
  | 'cloud.cancelLogin'
  | 'cloud.disconnect'
  | 'cloud.setBaseUrl'
  | 'cloud.account'
  | 'cloud.catalog'
  | 'cloud.profile'
  | 'cloud.team'
  | 'cloud.invite'
  | 'cloud.revokeInvite'
  | 'cloud.spend'
  | 'cloud.voices'
  | 'cloud.cloneVoice'
  | 'cloud.blueprint'
  | 'cloud.blueprintPlan'
  | 'cloud.blueprintApply'
  | 'cloud.kitRef'
  | 'cloud.kit'
  | 'cloud.kitPublish'
  | 'cloud.kitDownload'

const isWebUrl = (value: string): boolean => {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Not connected (or signed out on the way): the panel shows "not connected" instead of an error. */
const signedOut = (e: unknown): boolean => e instanceof EngineError && e.code === 'missing_tool'

/** The approval page, on its « Créer un compte » form for a sign-up (the Cloud's /device page, `new=1`). */
export function loginPage(verificationUri: string, mode?: 'signin' | 'signup'): string {
  if (mode !== 'signup') return verificationUri
  return `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}new=1`
}

export function cloudApi(ctx: ApiContext): Pick<ApiHandlers, CloudMethods> {
  const { session, api, mirror, voices, blueprint } = ctx.cloud
  const open = async (uri: string, mode: unknown): Promise<void> => {
    if (!isWebUrl(uri)) return
    await Promise.resolve(ctx.openExternal(loginPage(uri, mode === 'signup' ? 'signup' : 'signin'))).catch(() => undefined)
  }
  const kits = ctx.cloudKits
  return {
    'cloud.status': () => session.status(),
    'cloud.connect': async (mode) => {
      const state = await session.startLogin(`Atelier (${os.hostname()})`)
      if (typeof state === 'object' && 'pending' in state) await open(state.verificationUri, mode)
      return state
    },
    'cloud.reopenLogin': async (mode) => {
      const state = session.loginState()
      if (typeof state === 'object' && 'pending' in state) await open(state.verificationUri, mode)
    },
    'cloud.loginState': () => session.loginState(),
    'cloud.cancelLogin': () => session.cancelLogin(),
    'cloud.disconnect': () => session.logout(),
    'cloud.setBaseUrl': (url) => {
      if (typeof url !== 'string') throw new Error('url must be a string')
      return session.setBaseUrl(url)
    },
    'cloud.account': async () => {
      if (!session.connected()) return null
      try {
        return await api.account()
      } catch (e) {
        if (signedOut(e)) return null
        throw e
      }
    },
    'cloud.catalog': async () => {
      if (!session.connected()) return null
      try {
        return await api.features()
      } catch {
        // unreachable, signed out or refused: every Cloud function stays demo
        return null
      }
    },
    'cloud.profile': async () => {
      if (!session.connected()) return null
      try {
        return await api.profile()
      } catch (e) {
        if (signedOut(e)) return null
        throw e
      }
    },
    'cloud.team': async () => {
      if (!session.connected()) return null
      try {
        return await api.team()
      } catch (e) {
        if (signedOut(e)) return null
        throw e
      }
    },
    'cloud.invite': async (email, role) => {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 200) throw new Error('Adresse e-mail invalide.')
      if (role !== undefined && role !== 'admin' && role !== 'member') throw new Error('Rôle inconnu.')
      try {
        return await api.invite(email.trim(), role ?? 'member')
      } finally {
        ctx.notify('cloud')
      }
    },
    'cloud.revokeInvite': async (id) => {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invitation inconnue.')
      try {
        await api.revokeInvite(id)
      } finally {
        ctx.notify('cloud')
      }
    },
    'cloud.spend': (month) => mirror.summary(month),
    'cloud.blueprint': (refresh) => (refresh === true ? blueprint.refresh() : Promise.resolve(blueprint.status())),
    'cloud.blueprintPlan': () => ctx.orchestra.blueprintPlan(),
    'cloud.blueprintApply': (version, agentIds) => {
      if (!Array.isArray(agentIds) || agentIds.some((x) => !Number.isInteger(x))) throw new Error('agentIds must be a list of agent ids')
      if (blueprint.version() !== version) throw new Error('The published version changed: reopen the list and confirm again')
      return ctx.orchestra.blueprintApply(agentIds)
    },
    'cloud.kitRef': (videoId) => kits.ref(videoId),
    'cloud.kit': (videoId, ref) => kits.kit(videoId, ref),
    'cloud.kitPublish': async (runId) => {
      try {
        return await kits.publishRun(runId)
      } finally {
        ctx.notify('cloud')
      }
    },
    'cloud.kitDownload': (videoId, name, ref) => kits.download(videoId, name, ref),
    'cloud.voices': () => voices.list(),
    'cloud.cloneVoice': async (request) => {
      try {
        return await voices.clone(request)
      } finally {
        ctx.notify('cloud')
      }
    }
  }
}
