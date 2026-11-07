// Request bodies, decided BEFORE a byte of them is read (security review, finding 1). Every contract route authenticates in
// its `onRequest` hook (route.ts), so an anonymous caller is refused while its body is still on the wire; a declared
// `content-length` over the route's limit is refused there too; a body without one is cut when it passes the limit.
//
// Two kinds of large bodies, each with its own budget (a refused caller gets 429 at once, nothing is read):
//   - raw uploads (`application/octet-stream`: kit files, `/v1/uploads`) are never held in memory: they are streamed to a
//     temporary file while being hashed and counted (`Spooled`), then handed to the file store from that file. The
//     budget is how many run at once, on the whole Cloud and per team (each one holds a disk file and a connection);
//   - JSON bodies over the server's 1 MiB default (the brain relay's calls, answers, events) are buffered by Fastify: the
//     budget is their bytes being read or held at once (the declared length, else the route's whole limit), on the whole
//     Cloud and per team.
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { FastifyRequest } from 'fastify'
import { CloudError } from '../errors.ts'

/** The `Retry-After` of a body refused for its budget: an upload in flight usually ends within seconds. */
export const BUSY_RETRY_S = 2

/** The server's body limit for every route that does not raise its own. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024

export interface BodyLimits {
  /** Raw uploads streaming at once, on the whole Cloud. */
  maxUploads: number
  /** Raw uploads streaming at once, per team. */
  maxUploadsPerTeam: number
  /** Bytes of large JSON bodies read or held at once, on the whole Cloud. */
  maxBufferedBytes: number
  /** Bytes of large JSON bodies read or held at once, per team. */
  maxBufferedBytesPerTeam: number
}

export const DEFAULT_BODY_LIMITS: BodyLimits = {
  maxUploads: 8,
  // production-17: a real run sends its clips' start stills, the portrait and the voice for the presenter at about the same
  // time; 2 refused the third at once (the first real 60 s run failed on it). 4 per team, half of the Cloud's 8, so two
  // teams can still send at once; the app sends at most 2 at a time (src/engine/cloud-busy.ts) and waits out a 429.
  maxUploadsPerTeam: 4,
  maxBufferedBytes: 256 * 1024 * 1024,
  maxBufferedBytesPerTeam: 64 * 1024 * 1024
}

/** A raw upload on disk: where, how many bytes, their SHA-256. The route's handler moves it to the store; it is removed after. */
export interface Spooled {
  readonly spooled: true
  path: string
  size: number
  sha256: string
}

export const isSpooled = (v: unknown): v is Spooled => typeof v === 'object' && v !== null && (v as { spooled?: unknown }).spooled === true

export function discardSpooled(v: unknown): Promise<void> {
  return isSpooled(v) ? rm(v.path, { force: true }).catch(() => undefined) : Promise.resolve()
}

/**
 * The refusal of an oversized body: 413 `too_large` on the routes whose clients show « trop gros » (the brain relay,
 * kit files, raw uploads), the older 400 `body too large` on the JSON routes.
 */
export function tooLarge(url: string): CloudError {
  return /^\/v1\/(team\/brain|relay|uploads|team\/videos|admin\/releases)(\/|\?|$)/.test(url) ? new CloudError('too_large', 'body too large') : new CloudError('bad_request', 'body too large')
}

/** The declared body length, or null when there is none (chunked) or it is not a plain number. */
export function declaredLength(req: FastifyRequest): number | null {
  const h = req.headers['content-length']
  if (typeof h !== 'string' || !/^\d{1,16}$/.test(h)) return null
  return Number(h)
}

class Counter {
  total = 0
  readonly perTeam = new Map<string, number>()
  add(team: string, n: number): void {
    this.total += n
    this.perTeam.set(team, (this.perTeam.get(team) ?? 0) + n)
  }
  sub(team: string, n: number): void {
    this.total -= n
    const left = (this.perTeam.get(team) ?? n) - n
    if (left <= 0) this.perTeam.delete(team)
    else this.perTeam.set(team, left)
  }
}

/** The two budgets of large bodies. `admit` answers the release function, or throws `rate_limited`. */
export class BodyGate {
  readonly limits: BodyLimits
  private readonly uploads = new Counter()
  private readonly buffered = new Counter()
  constructor(limits: Partial<BodyLimits> = {}) {
    this.limits = { ...DEFAULT_BODY_LIMITS, ...limits }
  }

  admit(kind: 'upload' | 'buffered', teamId: string, bytes: number): () => void {
    const c = kind === 'upload' ? this.uploads : this.buffered
    const n = kind === 'upload' ? 1 : bytes
    const [all, team] = kind === 'upload' ? [this.limits.maxUploads, this.limits.maxUploadsPerTeam] : [this.limits.maxBufferedBytes, this.limits.maxBufferedBytesPerTeam]
    if (c.total + n > all) throw new CloudError('rate_limited', kind === 'upload' ? 'too many uploads at once: try again in a moment' : 'the Cloud is busy: try again in a moment', BUSY_RETRY_S)
    if ((c.perTeam.get(teamId) ?? 0) + n > team) throw new CloudError('rate_limited', kind === 'upload' ? 'this team already sends files: wait for them to finish' : 'too much data in flight for this team: try again in a moment', BUSY_RETRY_S)
    c.add(teamId, n)
    let done = false
    return () => {
      if (done) return
      done = true
      c.sub(teamId, n)
    }
  }

  /** What is in flight now (tests, the admin overview). */
  usage(): { uploads: number; bufferedBytes: number } {
    return { uploads: this.uploads.total, bufferedBytes: this.buffered.total }
  }
}

/**
 * The `application/octet-stream` parser: only routes flagged `config.upload` take raw bytes, streamed to a file under
 * `dir` (never in memory), cut with 413 past the route's limit. Any other route refuses the bytes without reading them.
 */
export function spoolParser(dir: string) {
  return (req: FastifyRequest, payload: Readable, done: (err: Error | null, body?: unknown) => void): void => {
    const config = req.routeOptions.config as { upload?: boolean } | undefined
    if (!config?.upload) {
      done(new CloudError('bad_request', 'this route takes JSON, not raw bytes'))
      return
    }
    const limit = req.routeOptions.bodyLimit ?? DEFAULT_BODY_LIMIT
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, `${randomBytes(12).toString('hex')}.part`)
    const out = createWriteStream(path, { flags: 'wx', mode: 0o600 })
    const hash = createHash('sha256')
    let size = 0
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      payload.off('data', onData)
      // the rest of the body is drained (read and dropped), never kept; the answer closes the connection
      payload.resume()
      // removed once the file is closed (a stream destroyed before it opened would otherwise create it after the removal)
      const remove = (): void => void rm(path, { force: true }).catch(() => undefined)
      if (out.closed) remove()
      else {
        out.once('close', remove)
        out.destroy()
      }
      done(err)
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > limit) {
        fail(tooLarge(req.url))
        return
      }
      hash.update(chunk)
      if (!out.write(chunk)) {
        payload.pause()
        out.once('drain', () => payload.resume())
      }
    }
    payload.on('data', onData)
    payload.once('end', () => {
      if (settled) return
      out.end(() => {
        if (settled) return
        settled = true
        done(null, { spooled: true, path, size, sha256: hash.digest('hex') } satisfies Spooled)
      })
    })
    payload.once('error', (err: Error) => fail(err))
    payload.once('aborted', () => fail(new CloudError('bad_request', 'the upload was interrupted')))
    out.once('error', (err: Error) => fail(err))
  }
}
