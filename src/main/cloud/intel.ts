// The channel intelligence of the app through Atelier Cloud: `channelData` (a channel's public numbers, YouTube Data API, read-only)
// and `analyseVideo` (the eyes). Both run as ordinary quoted jobs through the same job client as every paid step, so they are
// held, captured and copied into the spend ledger like the others. A job's idempotency key makes a repeat the same job: a channel
// read twice the same day is quoted and paid once, a video analysed twice is analysed once.
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ChannelDataResult } from '../../shared/cloud-api'
import { AnalysisResult } from '../../shared/video-analysis'
import { cloudJobRunner } from '../../engine/cloud-http'
import { EngineError } from '../../engine/errors'
import { t } from '../../shared/fr'
import type { WatchRangeFn } from '../../engine/watch/gemini'
import type { ChannelIntelPort } from '../eyes/port'
import type { WatchInput, WatchOutcome, WholeWatcher } from '../eyes/whole'
import type { WholeVideoLog } from '../../shared/shot-log'
import { applyLocalMeasures, type Refiner } from '../eyes/refine'
import type { CloudApi } from './client'
import type { CloudSpendMirror } from './mirror'

export interface IntelOptions {
  stateDir?: string
  pollMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Counts what the model only guesses (cuts, words a minute) on the video itself; absent or null: the model's numbers stand. */
  refine?: Refiner
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 24)

export class CloudChannelIntel implements ChannelIntelPort {
  private jobs: { baseUrl: string; runner: ReturnType<typeof cloudJobRunner> } | null = null
  private label = ''
  private watcher: WholeWatcher | null = null
  /** Problems of the last whole readings (French), for the caller's report. */
  readonly watchProblems: string[] = []

  constructor(
    private readonly api: CloudApi,
    private readonly mirror: CloudSpendMirror,
    private readonly o: IntelOptions = {}
  ) {}

  connected(): boolean {
    return this.api.session.connected()
  }

  /** The whole-video watcher (set by core once the model routes exist). */
  setWatcher(w: WholeWatcher | null): void {
    this.watcher = w
  }

  /** One range read by Google's model through the Cloud; null when the Cloud is not connected. */
  watchRange(): WatchRangeFn | null {
    if (!this.connected()) return null
    return async (r, signal) => {
      const a = await this.api.mediaWatch({ url: r.url, startS: r.startS, endS: r.endS, dense: r.dense, ...(r.fps ? { fps: r.fps } : {}) }, signal)
      return {
        shots: a.shots.map((s) => ({ ...s, kind: s.kind as never, text: s.text as never, logo: s.logo as never, quality: s.quality as 1 })),
        costUsd: a.costUsd,
        ms: a.ms,
        inputTokens: a.usage?.promptTokenCount ?? 0,
        outputTokens: (a.usage?.candidatesTokenCount ?? 0) + (a.usage?.thoughtsTokenCount ?? 0),
        dense: a.dense === true
      }
    }
  }

  /** The whole reading with every option (a supplied file, a fresh read); throws with the plain reasons when it cannot. */
  async watch(input: WatchInput, signal: AbortSignal): Promise<WatchOutcome> {
    if (!this.watcher) throw new Error('La lecture entière des vidéos n’est pas disponible ici.')
    return this.watcher.watch(input, signal)
  }

  async watchWhole(url: string, o: { title?: string; durationS?: number | null; maxUsd?: number }, signal: AbortSignal): Promise<{ log: WholeVideoLog; line: string } | null> {
    if (!this.watcher) return null
    try {
      const r = await this.watcher.watch({ url, ...(o.title ? { title: o.title } : {}), durationS: o.durationS ?? null, ...(o.maxUsd !== undefined ? { maxUsd: o.maxUsd } : {}) }, signal)
      return { log: r.log, line: r.line }
    } catch (e) {
      if (signal.aborted) throw e
      this.watchProblems.push((e as Error).message.slice(0, 400))
      return null
    }
  }

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

  private requireConnected(): void {
    if (!this.connected()) throw new EngineError('missing_tool', t('eyes.err.notConnected'))
  }

  private day(): string {
    return (this.o.now?.() ?? new Date()).toISOString().slice(0, 10)
  }

  async channelData(url: string, maxVideos: number, signal: AbortSignal, label: string): Promise<{ data: ChannelDataResult; demo: boolean }> {
    this.requireConnected()
    const dir = await mkdtemp(path.join(os.tmpdir(), 'atelier-eyes-'))
    try {
      // same channel, same day, same size = the same job
      const key = `channeldata-${hash(url)}-${this.day()}-${maxVideos}`
      const { job } = await this.runner(label).runJob('channelData', { url, maxVideos }, { idempotencyKey: key, signal, dir })
      const data = ChannelDataResult.safeParse(job.result)
      if (!data.success) throw new Error(t('eyes.err.badAnswer'))
      return { data: data.data, demo: job.demo }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async analyseVideo(url: string, minutes: number, signal: AbortSignal, label: string): Promise<{ analysis: AnalysisResult; demo: boolean }> {
    this.requireConnected()
    const dir = await mkdtemp(path.join(os.tmpdir(), 'atelier-eyes-'))
    try {
      const rounded = Math.round(minutes * 10) / 10
      // the same video, length and day = the same job; a job that failed or was cancelled never blocks the next try (cloud-http moves
      // the key on to a new generation, and the day bounds how long a lost record can matter): issue #92
      const key = `analyse-${hash(url)}-${rounded}-${this.day()}`
      const { job } = await this.runner(label).runJob('analyseVideo', { url, minutes: rounded }, { idempotencyKey: key, signal, dir })
      const analysis = AnalysisResult.safeParse((job.result as { analysis?: unknown } | null)?.analysis)
      if (!analysis.success) throw new Error(t('eyes.err.badAnswer'))
      // a demonstration answer measures nothing real: only a real reading is counted on the video
      const counted = this.o.refine && !job.demo ? await this.o.refine(url, rounded, signal).catch((e) => {
        if (signal.aborted) throw e
        return null
      }) : null
      return { analysis: counted ? applyLocalMeasures(analysis.data, counted) : analysis.data, demo: job.demo }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
