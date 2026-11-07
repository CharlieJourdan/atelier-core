// The desktop app as a remote control (docs/BRAIN-HEADLESS.md): once Réglages › Ordinateur d'équipe is connected, every
// renderer call is forwarded to the headless brain on the team computer and its events (changes, chat replies) come
// back to the window. Two ways there:
// - direct: an address (`brain.url` setting) + the brain's token (`brain.token`, an encrypted secret that never
//   reaches the renderer, logs or errors), e.g. through an SSH tunnel;
// - via Atelier Cloud (`brain.via` = 'cloud'): the Cloud relays the calls to the team's computer; the app's own Cloud
//   session is the credential (no brain token kept), refreshed by CloudSession.
// Electron-free (plain fetch), unit-tested in-process.
import type { BrainCloudMachine, BrainConnectInput, BrainStatus, CallEnvelope, ChangeTopic, EventContract } from '../../shared/api'
import { brainCall, cloudBrainEndpoint, normalizeBrainUrl, openBrainEvents, type BrainEndpoint, type FetchLike } from '../../shared/brain-client'
import { t } from '../../shared/fr'
import type { SecretsStore } from '../secrets'
import type { SettingsStore } from '../settings'

export const BRAIN_URL_SETTING = 'brain.url'
export const BRAIN_NAME_SETTING = 'brain.name'
export const BRAIN_VIA_SETTING = 'brain.via'
export const BRAIN_TOKEN_SECRET = 'brain.token'
/** How long the list of the team's computers is trusted before it is asked again. */
export const CLOUD_OFFER_TTL_MS = 30_000

/** What the link needs of the app's Atelier Cloud session (src/main/cloud/session.ts). */
export interface BrainCloudAccess {
  connected(): boolean
  baseUrl(): string
  token(): Promise<string>
  /** The Cloud refused the access token early: the next token() refreshes it. */
  expireAccess(): void
  /** `GET /v1/team/machines` with the person's token. */
  machines(): Promise<BrainCloudMachine[]>
}

export interface BrainLinkDeps {
  settings: SettingsStore
  secrets: SecretsStore
  notify: (topic: ChangeTopic) => void
  emitStream: (payload: EventContract['atelier:stream']) => void
  fetchImpl?: FetchLike
  /** Reconnection delay of the event stream (tests pass a short one). */
  retryMs?: (attempt: number) => number
  cloud?: BrainCloudAccess
  now?: () => number
}

export class BrainLink {
  private events: { close(): void } | null = null
  private live = false
  private error: string | null = null
  private offer: { at: number; machines: BrainCloudMachine[]; error: string | null } | null = null
  private offerLoading = false

  constructor(private readonly deps: BrainLinkDeps) {}

  private viaCloud(): boolean {
    return this.deps.settings.get<string>(BRAIN_VIA_SETTING) === 'cloud'
  }

  /** True when calls go to the team computer. */
  active(): boolean {
    if (this.viaCloud()) return this.deps.cloud?.connected() === true
    return this.url() !== null && this.deps.secrets.has(BRAIN_TOKEN_SECRET)
  }

  status(): BrainStatus {
    const cloudOffer = this.cloudOffer()
    if (this.viaCloud()) {
      const remote = this.active()
      return {
        mode: remote ? 'remote' : 'local',
        url: remote ? (this.deps.cloud?.baseUrl() ?? null) : null,
        name: remote ? (this.deps.settings.get<string>(BRAIN_NAME_SETTING) ?? t('prefs.ordinateur.via.cloud')) : null,
        tokenSet: false,
        live: remote && this.live,
        error: remote ? this.error : null,
        storage: null,
        ...(remote ? { via: 'cloud' as const } : {}),
        ...(cloudOffer ? { cloud: cloudOffer } : {})
      }
    }
    const url = this.url()
    const tokenSet = this.deps.secrets.has(BRAIN_TOKEN_SECRET)
    const remote = url !== null && tokenSet
    return {
      mode: remote ? 'remote' : 'local',
      url,
      name: remote ? (this.deps.settings.get<string>(BRAIN_NAME_SETTING) ?? hostOf(url)) : null,
      tokenSet,
      live: remote && this.live,
      error: remote ? this.error : null,
      storage: tokenSet ? 'secret' : null,
      ...(remote ? { via: 'direct' as const } : {}),
      ...(cloudOffer ? { cloud: cloudOffer } : {})
    }
  }

  /** The team's computers on Atelier Cloud, only when signed in; a stale list is refreshed in the background. */
  private cloudOffer(): BrainStatus['cloud'] | null {
    const cloud = this.deps.cloud
    if (!cloud?.connected()) {
      this.offer = null
      return null
    }
    const now = (this.deps.now ?? Date.now)()
    if ((!this.offer || now - this.offer.at > CLOUD_OFFER_TTL_MS) && !this.offerLoading) {
      this.offerLoading = true
      void cloud
        .machines()
        .then(
          (machines) => ({ machines, error: null }),
          () => ({ machines: [] as BrainCloudMachine[], error: t('brain.err.cloudUnreachable') })
        )
        .then((r) => {
          const before = JSON.stringify(this.offer?.machines ?? null) + (this.offer?.error ?? '')
          this.offer = { at: (this.deps.now ?? Date.now)(), ...r }
          this.offerLoading = false
          if (before !== JSON.stringify(r.machines) + (r.error ?? '')) this.deps.notify('brain')
        })
    }
    return { machines: this.offer?.machines ?? [], checked: this.offer !== null, error: this.offer?.error ?? null }
  }

  /** At start: an existing link opens its event stream. */
  start(): void {
    if (this.active()) this.openEvents()
  }

  async connect(input: BrainConnectInput): Promise<BrainStatus> {
    if (input?.via === 'cloud') return this.connectCloud()
    const url = normalizeBrainUrl(input?.url ?? '')
    const token = String(input?.token ?? '').trim()
    if (!token) throw new Error(t('brain.err.tokenEmpty'))
    const ep = { url, token }
    // The token is checked before anything is kept: a wrong one leaves the app on its own brain.
    const machine = await brainCall(ep, 'app.machine', [], this.deps.fetchImpl)
    if (!machine.ok) throw codeError(machine.error.code, machine.error.message)
    const name = (machine.value as { hostname?: unknown } | null)?.hostname
    this.deps.settings.delete(BRAIN_VIA_SETTING)
    this.deps.secrets.set(BRAIN_TOKEN_SECRET, token)
    this.deps.settings.set(BRAIN_URL_SETTING, url)
    this.deps.settings.set(BRAIN_NAME_SETTING, typeof name === 'string' && name ? name : hostOf(url))
    this.error = null
    this.openEvents()
    this.deps.notify('brain')
    return this.status()
  }

  /** Via Atelier Cloud: the relay must reach the team's computer before the app switches to it. */
  private async connectCloud(): Promise<BrainStatus> {
    const cloud = this.deps.cloud
    if (!cloud?.connected()) throw codeError('UNAUTHORIZED', t('brain.err.cloudSignedOut'))
    const ep = this.cloudEndpoint(cloud)
    const machine = await brainCall(ep, 'app.machine', [], this.deps.fetchImpl)
    if (!machine.ok) throw codeError(machine.error.code, machine.error.message)
    const name = (machine.value as { hostname?: unknown } | null)?.hostname
    // a direct link (address + token) is forgotten: one way at a time
    this.deps.secrets.clear(BRAIN_TOKEN_SECRET)
    this.deps.settings.delete(BRAIN_URL_SETTING)
    this.deps.settings.set(BRAIN_VIA_SETTING, 'cloud')
    this.deps.settings.set(BRAIN_NAME_SETTING, typeof name === 'string' && name ? name : t('prefs.ordinateur.via.cloud'))
    this.error = null
    this.openEvents()
    this.deps.notify('brain')
    return this.status()
  }

  disconnect(): BrainStatus {
    this.closeEvents()
    this.deps.secrets.clear(BRAIN_TOKEN_SECRET)
    this.deps.settings.delete(BRAIN_URL_SETTING)
    this.deps.settings.delete(BRAIN_NAME_SETTING)
    this.deps.settings.delete(BRAIN_VIA_SETTING)
    this.error = null
    this.deps.notify('brain')
    return this.status()
  }

  /** Forwards one renderer call; the answer is the remote brain's envelope (same shape as the local bus). */
  async call(method: string, args: unknown): Promise<CallEnvelope<unknown>> {
    const ep = this.endpoint()
    if (!ep) return { ok: false, error: { code: 'BRAIN_UNREACHABLE', message: t(this.viaCloud() ? 'brain.err.cloudSignedOut' : 'brain.err.tokenEmpty') } }
    return brainCall(ep, method, Array.isArray(args) ? args : [], this.deps.fetchImpl)
  }

  close(): void {
    this.closeEvents()
  }

  private url(): string | null {
    const v = this.deps.settings.get<string>(BRAIN_URL_SETTING)
    return typeof v === 'string' && v ? v : null
  }

  private cloudEndpoint(cloud: BrainCloudAccess): BrainEndpoint {
    return cloudBrainEndpoint(cloud.baseUrl(), () => cloud.token(), () => cloud.expireAccess())
  }

  private endpoint(): BrainEndpoint | null {
    if (this.viaCloud()) return this.deps.cloud?.connected() ? this.cloudEndpoint(this.deps.cloud) : null
    const url = this.url()
    const token = url ? this.deps.secrets.get(BRAIN_TOKEN_SECRET) : null
    return url && token ? { url, token } : null
  }

  private openEvents(): void {
    this.closeEvents()
    const ep = this.endpoint()
    if (!ep) return
    this.events = openBrainEvents(
      ep,
      (event, payload) => {
        if (event === 'atelier:changed') this.deps.notify((payload as EventContract['atelier:changed']).topic)
        else if (event === 'atelier:stream') this.deps.emitStream(payload as EventContract['atelier:stream'])
      },
      {
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
        ...(this.deps.retryMs ? { retryMs: this.deps.retryMs } : {}),
        onState: (s) => {
          const changed = s.live !== this.live || s.error !== this.error
          this.live = s.live
          this.error = s.error
          if (changed) this.deps.notify('brain')
        }
      }
    )
  }

  private closeEvents(): void {
    this.events?.close()
    this.events = null
    this.live = false
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}
