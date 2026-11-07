// Reads a LOCAL video file from start to end (a file the user supplied, or one the platform served by a normal download): shots by
// scene detection, the words under each shot (faster-whisper when installed, else the video's own captions), contact sheets with two
// frames per shot and a dense hook sheet, labels by a vision model in a few batched calls, then the assembled log. Programs run
// through the injectable `run`, the model through the `Labeller` port: the tests start neither.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Coverage, WatchMethod, WholeVideoLog } from '../../shared/shot-log.ts'
import { detectCuts, probeDuration, whisperWords } from '../sourcing/measure-video.ts'
import type { RunFn } from '../sourcing/types.ts'
import { applyLabels, hookPrompt, labelPrompt, mergeContinued, parseHook, parseLabels, SHEETS_PER_CALL, type Labeller } from './label.ts'

/** Model calls run at once (the CLI is slow per call; three keep a subscription's rate fine). */
export const LABEL_CONCURRENCY = 3
import { assembleLog, attachWords, hookEnd, shotsFromCuts, type TimedWord } from './log.ts'
import { buildSheets, framesArgs, hookLayoutFor, layoutFor, type Sheet } from './sheets.ts'

export interface LocalReadOptions {
  url: string
  title: string
  method: Extract<WatchMethod, 'local-file' | 'download'>
  run: RunFn
  /** Names what it sees; absent: the log has counted times and words but no labels (said in `coverage.missing`). */
  labeller?: Labeller
  /** The video's own captions (word times), used when whisper is not installed. */
  captionWords?: TimedWord[]
  /** The python that has faster-whisper (default `python`); `false` skips whisper. */
  python?: string | false
  whisperModel?: string
  language?: string
  tmpDir?: string
  signal?: AbortSignal
  now?: () => Date
}

/** Is the picture taller than wide (a Short)? */
async function isVertical(file: string, run: RunFn): Promise<boolean> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeoutMs: 30_000 })
    const [w, h] = stdout.trim().split(',').map(Number)
    return Number(h) > Number(w)
  } catch {
    return false
  }
}

export async function readLocalVideo(file: string, o: LocalReadOptions): Promise<WholeVideoLog> {
  const started = Date.now()
  const run = o.run
  const sig = o.signal ? { signal: o.signal } : {}
  const durationS = await probeDuration(file, run)
  if (!durationS) throw new Error('the video file cannot be read (ffprobe found no duration)')
  const vertical = await isVertical(file, run)
  const dir = await mkdtemp(path.join(o.tmpDir ?? os.tmpdir(), 'atelier-watch-'))
  const missing: string[] = []
  const labelGaps: { fromS: number; toS: number; why: string }[] = []
  try {
    const cuts = await detectCuts(file, run, sig)
    let shots = shotsFromCuts(cuts, durationS)
    const detectedShots = shots.length

    let words: TimedWord[] = []
    let wordsFrom: Coverage['wordsFrom'] = 'none'
    if (o.python !== false) {
      const audio = path.join(dir, 'a.wav')
      const ok = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-y', audio], { timeoutMs: 300_000, ...sig }).then(() => true, () => false)
      const heard = ok ? await whisperWords(audio, run, { ...(o.python ? { python: o.python } : {}), model: o.whisperModel ?? 'base', ...sig }) : null
      if (heard) {
        words = heard
        wordsFrom = 'whisper'
      }
    }
    if (wordsFrom === 'none' && o.captionWords && o.captionWords.length > 0) {
      words = o.captionWords
      wordsFrom = 'captions'
    }
    if (wordsFrom === 'none') missing.push('words')
    shots = attachWords(shots, words)

    let inputTokens = 0
    let outputTokens = 0
    let usd = 0
    let subscription = true
    let hookNotes: { firstImage: string; notes: string } | null = null
    if (o.labeller) {
      await run('ffmpeg', framesArgs(file, dir, vertical), { timeoutMs: 900_000, ...sig })
      const count = (await readdir(dir)).filter((f) => /^f_\d{5}\.jpg$/.test(f)).length
      // the hook sheet shows at least the first 10 s of a Short and 30 s of a long video, whatever the first sentence
      const { shotSheets, hookSheet } = await buildSheets(dir, shots, count, run, { vertical, hookEndS: Math.max(hookEnd(words, durationS), durationS <= 180 ? 10 : 30), ...sig })
      const cols = layoutFor(vertical).cols
      const unlabelledShots = new Set<number>()
      const batches: Sheet[][] = []
      for (let i = 0; i < shotSheets.length; i += SHEETS_PER_CALL) batches.push(shotSheets.slice(i, i + SHEETS_PER_CALL))
      const cont = new Set<number>()
      const labelled = shots
      let next = 0
      const worker = async (): Promise<void> => {
        while (next < batches.length) {
          const batch = batches[next++] as Sheet[]
          try {
            const a = await (o.labeller as Labeller)({ prompt: labelPrompt(batch, labelled, { cols, ...(o.language ? { language: o.language } : {}) }), images: batch.map((b) => b.file), ...sig })
            inputTokens += a.inputTokens
            outputTokens += a.outputTokens
            usd += a.usd
            subscription &&= a.subscription
            const labels = parseLabels(a.text)
            for (const n of batch.flatMap((b) => b.shots)) if (!labels.has(n)) unlabelledShots.add(n)
            for (const [n, l] of labels) if (l.cont) cont.add(n)
            shots = applyLabels(shots, labels)
          } catch (e) {
            if (o.signal?.aborted) throw e
            for (const n of batch.flatMap((b) => b.shots)) unlabelledShots.add(n)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(LABEL_CONCURRENCY, batches.length) }, worker))
      if (unlabelledShots.size > 0) {
        missing.push(`labels of ${unlabelledShots.size} shots`)
        // a shot whose vision batch failed keeps kind `other`: its time is a gap of the reading, never « read in full »
        labelGaps.push(...unlabelledGaps(shots, unlabelledShots))
      }
      shots = mergeContinued(shots, cont)
      if (hookSheet?.times) {
        try {
          const a = await o.labeller({ prompt: hookPrompt(hookSheet.times, words.filter((w) => w.atS < hookSheet.times!.length / 2).map((w) => w.word).join(' '), hookLayoutFor(vertical).cols), images: [hookSheet.file], ...sig })
          inputTokens += a.inputTokens
          outputTokens += a.outputTokens
          usd += a.usd
          hookNotes = parseHook(a.text)
        } catch (e) {
          if (o.signal?.aborted) throw e
          missing.push('hook notes')
        }
      }
    } else missing.push('labels (no vision model)')

    const log = assembleLog({
      url: o.url,
      title: o.title,
      durationS,
      shots,
      words,
      detectedShots,
      coverage: { method: o.method, readS: durationS, complete: labelGaps.length === 0, gaps: labelGaps, cutsFrom: 'scene-detection', wordsFrom, missing },
      cost: { usd, subscription, inputTokens, outputTokens, ms: Date.now() - started },
      ...(o.now ? { now: o.now() } : {})
    })
    return hookNotes ? { ...log, hook: { ...log.hook, ...hookNotes } } : log
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The time ranges of the shots no label came back for (adjacent ones joined): the reading's gaps. */
export function unlabelledGaps(shots: readonly { n: number; startS: number; endS: number }[], unlabelled: ReadonlySet<number>): Coverage['gaps'] {
  const gaps: Coverage['gaps'] = []
  for (const s of [...shots].sort((a, b) => a.startS - b.startS)) {
    if (!unlabelled.has(s.n)) continue
    const last = gaps[gaps.length - 1]
    if (last && Math.abs(last.toS - s.startS) < 1e-6) last.toS = s.endS
    else gaps.push({ fromS: s.startS, toS: s.endS, why: 'plans non étiquetés (le modèle de vision n’a pas répondu)' })
  }
  return gaps
}
