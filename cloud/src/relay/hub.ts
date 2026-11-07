// The brain relay (docs/BRAIN-HEADLESS.md §7): a team computer opens no port; its brain keeps an OUTBOUND long poll
// on the Cloud (`GET /v1/relay/machine/next`), takes the calls waiting for it, answers each one
// (`POST /v1/relay/machine/reply`) and pushes its events up (`POST /v1/relay/machine/events`). The team's people call
// `POST /v1/team/brain/rpc` and listen to `GET /v1/team/brain/events`; this hub pairs the two sides, in memory (one Cloud
// process in v2: a restart drops the calls in flight, which time out, and the machines poll again).
//
// A machine is online while its long poll is open, or for `onlineGraceMs` after the last one ended. An offline
// machine is refused at once (no queue that would replay stale calls later); a call nobody answers within
// `timeoutMs` ends with `timeout`; a machine holds at most `maxQueued` calls waiting or in flight, and at most
// `maxPendingBytesPerMachine` of their arguments (`maxPendingBytes` on the whole Cloud); a poll hands out at most
// `maxPollBytes` at once. A machine whose credential was revoked (by another process: the admin tool) is dropped the
// next time a call is handed to it or it polls: its open long poll never receives a call after the revocation.
import { randomBytes } from 'node:crypto'
import type { Clock } from '../clock.ts'
import { CloudError } from '../errors.ts'

export interface RelayLimits {
  /** How long a user call waits for the machine's answer. */
  timeoutMs: number
  /** Longest wait of the machine's long poll. */
  pollWaitMs: number
  /** A machine that polled within this window counts as online. */
  onlineGraceMs: number
  /** Calls waiting or in flight per machine. */
  maxQueued: number
  /** Body of a user call (`POST /v1/team/brain/rpc`). */
  maxRequestBytes: number
  /** Body of a machine's answer (`POST /v1/relay/machine/reply`). */
  maxReplyBytes: number
  /** Open event streams per team. */
  maxStreamsPerTeam: number
  /** Relayed calls per person per minute. */
  rpcPerMinute: number
  /** Keep-alive comment of the event streams; the token and the machine are checked again each time. */
  heartbeatMs: number
  /** Requests per machine per minute (polls, answers, events). */
  machinePerMinute: number
  /** Bytes of the arguments of the calls waiting or in flight, per machine and on the whole Cloud. */
  maxPendingBytesPerMachine: number
  maxPendingBytes: number
  /** Bytes of arguments one long poll hands out at most (always at least one call). */
  maxPollBytes: number
  /** Bytes of events a machine may push per minute (they are fanned out to every open stream of its team). */
  maxEventBytesPerMinute: number
  /** An event stream whose client reads too slowly is closed once this much waits in its buffer. */
  maxStreamBufferBytes: number
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  timeoutMs: 60_000,
  pollWaitMs: 25_000,
  onlineGraceMs: 35_000,
  maxQueued: 64,
  maxRequestBytes: 8 * 1024 * 1024,
  maxReplyBytes: 32 * 1024 * 1024,
  maxStreamsPerTeam: 16,
  rpcPerMinute: 900,
  heartbeatMs: 15_000,
  machinePerMinute: 6000,
  maxPendingBytesPerMachine: 64 * 1024 * 1024,
  maxPendingBytes: 512 * 1024 * 1024,
  maxPollBytes: 16 * 1024 * 1024,
  maxEventBytesPerMinute: 8 * 1024 * 1024,
  maxStreamBufferBytes: 1024 * 1024
}

/** Shown to the person as is (the app also has it in fr.ts). */
export const OFFLINE_MESSAGE = 'L’ordinateur d’équipe est en veille ou hors ligne.'
export const TIMEOUT_MESSAGE = 'L’ordinateur d’équipe n’a pas répondu à temps.'

export type BrainEnvelopeValue = { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string } }
export interface RelayedRequest {
  id: string
  method: string
  args: unknown[]
}
export interface RelayEvent {
  event: 'changed' | 'stream'
  data: unknown
}

interface Pending {
  id: string
  method: string
  args: unknown[]
  /** Size of the arguments, counted in the budgets until the call ends. */
  bytes: number
  resolve: (e: BrainEnvelopeValue) => void
  reject: (err: CloudError) => void
  timer: NodeJS.Timeout
}

interface Listener {
  send: (e: RelayEvent) => void
  /** Ends the stream (the machine was dropped). */
  end: () => void
}

interface Waiter {
  resolve: (requests: RelayedRequest[]) => void
  timer: NodeJS.Timeout
}

class Channel {
  readonly queue: Pending[] = []
  readonly inflight = new Map<string, Pending>()
  waiter: Waiter | null = null
  lastPollAt: number | null = null
  readonly listeners = new Set<Listener>()
  pendingBytes = 0
  eventWindow = 0
  eventBytes = 0
  readonly id: string
  constructor(id: string) {
    this.id = id
  }
}

const BATCH = 16

export class RelayHub {
  readonly limits: RelayLimits
  private readonly clock: Clock
  private readonly channels = new Map<string, Channel>()
  private readonly streams = new Map<string, number>()
  private readonly live: (machineId: string) => boolean
  private pendingBytes = 0

  /** `live`: whether the machine still holds a live credential (read from the database, so a revocation anywhere counts). */
  constructor(clock: Clock, limits: Partial<RelayLimits> = {}, live: (machineId: string) => boolean = () => true) {
    this.clock = clock
    this.limits = { ...DEFAULT_RELAY_LIMITS, ...limits }
    this.live = live
  }

  private channel(machineId: string): Channel {
    let c = this.channels.get(machineId)
    if (!c) {
      c = new Channel(machineId)
      this.channels.set(machineId, c)
    }
    return c
  }

  /** Bytes of arguments held for calls now (tests, the admin overview). */
  pending(machineId?: string): number {
    return machineId === undefined ? this.pendingBytes : (this.channels.get(machineId)?.pendingBytes ?? 0)
  }

  /** True while the machine's long poll is open (tests). */
  polling(machineId: string): boolean {
    return this.channels.get(machineId)?.waiter != null
  }

  /** Open event streams of a machine (tests). */
  listenerCount(machineId: string): number {
    return this.channels.get(machineId)?.listeners.size ?? 0
  }

  isOnline(machineId: string): boolean {
    const c = this.channels.get(machineId)
    if (!c) return false
    if (!this.live(machineId)) {
      // revoked elsewhere (the admin tool): dropped as soon as anyone asks, so its poll and streams end now
      this.drop(machineId)
      return false
    }
    if (c.waiter) return true
    return c.lastPollAt !== null && this.clock.now() - c.lastPollAt <= this.limits.onlineGraceMs
  }

  /**
   * A person's call, forwarded to the machine; resolves with the machine's envelope. `bytes`: the size of the call's
   * arguments (the route passes its body's), counted in the machine's and the Cloud's budgets until the call ends.
   */
  call(machineId: string, method: string, args: unknown[], bytes: number = Buffer.byteLength(JSON.stringify(args))): Promise<BrainEnvelopeValue> {
    if (!this.isOnline(machineId)) return Promise.reject(new CloudError('machine_offline', OFFLINE_MESSAGE))
    const c = this.channel(machineId)
    if (c.queue.length + c.inflight.size >= this.limits.maxQueued) {
      return Promise.reject(new CloudError('rate_limited', 'too many calls waiting for this team computer'))
    }
    if (c.pendingBytes + bytes > this.limits.maxPendingBytesPerMachine) {
      return Promise.reject(new CloudError('rate_limited', 'too much data waiting for this team computer: try again in a moment'))
    }
    if (this.pendingBytes + bytes > this.limits.maxPendingBytes) {
      return Promise.reject(new CloudError('rate_limited', 'the relay is busy: try again in a moment'))
    }
    c.pendingBytes += bytes
    this.pendingBytes += bytes
    return new Promise<BrainEnvelopeValue>((resolve, reject) => {
      const id = `rq_${randomBytes(12).toString('base64url')}`
      let settled = false
      // every way a call ends gives its bytes back, once
      const settle = (): void => {
        if (settled) return
        settled = true
        clearTimeout(p.timer)
        c.pendingBytes -= bytes
        this.pendingBytes -= bytes
      }
      const p: Pending = {
        id,
        method,
        args,
        bytes,
        resolve: (e) => {
          settle()
          resolve(e)
        },
        reject: (err) => {
          settle()
          reject(err)
        },
        timer: setTimeout(() => {
          const at = c.queue.indexOf(p)
          if (at >= 0) c.queue.splice(at, 1)
          c.inflight.delete(id)
          p.reject(new CloudError('timeout', TIMEOUT_MESSAGE))
        }, this.limits.timeoutMs)
      }
      p.timer.unref?.()
      c.queue.push(p)
      this.flush(c)
    })
  }

  /** Hands queued calls to a waiting long poll; a machine revoked meanwhile is dropped instead (its calls end offline). */
  private flush(c: Channel): void {
    if (!c.waiter || c.queue.length === 0) return
    if (!this.live(c.id)) {
      this.drop(c.id)
      return
    }
    const w = c.waiter
    c.waiter = null
    clearTimeout(w.timer)
    c.lastPollAt = this.clock.now()
    w.resolve(this.take(c))
  }

  /** The next calls of the queue: at most BATCH of them and `maxPollBytes` of arguments (always at least one). */
  private take(c: Channel): RelayedRequest[] {
    let n = 0
    let bytes = 0
    while (n < Math.min(BATCH, c.queue.length)) {
      const next = (c.queue[n] as Pending).bytes
      if (n > 0 && bytes + next > this.limits.maxPollBytes) break
      bytes += next
      n++
    }
    const batch = c.queue.splice(0, n)
    for (const p of batch) c.inflight.set(p.id, p)
    return batch.map((p) => ({ id: p.id, method: p.method, args: p.args }))
  }

  /**
   * The machine's long poll: the calls waiting now, else the first ones to arrive within `waitMs`, else none.
   * A newer poll of the same machine ends the previous one (empty). `onClose` lets the caller register the end of the
   * HTTP exchange: a poll whose connection dropped keeps its calls in the queue.
   */
  next(machineId: string, waitMs: number, onClose: (cancel: () => void) => void): Promise<RelayedRequest[]> {
    if (!this.live(machineId)) {
      this.drop(machineId)
      return Promise.resolve([])
    }
    const c = this.channel(machineId)
    c.lastPollAt = this.clock.now()
    if (c.waiter) {
      const old = c.waiter
      c.waiter = null
      clearTimeout(old.timer)
      old.resolve([])
    }
    if (c.queue.length > 0 || waitMs <= 0) return Promise.resolve(this.take(c))
    return new Promise<RelayedRequest[]>((resolve) => {
      const w: Waiter = {
        resolve,
        timer: setTimeout(() => {
          if (c.waiter === w) c.waiter = null
          c.lastPollAt = this.clock.now()
          resolve([])
        }, Math.min(waitMs, this.limits.pollWaitMs))
      }
      w.timer.unref?.()
      c.waiter = w
      onClose(() => {
        if (c.waiter !== w) return
        c.waiter = null
        clearTimeout(w.timer)
        c.lastPollAt = this.clock.now()
        resolve([])
      })
    })
  }

  /** The machine's answer to one call; false when the call is unknown here (timed out, or another machine's). */
  reply(machineId: string, id: string, response: BrainEnvelopeValue): boolean {
    const c = this.channels.get(machineId)
    const p = c?.inflight.get(id)
    if (!c || !p) return false
    c.inflight.delete(id)
    clearTimeout(p.timer)
    c.lastPollAt = this.clock.now()
    p.resolve(response)
    return true
  }

  /** Counts `bytes` of events against the machine's budget of the minute; refuses (429) past it. */
  chargeEvents(machineId: string, bytes: number): void {
    const c = this.channel(machineId)
    const w = Math.floor(this.clock.now() / 60_000)
    if (c.eventWindow !== w) {
      c.eventWindow = w
      c.eventBytes = 0
    }
    if (c.eventBytes + bytes > this.limits.maxEventBytesPerMinute) throw new CloudError('rate_limited', 'too many events this minute')
    c.eventBytes += bytes
  }

  publish(machineId: string, events: readonly RelayEvent[]): void {
    const c = this.channels.get(machineId)
    if (!c) return
    for (const e of events) {
      for (const l of [...c.listeners]) {
        try {
          l.send(e)
        } catch {
          // one broken stream never stops the others
        }
      }
    }
  }

  /**
   * An event stream of a team's person; null when the team already has `maxStreamsPerTeam` open. `end` is called when
   * the machine is dropped (revoked, deleted): the stream closes then, instead of staying open with nothing behind it.
   */
  subscribe(teamId: string, machineId: string, fn: (e: RelayEvent) => void, end: () => void = () => undefined): (() => void) | null {
    const open = this.streams.get(teamId) ?? 0
    if (open >= this.limits.maxStreamsPerTeam) return null
    this.streams.set(teamId, open + 1)
    const c = this.channel(machineId)
    const l: Listener = { send: fn, end }
    c.listeners.add(l)
    let done = false
    return () => {
      if (done) return
      done = true
      c.listeners.delete(l)
      const n = (this.streams.get(teamId) ?? 1) - 1
      if (n <= 0) this.streams.delete(teamId)
      else this.streams.set(teamId, n)
    }
  }

  /** Forgets a machine (credential revoked, machine deleted): its calls end offline, its poll ends empty, its streams end. */
  drop(machineId: string): void {
    const c = this.channels.get(machineId)
    if (!c) return
    this.channels.delete(machineId)
    if (c.waiter) {
      clearTimeout(c.waiter.timer)
      c.waiter.resolve([])
      c.waiter = null
    }
    const calls = [...c.queue, ...c.inflight.values()]
    c.queue.length = 0
    c.inflight.clear()
    for (const p of calls) p.reject(new CloudError('machine_offline', OFFLINE_MESSAGE))
    for (const l of [...c.listeners]) {
      try {
        l.end()
      } catch {
        // a stream already gone
      }
    }
  }

  close(): void {
    for (const id of [...this.channels.keys()]) this.drop(id)
  }
}
