// HTTP transport to a headless brain (src/main/headless, docs/BRAIN-HEADLESS.md): `POST /rpc` answers the same envelope
// as the IPC bus, `GET /events` is a Server-Sent Events stream of `atelier:changed` and `atelier:stream`. Plain fetch and
// web streams only (no DOM, no Node API): the web app, the desktop's main process (src/main/brain) and Node tests share it.
// The token goes in the Authorization header, never in an address.
//
// Two ways to a brain: direct (`url` = the brain's address, e.g. through an SSH tunnel, `token` = its bearer token), or
// « via Atelier Cloud » (`url` = <Cloud>/v1/team/brain, `token` = the person's Cloud access token): the Cloud relays the
// same `/rpc` and `/events` to the team's computer (docs/BRAIN-HEADLESS.md §7). The Cloud's own refusals (offline
// machine, timeout, size, rate) come back as error envelopes with a French message.
import type { CallEnvelope, EventContract, EventName } from './api'
import { t } from './fr'

/** SSE event names on the wire → the app's event names. */
export const BRAIN_SSE_EVENTS = { changed: 'atelier:changed', stream: 'atelier:stream' } as const satisfies Record<string, EventName>
export type BrainSseName = keyof typeof BRAIN_SSE_EVENTS

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface BrainEndpoint {
  /** Normalized base address (see `normalizeBrainUrl`), without a trailing slash. */
  url: string
  /** The bearer token, or a function giving a fresh one (a Cloud access token refreshes itself). */
  token: string | (() => Promise<string>)
  via?: 'direct' | 'cloud'
  /** The Cloud refused the token before its time: called once, then the call is tried again with a new token. */
  onUnauthorized?: () => void
}

/** The relay path under the Cloud (`POST <base>/rpc`, `GET <base>/events`). */
export const CLOUD_BRAIN_PATH = '/v1/team/brain'

export function cloudBrainEndpoint(cloudUrl: string, token: BrainEndpoint['token'], onUnauthorized?: () => void): BrainEndpoint {
  return { url: normalizeBrainUrl(cloudUrl).replace(/\/v1\/team\/brain$/, '') + CLOUD_BRAIN_PATH, token, via: 'cloud', ...(onUnauthorized ? { onUnauthorized } : {}) }
}

async function tokenOf(ep: BrainEndpoint): Promise<string> {
  return typeof ep.token === 'function' ? ep.token() : ep.token
}

/** A Cloud error answer (`{error: {code, message}}`) as the app's error envelope, in French. */
function cloudFailure(status: number, body: unknown): CallEnvelope<never> | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code
  if (typeof code !== 'string') return null
  if (code === 'machine_offline') return fail('BRAIN_OFFLINE', t('brain.err.offline'))
  if (code === 'timeout') return fail('BRAIN_TIMEOUT', t('brain.err.timeout'))
  if (code === 'too_large') return fail('TOO_LARGE', t('brain.err.tooLarge'))
  if (code === 'not_found') return fail('BRAIN_NO_MACHINE', t('brain.err.noMachine'))
  if (code === 'rate_limited') return fail('RATE_LIMITED', t('brain.err.rateLimited'))
  if (code === 'unauthorized' || code === 'token_expired') return fail('UNAUTHORIZED', t('brain.err.cloudToken'))
  return fail('BRAIN_BAD_ANSWER', t('brain.err.answer', { status }))
}

const unreachable = (ep: BrainEndpoint): CallEnvelope<never> =>
  ep.via === 'cloud' ? fail('BRAIN_UNREACHABLE', t('brain.err.cloudUnreachable')) : fail('BRAIN_UNREACHABLE', t('brain.err.unreachable', { url: ep.url }))

export class BrainClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = code
  }
}

/** A loopback host: plain http is only allowed there (the SSH tunnel, a test Cloud), like the Cloud link's `checkCloudUrl`. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

/**
 * https, or plain http on the loopback only (the bearer token never crosses a network in clear); no credentials, query
 * or fragment; keeps a path prefix (reverse proxy) without its trailing slash.
 */
export function normalizeBrainUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    throw new BrainClientError('BAD_URL', t('brain.err.url'))
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BrainClientError('BAD_URL', t('brain.err.url'))
  if (u.username || u.password) throw new BrainClientError('BAD_URL', t('brain.err.urlCredentials'))
  if (u.search || u.hash) throw new BrainClientError('BAD_URL', t('brain.err.url'))
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) throw new BrainClientError('BAD_URL', t('brain.err.urlHttp'))
  return u.origin + u.pathname.replace(/\/+$/, '')
}

/** Bytes on the wire: JSON has no binary, the IPC bus does (structured clone). Uint8Array (and Buffer) ⇄ this marker. */
const BYTES_KEY = '$atelierBytes'

function bytesToBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A JSON-safe copy of a call's arguments or result (bytes become `{ $atelierBytes: base64 }`). */
export function toWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return { [BYTES_KEY]: bytesToBase64(v) }
  if (Array.isArray(v)) return v.map(toWire)
  if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v) as object | null)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toWire(x)]))
  }
  return v
}

/** The reverse of `toWire`, on parsed JSON. */
export function fromWire(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromWire)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === BYTES_KEY && typeof o[BYTES_KEY] === 'string') return base64ToBytes(o[BYTES_KEY])
    return Object.fromEntries(keys.map((k) => [k, fromWire(o[k])]))
  }
  return v
}

function fail(code: string, message: string): CallEnvelope<never> {
  return { ok: false, error: { code, message } }
}

function isEnvelope(v: unknown): v is CallEnvelope<unknown> {
  if (!v || typeof v !== 'object') return false
  const o = v as { ok?: unknown; error?: { code?: unknown; message?: unknown } }
  if (o.ok === true) return 'value' in o
  return o.ok === false && typeof o.error?.code === 'string' && typeof o.error.message === 'string'
}

/** One call; never throws: network and HTTP failures come back as an error envelope with a French message. */
export async function brainCall(ep: BrainEndpoint, method: string, args: unknown[], fetchImpl: FetchLike = fetch, retried = false): Promise<CallEnvelope<unknown>> {
  let token: string
  try {
    token = await tokenOf(ep)
  } catch {
    return fail('UNAUTHORIZED', t('brain.err.cloudToken'))
  }
  let res: Response
  try {
    res = await fetchImpl(`${ep.url}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, args: toWire(args) })
    })
  } catch {
    return unreachable(ep)
  }
  const body: unknown = fromWire(await res.json().catch(() => null))
  // `value` is absent from JSON when a method returns undefined (void): it is still a success.
  if (res.ok && body && typeof body === 'object' && (body as { ok?: unknown }).ok === true) return { ok: true, value: (body as { value?: unknown }).value }
  if (isEnvelope(body)) return body
  if (res.status === 401 && ep.onUnauthorized && !retried) {
    ep.onUnauthorized()
    return brainCall(ep, method, args, fetchImpl, true)
  }
  if (ep.via === 'cloud') {
    const refused = cloudFailure(res.status, body)
    if (refused) return refused
  }
  if (res.status === 401) return fail('UNAUTHORIZED', t('brain.err.token'))
  return fail('BRAIN_BAD_ANSWER', t('brain.err.answer', { status: res.status }))
}

export interface SseMessage {
  event: string
  data: string
}

/** Incremental Server-Sent Events parser (event + data lines, comments ignored, `\n` or `\r\n`). */
export class SseParser {
  private buffer = ''
  private event = ''
  private data: string[] = []

  push(chunk: string): SseMessage[] {
    this.buffer += chunk
    const out: SseMessage[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      if (line === '') {
        if (this.data.length > 0) out.push({ event: this.event || 'message', data: this.data.join('\n') })
        this.event = ''
        this.data = []
      } else if (line.startsWith(':')) {
        // comment (keep-alive)
      } else {
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') this.event = value
        else if (field === 'data') this.data.push(value)
      }
    }
    return out
  }
}

export interface BrainEventsState {
  live: boolean
  error: string | null
}

export interface BrainEventsOptions {
  fetchImpl?: FetchLike
  onState?: (state: BrainEventsState) => void
  /** Delay before reconnecting after `attempt` failures (default 1 s, doubling, at most 15 s). */
  retryMs?: (attempt: number) => number
}

export type BrainEventListener = <E extends EventName>(event: E, payload: EventContract[E]) => void

/**
 * Opens `GET /events` and keeps it open: reconnects after a drop with a growing delay, stops for good on 401 (the token
 * was rotated: reconnecting would not help) or on `close()`.
 */
export function openBrainEvents(ep: BrainEndpoint, onEvent: BrainEventListener, opts: BrainEventsOptions = {}): { close(): void } {
  const fetchImpl = opts.fetchImpl ?? fetch
  const onState = opts.onState ?? (() => undefined)
  const retryMs = opts.retryMs ?? ((n: number) => Math.min(15_000, 1000 * 2 ** n))
  let closed = false
  let ctrl: AbortController | null = null
  let wake: (() => void) | null = null
  const deliver = (m: SseMessage): void => {
    const name = BRAIN_SSE_EVENTS[m.event as BrainSseName]
    if (!name) return
    let payload: unknown
    try {
      payload = JSON.parse(m.data)
    } catch {
      return
    }
    onEvent(name, payload as never)
  }
  const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  const loop = async (): Promise<void> => {
    let attempt = 0
    while (!closed) {
      ctrl = new AbortController()
      try {
        const res = await fetchImpl(`${ep.url}/events`, {
          headers: { authorization: `Bearer ${await tokenOf(ep)}`, accept: 'text/event-stream' },
          signal: ctrl.signal
        })
        if (res.status === 401 && !ep.onUnauthorized) {
          onState({ live: false, error: t('brain.err.token') })
          return
        }
        if (res.status === 401) {
          // A Cloud access token refused before its time: a fresh one next round.
          ep.onUnauthorized?.()
          onState({ live: false, error: t('brain.err.cloudToken') })
        } else if (!res.ok || !res.body) {
          const refused = ep.via === 'cloud' ? cloudFailure(res.status, await res.json().catch(() => null)) : null
          onState({ live: false, error: refused && !refused.ok ? refused.error.message : t('brain.err.answer', { status: res.status }) })
        } else {
          attempt = 0
          onState({ live: true, error: null })
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          const parser = new SseParser()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            for (const m of parser.push(decoder.decode(value, { stream: true }))) deliver(m)
          }
          if (!closed) onState({ live: false, error: t('brain.err.lost') })
        }
      } catch {
        if (closed) return
        const down = unreachable(ep)
        onState({ live: false, error: down.ok ? null : down.error.message })
      }
      if (closed) return
      await pause(retryMs(attempt++))
    }
  }
  void loop()
  return {
    close: () => {
      closed = true
      ctrl?.abort()
      wake?.()
    }
  }
}
