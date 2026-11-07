// The headless brain's remote API (docs/BRAIN-HEADLESS.md), on Node's own `http`:
//   POST /rpc     {method, args} → the same envelope as the IPC bus ({ok, value} | {ok: false, error}), always HTTP 200
//                 once authenticated and parsed, so an unknown method answers exactly what IPC answers.
//   GET  /events  Server-Sent Events: `changed` ({topic}) and `stream` (chat replies), a comment every 15 s.
//   GET  /health  {ok: true}, no token (for a service manager); tells nothing else.
// Every other route needs `Authorization: Bearer <token>`, checked before the body is read; a bad or absent token gets
// the same 401. CORS only for the configured origins; a request carrying any other Origin is refused (403).
import http from 'node:http'
import type { ApiHandlers, CallEnvelope, EventName } from '../../shared/api'
import { BRAIN_SSE_EVENTS, fromWire, toWire, type BrainSseName } from '../../shared/brain-client'
import { t, type MessageKey } from '../../shared/fr'
import { handleCall } from '../ipc'
import type { EventHub } from './events'

/** Methods that make no sense on a machine without a screen, with the French reason. */
export const REMOTE_UNAVAILABLE: Readonly<Record<string, MessageKey>> = {
  'app.setTheme': 'brain.unavailable.theme',
  'production.revealPackage': 'brain.unavailable.folder',
  'cloud.kitDownload': 'brain.unavailable.download',
  'brain.connect': 'brain.unavailable.link',
  'brain.disconnect': 'brain.unavailable.link'
}

/**
 * One remote call, from either way in (`POST /rpc` or the Atelier Cloud relay): the methods refused on a machine
 * without a screen, else the IPC bus. Arguments and answer are on the wire form (bytes as base64 markers).
 */
export async function dispatchRemote(api: ApiHandlers, method: unknown, args: unknown): Promise<unknown> {
  const reason = typeof method === 'string' && Object.prototype.hasOwnProperty.call(REMOTE_UNAVAILABLE, method) ? REMOTE_UNAVAILABLE[method] : undefined
  if (reason) return envelopeError('UNAVAILABLE_REMOTE', t('brain.unavailable', { reason: t(reason) }))
  // Bytes (production.file) travel as base64 markers: JSON has no binary, the IPC bus has.
  return toWire(await handleCall(api, method, fromWire(args)))
}

export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

export interface BrainServerOptions {
  api: ApiHandlers
  hub: EventHub
  tokens: { verifyHeader(header: string | undefined): boolean }
  /** Exact origins allowed to call from a browser (the web app), e.g. http://localhost:5180. */
  origins?: readonly string[]
  maxBodyBytes?: number
  /** Open event streams at most (default 32). */
  maxStreams?: number
  heartbeatMs?: number
}

const SSE_NAME = Object.fromEntries(Object.entries(BRAIN_SSE_EVENTS).map(([k, v]) => [v, k])) as Record<EventName, BrainSseName | undefined>

function envelopeError(code: string, message: string): CallEnvelope<never> {
  return { ok: false, error: { code, message } }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extra: http.OutgoingHttpHeaders = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...extra })
  res.end(text)
}

/** Reads the body up to `max` bytes; null when it is larger (the caller answers 413). */
function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      if (over) return
      size += c.length
      if (size > max) {
        over = true
        chunks.length = 0
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

export function createBrainServer(o: BrainServerOptions): http.Server {
  const origins = new Set(o.origins ?? [])
  const maxBody = o.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxStreams = o.maxStreams ?? 32
  const heartbeatMs = o.heartbeatMs ?? 15_000
  let streams = 0

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    const origin = req.headers.origin
    if (origin !== undefined) {
      if (!origins.has(origin)) {
        req.resume()
        sendJson(res, 403, envelopeError('FORBIDDEN_ORIGIN', t('brain.err.origin')), { connection: 'close' })
        return
      }
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'Origin')
    }
    const pathname = new URL(req.url ?? '/', 'http://brain').pathname
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600'
      })
      res.end()
      return
    }
    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true })
      return
    }
    const known = (pathname === '/rpc' && req.method === 'POST') || (pathname === '/events' && req.method === 'GET')
    if (!known) {
      req.resume()
      sendJson(res, 404, envelopeError('NOT_FOUND', t('brain.err.notFound')))
      return
    }
    // The token is checked before anything else is read; absent and wrong answer the same thing.
    if (!o.tokens.verifyHeader(req.headers.authorization)) {
      req.resume()
      sendJson(res, 401, envelopeError('UNAUTHORIZED', t('brain.err.token')), { 'www-authenticate': 'Bearer', connection: 'close' })
      return
    }
    if (pathname === '/events') {
      openStream(req, res)
      return
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    // Too large: answered at once; the rest of the body (authenticated callers only) is drained, not kept.
    if (Number.isFinite(declared) && declared > maxBody) {
      req.resume()
      sendJson(res, 413, envelopeError('TOO_LARGE', t('brain.err.tooLarge')), { connection: 'close' })
      return
    }
    const body = await readBody(req, maxBody)
    if (body === null) {
      sendJson(res, 413, envelopeError('TOO_LARGE', t('brain.err.tooLarge')), { connection: 'close' })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      sendJson(res, 400, envelopeError('BAD_REQUEST', t('brain.err.badRequest')))
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendJson(res, 400, envelopeError('BAD_REQUEST', t('brain.err.badRequest')))
      return
    }
    const { method, args } = parsed as { method?: unknown; args?: unknown }
    sendJson(res, 200, await dispatchRemote(o.api, method, args))
  }

  const openStream = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (streams >= maxStreams) {
      sendJson(res, 503, envelopeError('BUSY', t('brain.err.busy')))
      return
    }
    streams++
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write('retry: 3000\n: atelier\n\n')
    const unsubscribe = o.hub.subscribe((event, payload) => {
      const name = SSE_NAME[event]
      if (name) res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)
    })
    const ping = setInterval(() => res.write(': ping\n\n'), heartbeatMs)
    ping.unref()
    let done = false
    const end = (): void => {
      if (done) return
      done = true
      streams--
      clearInterval(ping)
      unsubscribe()
    }
    req.on('close', end)
    res.on('close', end)
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, envelopeError('ERROR', t('brain.err.answer', { status: 500 })))
      else res.end()
    })
  })
  return server
}
