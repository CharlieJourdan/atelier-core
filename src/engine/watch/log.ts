// The pure arithmetic of « watch a whole video »: shots from counted cuts, the words under each shot, the cadence curve, the hook broken
// down shot by shot, the stats, and the assembled log (src/shared/shot-log.ts). No program, no model, no network here.
import type { CadencePoint, Coverage, HookBreakdown, LogShot, WatchCost, WholeVideoLog } from '../../shared/shot-log.ts'

export interface TimedWord {
  atS: number
  word: string
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Bare shots (no label yet) from cut times over a duration. */
export function shotsFromCuts(cuts: readonly number[], durationS: number): LogShot[] {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < durationS), durationS]
  const out: LogShot[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const startS = edges[i] as number
    const endS = edges[i + 1] as number
    if (endS - startS <= 0) continue
    out.push({ n: out.length + 1, startS: r2(startS), endS: r2(endS), lengthS: r2(endS - startS), kind: 'other', shows: '', onScreenText: '', words: '', illustrates: null, camera: 'unknown' })
  }
  return out
}

/** The words spoken in [fromS, toS). */
export function wordsIn(words: readonly TimedWord[], fromS: number, toS: number): string {
  return words
    .filter((w) => w.atS >= fromS && w.atS < toS)
    .map((w) => w.word.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    // whisper's French tokens: « n 'avaient », « l 'argent »
    .replace(/(\w) '(\w)/g, "$1'$2")
}

/** Each shot gets the words said under it (cut to the schema's length). */
export function attachWords(shots: readonly LogShot[], words: readonly TimedWord[]): LogShot[] {
  return shots.map((s) => ({ ...s, words: wordsIn(words, s.startS, s.endS).slice(0, 600) }))
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

/** Words a minute over [fromS, toS): words counted there over the spoken time (pauses over 2 s left out). */
export function wordsPerMinute(words: readonly TimedWord[], fromS = 0, toS = Infinity): number | null {
  const ws = words.filter((w) => w.atS >= fromS && w.atS < toS)
  if (ws.length < 5) return null
  let speaking = 0
  for (let i = 1; i < ws.length; i++) {
    const gap = (ws[i] as TimedWord).atS - (ws[i - 1] as TimedWord).atS
    if (gap <= 2) speaking += gap
  }
  return speaking > 0 ? Math.round((ws.length / speaking) * 60) : null
}

/** The window of the cadence curve: 10 s for a Short (≤ 3 min), 30 s up to 15 min, 60 s beyond. */
export const cadenceWindowS = (durationS: number): number => (durationS <= 180 ? 10 : durationS <= 900 ? 30 : 60)

/** Shots starting in each window, their mean length, and the speech rate there: the curve, not the average. */
export function cadenceCurve(shots: readonly LogShot[], words: readonly TimedWord[], durationS: number, windowS = cadenceWindowS(durationS)): CadencePoint[] {
  const out: CadencePoint[] = []
  for (let from = 0; from < durationS; from += windowS) {
    const to = Math.min(durationS, from + windowS)
    const inside = shots.filter((s) => s.startS >= from && s.startS < to)
    out.push({ fromS: from, toS: r1(to), shots: inside.length, meanShotS: inside.length ? r2(inside.reduce((a, s) => a + s.lengthS, 0) / inside.length) : 0, wordsPerMinute: wordsPerMinute(words, from, to) })
  }
  return out
}

/** The end of the hook: the end of the first sentence that closes after `minS` (words carry their punctuation), else `fallbackS`. */
export function hookEnd(words: readonly TimedWord[], durationS: number, o: { minS?: number; maxS?: number } = {}): number {
  const minS = o.minS ?? (durationS <= 180 ? 1.5 : 15)
  const maxS = Math.min(durationS, o.maxS ?? (durationS <= 180 ? 15 : 60))
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as TimedWord
    if (w.atS < minS) continue
    if (w.atS > maxS) break
    if (/[.!?…]["»”']?$/.test(w.word.trim())) return r2(Math.min(maxS, (words[i + 1]?.atS ?? w.atS + 0.4)))
  }
  return r2(Math.min(maxS, durationS <= 180 ? 5 : 30))
}

export function hookBreakdown(shots: readonly LogShot[], words: readonly TimedWord[], endS: number, wholeMeanS: number): HookBreakdown {
  const inside = shots.filter((s) => s.startS < endS)
  const mean = inside.length ? inside.reduce((a, s) => a + Math.min(s.endS, endS) - s.startS, 0) / inside.length : 0
  return {
    endS,
    shots: inside,
    firstCutS: shots.length > 1 ? (shots[0] as LogShot).endS : null,
    meanShotS: r2(mean),
    paceVsBody: wholeMeanS > 0 && mean > 0 ? r2(mean / wholeMeanS) : null,
    words: wordsIn(words, 0, endS).slice(0, 1500)
  }
}

export interface AssembleInput {
  url: string
  title: string
  durationS: number
  shots: LogShot[]
  words: readonly TimedWord[]
  coverage: Omit<Coverage, 'durationS'>
  cost: Omit<WatchCost, 'usdPerMinute' | 'secondsPerMinute'>
  /** Shots scene detection found before merges. */
  detectedShots?: number
  now?: Date
}

/** The whole log: numbered shots, hook, cadence, stats, cost per minute of video. */
export function assembleLog(i: AssembleInput): WholeVideoLog {
  const shots = i.shots.map((s, k) => ({ ...s, n: k + 1, lengthS: r2(s.endS - s.startS) }))
  const lengths = shots.map((s) => s.lengthS)
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const readS = Math.max(1, i.coverage.readS)
  const kinds: Record<string, number> = {}
  for (const s of shots) kinds[s.kind] = (kinds[s.kind] ?? 0) + s.lengthS / readS
  for (const k of Object.keys(kinds)) kinds[k] = r2(kinds[k] as number)
  const minutes = Math.max(1 / 60, i.durationS / 60)
  return {
    version: 1,
    url: i.url,
    title: i.title,
    coverage: { ...i.coverage, durationS: r2(i.durationS) },
    shots,
    hook: hookBreakdown(shots, i.words, hookEnd(i.words, i.durationS), mean),
    cadence: cadenceCurve(shots, i.words, i.durationS),
    stats: {
      ...(i.detectedShots !== undefined ? { detectedShots: i.detectedShots } : {}),
      shots: shots.length,
      meanShotS: r2(mean),
      medianShotS: r2(median(lengths)),
      cutsPerMinute: r2((Math.max(0, shots.length - 1) / readS) * 60),
      wordsPerMinute: wordsPerMinute(i.words),
      kinds
    },
    cost: { ...i.cost, usdPerMinute: Math.round((i.cost.usd / minutes) * 10_000) / 10_000, secondsPerMinute: r1(i.cost.ms / 1000 / minutes) },
    readAt: (i.now ?? new Date()).toISOString()
  }
}
