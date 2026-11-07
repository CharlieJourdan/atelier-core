// The Discord gateway, only for the buttons: a click on « Valider une fois / Refuser / Toujours valider » is an
// interaction, and a bot without a public HTTPS endpoint receives it over this WebSocket. Everything else stays pull-based
// over REST (bridge.ts). Minimal client: hello → identify (no intent: interactions need none) or resume, heartbeats with
// zombie detection, reconnect with a growing delay, resume after a drop. Fatal closes (token refused) stop it for good.
// The socket factory is injected: the app uses Node's WebSocket, the tests an in-memory gateway (fake.ts).
import { DiscordError, scrub, type DiscordRest } from './rest'
import type { DiscordInteraction } from './types'

export interface SocketLike {
  send(data: string): void
  close(code?: number): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type SocketFactory = (url: string) => SocketLike

export interface GatewayOptions {
  token: () => string | null
  rest: DiscordRest
  socket: SocketFactory
  onInteraction: (i: DiscordInteraction) => void
  /** A fatal problem (shown in Réglages › Discord). */
  onError?: (message: string) => void
  random?: () => number
}

interface Payload {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
}

/** Closes after which reconnecting is useless: authentication failed, bad shard / version / intents. */
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014])
const MAX_BACKOFF_MS = 60_000

/** Node's WebSocket (Node 22+, Electron), when there is one. */
export function nodeSocket(): SocketFactory | null {
  const WS = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket
  return WS ? (url) => new WS(url) : null
}

export class DiscordGateway {
  /** Identified (or resumed): clicks arrive. */
  ready = false
  private ws: SocketLike | null = null
  private running = false
  private seq: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private beat: ReturnType<typeof setInterval> | null = null
  private firstBeat: ReturnType<typeof setTimeout> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private acked = true
  private failures = 0
  private readonly random: () => number

  constructor(private readonly o: GatewayOptions) {
    this.random = o.random ?? Math.random
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.connect()
  }

  stop(): void {
    this.running = false
    this.ready = false
    this.clearTimers()
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      try {
        ws.close(1000)
      } catch {
        // already closed
      }
    }
  }

  private async connect(): Promise<void> {
    if (!this.running) return
    let base = this.resumeUrl
    try {
      base = base ?? (await this.o.rest.gatewayBot()).url
    } catch (err) {
      if (err instanceof DiscordError && err.status === 401) return this.fatal(String(err.message))
      return this.reconnectLater()
    }
    if (!this.running) return
    let ws: SocketLike
    try {
      ws = this.o.socket(`${base}/?v=10&encoding=json`)
    } catch {
      return this.reconnectLater()
    }
    this.ws = ws
    ws.onmessage = (ev) => this.receive(ev.data)
    ws.onerror = () => undefined
    ws.onclose = (ev) => this.closed(ws, ev.code)
  }

  private send(p: Payload): void {
    try {
      this.ws?.send(JSON.stringify(p))
    } catch {
      // the close handler reconnects
    }
  }

  private receive(raw: unknown): void {
    let p: Payload
    try {
      p = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Payload
    } catch {
      return
    }
    if (typeof p.s === 'number') this.seq = p.s
    if (p.op === 10) return this.hello(p.d as { heartbeat_interval?: number })
    if (p.op === 11) {
      this.acked = true
      return
    }
    if (p.op === 1) return this.send({ op: 1, d: this.seq })
    if (p.op === 7) return this.drop(4000)
    if (p.op === 9) {
      // invalid session: start a new one unless Discord says it can be resumed
      if (p.d !== true) {
        this.sessionId = null
        this.seq = null
        this.resumeUrl = null
      }
      return this.drop(4000)
    }
    if (p.op !== 0) return
    if (p.t === 'READY') {
      const d = p.d as { session_id?: string; resume_gateway_url?: string }
      this.sessionId = d.session_id ?? null
      this.resumeUrl = d.resume_gateway_url ?? null
      this.ready = true
      this.failures = 0
    } else if (p.t === 'RESUMED') {
      this.ready = true
      this.failures = 0
    } else if (p.t === 'INTERACTION_CREATE') {
      this.o.onInteraction(p.d as DiscordInteraction)
    }
  }

  private hello(d: { heartbeat_interval?: number }): void {
    const token = this.o.token()
    if (!token) return this.fatal('No Discord bot token is set')
    const interval = typeof d?.heartbeat_interval === 'number' && d.heartbeat_interval > 0 ? d.heartbeat_interval : 41_250
    this.clearTimers()
    this.acked = true
    this.firstBeat = setTimeout(() => {
      this.heartbeat()
      this.beat = setInterval(() => this.heartbeat(), interval)
      this.beat.unref?.()
    }, Math.floor(interval * this.random()))
    this.firstBeat.unref?.()
    if (this.sessionId && this.seq !== null) this.send({ op: 6, d: { token, session_id: this.sessionId, seq: this.seq } })
    else this.send({ op: 2, d: { token, intents: 0, properties: { os: process.platform, browser: 'atelier', device: 'atelier' } } })
  }

  private heartbeat(): void {
    // no acknowledgement of the last beat: the connection is a zombie
    if (!this.acked) return this.drop(4000)
    this.acked = false
    this.send({ op: 1, d: this.seq })
  }

  /** Closes the socket on our side; the close handler reconnects (and resumes). */
  private drop(code: number): void {
    const ws = this.ws
    if (!ws) return
    try {
      ws.close(code)
    } catch {
      // already closing
    }
    this.closed(ws, code)
  }

  private closed(ws: SocketLike, code: number): void {
    if (ws !== this.ws) return
    ws.onclose = null
    ws.onmessage = null
    this.ws = null
    this.ready = false
    this.clearTimers()
    if (!this.running) return
    if (FATAL.has(code)) return this.fatal(`Discord gateway closed (${code})`)
    // a session Discord will not resume
    if (code === 4007 || code === 4009) {
      this.sessionId = null
      this.seq = null
      this.resumeUrl = null
    }
    this.reconnectLater()
  }

  private reconnectLater(): void {
    if (!this.running || this.retry) return
    const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures) * (0.5 + this.random() / 2)
    this.failures = Math.min(this.failures + 1, 10)
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, wait)
    this.retry.unref?.()
  }

  private fatal(message: string): void {
    this.stop()
    this.o.onError?.(scrub(message, this.o.token()))
  }

  private clearTimers(): void {
    if (this.beat) clearInterval(this.beat)
    if (this.firstBeat) clearTimeout(this.firstBeat)
    this.beat = null
    this.firstBeat = null
  }
}
