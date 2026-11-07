// The engine's view of Atelier Cloud over HTTP (contract: src/shared/cloud-api.ts). One paid item = one quote, one job
// with its idempotency key (the same key never pays twice, R10.6), then the files through their signed links. The
// access token comes from the host (the app keeps it in safeStorage, lot P5); the engine never sees a provider key.
// The Cloud ties a key to the quote of its first job, so the client remembers that quote per key (`stateDir`, else in
// memory): a retry or a resumed run replays the same job instead of paying again. After a failed job the key moves to a
// new generation, so « Réessayer » can make a new job. Errors map to engine codes: unreachable / busy → transient,
// no credits → budget, signed out → missing_tool, anything else → refused, with a French message (never a raw object).
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import { Artefact as CloudArtefact, ArtefactLinkResponse, CatalogResponse, Job, Quote, StockResult, TERMINAL_JOB_STATES, type Usage } from '../shared/cloud-api'
import { MEDIA_ROUTES, MediaSearchRequest, MediaSearchResponse } from '../shared/cloud-media'
import { busyRetry, SEARCHES_AT_ONCE, slotFor, uploadSlot } from './cloud-busy'
import { AbortError, EngineError } from './errors'
import type { CloudJobOptions, CloudService, StockHit, TimedWord } from './services'

export interface CloudHttpOptions {
  baseUrl: string
  token: () => string | Promise<string>
  fetchImpl?: typeof fetch
  /** Poll interval while a job runs (ms). */
  pollMs?: number
  /** A job not finished after this long is given up (transient, the scheduler retries; default 15 min). */
  jobTimeoutMs?: number
  /** Where the quote of each idempotency key is remembered across processes (else in memory only). */
  stateDir?: string
  /**
   * Told about every job this client makes or replays (`created`, with its quote when this client asked it) and about
   * how it ended (`ended`): the app copies them into its local ledger (lot P5). A failing listener never fails a node.
   */
  onJob?: (e: { phase: 'created' | 'ended'; job: Job; creditValueEur?: number }) => void | Promise<void>
  /** The jobs serve a run its owner turned real (production-17): the Cloud answers a usage it can only serve in demo for free. */
  realRun?: boolean
  /** Free usages only (a demo run's client, cloud-demo.ts): a quote priced above 0 credits is refused before any job exists. */
  freeOnly?: boolean
  /** How long a busy Cloud (429) is waited for before a request fails (default BUSY_BUDGET_MS, about 2 minutes). */
  busyBudgetMs?: number
}

export const UNREACHABLE = 'Atelier Cloud est injoignable : vérifie que le Cloud tourne, puis réessaie.'
/** The start of a busy Cloud's message (a 429 or a 5xx, waited for first): « occupé », never « injoignable ». */
export const BUSY = 'Atelier Cloud est occupé'

/** A Cloud refusal with its contract error code (`gone`, `conflict`…). */
export class CloudRefusal extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(`${status} ${code}`)
    this.status = status
    this.code = code
  }
}

export function toEngine(e: CloudRefusal): EngineError {
  switch (e.code) {
    case 'unauthorized':
    case 'token_expired':
      return new EngineError('missing_tool', 'La connexion à Atelier Cloud a expiré : reconnecte l’app au Cloud.')
    case 'insufficient_credits':
    case 'cap_exceeded':
      return new EngineError('budget', 'Crédits insuffisants pour cette étape.')
    case 'rate_limited':
    case 'internal':
      return new EngineError('transient', `${BUSY} (${e.status}).`)
    default:
      return e.status >= 500 ? new EngineError('transient', `${BUSY} (${e.status}).`) : new EngineError('refused', `Atelier Cloud a refusé la demande (${e.code}).`)
  }
}

/** What the client remembers per idempotency key. */
interface KeyRecord {
  quoteId?: string
  generation: number
}

/** A typed call to the Cloud: refusals come back as `CloudRefusal` (`raw`) or as engine errors (`call`). */
export interface CloudCaller {
  readonly baseUrl: string
  readonly fetch: typeof fetch
  raw<T>(method: string, url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T>
  call<T>(method: string, url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T>
}

/** The HTTP plumbing shared by every client of the contract (the engine's services and the app's own client). */
export function cloudCaller(o: Pick<CloudHttpOptions, 'baseUrl' | 'token' | 'fetchImpl' | 'busyBudgetMs'>): CloudCaller {
  const f = o.fetchImpl ?? fetch
  const raw = async <T>(method: string, url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> => {
    let res: Response
    try {
      // a busy Cloud (429) is waited for, as it asks (production-17)
      res = await busyRetry(
        async () =>
          f(o.baseUrl + url, {
            method,
            signal,
            headers: { authorization: `Bearer ${await o.token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body)
          }),
        signal,
        // media searches and the rest are paced apart: the Cloud limits them separately (a search 429 must not stop job polls)
        { key: url.startsWith('/v1/media') ? `${o.baseUrl}#media` : o.baseUrl, ...(o.busyBudgetMs === undefined ? {} : { budgetMs: o.busyBudgetMs }) }
      )
    } catch (e) {
      if (signal.aborted) throw new AbortError()
      if (e instanceof EngineError) throw e // the token provider's own refusal (signed out)
      throw new EngineError('transient', `${UNREACHABLE} (${(e as Error).message})`)
    }
    const text = await res.text()
    if (!res.ok) {
      let code = `http_${res.status}`
      try {
        const err = (JSON.parse(text) as { error?: { code?: unknown } }).error
        if (typeof err?.code === 'string') code = err.code
      } catch {
        // not JSON: the status says enough
      }
      throw new CloudRefusal(res.status, code)
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new EngineError('transient', `unexpected Cloud answer to ${method} ${url}`)
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new EngineError('internal', `unexpected Cloud answer to ${method} ${url}`)
    return parsed.data
  }
  const call = async <T>(method: string, url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> => {
    try {
      return await raw(method, url, schema, signal, body)
    } catch (e) {
      throw e instanceof CloudRefusal ? toEngine(e) : e
    }
  }
  return { baseUrl: o.baseUrl, fetch: f, raw, call }
}

/** The hex SHA-256 of a file, read as a stream. */
async function sha256File(file: string, signal: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** A plain file name the Cloud accepts for an upload. */
const uploadName = (file: string): string => {
  const base = path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '')
  return (base || 'file').slice(-100)
}

/**
 * The team's artefact holding this file's content, uploading it when the Cloud does not have it yet (`GET /v1/uploads/:sha256`
 * first: a file already there is not sent again). Shared by the GPU executor and the nodes that hand a file to a provider
 * (the voice audio of a talking avatar).
 */
export type CloudUpload = (file: string, signal: AbortSignal) => Promise<string>

function cloudUploader(o: Pick<CloudHttpOptions, 'token' | 'busyBudgetMs'>, caller: CloudCaller): CloudUpload {
  return async (file, signal) => {
    const sha256 = await sha256File(file, signal)
    try {
      return (await caller.raw('GET', `/v1/uploads/${sha256}`, CloudArtefact, signal)).id
    } catch (e) {
      if (!(e instanceof CloudRefusal)) throw e
      if (e.code !== 'not_found') throw toEngine(e)
    }
    const query = new URLSearchParams({ name: uploadName(file), sha256 })
    let res: Response
    // a few files at a time from this process (the Cloud's per-team budget), a busy answer waited for (production-17)
    const release = await uploadSlot(caller.baseUrl, signal)
    try {
      const bytes = await readFile(file)
      res = await busyRetry(
        async () =>
          caller.fetch(`${caller.baseUrl}/v1/uploads?${query.toString()}`, {
            method: 'POST',
            signal,
            headers: { authorization: `Bearer ${await o.token()}`, 'content-type': 'application/octet-stream' },
            body: bytes
          }),
        signal,
        { key: `${caller.baseUrl}#upload`, ...(o.busyBudgetMs === undefined ? {} : { budgetMs: o.busyBudgetMs }) }
      )
    } catch (e) {
      if (signal.aborted) throw new AbortError()
      if (e instanceof EngineError) throw e
      throw new EngineError('transient', `${UNREACHABLE} (${(e as Error).message})`)
    } finally {
      release()
    }
    const text = await res.text()
    if (!res.ok) {
      let code = `http_${res.status}`
      try {
        const err = (JSON.parse(text) as { error?: { code?: unknown } }).error
        if (typeof err?.code === 'string') code = err.code
      } catch {
        // the status says enough
      }
      throw toEngine(new CloudRefusal(res.status, code))
    }
    const parsed = CloudArtefact.safeParse(JSON.parse(text))
    if (!parsed.success) throw new EngineError('internal', 'unexpected Cloud answer to an upload')
    return parsed.data.id
  }
}

/** One paid item through the Cloud: quote, job (idempotent by key), wait, download into `opts.dir`. */
export type CloudJobRun = (usage: Usage, input: Record<string, unknown>, opts: CloudJobOptions) => Promise<{ job: Job; files: string[] }>

/** The job machinery shared by the node services below and the GPU executor (cloud-gpu.ts). */
export function cloudJobRunner(o: CloudHttpOptions): { caller: CloudCaller; runJob: CloudJobRun; upload: CloudUpload } {
  const caller = cloudCaller(o)
  const f = caller.fetch
  const { raw, call } = caller
  const pollMs = o.pollMs ?? 250
  const timeoutMs = o.jobTimeoutMs ?? 15 * 60_000
  const memory = new Map<string, KeyRecord>()
  const creditValues = new Map<string, number>()
  const real = o.realRun ? { real: true } : {}
  const tell = async (phase: 'created' | 'ended', job: Job): Promise<void> => {
    try {
      const creditValueEur = creditValues.get(job.quoteId)
      await o.onJob?.({ phase, job, ...(creditValueEur === undefined ? {} : { creditValueEur }) })
    } catch {
      // the ledger copy is reconciled later; the node goes on
    }
  }
  const recordFile = (key: string): string | null => (o.stateDir ? path.join(o.stateDir, `${key.replace(/[^\w.-]/g, '_')}.json`) : null)
  const getRecord = async (key: string): Promise<KeyRecord> => {
    const file = recordFile(key)
    if (file && existsSync(file)) {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as KeyRecord
      } catch {
        // a damaged record is a miss
      }
    }
    return memory.get(key) ?? { generation: 0 }
  }
  const putRecord = async (key: string, r: KeyRecord): Promise<void> => {
    memory.set(key, r)
    const file = recordFile(key)
    if (!file) return
    await mkdir(path.dirname(file), { recursive: true })
    // two runs of this process may write the same key at once (the same item in two videos): each its own temporary file
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(r))
    await rename(tmp, file)
  }

  /** Generations of a key tried in a row when the Cloud says it is taken. */
const MAX_KEY_PROBES = 25

/** The job of this key: the remembered quote's job when there is one, else a new quote and job. */
  const startJob = async (usage: Usage, input: Record<string, unknown>, baseKey: string, signal: AbortSignal): Promise<{ job: Job; key: string; record: KeyRecord }> => {
    const record = await getRecord(baseKey)
    const key = record.generation > 0 ? `${baseKey}-g${record.generation}` : baseKey
    if (record.quoteId) {
      let replayed: Job | null = null
      try {
        replayed = await raw('POST', '/v1/jobs', Job, signal, { quoteId: record.quoteId, idempotencyKey: key, ...real })
      } catch (e) {
        // an expired or unknown quote that never made a job: ask a new one below
        if (!(e instanceof CloudRefusal) || !['gone', 'not_found'].includes(e.code)) throw e instanceof CloudRefusal ? toEngine(e) : e
      }
      if (replayed && replayed.state !== 'failed' && replayed.state !== 'cancelled') return { job: replayed, key, record }
      if (replayed) {
        // that job ended without a result while this client was not looking (a crash, a cancel): it cost nothing, and
        // a new generation of the key makes a new one
        await tell('ended', replayed)
        await putRecord(baseKey, { generation: record.generation + 1 })
        return startJob(usage, input, baseKey, signal)
      }
    }
    const quote = await call('POST', '/v1/quotes', Quote, signal, { usage, input })
    // a demo run never spends: a priced quote is refused here, before a job (and its hold) exists
    if (o.freeOnly && quote.totalCredits > 0) throw new EngineError('refused', `Une démo ne dépense rien : ${usage} est facturé ${quote.totalCredits} crédits, refusé avant toute tâche.`)
    creditValues.set(quote.id, quote.creditValueEur)
    // remembered BEFORE the job exists: a crash right after still replays this job, never a second one
    const next = { ...record, quoteId: quote.id }
    await putRecord(baseKey, next)
    try {
      return { job: await raw('POST', '/v1/jobs', Job, signal, { quoteId: quote.id, idempotencyKey: key, ...real }), key, record: next }
    } catch (e) {
      if (e instanceof CloudRefusal && e.code === 'conflict') {
        // the key was used with a quote this client no longer knows (its record was lost): the next generations are tried in turn,
        // because a lost record can leave several of them taken (a job that failed, then the app restarted, then failed again):
        // a retry must always get through (issue #92)
        for (let generation = record.generation + 1; generation <= record.generation + MAX_KEY_PROBES; generation++) {
          const moved = { generation, quoteId: quote.id }
          await putRecord(baseKey, moved)
          try {
            return { job: await raw('POST', '/v1/jobs', Job, signal, { quoteId: quote.id, idempotencyKey: `${baseKey}-g${generation}`, ...real }), key: `${baseKey}-g${generation}`, record: moved }
          } catch (again) {
            if (!(again instanceof CloudRefusal) || again.code !== 'conflict') throw again instanceof CloudRefusal ? toEngine(again) : again
          }
        }
        throw new EngineError('refused', 'Atelier Cloud refuse cette tâche : la clé est déjà prise, réessaie plus tard.')
      }
      throw e instanceof CloudRefusal ? toEngine(e) : e
    }
  }

  /**
   * Cancels a job on the Cloud and waits briefly for its end (a running job stops asynchronously), so the ledger copy
   * closes now; a job still open after that is closed later by the app's reconcile.
   */
  const cancelAndWait = async (id: string): Promise<Job | null> => {
    const signal = new AbortController().signal
    let job = await call('POST', `/v1/jobs/${id}/cancel`, Job, signal).catch(() => null)
    for (let i = 0; job && !TERMINAL_JOB_STATES.includes(job.state) && i < 40; i++) {
      await new Promise((r) => setTimeout(r, Math.min(pollMs, 250)))
      job = await call('GET', `/v1/jobs/${id}`, Job, signal).catch(() => null)
    }
    return job && TERMINAL_JOB_STATES.includes(job.state) ? job : null
  }

  /** Quote, job, wait, download: the job's result data and its files. */
  const runJob: CloudJobRun = async (usage, input, opts) => {
    const started = await startJob(usage, input, opts.idempotencyKey, opts.signal)
    const record = started.record
    let job = started.job
    await tell('created', job)
    // the deadline counts from the job's last change of state (a provider's queue, then its work): solidite
    let deadline = Date.now() + timeoutMs
    let seen = job.state
    // the wait between two looks grows to 16 × pollMs (4 s, ±20 %): ten jobs at once stay far under the Cloud's per-account limit
    let wait = pollMs
    try {
      while (!TERMINAL_JOB_STATES.includes(job.state)) {
        if (Date.now() > deadline) {
          // given up: the job is cancelled on the Cloud (released, never captured later while a fallback engine is paid
          // for the same item), and the key moves on so the retry makes a new one
          await putRecord(opts.idempotencyKey, { generation: record.generation + 1 }).catch(() => undefined)
          const ended = await cancelAndWait(job.id)
          if (ended) await tell('ended', ended)
          throw new EngineError('transient', 'Atelier Cloud n’a pas fini la tâche à temps.')
        }
        const waitNow = Math.round(wait * (0.8 + Math.random() * 0.4)) // jitter: ten jobs started together do not look together
        wait = Math.min(pollMs * 16, Math.round(wait * 1.5))
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            clearTimeout(t)
            reject(new AbortError())
          }
          const t = setTimeout(() => {
            opts.signal.removeEventListener('abort', onAbort)
            resolve()
          }, waitNow)
          if (opts.signal.aborted) onAbort()
          else opts.signal.addEventListener('abort', onAbort, { once: true })
        })
        try {
          job = await call('GET', `/v1/jobs/${job.id}`, Job, opts.signal)
        } catch (e) {
          // a look that fails (a busy or restarting Cloud) is not the job failing: look again until the deadline, so
          // the brick never moves to another engine while this job may still finish and be paid (solidite)
          if (opts.signal.aborted || !(e instanceof EngineError) || e.code !== 'transient') throw e
          continue
        }
        if (job.state !== seen) {
          seen = job.state
          deadline = Date.now() + timeoutMs
        }
        if (job.state === 'running') opts.onProgress?.(0.5)
      }
    } catch (e) {
      // a cancel reaches the Cloud too (R10.4); its credits are released there
      if (opts.signal.aborted) {
        // this key's job is spent either way: the next try (« Réessayer ») makes a new one
        await putRecord(opts.idempotencyKey, { generation: record.generation + 1 }).catch(() => undefined)
        const ended = await cancelAndWait(job.id)
        if (ended) await tell('ended', ended)
      }
      throw e
    }
    await tell('ended', job)
    if (job.state !== 'succeeded') {
      // this key's job is spent: the next try (« Réessayer ») makes a new one
      await putRecord(opts.idempotencyKey, { generation: record.generation + 1 })
      // a job the Cloud's restart cut short is not the provider's verdict: retried (a new job, nothing was paid)
      if (job.error && /interrupted by a Cloud restart/.test(job.error)) throw new EngineError('transient', `Atelier Cloud a redémarré pendant la tâche (${job.id}).`)
      throw new EngineError('refused', `Le fournisseur a échoué : ${job.error ?? job.state}`)
    }
    const files: string[] = []
    for (const a of job.artefacts) {
      // a paid result is downloaded again on a hiccup (3 tries) rather than given up (a fallback would pay again)
      for (let tries = 1; ; tries++) {
        try {
          const link = await call('GET', `/v1/artefacts/${a.id}`, ArtefactLinkResponse, opts.signal)
          const res = await f(link.url, { signal: opts.signal }).catch((e: Error) => {
            if (opts.signal.aborted) throw new AbortError()
            throw new EngineError('transient', `${UNREACHABLE} (${e.message})`)
          })
          if (!res.ok) throw new EngineError('transient', `download failed (${res.status})`)
          const file = path.join(opts.dir, path.basename(a.name).replace(/[^\w.-]/g, '_'))
          await writeFile(file, Buffer.from(await res.arrayBuffer()))
          files.push(file)
          break
        } catch (e) {
          if (opts.signal.aborted || tries >= 3 || !(e instanceof EngineError) || e.code !== 'transient') throw e
          await new Promise((r) => setTimeout(r, pollMs * 4 * tries))
        }
      }
    }
    return { job, files }
  }
  return { caller, runJob, upload: cloudUploader(o, caller) }
}

/** What a refused demo item is, in the run's French error. */
const DEMO_ITEM: Partial<Record<Usage, string>> = { synthesize: 'La voix', generateImage: 'Une image', generateVideo: 'Un clip', talkingAvatar: 'Un plan du présentateur' }

export function cloudHttpService(o: CloudHttpOptions): CloudService {
  const { runJob, upload, caller } = cloudJobRunner(o)
  // solidite: a Cloud whose paid calls are on answers a real run's job in demo only when that engine is not served for
  // real (its key missing, not in realEngines). Such an item is refused, never mixed into the film (it put « DÉMO » over a
  // whole real film): the brick then tries its next engine, then its gap, or fails with this reason. A Cloud whose paid
  // calls are off answers every job in demo: that whole run is a demo, as before.
  let paidCalls: Promise<boolean> | null = null
  const realOnly = async (usage: Usage, job: Job, signal: AbortSignal): Promise<void> => {
    if (!o.realRun || !job.demo) return
    paidCalls ??= caller.call('GET', '/v1/catalog', CatalogResponse, signal).then(
      (c) => c.paidCalls,
      () => false
    )
    if (!(await paidCalls)) return
    throw new EngineError(
      'refused',
      `${DEMO_ITEM[usage] ?? 'Un élément'} : Atelier Cloud a répondu en démo pendant une fabrication réelle (le moteur ${job.provider ?? 'demandé'} n’est pas servi pour de vrai : clé absente ou moteur non activé). Cet élément n’entre pas dans le film.`
    )
  }
  return {
    // the free sources with the keys only the Cloud's vault holds (Europeana, NARA…); nothing billed, nothing downloaded (record 0069)
    async searchMedia(req, signal) {
      // a few searches at a time from this process: ten productions asking at once are paced, not refused
      const release = await slotFor(`${caller.baseUrl}#search`, SEARCHES_AT_ONCE, signal)
      try {
        return await caller.call(MEDIA_ROUTES.mediaSearch.method, MEDIA_ROUTES.mediaSearch.path, MediaSearchResponse, signal, MediaSearchRequest.parse(req))
      } finally {
        release()
      }
    },
    ...(o.realRun ? { realRun: true } : {}),
    async synthesize(req, opts) {
      const { job, files } = await runJob('synthesize', { text: req.text, voiceId: req.voiceId, wordTimings: req.wordTimings, ...(req.engine ? { engine: req.engine } : {}) }, opts)
      await realOnly('synthesize', job, opts.signal)
      const audioFile = files[0]
      if (!audioFile) throw new EngineError('internal', 'the voice job returned no audio')
      const r = job.result ?? {}
      const words = Array.isArray(r.words)
        ? (r.words as unknown[]).flatMap((w): TimedWord[] => {
            const x = w as { word?: unknown; start?: unknown; end?: unknown }
            return typeof x.word === 'string' && typeof x.start === 'number' && typeof x.end === 'number' ? [{ word: x.word, start: x.start, end: x.end }] : []
          })
        : []
      return { audioFile, words, ...(typeof r.durationS === 'number' ? { durationS: r.durationS } : {}), demo: job.demo, credits: job.credits }
    },
    async generateImage(req, opts) {
      // reference images go up to the team's storage first (each once: uploads are by content)
      const refs: string[] = []
      for (const file of req.references ?? []) refs.push(await upload(file, opts.signal))
      const input = {
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        count: 1,
        ...(req.engine ? { engine: req.engine } : {}),
        ...(req.negative ? { negative: req.negative } : {}),
        ...(refs.length > 0 ? { referenceArtefactIds: refs } : {})
      }
      const { job, files } = await runJob('generateImage', input, opts)
      await realOnly('generateImage', job, opts.signal)
      return { files, demo: job.demo, credits: job.credits }
    },
    async generateVideo(req, opts) {
      const imageArtefactId = req.image ? await upload(req.image, opts.signal) : undefined
      const input = {
        prompt: req.prompt,
        seconds: req.seconds,
        aspect: req.aspect,
        ...(req.engine ? { engine: req.engine } : {}),
        ...(req.negative ? { negative: req.negative } : {}),
        ...(imageArtefactId ? { imageArtefactId } : {})
      }
      const { job, files } = await runJob('generateVideo', input, opts)
      await realOnly('generateVideo', job, opts.signal)
      return { files, demo: job.demo, credits: job.credits }
    },
    async talkingAvatar(req, opts) {
      // the voice goes up to the team's storage first (the Cloud hands it to the provider), then one job per clip
      const audioArtefactId = await upload(req.audioFile, opts.signal)
      const portraitArtefactId = req.portraitFile ? await upload(req.portraitFile, opts.signal) : undefined
      const input = {
        avatarId: req.avatarId,
        audioArtefactId,
        seconds: req.seconds,
        aspect: req.aspect,
        ...(req.engine ? { engine: req.engine } : {}),
        ...(portraitArtefactId ? { portraitArtefactId } : {}),
        ...(req.resolution ? { resolution: req.resolution } : {}),
        ...(req.prompt ? { prompt: req.prompt } : {})
      }
      const { job, files } = await runJob('talkingAvatar', input, opts)
      await realOnly('talkingAvatar', job, opts.signal)
      const registration = typeof job.result?.registration === 'string' ? job.result.registration : undefined
      return { files, demo: job.demo, credits: job.credits, ...(registration ? { registration } : {}) }
    },
    async searchStock(req, opts) {
      const { job, files } = await runJob('searchStock', { query: req.query, orientation: req.orientation, kind: req.kind, count: req.count }, opts)
      // `data.results` lists the hits in the order of the files; each names its artefact, which is saved under its own name
      const raw = Array.isArray(job.result?.results) ? (job.result?.results as unknown[]) : []
      const results: StockHit[] = []
      for (const r of raw) {
        const parsed = StockResult.safeParse(r)
        if (!parsed.success) continue
        const file = files.find((f) => path.basename(f) === parsed.data.file.replace(/[^\w.-]/g, '_'))
        if (file) results.push({ ...parsed.data, file })
      }
      return { results, files: results.map((r) => r.file), demo: job.demo, credits: job.credits }
    }
  }
}
