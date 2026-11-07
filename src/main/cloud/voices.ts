// The voices of Atelier Cloud in the app: the list the Cloud offers (its platform voices, in demo the fake ones, plus the ones
// this team cloned) and the cloning of a new voice from a recording. The recording is checked here (format, size, length)
// before anything is sent; then it goes up through the Cloud's upload route (a file the Cloud already has is not sent again)
// and a `cloneVoice` job runs through the same job client as every paid step, so it is quoted, held, captured and copied
// into the spend ledger like the others. Nothing is invented: not connected means no voices, and the reason is returned.
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { CloneVoiceRequest, CloudVoice, CloudVoices } from '../../shared/api'
import { Artefact, MAX_UPLOAD_BYTES } from '../../shared/cloud-api'
import { CloudRefusal, cloudJobRunner, toEngine, UNREACHABLE } from '../../engine/cloud-http'
import { EngineError } from '../../engine/errors'
import { createMediaService, locateTool } from '../../engine/media/tools'
import { probe } from '../../engine/media/probe'
import { t } from '../../shared/fr'
import type { CloudApi } from './client'
import type { CloudSpendMirror } from './mirror'

/** The limits of a recording to clone (MiniMax's guide, docs/PROVIDERS.md): 10 s to 5 min, 20 MB, mp3 / m4a / wav. */
export const CLONE_MIN_S = 10
export const CLONE_MAX_S = 300
export const CLONE_MAX_BYTES = 20 * 1024 * 1024
export const CLONE_EXTENSIONS = ['mp3', 'm4a', 'wav'] as const
const NAME_MAX = 60

export interface VoicesOptions {
  /** Length of an audio file in seconds, or null when it cannot be measured here (then the provider's own check applies). */
  duration?: (file: string, signal: AbortSignal) => Promise<number | null>
  /** Where the quote of each clone job is remembered across restarts (else in memory only). */
  stateDir?: string
  /** Poll interval while the job runs (ms). */
  pollMs?: number
  fetchImpl?: typeof fetch
}

/** Length of an audio file with the machine's ffprobe, null when there is none. */
export async function ffprobeDuration(file: string, signal: AbortSignal): Promise<number | null> {
  const env = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
  const ffmpeg = locateTool('ffmpeg', env)
  const ffprobe = locateTool('ffprobe', env)
  if (!ffmpeg || !ffprobe) return null
  try {
    return (await probe(createMediaService({ ffmpeg, ffprobe }), file, signal)).durationS
  } catch {
    return null
  }
}

const safeName = (fileName: string, ext: string): string => {
  const base = path.basename(fileName, path.extname(fileName)).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60)
  return `${base || 'voix'}.${ext}`
}

const extOf = (fileName: string): string => path.extname(fileName).slice(1).toLowerCase()

export class CloudVoicesService {
  private jobs: { baseUrl: string; runner: ReturnType<typeof cloudJobRunner> } | null = null
  /** The ledger label of the clone in progress (read by the job client's listener). */
  private label = ''

  constructor(
    private readonly api: CloudApi,
    private readonly mirror: CloudSpendMirror,
    private readonly o: VoicesOptions = {}
  ) {}

  /** The voices the team can pick, or why there are none (not signed in, Cloud unreachable). */
  async list(): Promise<CloudVoices> {
    if (!this.api.session.connected()) return { status: 'not-connected', voices: [], clone: null }
    try {
      const catalog = await this.api.catalog()
      const clone = catalog.providers.find((p) => p.usage === 'cloneVoice')
      return {
        status: 'ok',
        voices: catalog.voices.map((v) => ({ id: v.id, name: v.name, language: v.language, demo: v.demo, cloned: v.cloned, ...(v.default ? { default: true } : {}) })),
        clone: clone ? (clone.status === 'real' && catalog.paidCalls ? 'real' : 'demo') : null
      }
    } catch (e) {
      // signed out on the way, or the Cloud does not answer: nothing is shown but the reason
      if (e instanceof EngineError && e.code === 'missing_tool') return { status: 'not-connected', voices: [], clone: null }
      return { status: 'unreachable', voices: [], clone: null }
    }
  }

  /** Checks a recording, uploads it, clones the voice and returns it as the Cloud now lists it. */
  async clone(req: unknown): Promise<CloudVoice> {
    const input = checkRequest(req)
    if (!this.api.session.connected()) throw new EngineError('missing_tool', t('cloud.voices.notConnected'))
    const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)
    const ext = extOf(input.fileName)
    const dir = await mkdtemp(path.join(os.tmpdir(), 'atelier-clone-'))
    const control = new AbortController()
    try {
      const file = path.join(dir, safeName(input.fileName, ext))
      await writeFile(file, bytes)
      const seconds = await (this.o.duration ?? ffprobeDuration)(file, control.signal)
      if (seconds !== null && seconds < CLONE_MIN_S) throw new Error(t('cloud.clone.tooShort', { s: Math.round(seconds) }))
      if (seconds !== null && seconds > CLONE_MAX_S) throw new Error(t('cloud.clone.tooLong'))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const artefactId = await this.upload(path.basename(file), sha256, bytes, control.signal)
      const { runJob } = this.runner(t('cloud.clone.ledger', { name: input.name }))
      // the same recording under the same name is the same job: asked twice, it is quoted and paid once
      const key = `clone-${sha256.slice(0, 24)}-${createHash('sha256').update(`${input.name}\n${input.language}${input.engine ? `\n${input.engine}` : ''}`).digest('hex').slice(0, 12)}`
      let job
      try {
        const engine = input.engine ? { engine: input.engine } : {}
        job = (await runJob('cloneVoice', { audioArtefactId: artefactId, name: input.name, language: input.language, consent: true, ...engine }, { idempotencyKey: key, signal: control.signal, dir })).job
      } catch (e) {
        if (e instanceof EngineError && e.code === 'refused') throw new Error(t('cloud.clone.failed', { why: e.message.replace(/^Le fournisseur a échoué : /, '') }), { cause: e })
        throw e
      }
      const result = z.object({ voiceId: z.string().min(1) }).safeParse(job.result)
      if (!result.success) throw new Error(t('cloud.clone.failed', { why: job.error ?? job.state }))
      return { id: result.data.voiceId, name: input.name, language: input.language, demo: job.demo, cloned: true }
    } finally {
      control.abort()
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Voice design (decision 0029): previews of a voice described in words, downloaded into `dir`. */
  async design(req: { description: string; text?: string; language: string; engine: string }, dir: string): Promise<{ previews: DesignPreview[]; demo: boolean }> {
    const key = `design-${createHash('sha256').update(`${req.engine}\n${req.language}\n${req.description}\n${req.text ?? ''}`).digest('hex').slice(0, 32)}`
    const { job, files } = await this.voiceJob('designVoice', { ...req }, key, dir, t('cloud.design.ledger'))
    const previews = z.array(z.object({ generatedVoiceId: z.string().min(1), file: z.string(), durationS: z.number().nullable() })).safeParse((job.result ?? {}).previews)
    if (!previews.success) throw new Error(t('cloud.clone.failed', { why: 'previews' }))
    return { previews: previews.data.map((p) => ({ ...p, file: files.find((f) => path.basename(f) === p.file) ?? '' })).filter((p) => p.file !== ''), demo: job.demo }
  }

  /** Keeps one preview of a design as a voice of the team. */
  async keep(req: { description: string; generatedVoiceId: string; name: string; language: string; engine: string }): Promise<{ voiceId: string; demo: boolean }> {
    const key = `keep-${createHash('sha256').update(`${req.engine}\n${req.generatedVoiceId}\n${req.name}`).digest('hex').slice(0, 32)}`
    const input = { description: req.description, language: req.language, engine: req.engine, keep: { generatedVoiceId: req.generatedVoiceId, name: req.name } }
    const { job } = await this.voiceJob('designVoice', input, key, null, t('cloud.design.ledger'))
    const r = z.object({ voiceId: z.string().min(1) }).safeParse(job.result)
    if (!r.success) throw new Error(t('cloud.clone.failed', { why: job.error ?? job.state }))
    return { voiceId: r.data.voiceId, demo: job.demo }
  }

  /** A short narration with a voice on an engine (the sample a designed voice is cloned from on another engine). */
  async speak(req: { text: string; voiceId: string; engine: string }, dir: string): Promise<{ file: string; demo: boolean }> {
    const key = `voice-sample-${createHash('sha256').update(`${req.engine}\n${req.voiceId}\n${req.text}`).digest('hex').slice(0, 32)}`
    const { job, files } = await this.voiceJob('synthesize', { text: req.text, voiceId: req.voiceId, engine: req.engine, wordTimings: false }, key, dir, t('cloud.design.sampleLedger'))
    const file = files[0]
    if (!file) throw new Error(t('cloud.clone.failed', { why: 'audio' }))
    return { file, demo: job.demo }
  }

  /** One voice job (quoted, held, captured, in the ledger), with its files downloaded into `dir` (or a temporary folder). */
  private async voiceJob(usage: 'designVoice' | 'synthesize', input: Record<string, unknown>, key: string, dir: string | null, label: string) {
    if (!this.api.session.connected()) throw new EngineError('missing_tool', t('cloud.voices.notConnected'))
    const work = dir ?? (await mkdtemp(path.join(os.tmpdir(), 'atelier-voice-')))
    const control = new AbortController()
    try {
      return await this.runner(label).runJob(usage, input, { idempotencyKey: key, signal: control.signal, dir: work })
    } finally {
      control.abort()
      if (!dir) await rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** The job client of the current Cloud address (one per address: it remembers the quote of each key). */
  private runner(label: string): ReturnType<typeof cloudJobRunner> {
    const baseUrl = this.api.session.baseUrl()
    this.label = label
    if (this.jobs?.baseUrl !== baseUrl) {
      this.jobs = {
        baseUrl,
        runner: cloudJobRunner({
          baseUrl,
          token: () => this.api.session.token(),
          ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}),
          ...(this.o.pollMs !== undefined ? { pollMs: this.o.pollMs } : {}),
          ...(this.o.stateDir ? { stateDir: this.o.stateDir } : {}),
          onJob: (e) => this.mirror.record(e, { label: this.label })
        })
      }
    }
    return this.jobs.runner
  }

  /** The id of the team's file with this content: the one the Cloud already has, else the upload. */
  private async upload(name: string, sha256: string, bytes: Buffer, signal: AbortSignal): Promise<string> {
    const caller = this.api.session.caller()
    try {
      return (await caller.raw('GET', `/v1/uploads/${sha256}`, Artefact, signal)).id
    } catch (e) {
      if (!(e instanceof CloudRefusal)) throw e
      if (e.code !== 'not_found') throw toEngine(e)
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(t('cloud.clone.tooBig'))
    const query = new URLSearchParams({ name, sha256 })
    let res: Response
    try {
      res = await caller.fetch(`${caller.baseUrl}/v1/uploads?${query.toString()}`, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${await this.api.session.token()}`, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes)
      })
    } catch (e) {
      if (e instanceof EngineError) throw e
      throw new EngineError('transient', UNREACHABLE)
    }
    const text = await res.text()
    if (!res.ok) throw new Error(t('cloud.clone.failed', { why: `HTTP ${res.status}` }))
    const parsed = Artefact.safeParse(JSON.parse(text))
    if (!parsed.success) throw new EngineError('internal', 'unexpected Cloud answer to an upload')
    return parsed.data.id
  }
}

export interface DesignPreview {
  generatedVoiceId: string
  /** The preview's file on this computer. */
  file: string
  durationS: number | null
}

/** Validates what the renderer sent (untrusted): a name, a language, a file name, its bytes and the consent tick. */
export function checkRequest(v: unknown): { name: string; language: string; fileName: string; bytes: Uint8Array; engine?: string } {
  const x = (typeof v === 'object' && v !== null ? v : {}) as Partial<CloneVoiceRequest>
  const engine = typeof x.engine === 'string' && /^voice:[a-z0-9][a-z0-9.-]{0,60}$/.test(x.engine) ? x.engine : undefined
  const name = typeof x.name === 'string' ? x.name.trim() : ''
  if (name.length < 1 || name.length > NAME_MAX) throw new Error(t('cloud.clone.name'))
  const language = typeof x.language === 'string' && /^[a-z]{2}$/.test(x.language) ? x.language : 'fr'
  const fileName = typeof x.fileName === 'string' ? x.fileName : ''
  if (!(CLONE_EXTENSIONS as readonly string[]).includes(extOf(fileName))) throw new Error(t('cloud.clone.format'))
  const bytes = x.bytes
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error(t('cloud.clone.unreadable'))
  if (bytes.byteLength > CLONE_MAX_BYTES) throw new Error(t('cloud.clone.tooBig'))
  // decision 0025: no clone without the tick that says the person holds the rights to the voice
  if (x.consent !== true) throw new Error(t('cloud.clone.consent'))
  return { name, language, fileName, bytes, ...(engine ? { engine } : {}) }
}
