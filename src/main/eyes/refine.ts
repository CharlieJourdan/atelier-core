// The eyes' counted measures (issue #93). Gemini reads a video well but guesses numbers: « Le Monde en POV » came back at 135 words a
// minute and 4.5 s shots when the truth was 219 and 2.7 s. After the Cloud's reading, this step downloads the watched minutes at low
// quality (yt-dlp, read-only, no login) and COUNTS: cuts by real scene detection and words by faster-whisper on the audio (when it is
// installed) or the video's own captions (src/engine/sourcing/measure-video.ts). The counted numbers replace the model's guess; when
// the video cannot be fetched (YouTube blocks some networks) or ffmpeg is missing, the model's numbers stand and nothing fails.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { measureFile, wordsFromJson3, type LocalMeasures, type TimedWord } from '../../engine/sourcing/measure-video'
import { spawnRun } from '../../engine/sourcing/providers/ytdlp'
import type { RunFn } from '../../engine/sourcing/types'
import type { WholeVideoLog } from '../../shared/shot-log'
import type { AnalysisResult } from '../../shared/video-analysis'

/** The analysis with its guessed shot length, cut rate and speech rate replaced by the counted ones. Pure. */
export function applyLocalMeasures(a: AnalysisResult, m: LocalMeasures): AnalysisResult {
  if (!m.shots && !m.speech) return a
  const out: AnalysisResult = { ...a, pacing: { ...a.pacing } }
  if (m.shots) {
    out.pacing = {
      cutsPerMinute: m.shots.cutsPerMinute,
      tempo: m.shots.tempo,
      notes: `${a.pacing.notes} (Mesuré : ${m.shots.shots} plans, ${m.shots.meanS} s en moyenne.)`.trim()
    }
  }
  if (a.measures) {
    out.measures = {
      ...a.measures,
      ...(m.shots ? { shotS: Math.max(0.1, m.shots.meanS) } : {}),
      ...(m.speech ? { wordsPerMinute: m.speech.wordsPerMinute } : {})
    }
  }
  return out
}

/** The analysis with the counted numbers of the whole log: mean shot, cut rate, speech rate (the model's guesses replaced). */
export function withWholeLog(a: AnalysisResult, log: WholeVideoLog): AnalysisResult {
  if (log.stats.shots < 2) return a
  const out: AnalysisResult = { ...a, pacing: { ...a.pacing, cutsPerMinute: log.stats.cutsPerMinute, notes: `${a.pacing.notes} (Vidéo entière : ${log.stats.shots} plans, ${log.stats.meanShotS} s en moyenne.)`.trim() } }
  if (a.measures) out.measures = { ...a.measures, shotS: Math.max(0.1, log.stats.meanShotS), ...(log.stats.wordsPerMinute ? { wordsPerMinute: log.stats.wordsPerMinute } : {}) }
  return out
}

/** yt-dlp arguments: the first `seconds` of the video at low quality, and its captions as json3. Read-only: no cookies, no login. */
export function fetchArgs(url: string, dir: string, seconds: number): string[] {
  return [
    '--ignore-config', '--no-warnings', '--no-playlist', '--socket-timeout', '20',
    // the picture AND the sound: whisper needs the audio track (issue #101: `bestvideo` alone carried none)
    '-f', 'bv*[height<=360]+ba/b[height<=360]/bv*[height<=480]+ba/worst',
    '--merge-output-format', 'mp4',
    '--download-sections', `*0-${Math.ceil(seconds)}`,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'all,-live_chat', '--sub-format', 'json3',
    '-o', path.join(dir, 'v.%(ext)s'),
    '--', url
  ]
}

export type Refiner = (url: string, minutes: number, signal: AbortSignal) => Promise<LocalMeasures | null>

export interface RefinerOptions {
  run?: RunFn
  /** Where the temporary files go (a fresh folder inside is made and removed). */
  tmpDir?: string
}

/** The refiner of the app: fetch, count, clean up. Null (never an error) when it cannot. */
export function localRefiner(o: RefinerOptions = {}): Refiner {
  const run = o.run ?? spawnRun
  return async (url, minutes, signal) => {
    const dir = await mkdtemp(path.join(o.tmpDir ?? os.tmpdir(), 'atelier-count-'))
    try {
      const seconds = Math.round(minutes * 60)
      await run('yt-dlp', fetchArgs(url, dir, seconds), { signal, timeoutMs: 300_000 })
      const files = await readdir(dir)
      const video = files.find((f) => /^v\.(mp4|mkv|webm|mov)$/.test(f))
      if (!video) return null
      const file = path.join(dir, video)
      // the captions of the video's own language: the auto ones carry a time for every word
      const caps = files.filter((f) => f.endsWith('.json3')).sort((x, y) => Number(/orig/.test(y)) - Number(/orig/.test(x)))
      let words: TimedWord[] = []
      for (const c of caps) {
        words = wordsFromJson3(await readFile(path.join(dir, c), 'utf8')).filter((w) => w.atS <= seconds)
        if (words.length >= 20) break
      }
      const audio = path.join(dir, 'a.wav')
      await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-y', audio], { signal, timeoutMs: 120_000 }).catch(() => undefined)
      return await measureFile(file, run, { captionWords: words, signal, audioFile: audio })
    } catch (e) {
      if (signal.aborted) throw e
      return null
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
