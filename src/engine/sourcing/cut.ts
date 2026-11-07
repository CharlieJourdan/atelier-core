// Cutting a chosen shot out of a downloaded excerpt: where to cut, and how. The shot log's times are approximate (they round to the
// second), so the excerpt is downloaded with a margin, real scene changes are detected in it (ffmpeg's scene score), and the cut keeps the
// longest cut-free run that overlaps the claimed shot, so a clip never starts or ends on the previous or next shot. Capped in length;
// a short clip is slowed a little; the picture is cropped to 16:9 and, when a corner logo was flagged, zoomed away from it (never past 1.45×).
// All pure arithmetic except the two ffmpeg calls, which take an injectable `run`.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { RunFn } from './types.ts'

export const CUT_MARGIN_S = 1.2
export const CUT_MIN_RUN_S = 2.2
export const CUT_MAX_S = 7
export const CUT_SLOW_BELOW_S = 4
export const CUT_SLOW_FACTOR = 0.89
export const CUT_MAX_ZOOM = 1.45
/** A frame this far from the cut is not on the cut (the cut frame itself belongs to the next shot). */
const CUT_INSET_S = 0.08

export interface CutRequest {
  /** The shot as the log claims it, on the source's clock. */
  shotStartS: number
  shotEndS: number
  /** Scene changes found in the downloaded window, on the source's clock, ascending. */
  cuts: readonly number[]
  /** The window that was downloaded (default: the shot ± the margin). */
  windowStartS?: number
  windowEndS?: number
}

export interface CutPlan {
  startS: number
  endS: number
  durationS: number
  /** < 1 plays slower (a short clip is stretched to feel less rushed). */
  speed: number
  /** The duration the clip lasts once the speed is applied. */
  outputS: number
}

export const downloadWindow = (shotStartS: number, shotEndS: number): { startS: number; endS: number } => ({ startS: Math.max(0, shotStartS - CUT_MARGIN_S), endS: shotEndS + CUT_MARGIN_S })

/** The longest cut-free run that overlaps the claimed shot, inside the window; null when no run reaches CUT_MIN_RUN_S. */
export function planCut(r: CutRequest): CutPlan | null {
  const win = downloadWindow(r.shotStartS, r.shotEndS)
  const wStart = r.windowStartS ?? win.startS
  const wEnd = r.windowEndS ?? win.endS
  const bounds = [wStart, ...r.cuts.filter((c) => c > wStart + CUT_INSET_S && c < wEnd - CUT_INSET_S), wEnd]
  let best: { startS: number; endS: number; overlap: number } | null = null
  for (let i = 0; i + 1 < bounds.length; i++) {
    // a run begins just after the cut that opens it and stops just before the next one
    const a = bounds[i]! + (i === 0 ? 0 : CUT_INSET_S)
    const b = bounds[i + 1]! - (i + 2 === bounds.length ? 0 : CUT_INSET_S)
    const overlap = Math.min(b, r.shotEndS) - Math.max(a, r.shotStartS)
    if (b - a < CUT_MIN_RUN_S || overlap <= 0) continue
    // the part of the run inside the claimed shot; when that is too short, grown inside the run (end first, then start)
    let from = Math.max(a, r.shotStartS)
    let to = Math.min(b, r.shotEndS)
    if (to - from < CUT_MIN_RUN_S) {
      to = Math.min(b, from + CUT_MIN_RUN_S)
      from = Math.max(a, to - CUT_MIN_RUN_S)
    }
    if (!best || overlap > best.overlap + 1e-6 || (Math.abs(overlap - best.overlap) < 1e-6 && to - from > best.endS - best.startS)) best = { startS: from, endS: to, overlap }
  }
  if (!best) return null
  const durationS = Math.min(CUT_MAX_S, best.endS - best.startS)
  const speed = durationS < CUT_SLOW_BELOW_S ? CUT_SLOW_FACTOR : 1
  const r1 = (n: number): number => Math.round(n * 100) / 100
  return { startS: r1(best.startS), endS: r1(best.startS + durationS), durationS: r1(durationS), speed, outputS: r1(durationS / speed) }
}

/** Scene-change times of a file: ffmpeg's `scene` score above the threshold (0.3 finds real cuts and ignores camera motion). */
export async function detectSceneCuts(file: string, run: RunFn, threshold = 0.3): Promise<number[]> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 180_000 })
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite)
}

export type LogoCorner = 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** The crop (in source pixels) that makes a 16:9 picture and, for a flagged corner logo, zooms away from it (anchored on the opposite side). */
export function cropFor(srcW: number, srcH: number, logo: LogoCorner = 'none'): { x: number; y: number; w: number; h: number } {
  // first the largest centred 16:9 rectangle
  let w = srcW
  let h = Math.round((srcW * 9) / 16)
  if (h > srcH) {
    h = srcH
    w = Math.round((srcH * 16) / 9)
  }
  let x = Math.round((srcW - w) / 2)
  let y = Math.round((srcH - h) / 2)
  if (logo === 'none') return { x, y, w, h }
  // a logo takes about 18 % of the width and height of its corner: zoom so that this strip leaves the frame, no more than CUT_MAX_ZOOM
  const z = Math.min(CUT_MAX_ZOOM, 1 / (1 - 0.18))
  const nw = Math.round(w / z)
  const nh = Math.round(h / z)
  x = logo.endsWith('left') ? x + (w - nw) : x
  y = logo.startsWith('top') ? y + (h - nh) : y
  return { x, y, w: nw, h: nh }
}

export interface CutOutput {
  width?: number
  height?: number
  fps?: number
  logo?: LogoCorner
  srcW: number
  srcH: number
}

export function cutArgs(src: string, plan: CutPlan, out: string, o: CutOutput): string[] {
  const c = cropFor(o.srcW, o.srcH, o.logo ?? 'none')
  const w = o.width ?? 1920
  const h = o.height ?? 1080
  const slow = plan.speed < 1 ? `,setpts=PTS/${plan.speed}` : ''
  return ['-y', '-v', 'error', '-ss', String(plan.startS), '-t', String(plan.durationS), '-i', src, '-an', '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${w}:${h}:flags=lanczos${slow},fps=${o.fps ?? 30}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]
}

export async function cutClip(src: string, plan: CutPlan, out: string, o: CutOutput, run: RunFn): Promise<string> {
  await mkdir(path.dirname(out), { recursive: true })
  await run('ffmpeg', cutArgs(src, plan, out, o), { timeoutMs: 300_000 })
  return out
}
