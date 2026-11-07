// Browser build of the app (web app): there is no Electron main process. Two cases, decided before the app is imported:
// - connected to a team computer (Réglages › Ordinateur d'équipe, kept in this tab's sessionStorage): `window.atelier`
//   is the remote bridge (state/remote.ts) and the app is fully real. Direct (address + the brain's token) or via
//   Atelier Cloud (the site's Cloud session is the credential: nothing of the brain is kept, see cloud-session.ts);
// - otherwise a stub: the proto screens run on their own demo store, screens wired to the real core get a clear refusal
//   ("available in the desktop app"), and only the brain.* methods work (to connect).
import type { BrainConnectInput, BrainStatus } from '../../shared/api'
import { brainCall, cloudBrainEndpoint, normalizeBrainUrl, type BrainEndpoint } from '../../shared/brain-client'
import { fetchKitState } from '../../shared/kit-client'
import { t } from '../../shared/fr'
import { createRemoteBridge } from '../state/remote'
import { cloudBaseFromEnv, webCloudSession, type WebCloudSession } from './cloud-session'

const DESKTOP_ONLY = 'Disponible dans l’app de bureau (Mac / Windows), ou une fois relié à l’ordinateur d’équipe (Réglages › Ordinateur d’équipe).'
/** sessionStorage key of the link: { url, token, name } or { via: 'cloud', name }. Gone when the tab closes. */
export const BRAIN_SESSION_KEY = 'atelier.brain'

type Listener = (payload: unknown) => void

type SessionLink = { via: 'direct'; url: string; token: string; name: string } | { via: 'cloud'; name: string }

/** A few read methods get harmless defaults so shared chrome renders without an error line. */
const DEFAULTS: Record<string, unknown> = {
  'app.setTheme': null,
  'credits.balance': { available: 12_480, held: 0, example: 0 },
  'cloud.status': { connected: false },
  'features.list': []
}

const LOCAL_STATUS: BrainStatus = { mode: 'local', url: null, name: null, tokenSet: false, live: false, error: null, storage: null }

function cloudSession(): WebCloudSession | null {
  try {
    return webCloudSession({ storage: localStorage, baseUrl: cloudBaseFromEnv() })
  } catch {
    return null
  }
}

function readLink(): SessionLink | null {
  try {
    const raw = sessionStorage.getItem(BRAIN_SESSION_KEY)
    const v = raw ? (JSON.parse(raw) as { via?: unknown; url?: unknown; token?: unknown; name?: unknown }) : null
    if (!v) return null
    const name = typeof v.name === 'string' ? v.name : ''
    if (v.via === 'cloud') return { via: 'cloud', name: name || t('prefs.ordinateur.via.cloud') }
    return typeof v.url === 'string' && typeof v.token === 'string' ? { via: 'direct', url: v.url, token: v.token, name: name || v.url } : null
  } catch {
    return null
  }
}

/**
 * The publication kit, asked of the Cloud by the page itself (the team computer holds no person's token), and saved by the
 * browser: each file's presigned link carries `Content-Disposition: attachment`, so following it downloads it.
 */
function kitHandlers(session: WebCloudSession): Record<'cloud.kit' | 'cloud.kitDownload', (...args: never[]) => unknown> {
  const endpoint = { baseUrl: session.baseUrl, token: () => session.token(), expire: () => session.expire() }
  const state = (videoId: number, ref?: string) => fetchKitState(endpoint, videoId, ref)
  return {
    'cloud.kit': state,
    'cloud.kitDownload': async (videoId: number, name?: string | null, ref?: string) => {
      const s = await state(videoId, ref)
      if (s.status !== 'ok') throw new Error(t('kit.err.gone'))
      const files = typeof name === 'string' ? s.kit.files.filter((f) => f.name === name) : s.kit.files
      if (files.length === 0) throw new Error(t('kit.err.noFile'))
      for (const f of files) {
        const a = document.createElement('a')
        a.href = f.url
        a.download = f.name
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        await new Promise((resolve) => setTimeout(resolve, 250)) // browsers drop downloads fired in the same tick
      }
      return { saved: files.map((f) => f.name), dir: null }
    }
  }
}

const cloudEndpoint = (s: WebCloudSession): BrainEndpoint => cloudBrainEndpoint(s.baseUrl, () => s.token(), () => s.expire())

/** Checks the way in against the brain, keeps it in this tab and reloads the app on it. */
async function connect(input: BrainConnectInput): Promise<BrainStatus> {
  let ep: BrainEndpoint
  if (input?.via === 'cloud') {
    const session = cloudSession()
    if (!session) throw new Error(t('brain.err.cloudSignedOut'))
    ep = cloudEndpoint(session)
  } else {
    const token = String(input?.token ?? '').trim()
    ep = { url: normalizeBrainUrl(input?.url ?? ''), token }
    if (!token) throw new Error(t('brain.err.tokenEmpty'))
  }
  const machine = await brainCall(ep, 'app.machine', [])
  if (!machine.ok) throw Object.assign(new Error(machine.error.message), { name: machine.error.code })
  const hostname = (machine.value as { hostname?: unknown } | null)?.hostname
  const named = typeof hostname === 'string' && hostname ? hostname : null
  const link: SessionLink =
    ep.via === 'cloud'
      ? { via: 'cloud', name: named ?? t('prefs.ordinateur.via.cloud') }
      : { via: 'direct', url: ep.url, token: ep.token as string, name: named ?? new URL(ep.url).host }
  sessionStorage.setItem(BRAIN_SESSION_KEY, JSON.stringify(link))
  setTimeout(() => window.location.reload(), 600)
  return { mode: 'remote', url: ep.url, name: link.name, tokenSet: link.via === 'direct', live: false, error: null, storage: link.via === 'direct' ? 'session' : null, via: link.via }
}

function disconnect(): BrainStatus {
  try {
    sessionStorage.removeItem(BRAIN_SESSION_KEY)
  } catch {
    // storage blocked: nothing kept anyway
  }
  setTimeout(() => window.location.reload(), 600)
  return LOCAL_STATUS
}

/** Local status, with the team's computers when the site's Cloud session is there. */
async function localStatus(): Promise<BrainStatus> {
  const session = cloudSession()
  if (!session) return LOCAL_STATUS
  try {
    return { ...LOCAL_STATUS, cloud: { machines: await session.machines(), checked: true, error: null } }
  } catch {
    return { ...LOCAL_STATUS, cloud: { machines: [], checked: true, error: t('brain.err.cloudUnreachable') } }
  }
}

export function installWebBridge(): void {
  const w = window as unknown as { atelier?: unknown }
  if (w.atelier) return
  const link = readLink()
  const session = link?.via === 'cloud' ? cloudSession() : null
  const ep: BrainEndpoint | null = link?.via === 'direct' ? { url: link.url, token: link.token } : session ? cloudEndpoint(session) : null
  if (link && ep) {
    let live = false
    let error: string | null = null
    const status = (): BrainStatus => ({
      mode: 'remote',
      url: ep.url,
      name: link.name,
      tokenSet: link.via === 'direct',
      live,
      error,
      storage: link.via === 'direct' ? 'session' : null,
      via: link.via
    })
    const bridge = createRemoteBridge(ep, {
      local: {
        ...(session ? kitHandlers(session) : {}),
        'app.setTheme': () => null,
        'brain.status': status,
        'brain.connect': (input: BrainConnectInput) => connect(input),
        'brain.disconnect': disconnect
      },
      onState: (s) => {
        live = s.live
        error = s.error
        bridge.emit('atelier:changed', { topic: 'brain' })
      }
    })
    w.atelier = bridge
    return
  }
  const listeners = new Map<string, Set<Listener>>()
  const local: Record<string, (arg: never) => unknown> = {
    'brain.status': () => localStatus(),
    'brain.connect': (input: BrainConnectInput) => connect(input),
    'brain.disconnect': disconnect
  }
  w.atelier = {
    web: true,
    call: (method: string, ...args: unknown[]): Promise<unknown> => {
      const fn = local[method]
      if (fn) return Promise.resolve().then(() => fn(args[0] as never))
      return method in DEFAULTS ? Promise.resolve(DEFAULTS[method]) : Promise.reject(new Error(DESKTOP_ONLY))
    },
    on: (event: string, listener: Listener): (() => void) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    }
  }
}
