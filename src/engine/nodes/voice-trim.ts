// `voice.trim` (docs/specs/pipeline-avatar.md §2.3, ENGINE-SPEC R19.5): every pause longer than `maxPauseS` is shortened
// to `maxPauseS` so the narration flows, BEFORE any word is timed (every later time is real). A cut only ever removes the
// middle of a silence: half of the kept pause stays after the last word and half before the next one, so no word is cut.
// Cuts sit on a 10 ms grid and the audio is cut in 10 ms frames, so the times of the provider's words move by exactly
// the length removed before them.
import path from 'node:path'
import type { MediaService, TimedWord } from '../services'
import { energyEnvelope, probe, speechRegions, type SpeechRegion } from '../media/probe'

/** The default longest pause (0.6 s: one breath kept, dead air removed; measure of pipeline-avatar §2.3). */
export const MAX_PAUSE_S = 0.6
/** The cut grid and the frame the audio is cut in. */
const GRID_S = 0.01
const RATE = 48_000

/** One removed span `[start, end)`, seconds on the untrimmed clock. */
export interface Cut {
  start: number
  end: number
}

const onGrid = (x: number): number => Math.round(x / GRID_S) * GRID_S

/** A burst this short, alone between two silences at least `SLIVER_GAP_S` long, is a click or a false start, never a word. */
export const SLIVER_S = 0.08
export const SLIVER_GAP_S = 0.15

/**
 * The slivers of a voice (qualite-montage: the Markets clone's « None » at 1:52 began with 50 ms of the word, a quarter second of nothing,
 * then the word): a speech region of at most `SLIVER_S` with a silence of `SLIVER_GAP_S` or more on both sides. Pure.
 */
export function slivers(regions: readonly SpeechRegion[]): SpeechRegion[] {
  return regions.filter((r, i) => {
    const prev = regions[i - 1]
    const next = regions[i + 1]
    return r.end - r.start <= SLIVER_S + 1e-9 && prev !== undefined && next !== undefined && r.start - prev.end >= SLIVER_GAP_S && next.start - r.end >= SLIVER_GAP_S
  })
}

/** The spans to remove so that no pause between two speech regions is longer than `maxPauseS`, slivers included in them. Pure. */
export function pauseCuts(all: readonly SpeechRegion[], maxPauseS: number): Cut[] {
  const gone = new Set(slivers(all))
  const regions = all.filter((r) => !gone.has(r))
  const cuts: Cut[] = []
  const half = maxPauseS / 2
  for (let i = 1; i < regions.length; i++) {
    const prev = regions[i - 1] as SpeechRegion
    const next = regions[i] as SpeechRegion
    // a cut starts after the kept half-pause (rounded up) and ends before the other half (rounded down): never into a word
    const start = Math.ceil((prev.end + half) / GRID_S - 1e-6) * GRID_S
    const end = Math.floor((next.start - half) / GRID_S + 1e-6) * GRID_S
    if (end - start >= GRID_S - 1e-9) cuts.push({ start: +onGrid(start).toFixed(2), end: +onGrid(end).toFixed(2) })
  }
  // a sliver the pause's cut does not cover goes on its own (a few frames on each side with it), then overlapping cuts are joined
  for (const r of gone) {
    if (cuts.some((c) => c.start <= r.start && c.end >= r.end)) continue
    cuts.push({ start: +onGrid(Math.floor((r.start - 0.02) / GRID_S + 1e-6) * GRID_S).toFixed(2), end: +onGrid(Math.ceil((r.end + 0.02) / GRID_S - 1e-6) * GRID_S).toFixed(2) })
  }
  cuts.sort((a, b) => a.start - b.start)
  const joined: Cut[] = []
  for (const c of cuts) {
    const last = joined.at(-1)
    if (last && c.start <= last.end + 1e-9) last.end = Math.max(last.end, c.end)
    else joined.push({ ...c })
  }
  return joined
}

/** A time of the untrimmed audio on the trimmed clock (a time inside a cut lands on the cut's edge). */
export function mapTime(t: number, cuts: readonly Cut[]): number {
  let removed = 0
  for (const c of cuts) {
    if (t <= c.start) break
    removed += Math.min(t, c.end) - c.start
  }
  return +(t - removed).toFixed(4)
}

/** Provider word times moved onto the trimmed clock. */
export function mapWords(words: readonly TimedWord[], cuts: readonly Cut[]): TimedWord[] {
  if (cuts.length === 0) return [...words]
  return words.map((w) => ({ word: w.word, start: mapTime(w.start, cuts), end: mapTime(w.end, cuts) }))
}

/** Cuts per `aselect`: ffmpeg's expression parser refuses a sum of more than about 90 terms (a 13-minute voice has hundreds). */
const CUTS_PER_SELECT = 40

/** The ffmpeg filter that removes `cuts` (10 ms frames, so each cut removes exactly its length). */
export function trimFilter(cuts: readonly Cut[]): string {
  // `between` is inclusive and a frame's `t` is a float (n × 0.01 can land just under `start`): both bounds sit half a
  // frame before the grid line, so exactly the frames from `start` up to the one before `end` go, on a cut of any length
  const between = cuts.map((c) => `between(t,${(c.start - GRID_S / 2).toFixed(3)},${(c.end - GRID_S / 2).toFixed(3)})`)
  // one `aselect` per group of cuts: a selected frame keeps its time, so every group reads the untrimmed clock; `asetpts`
  // renumbers once at the end
  const selects: string[] = []
  for (let i = 0; i < between.length; i += CUTS_PER_SELECT) selects.push(`aselect='not(${between.slice(i, i + CUTS_PER_SELECT).join('+')})'`)
  return `aresample=${RATE},asetnsamples=n=${Math.round(RATE * GRID_S)}:p=0,${selects.join(',')},asetpts=N/SR/TB`
}

export interface TrimResult {
  /** The trimmed file (the input itself when nothing was cut). */
  file: string
  cuts: Cut[]
  /** Seconds removed. */
  removedS: number
}

/** Shortens the long pauses of `input` into `dir/trimmed.flac`; returns the cuts so word times can follow. */
export async function trimPauses(media: MediaService, input: string, dir: string, maxPauseS: number, signal: AbortSignal): Promise<TrimResult> {
  const regions = speechRegions(await energyEnvelope(media, input, signal))
  const cuts = pauseCuts(regions, maxPauseS)
  if (cuts.length === 0) return { file: input, cuts, removedS: 0 }
  const out = path.join(dir, 'trimmed.flac')
  await media.run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', trimFilter(cuts), '-ac', '1', '-c:a', 'flac', out], { signal })
  const removedS = +cuts.reduce((s, c) => s + c.end - c.start, 0).toFixed(3)
  // the file must be shorter by what was cut (to a frame): otherwise the provider times would be wrong
  const before = (await probe(media, input, signal)).durationS
  const after = (await probe(media, out, signal)).durationS
  if (Math.abs(before - removedS - after) > 0.05) throw new Error(`voice.trim: expected ${(before - removedS).toFixed(3)} s, got ${after.toFixed(3)} s`)
  return { file: out, cuts, removedS }
}
