// The local worker's child side (PLAN-V2-PRODUCTION §1.5, lot P5): runs ONE engine node for a host that speaks the
// worker protocol (src/shared/worker-protocol.ts). It reads one `job` line, downloads the remote input files if any,
// runs the node with this machine's services and answers with `done` or `error`. With `parentServices`, Claude and
// Atelier Cloud are proxies: each call becomes a `call` line and waits for the parent's `reply` (no token lives here).
// Cancel is not part of the protocol: the parent kills this process with its whole tree.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  ParentLine,
  encodeChildLine,
  type ChildLine,
  type WireArtefact,
  type WireError,
  type WorkerCallName,
  type WorkerJob
} from '../../shared/worker-protocol'
import type { Artefact, NodeOutputs } from '../artefacts'
import { EngineError, ERROR_CODES, toEngineError, type ErrorCode } from '../errors'
import { nodeHost } from '../host'
import { createRunCtx, type NodeRegistry, type ResolvedInputs } from '../registry'
import type { ClaudeService, CloudService, EngineServices, VideoReaderService } from '../services'
import type { ArtefactType, Json } from '../types'

export interface WorkerChildOptions {
  registry: NodeRegistry
  dataDir: string
  resourcesDir: string
  /** The parent answers `call` lines (the app's local executor); otherwise Claude and the Cloud are absent. */
  parentServices: boolean
  stdin: NodeJS.ReadableStream
  stdout: { write(s: string): unknown }
  fetchImpl?: typeof fetch
  pathEnv?: string
  platform?: NodeJS.Platform
}

type ReplyLine = Extract<ParentLine, { t: 'reply' }>

const asCode = (c: string): ErrorCode => ((ERROR_CODES as readonly string[]).includes(c) ? (c as ErrorCode) : 'internal')
const wireError = (e: unknown): WireError => {
  const err = toEngineError(e)
  return { code: err.code, message: err.message, permanent: err.permanent }
}

/** A file name safe on every OS, kept short; never `..` nor empty. */
export function safeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 100)
  return base || 'file'
}

/** Downloads one signed link to `dest` (http and https only). */
async function download(url: string, dest: string, fetchImpl: typeof fetch): Promise<void> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new EngineError('bad_input', `input link is not a URL: ${url.slice(0, 80)}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new EngineError('bad_input', `input link must be http(s), got ${u.protocol}`)
  let res: Response
  try {
    res = await fetchImpl(u)
  } catch (e) {
    throw new EngineError('transient', `download failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    throw new EngineError(res.status >= 500 || res.status === 429 ? 'transient' : 'bad_input', `download failed: HTTP ${res.status}`)
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

/** The engine artefacts of a job's inputs; remote files land under `<outDir>/in/<port>/`. */
async function resolveInputs(job: WorkerJob, fetchImpl: typeof fetch): Promise<ResolvedInputs> {
  const out: ResolvedInputs = {}
  for (const [port, w] of Object.entries(job.inputs) as [string, WireArtefact][]) {
    const files = (w.files ?? []).map((f) => path.resolve(f))
    if (w.remoteFiles && w.remoteFiles.length > 0) {
      const dir = path.join(job.outDir, 'in', safeFileName(port))
      await mkdir(dir, { recursive: true })
      for (const [i, r] of w.remoteFiles.entries()) {
        const dest = path.join(dir, `${i}-${safeFileName(r.name)}`)
        await download(r.url, dest, fetchImpl)
        files.push(dest)
      }
    }
    const a: Artefact = { type: w.type as ArtefactType, fingerprint: w.fingerprint }
    if (w.value !== undefined) a.value = w.value as Json
    if (w.meta) a.meta = w.meta as Record<string, Json>
    if (w.files || w.remoteFiles) a.files = files
    out[port] = a
  }
  return out
}

/** Reads the parent's lines: the first one through `first`, the replies through `onReply`. */
function lineReader(stdin: NodeJS.ReadableStream): {
  first: Promise<string | null>
  onReply: (f: (l: ReplyLine) => void) => void
  onClose: (f: () => void) => void
  close: () => void
} {
  const rl = createInterface({ input: stdin, crlfDelay: Infinity })
  let resolveFirst!: (s: string | null) => void
  const first = new Promise<string | null>((r) => (resolveFirst = r))
  let gotFirst = false
  let reply: (l: ReplyLine) => void = () => undefined
  let onClosed: () => void = () => undefined
  let isClosed = false
  rl.on('line', (line) => {
    if (!gotFirst) {
      gotFirst = true
      resolveFirst(line)
      return
    }
    try {
      const p = ParentLine.safeParse(JSON.parse(line))
      if (p.success && p.data.t === 'reply') reply(p.data)
    } catch {
      // not a protocol line: ignored
    }
  })
  rl.on('close', () => {
    isClosed = true
    if (!gotFirst) resolveFirst(null)
    onClosed()
  })
  return {
    first,
    onReply: (f) => (reply = f),
    // a channel already closed calls back at once
    onClose: (f) => {
      onClosed = f
      if (isClosed) f()
    },
    close: () => rl.close()
  }
}

export async function runWorkerChild(o: WorkerChildOptions): Promise<number> {
  const send = (l: ChildLine): void => {
    o.stdout.write(encodeChildLine(l))
  }
  const fail = (e: unknown): number => {
    send({ t: 'error', error: wireError(e) })
    return 0
  }
  const lines = lineReader(o.stdin)
  try {
    const first = await lines.first
    if (first === null) {
      send({ t: 'error', error: { code: 'bad_params', message: 'no job received', permanent: true } })
      return 1
    }
    let job: WorkerJob
    try {
      const parsed = ParentLine.safeParse(JSON.parse(first))
      if (!parsed.success) throw new Error(`the first line is not a valid job: ${parsed.error.message}`)
      if (parsed.data.t !== 'job') throw new Error('the first line is not a job')
      job = parsed.data.job
    } catch (e) {
      return fail(new EngineError('bad_params', `bad job: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`))
    }
    const def = o.registry.get(job.nodeType)
    if (!def) return fail(new EngineError('bad_params', `unknown node type ${job.nodeType}`))
    const params = def.params.safeParse(job.params)
    if (!params.success) return fail(new EngineError('bad_params', `bad params for ${job.nodeType}: ${params.error.message.slice(0, 300)}`))

    // parent calls: one pending promise per id, answered by `reply` lines
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    let nextId = 0
    lines.onReply((l) => {
      const p = pending.get(l.id)
      if (!p) return
      pending.delete(l.id)
      if (l.ok) p.resolve(l.value)
      else p.reject(new EngineError(asCode(l.error.code), l.error.message, l.error.permanent))
    })
    let channelClosed = false
    // the parent died (a crash, a kill): the node stops too, never a render running on unseen (solidite)
    const parentGone = new AbortController()
    const channelGone = (): EngineError => new EngineError('transient', 'the parent closed the worker channel')
    lines.onClose(() => {
      channelClosed = true
      for (const p of pending.values()) p.reject(channelGone())
      pending.clear()
      parentGone.abort()
    })
    const call = <T>(name: WorkerCallName, req: unknown, opts?: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (channelClosed) {
          reject(channelGone())
          return
        }
        const id = ++nextId
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        send({ t: 'call', id, name, req, ...(opts === undefined ? {} : { opts }) })
      })
    const proxies: Partial<EngineServices> = {}
    if (o.parentServices) {
      const cloud: CloudService = {
        synthesize: (req, opts) => call('cloud.synthesize', req, { idempotencyKey: opts.idempotencyKey, dir: opts.dir }),
        generateImage: (req, opts) => call('cloud.generateImage', req, { idempotencyKey: opts.idempotencyKey, dir: opts.dir }),
        generateVideo: (req, opts) => call('cloud.generateVideo', req, { idempotencyKey: opts.idempotencyKey, dir: opts.dir }),
        talkingAvatar: (req, opts) => call('cloud.talkingAvatar', req, { idempotencyKey: opts.idempotencyKey, dir: opts.dir }),
        searchStock: (req, opts) => call('cloud.searchStock', req, { idempotencyKey: opts.idempotencyKey, dir: opts.dir })
      }
      const claude: ClaudeService = {
        ask: (req) => {
          const { signal: _signal, ...rest } = req
          return call('claude.ask', rest)
        }
      }
      const videos: VideoReaderService = { read: (req) => call('videos.read', req) }
      proxies.cloud = cloud
      proxies.claude = claude
      proxies.videos = videos
    }

    // scratch folders live under outDir: their files must outlive this process until the parent stores them
    const host = nodeHost({
      dataDir: o.dataDir,
      resourcesDir: o.resourcesDir,
      ...(o.platform ? { platform: o.platform } : {}),
      ...(o.pathEnv !== undefined ? { pathEnv: o.pathEnv } : {})
    })
    let n = 0
    const services: EngineServices = {
      ...host.services,
      workspace: {
        scratch: async (label) => {
          const d = path.join(job.outDir, 'scratch', `${String(++n).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '_')}`)
          await mkdir(d, { recursive: true })
          return d
        },
        cache: (kind) => (host.services.workspace as NonNullable<EngineServices['workspace']>).cache(kind)
      },
      ...proxies
    }
    if (!o.parentServices) {
      delete services.claude
      delete services.cloud
    }

    try {
      await mkdir(job.outDir, { recursive: true })
      const inputs = await resolveInputs(job, o.fetchImpl ?? fetch)
      const ctx = createRunCtx(
        def,
        {
          emit: (r) => send(r.kind === 'progress' ? { t: 'progress', frac: r.frac, ...(r.text ? { text: r.text } : {}) } : { t: 'log', level: r.level, text: r.text }),
          signal: parentGone.signal, // a cancel kills this process; this signal aborts only when the parent is gone
          store: { read: async () => null },
          seed: job.seed,
          where: job.where,
          attempt: job.attempt,
          notes: job.notes,
          reportCost: (c) => send({ t: 'cost', cost: { units: c.units, ...(c.provider ? { provider: c.provider } : {}) } }),
          services
        },
        job.settings
      )
      const outputs: NodeOutputs = job.fake ? await def.fake(ctx, inputs, params.data) : await def.run(ctx, inputs, params.data)
      const wire = Object.fromEntries(
        Object.entries(outputs).map(([name, out]) => [
          name,
          {
            ...(out.files ? { files: out.files.map((f) => path.resolve(f)) } : {}),
            ...(out.value !== undefined ? { value: out.value } : {}),
            ...(out.meta ? { meta: out.meta } : {})
          }
        ])
      )
      send({ t: 'done', outputs: wire })
      return 0
    } catch (e) {
      return fail(e)
    }
  } finally {
    lines.close()
  }
}
