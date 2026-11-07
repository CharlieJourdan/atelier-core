// « Watch a whole video » for the app (chantier regarder-videos): one call that returns the structured shot log of a whole video,
// cached per video. The order is the cheapest deep reading first, all legitimate:
//   1. a file the user supplied (import) → read locally;
//   2. a normal download when the platform serves it (yt-dlp with fixed arguments: no cookies, no login, no config, nothing that
//      gets around a check; a refusal is accepted as it is) → read locally, then the file is deleted;
//   3. Google's model reading the public link on its side, range by range, through Atelier Cloud (`POST /v1/media/watch`).
// Local reading counts the cuts (scene detection), takes word times (faster-whisper or the video's captions) and names the shots on
// contact sheets with Claude at Haiku level (the user's subscription). When no way works, the error says each reason plainly.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { coverageLine, type WholeVideoLog } from '../../shared/shot-log'
import { WatchCache, videoKey } from '../../engine/watch/cache'
import { readByGemini, type Range, type WatchRangeFn } from '../../engine/watch/gemini'
import type { Labeller } from '../../engine/watch/label'
import { readLocalVideo } from '../../engine/watch/local'
import { wordsFromJson3, type TimedWord } from '../../engine/sourcing/measure-video'
import { spawnRun } from '../../engine/sourcing/providers/ytdlp'
import type { RunFn } from '../../engine/sourcing/types'

/** Longest video downloaded for a local reading (a longer one goes to the model's reading of the link). */
export const DOWNLOAD_MAX_S = 2 * 3600
/** Default dollars one model reading of a link may spend. */
export const DEFAULT_WATCH_USD = 0.5

/** yt-dlp arguments of a NORMAL download: ≤ 480p with its sound, the video's info and its own captions. Fixed: `--ignore-config` so
 *  no user config (cookies, proxies) can slip in; no cookies, no login, no impersonation, no player or token options. */
export function downloadArgs(url: string, dir: string): string[] {
  return [
    '--ignore-config', '--no-warnings', '--no-playlist', '--socket-timeout', '20',
    '--match-filter', `duration < ${DOWNLOAD_MAX_S}`,
    // the smaller side ≤ 480 (a vertical Short too), H.264 preferred
    '-f', 'bv*+ba/b', '-S', 'res:480,+codec:avc', '--merge-output-format', 'mp4',
    // captions are a bonus (word times when whisper is missing): only the original-language track, and a refused caption (HTTP 429)
    // never fails the download (`--ignore-errors`; the video file itself is checked after)
    '--write-info-json', '--write-auto-subs', '--sub-langs', '.*-orig', '--sub-format', 'json3', '--ignore-errors',
    '-o', path.join(dir, 'v.%(ext)s'),
    '--', url
  ]
}

export interface WatchInput {
  /** The public link (needed for a download or the model's reading; a supplied file alone is enough for a local reading). */
  url?: string
  /** A video file the user supplied or has rights to. */
  file?: string
  title?: string
  durationS?: number | null
  /** Dollars the model's reading may spend (a local reading spends only subscription turns). */
  maxUsd?: number
  /** Read again even when the cache has it. */
  refresh?: boolean
  /** Only the model's reading of the link (no download): to compare the ways; cached apart. */
  modelOnly?: boolean
  language?: string
  /** The supplied `file` is a normal download of `url` made by the caller (creation-conversationnelle keeps it for the side-by-side). */
  downloaded?: boolean
  /** Word times from the video's own caption track (the fallback when whisper is missing), for a supplied file. */
  captionWords?: TimedWord[]
}

export interface WatchOutcome {
  log: WholeVideoLog
  cached: boolean
  /** Plain French: what was read. */
  line: string
  /** The ways tried before this one, with why they did not serve (French). */
  tried: string[]
}

export interface WholeWatcherDeps {
  cacheDir: string
  run?: RunFn
  /** Claude at Haiku level with eyes; null: local readings have no labels (said in the log). */
  labeller?: () => Labeller | null
  /** The Cloud's range reading; null when the Cloud is not connected. */
  watchRange?: () => WatchRangeFn | null
  maxCost?: (r: Range) => number
  /** The python that has faster-whisper (default `python`). */
  python?: string
  /** Finds that python when `python` is not given (the same candidates as the speech recogniser: `py -3.13`, `py -3.12`,
   *  `python` on Windows), so words never silently fall back to captions on a machine where plain `python` lacks it. */
  findPython?: () => Promise<string | null>
  whisperModel?: string
  tmpDir?: string
  /** Turns the normal download off (a team that only wants the model's reading). */
  download?: boolean
}

const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 160)

export class WholeWatcher {
  private readonly cache: WatchCache
  private readonly run: RunFn

  constructor(private readonly d: WholeWatcherDeps) {
    this.cache = new WatchCache(d.cacheDir)
    this.run = d.run ?? spawnRun
  }

  async cached(urlOrFile: string): Promise<WholeVideoLog | null> {
    return this.cache.get(videoKey(urlOrFile))
  }

  async watch(input: WatchInput, signal?: AbortSignal): Promise<WatchOutcome> {
    const key = `${videoKey(input.url ?? input.file ?? '')}${input.modelOnly ? '-model' : ''}`
    if (!input.url && !input.file) throw new Error('Donne un lien de vidéo ou un fichier.')
    if (!input.refresh) {
      const hit = await this.cache.get(key)
      if (hit) return { log: hit, cached: true, line: coverageLine(hit.coverage, hit.stats.shots), tried: [] }
    }
    const tried: string[] = []
    const title = input.title ?? input.url ?? path.basename(input.file ?? '')
    const python = this.d.python ?? (await this.d.findPython?.()) ?? null
    const local = (file: string, method: 'local-file' | 'download', captionWords: TimedWord[]): Promise<WholeVideoLog> =>
      readLocalVideo(file, {
        url: input.url ?? file,
        title,
        method,
        run: this.run,
        ...(this.d.labeller?.() ? { labeller: this.d.labeller() as Labeller } : {}),
        captionWords,
        ...(python ? { python } : {}),
        ...(this.d.whisperModel ? { whisperModel: this.d.whisperModel } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(this.d.tmpDir ? { tmpDir: this.d.tmpDir } : {}),
        ...(signal ? { signal } : {})
      })
    let log: WholeVideoLog | null = null
    if (input.file && !input.modelOnly) {
      log = await local(input.file, input.downloaded && input.url ? 'download' : 'local-file', input.captionWords ?? [])
    }
    if (!log && input.url && this.d.download !== false && !input.modelOnly) {
      const dir = await mkdtemp(path.join(this.d.tmpDir ?? os.tmpdir(), 'atelier-dl-'))
      try {
        await this.run('yt-dlp', downloadArgs(input.url, dir), { timeoutMs: 900_000, ...(signal ? { signal } : {}) })
        const files = await readdir(dir)
        const video = files.find((f) => /^v\.(mp4|mkv|webm|mov)$/.test(f))
        if (!video) throw new Error('aucun fichier servi')
        const info = files.includes('v.info.json') ? (JSON.parse(await readFile(path.join(dir, 'v.info.json'), 'utf8')) as { title?: string }) : {}
        let words: TimedWord[] = []
        for (const c of files.filter((f) => f.endsWith('.json3')).sort((x, y) => Number(/orig/.test(y)) - Number(/orig/.test(x)))) {
          words = wordsFromJson3(await readFile(path.join(dir, c), 'utf8'))
          if (words.length >= 20) break
        }
        log = await local(path.join(dir, video), 'download', words)
        if (info.title && !input.title) log = { ...log, title: info.title.slice(0, 200) }
      } catch (e) {
        if (signal?.aborted) throw e
        tried.push(`téléchargement normal refusé ou impossible (${short(e)})`)
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    if (!log && input.url) {
      const watch = this.d.watchRange?.() ?? null
      if (!watch) tried.push('lecture par le modèle impossible : Atelier Cloud n’est pas connecté')
      else {
        try {
          log = await readByGemini({ url: input.url, title, durationS: input.durationS ?? null, watch, maxUsd: input.maxUsd ?? DEFAULT_WATCH_USD, maxCost: this.d.maxCost ?? (() => 0.05), ...(signal ? { signal } : {}) })
          if (log.shots.length === 0) {
            tried.push(`lecture par le modèle sans résultat (${log.coverage.gaps[0]?.why ?? 'aucun plan'})`)
            log = null
          }
        } catch (e) {
          if (signal?.aborted) throw e
          tried.push(`lecture par le modèle impossible (${short(e)})`)
        }
      }
    }
    if (!log) throw new Error(`Impossible de lire cette vidéo en entier : ${tried.join(' ; ')}.`)
    await this.cache.put(key, log)
    return { log, cached: false, line: coverageLine(log.coverage, log.stats.shots), tried }
  }
}
