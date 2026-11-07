// The brain's end of the Atelier Cloud relay (docs/BRAIN-HEADLESS.md §7): no port is opened on the team computer. The
// brain keeps an OUTBOUND long poll on the Cloud (`GET /v1/relay/machine/next`), runs each call it receives exactly as
// `POST /rpc` would (the same refusals of screen-only methods, the same envelope), posts the answer back
// (`POST /v1/relay/machine/reply`) and pushes its events up (`POST /v1/relay/machine/events`), batched. It reconnects
// with a growing delay; a 401 means the credential was revoked: the brain enrols again if a new enrolment file is
// there, else it stops relaying and says so. The credential is only ever in an Authorization header.
import { CLOUD_ROUTES, RelayNextResponse } from '../../shared/cloud-api'
import type { EventName } from '../../shared/api'
import type { EventHub } from './events'
import type { CloudMachineLink } from './cloud-link'

export const RELAY_MAX_REPLY_BYTES = 32 * 1024 * 1024

const SSE_NAMES: Partial<Record<EventName, 'changed' | 'stream'>> = { 'atelier:changed': 'changed', 'atelier:stream': 'stream' }

export interface RelayState {
  online: boolean
  machineId: string | null
  error: string | null
}

export interface BrainRelayOptions {
  link: CloudMachineLink
  /** One call on the wire form → its wire envelope (server.ts `dispatchRemote`). */
  dispatch: (method: unknown, args: unknown) => Promise<unknown>
  hub: EventHub
  fetchImpl?: typeof fetch
  log?: (line: string) => void
  /** Long-poll wait asked of the Cloud, in seconds (default 25). */
  waitS?: number
  maxReplyBytes?: number
  /** Calls run at once (default 16). */
  concurrency?: number
  retryMs?: (attempt: number) => number
  eventFlushMs?: number
  /** The credential was refused: a new link (enrolled again) or null to stop. */
  onRevoked?: () => Promise<CloudMachineLink | null>
  onState?: (s: RelayState) => void
}

const tooLarge = { ok: false, error: { code: 'TOO_LARGE', message: 'Réponse trop grosse pour passer par Atelier Cloud.' } }
/** Posted instead when the Cloud refuses an answer for any other reason (4xx): the caller gets an answer, not a 60 s wait. */
const refused = { ok: false, error: { code: 'ERROR', message: 'Réponse du cerveau refusée par Atelier Cloud.' } }

/** The Cloud's limits of an error envelope (src/shared/cloud-api.ts `BrainEnvelope`). */
export const MAX_ERROR_CODE = 100
export const MAX_ERROR_MESSAGE = 4000

const cut = (v: unknown, max: number): string => {
  const text = typeof v === 'string' ? v : String(v ?? '')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** An error envelope cut to what the Cloud accepts (a long stack in a message must not turn into a timeout). */
export function fitEnvelope(response: unknown): unknown {
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== false) return response
  const error = (response as { error?: { code?: unknown; message?: unknown } }).error
  return { ok: false, error: { code: cut(error?.code ?? 'ERROR', MAX_ERROR_CODE) || 'ERROR', message: cut(error?.message ?? '', MAX_ERROR_MESSAGE) } }
}

export class BrainRelay {
  private link: CloudMachineLink
  private closed = false
  private ctrl = new AbortController()
  private wake: (() => void) | null = null
  private readonly inflight = new Set<Promise<void>>()
  private events: { event: 'changed' | 'stream'; data: unknown }[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null
  private loop: Promise<void> | null = null
  private st: RelayState
  private readonly fetchImpl: typeof fetch
  private readonly log: (line: string) => void

  constructor(private readonly o: BrainRelayOptions) {
    this.link = o.link
    this.fetchImpl = o.fetchImpl ?? fetch
    this.log = o.log ?? (() => undefined)
    this.st = { online: false, machineId: o.link.machineId, error: null }
  }

  state(): RelayState {
    return { ...this.st }
  }

  private setState(patch: Partial<RelayState>): void {
    const next = { ...this.st, ...patch }
    const changed = next.online !== this.st.online || next.error !== this.st.error || next.machineId !== this.st.machineId
    this.st = next
    if (changed) this.o.onState?.(this.state())
  }

  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.link.credential}`, ...(json ? { 'content-type': 'application/json' } : {}) }
  }

  start(): void {
    if (this.loop) return
    this.unsubscribe = this.o.hub.subscribe((event, payload) => {
      const name = SSE_NAMES[event]
      if (!name || !this.st.online) return
      if (this.events.length >= 1000) return
      this.events.push({ event: name, data: payload })
      if (this.events.length >= 200) void this.flush()
      else this.flushTimer ??= setTimeout(() => void this.flush(), this.o.eventFlushMs ?? 100)
    })
    this.loop = this.run()
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    while (this.events.length > 0 && !this.closed) {
      const batch = this.events.splice(0, 500)
      try {
        await this.fetchImpl(`${this.link.cloudUrl}${CLOUD_ROUTES.relayEvents.path}`, {
          method: 'POST',
          headers: this.headers(true),
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(15_000)])
        })
      } catch {
        return // events are live news: lost ones are not replayed
      }
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  private async run(): Promise<void> {
    const waitS = this.o.waitS ?? 25
    const retryMs = this.o.retryMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** n))
    let attempt = 0
    while (!this.closed) {
      try {
        const res = await this.fetchImpl(`${this.link.cloudUrl}${CLOUD_ROUTES.relayNext.path}?wait=${waitS}`, {
          headers: this.headers(),
          signal: AbortSignal.any([this.ctrl.signal, AbortSignal.timeout((waitS + 20) * 1000)])
        })
        if (res.status === 401) {
          this.setState({ online: false, error: 'Identifiant de la machine refusé par Atelier Cloud (révoqué).' })
          this.log('Atelier Cloud : l’identifiant de cette machine a été révoqué.')
          const fresh = this.o.onRevoked ? await this.o.onRevoked().catch(() => null) : null
          if (!fresh || this.closed) {
            this.log('Atelier Cloud : relais arrêté. Demande un nouveau jeton d’inscription (npm run cloud -- machines enrol-token <id>).')
            return
          }
          this.link = fresh
          this.setState({ machineId: fresh.machineId, error: null })
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = RelayNextResponse.parse(await res.json())
        if (!this.st.online) this.log(`Atelier Cloud : relié (machine ${this.link.machineId}).`)
        this.setState({ online: true, error: null })
        attempt = 0
        for (const r of body.requests) {
          while (this.inflight.size >= (this.o.concurrency ?? 16)) await Promise.race(this.inflight)
          const p = this.handle(r.id, r.method, r.args).finally(() => this.inflight.delete(p))
          this.inflight.add(p)
        }
      } catch {
        if (this.closed) return
        if (this.st.online) this.log('Atelier Cloud : liaison coupée, reconnexion…')
        this.setState({ online: false, error: 'Atelier Cloud ne répond pas : reconnexion…' })
        await this.pause(retryMs(attempt++))
      }
    }
  }

  private async handle(id: string, method: string, args: unknown[]): Promise<void> {
    let response: unknown
    try {
      response = await this.o.dispatch(method, args)
    } catch {
      response = { ok: false, error: { code: 'ERROR', message: 'Erreur interne du cerveau.' } }
    }
    let body = JSON.stringify({ id, response: fitEnvelope(response) })
    if (Buffer.byteLength(body) > (this.o.maxReplyBytes ?? RELAY_MAX_REPLY_BYTES)) body = JSON.stringify({ id, response: tooLarge })
    try {
      const res = await this.post(body)
      // The Cloud's own limit may be lower than ours (413), or it refused the answer's shape (400): the caller still gets
      // a clear answer. 401 (revoked) and 404 (the call is gone: timed out) have no one left to answer.
      if (res.status === 413) await this.post(JSON.stringify({ id, response: tooLarge }))
      else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 404) await this.post(JSON.stringify({ id, response: refused }))
    } catch {
      // the Cloud is gone: the caller's call times out there
    }
  }

  private post(body: string): Promise<Response> {
    return this.fetchImpl(`${this.link.cloudUrl}${CLOUD_ROUTES.relayReply.path}`, {
      method: 'POST',
      headers: this.headers(true),
      body,
      signal: AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(60_000)])
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.unsubscribe?.()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.ctrl.abort()
    this.wake?.()
    await this.loop?.catch(() => undefined)
    await Promise.allSettled([...this.inflight])
    this.setState({ online: false })
  }
}
