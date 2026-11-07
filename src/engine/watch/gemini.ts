// Reads a PUBLIC video link from start to end with Google's model on Google's side (no download here): the video is cut into ranges
// (Gemini's clipping offsets), the hook range at a denser frame rate, each range answers its shot log (src/engine/sourcing/watch.ts,
// through the Cloud route `POST /v1/media/watch`), and the logs are joined into one. Every range is priced BEFORE it is asked and the
// reading stops at the budget; a range that fails or is not afforded becomes a gap, said in the coverage, never filled by a guess.
import type { Coverage, LogShot } from '../../shared/shot-log.ts'
import type { Shot } from '../sourcing/watch.ts'
import { assembleLog, type TimedWord } from './log.ts'
import type { WholeVideoLog } from '../../shared/shot-log.ts'

/** Seconds per range: short enough for the dense answer to fit its token cap (≈ 60 shots of 4 s). */
export const CHUNK_S = 240
/** The hook range read at `HOOK_FPS` (and a whole Short). */
export const HOOK_S = 60
export const HOOK_FPS = 2
/** Without a known length, the reading goes on while shots reach the end of the range, up to this. */
export const MAX_UNKNOWN_S = 3 * 3600

export interface WatchRangeAnswer {
  shots: Shot[]
  costUsd: number
  ms: number
  inputTokens: number
  outputTokens: number
  /** The dense fields were really asked (an older Cloud does not echo it). */
  dense: boolean
}
export type WatchRangeFn = (r: { url: string; startS: number; endS: number; dense: boolean; fps?: number }, signal?: AbortSignal) => Promise<WatchRangeAnswer>

export interface Range {
  startS: number
  endS: number
  fps?: number
}

/** The ranges of a video of known length: the hook at a denser rate, then CHUNK_S ranges. */
export function planRanges(durationS: number): Range[] {
  const out: Range[] = [{ startS: 0, endS: Math.min(durationS, HOOK_S), fps: HOOK_FPS }]
  for (let s = HOOK_S; s < durationS; s += CHUNK_S) out.push({ startS: s, endS: Math.min(durationS, s + CHUNK_S) })
  return out.map((r) => ({ ...r, startS: Math.floor(r.startS), endS: Math.ceil(r.endS) }))
}

const KIND: Record<string, LogShot['kind']> = {
  'archive-film': 'archive-film',
  newsreel: 'archive-film',
  'photo-still': 'archive-photo',
  'modern-footage': 'stock-footage',
  aerial: 'stock-footage',
  nature: 'stock-footage',
  event: 'stock-footage',
  gameplay: 'gameplay',
  'talking-head': 'presenter',
  interview: 'presenter',
  studio: 'presenter',
  graphic: 'motion-graphic',
  animation: 'motion-graphic',
  'title-card': 'title-card',
  'screen-capture': 'screen-capture'
}
const CAMERAS = new Set<string>(['still', 'push-in', 'pull-out', 'pan', 'tilt', 'tracking', 'handheld', 'animated'])

export function toLogShot(s: Shot): LogShot {
  return {
    n: 0,
    startS: s.startS,
    endS: s.endS,
    lengthS: Math.round((s.endS - s.startS) * 100) / 100,
    kind: KIND[s.kind] ?? 'other',
    shows: s.shows,
    onScreenText: s.onText ?? (s.text === 'none' ? '' : `(${s.text} text)`),
    words: s.says ?? '',
    illustrates: null,
    camera: s.camera && CAMERAS.has(s.camera) ? (s.camera as LogShot['camera']) : 'unknown'
  }
}

/** Joins the shots of consecutive ranges: in order, an overlap trimmed (a shot cut by a range edge stays two shots: said). */
export function joinShots(parts: readonly LogShot[][]): LogShot[] {
  const all = parts.flat().sort((a, b) => a.startS - b.startS)
  const out: LogShot[] = []
  for (const s of all) {
    const prev = out[out.length - 1]
    const startS = prev && s.startS < prev.endS ? prev.endS : s.startS
    if (s.endS - startS < 0.2) continue
    out.push({ ...s, startS, lengthS: Math.round((s.endS - startS) * 100) / 100 })
  }
  return out
}

/** Word times spread evenly over each shot's words (the model gives words per shot, not per word): good for a rate, said as « model ». */
export function wordsFromShots(shots: readonly LogShot[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const s of shots) {
    const ws = s.words.split(/\s+/).filter(Boolean)
    ws.forEach((w, i) => out.push({ atS: s.startS + ((i + 0.5) * (s.endS - s.startS)) / ws.length, word: w }))
  }
  return out
}

export interface GeminiReadOptions {
  url: string
  title: string
  /** The video's length when known (the channel's read gives it); else the reading finds the end. */
  durationS?: number | null
  watch: WatchRangeFn
  /** Dollars the reading may spend; each range is priced first with `maxCost`. */
  maxUsd: number
  maxCost: (r: Range) => number
  signal?: AbortSignal
  now?: () => Date
}

export async function readByGemini(o: GeminiReadOptions): Promise<WholeVideoLog> {
  const started = Date.now()
  const known = o.durationS && o.durationS > 0 ? o.durationS : null
  const ranges = planRanges(known ?? MAX_UNKNOWN_S)
  const parts: LogShot[][] = []
  const gaps: Coverage['gaps'] = []
  let spent = 0
  let inTok = 0
  let outTok = 0
  let readS = 0
  let allDense = true
  let end = known
  for (const r of ranges) {
    if (end !== null && r.startS >= end) break
    const range = end !== null ? { ...r, endS: Math.min(r.endS, Math.ceil(end)) } : r
    const price = o.maxCost(range)
    if (spent + price > o.maxUsd) {
      gaps.push({ fromS: range.startS, toS: end ?? range.endS, why: `budget de ${o.maxUsd} $ atteint` })
      break
    }
    try {
      const a = await o.watch({ url: o.url, startS: range.startS, endS: range.endS, dense: true, ...(range.fps ? { fps: range.fps } : {}) }, o.signal)
      spent += a.costUsd
      inTok += a.inputTokens
      outTok += a.outputTokens
      allDense &&= a.dense
      const shots = a.shots.map(toLogShot)
      parts.push(shots)
      const last = shots[shots.length - 1]?.endS ?? range.startS
      // an unknown length: a range whose shots stop well before its end reached the end of the video
      if (end === null && last < range.endS - 10) end = Math.max(last, range.startS)
      readS += Math.min(range.endS, end ?? range.endS) - range.startS
    } catch (e) {
      if (o.signal?.aborted) throw e
      gaps.push({ fromS: range.startS, toS: range.endS, why: `lecture refusée (${(e as Error).message.slice(0, 120)})` })
      if (end === null) break
    }
  }
  const shots = joinShots(parts)
  const durationS = end ?? shots[shots.length - 1]?.endS ?? 0
  const missing = allDense ? ['illustrates'] : ['verbatim text', 'words', 'camera', 'illustrates']
  return assembleLog({
    url: o.url,
    title: o.title,
    durationS,
    shots,
    words: wordsFromShots(shots),
    coverage: { method: 'gemini-url', readS: Math.min(readS, durationS), complete: gaps.length === 0 && readS >= durationS - 2, gaps, cutsFrom: 'model', wordsFrom: allDense ? 'model' : 'none', missing },
    cost: { usd: spent, subscription: false, inputTokens: inTok, outputTokens: outTok, ms: Date.now() - started },
    ...(o.now ? { now: o.now() } : {})
  })
}
