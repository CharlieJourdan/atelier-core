// P2 framing measure (moteur-briques): black bars the reference keeps on its frames (a « cinema » letterbox, 2.39:1 inside a
// 16:9 video). One ffmpeg `cropdetect` pass over the 0.5 s frames P2 already draws gives, per frame, the rows that are not black;
// a frame is barred when both bars are there, about equal, and the picture between them is not itself black. Measured, never
// guessed: the active aspect is the median over the barred frames, with the share of readable frames that carry the bars.
import path from 'node:path'
import type { RunFn } from '../../../../engine/sourcing/types'

export interface FrameBars {
  width: number
  height: number
  /** Black rows above and below the picture (pixels). */
  top: number
  bottom: number
}

export interface LetterboxMeasure {
  /** Width ÷ height of the picture between the bars (2.39 for a cinema scope inside 16:9). */
  aspect: number
  /** Each bar's height as a share of the frame height. */
  barShare: number
  /** Share of the readable (not black) frames that carry the bars. */
  frameShare: number
  /** Readable frames measured. */
  frames: number
}

/** A bar thinner than this share of the height is compression noise or a thin border, not a letterbox. */
const MIN_BAR = 0.04
/** The two bars may differ by this share of the height (centred letterbox). */
const BAR_TOLERANCE = 0.03
/** A picture under this share of the height between the « bars » is a black or nearly black frame (a fade), not a letterbox. */
const MIN_PICTURE = 0.3

export const cropdetectArgs = (framesDir: string): string[] => [
  '-hide_banner', '-v', 'info', '-i', path.join(framesDir, 'f_%05d.jpg'), '-vf', 'cropdetect=limit=24:round=2:reset=1:skip=0', '-f', 'null', '-'
]

/** The bars of every frame cropdetect printed (its x1/x2/y1/y2 lines), in frame order. Pure. */
export function parseCropdetect(stderr: string, width: number, height: number): FrameBars[] {
  const out: FrameBars[] = []
  for (const m of stderr.matchAll(/cropdetect[^\n]*?y1:(-?\d+)\s+y2:(-?\d+)/g)) {
    const y1 = Number(m[1])
    const y2 = Number(m[2])
    // a black frame: cropdetect finds no row above the limit (y2 < y1); the whole height is « bar »
    if (!(y2 >= y1)) out.push({ width, height, top: height, bottom: 0 })
    else out.push({ width, height, top: Math.max(0, y1), bottom: Math.max(0, height - 1 - y2) })
  }
  return out
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

/** The letterbox the frames keep, or null when fewer than `minShare` of the readable frames have it (or none is readable). */
export function letterboxOf(frames: readonly FrameBars[], minShare = 0.5): LetterboxMeasure | null {
  const readable = frames.filter((f) => f.height - f.top - f.bottom >= MIN_PICTURE * f.height)
  if (readable.length === 0) return null
  const barred = readable.filter((f) => f.top >= MIN_BAR * f.height && f.bottom >= MIN_BAR * f.height && Math.abs(f.top - f.bottom) <= BAR_TOLERANCE * f.height)
  const frameShare = barred.length / readable.length
  if (barred.length === 0 || frameShare < minShare) return null
  const pictureH = median(barred.map((f) => f.height - f.top - f.bottom))
  const f0 = barred[0] as FrameBars
  return {
    aspect: Math.round((f0.width / pictureH) * 100) / 100,
    barShare: Math.round(((f0.height - pictureH) / 2 / f0.height) * 1000) / 1000,
    frameShare: Math.round(frameShare * 1000) / 1000,
    frames: readable.length
  }
}

/** Runs cropdetect over the 0.5 s frames of a video (`f_%05d.jpg`, `width`×`height`) and measures its letterbox. */
export async function measureLetterbox(run: RunFn, framesDir: string, width: number, height: number, signal?: AbortSignal): Promise<LetterboxMeasure | null> {
  const r = await run('ffmpeg', cropdetectArgs(framesDir), { timeoutMs: 600_000, ...(signal ? { signal } : {}) })
  return letterboxOf(parseCropdetect(`${r.stderr}\n${r.stdout}`, width, height))
}
