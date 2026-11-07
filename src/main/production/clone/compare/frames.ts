// P7 — matched frames (spec §2 P7, §3): the reference passage and our render at the SAME moments (the hook densely, each
// part change inside the passage, then evenly), one side-by-side image per pair and one contact sheet per round, all saved
// under the round's folder. Times are on the reference clock; our moment is the same fraction of our render.
import path from 'node:path'
import { MIN_FRAME_PAIRS, type FramePair, type Production, type VideoAnalysis } from '../../../../shared/clone'
import { buildSheet, grabFrame } from '../../../../engine/sourcing/sheet'
import type { RunFn } from '../../../../engine/sourcing/types'
import type { Folder } from '../store'
import { writeSideBySideFilm } from './film'

/** Pairs per comparison: enough to see the hook and every part, never fewer than the contract's minimum. */
export const FRAME_PAIRS = 12
/** The hook (first seconds of the video) gets dense pairs. */
export const HOOK_S = 15

const r1 = (x: number): number => Math.round(x * 10) / 10

/** The matched moments (reference clock) of a passage: two in the hook when the passage holds it, one just after each part
 *  change inside the passage, the rest evenly spread. Sorted, distinct, inside the passage. Pure. */
export function matchedMoments(passage: Production['passage'], analysis: VideoAnalysis | null, count = FRAME_PAIRS): number[] {
  const { fromS, toS } = passage
  const len = toS - fromS
  const n = Math.max(MIN_FRAME_PAIRS, count)
  const picks: number[] = []
  if (fromS < HOOK_S) picks.push(fromS + 1, Math.min(HOOK_S, toS) - 2)
  for (const p of analysis?.parts ?? []) if (p.fromS > fromS + 1 && p.fromS < toS - 1) picks.push(p.fromS + 1)
  const even = n - picks.length
  for (let i = 0; i < even; i++) picks.push(fromS + ((i + 0.5) * len) / Math.max(1, even))
  const sorted = [...new Set(picks.map(r1))].filter((t) => t >= fromS && t <= toS).sort((a, b) => a - b)
  // de-duplicate moments closer than 1 s, then top up evenly if that left too few
  const out: number[] = []
  for (const t of sorted) if (out.length === 0 || t - out[out.length - 1]! >= 1) out.push(t)
  for (let k = 1; out.length < MIN_FRAME_PAIRS && k < 50; k++) {
    const t = r1(fromS + (k * len) / 51)
    if (!out.some((x) => Math.abs(x - t) < 0.5)) out.push(t)
    out.sort((a, b) => a - b)
  }
  return out
}

/** Our render's moment for a reference moment (same fraction of the passage). */
export const oursAt = (atS: number, passage: Production['passage'], renderS: number): number =>
  r1(Math.max(0, Math.min(renderS - 0.1, ((atS - passage.fromS) / Math.max(0.1, passage.toS - passage.fromS)) * renderS)))

/** ffmpeg arguments: two frames side by side (reference left, ours right) at the same height. */
export const sideBySideArgs = (ref: string, ours: string, out: string): string[] =>
  ['-y', '-v', 'error', '-i', ref, '-i', ours, '-filter_complex', '[0:v]scale=-2:360,setsar=1[a];[1:v]scale=-2:360,setsar=1[b];[a][b]hstack=inputs=2[v]', '-map', '[v]', '-frames:v', '1', '-q:v', '3', out]

export interface MatchedFrames { pairs: FramePair[]; contactSheet: string; sideBySideVideo: string | null }

/** Grab the matched frames of both files, the side-by-side images and the round's contact sheet (paths under `dir.rel`). */
/** `referenceFromS`: where the reference file starts on the reference clock (0 for the whole video, `passage.fromS` when the
 *  file is the cut passage). */
export async function matchFrames(o: { referenceFile: string; referenceFromS?: number; oursFile: string; production: Production; analysis: VideoAnalysis | null; dir: Folder; run: RunFn; count?: number }): Promise<MatchedFrames> {
  const { production: pr, dir } = o
  const pairs: FramePair[] = []
  const sheetFiles: string[] = []
  const labels: string[] = []
  for (const [i, atS] of matchedMoments(pr.passage, o.analysis, o.count).entries()) {
    const k = String(i + 1).padStart(2, '0')
    const ref = await grabFrame(o.referenceFile, atS - (o.referenceFromS ?? 0), path.join(dir.abs, `ref-${k}.jpg`), o.run)
    const ours = await grabFrame(o.oursFile, oursAt(atS, pr.passage, pr.durationS), path.join(dir.abs, `ours-${k}.jpg`), o.run)
    await o.run('ffmpeg', sideBySideArgs(ref, ours, path.join(dir.abs, `pair-${k}.jpg`)), { timeoutMs: 60_000 })
    pairs.push({ atS, reference: `${dir.rel}/ref-${k}.jpg`, ours: `${dir.rel}/ours-${k}.jpg`, sideBySide: `${dir.rel}/pair-${k}.jpg` })
    sheetFiles.push(ref, ours)
    labels.push(`reference ${atS}s`, `ours ${atS}s`)
  }
  await buildSheet(sheetFiles, path.join(dir.abs, 'contact-sheet.jpg'), o.run, { cols: 2, cellW: 480, cellH: 270, labels })
  const sideBySideVideo = await writeSideBySideFilm({ referenceFile: o.referenceFile, oursFile: o.oursFile, dir, run: o.run, cut: { fromS: pr.passage.fromS - (o.referenceFromS ?? 0), lengthS: pr.passage.toS - pr.passage.fromS } })
  return { pairs, contactSheet: `${dir.rel}/contact-sheet.jpg`, sideBySideVideo }
}
