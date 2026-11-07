// Contact sheets of a local video for a vision model: ONE ffmpeg pass draws a small frame every 0.5 s of the whole video, then each
// shot gets two cells (a frame early in the shot and one late, so a push-in or a pan shows), and the hook gets a dense sheet (every
// frame of its first seconds). Sheets are tiled by ffmpeg from a concat list; no text is drawn on them (no font dependency): the
// prompt says which cell is which shot. Programs run through the injectable `run` (tests never start one).
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LogShot } from '../../shared/shot-log.ts'
import type { RunFn } from '../sourcing/types.ts'

/** Frames a second drawn for the sheets (0.5 s apart, the method's « frame every 0.5 s around the hook »). */
export const SHEET_FPS = 2

export interface SheetLayout {
  cellW: number
  cellH: number
  cols: number
  rows: number
}
/** 16:9: 240 × 135 cells, 6 × 6 (18 shots a sheet, 1440 × 810). 9:16: 135 × 240 cells, 8 × 3 (12 shots, 1080 × 720). */
export const layoutFor = (vertical: boolean): SheetLayout => (vertical ? { cellW: 136, cellH: 240, cols: 8, rows: 3 } : { cellW: 240, cellH: 136, cols: 6, rows: 6 })
/** The hook's dense sheet: every 0.5 s frame of its start (32 s of a 16:9 video, 24 s of a Short), same cells. */
export const hookLayoutFor = (vertical: boolean): SheetLayout => ({ ...layoutFor(vertical), ...(vertical ? { cols: 12, rows: 4 } : { cols: 8, rows: 8 }) })

/** ffmpeg arguments: every 0.5 s frame of the whole video, small, numbered from 1 (frame k is at (k − 1) / 2 s). */
export const framesArgs = (file: string, dir: string, vertical: boolean): string[] => {
  const l = layoutFor(vertical)
  return ['-hide_banner', '-v', 'error', '-i', file, '-an', '-vf', `fps=${SHEET_FPS},scale=${l.cellW}:${l.cellH}:force_original_aspect_ratio=decrease,pad=${l.cellW}:${l.cellH}:(ow-iw)/2:(oh-ih)/2`, '-q:v', '5', '-y', path.join(dir, 'f_%05d.jpg')]
}

export const frameAt = (t: number, count: number): number => Math.min(count, Math.max(1, Math.floor(t * SHEET_FPS) + 1))
export const frameName = (k: number): string => `f_${String(k).padStart(5, '0')}.jpg`

/** The two frames of a shot: at 25 % and 75 % of it (the same one twice for a very short shot). */
export function shotFrames(s: Pick<LogShot, 'startS' | 'endS'>, count: number): [number, number] {
  const len = s.endS - s.startS
  return [frameAt(s.startS + len * 0.25, count), frameAt(s.startS + len * 0.75, count)]
}

/** Shots per sheet for a layout (two cells each). */
export const shotsPerSheet = (l: SheetLayout): number => Math.floor((l.cols * l.rows) / 2)

/** ffmpeg arguments tiling the frames of a concat list into one sheet. */
export const tileArgs = (list: string, out: string, l: SheetLayout): string[] => ['-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${l.cols}x${l.rows}:color=black`, '-frames:v', '1', '-q:v', '4', '-y', out]

const concatList = (dir: string, frames: readonly number[]): string => frames.map((k) => `file '${path.join(dir, frameName(k)).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration 0.04`).join('\n') + '\n'

export interface Sheet {
  file: string
  /** The shots it holds, in cell order (two cells each); empty for the hook sheet. */
  shots: number[]
  /** The hook sheet: its frames' times, in cell order. */
  times?: number[]
}

/** Builds the shot sheets and the hook sheet from frames already drawn in `dir` (`count` of them). */
export async function buildSheets(dir: string, shots: readonly LogShot[], count: number, run: RunFn, o: { vertical: boolean; hookEndS: number; signal?: AbortSignal }): Promise<{ shotSheets: Sheet[]; hookSheet: Sheet | null }> {
  const l = layoutFor(o.vertical)
  const per = shotsPerSheet(l)
  const shotSheets: Sheet[] = []
  for (let i = 0; i < shots.length; i += per) {
    const part = shots.slice(i, i + per)
    const frames = part.flatMap((s) => shotFrames(s, count))
    const list = path.join(dir, `sheet_${shotSheets.length + 1}.txt`)
    await writeFile(list, concatList(dir, frames), 'utf8')
    const file = path.join(dir, `sheet_${String(shotSheets.length + 1).padStart(3, '0')}.jpg`)
    await run('ffmpeg', tileArgs(list, file, l), { timeoutMs: 60_000, ...(o.signal ? { signal: o.signal } : {}) })
    shotSheets.push({ file, shots: part.map((s) => s.n) })
  }
  const hl = hookLayoutFor(o.vertical)
  const hookFrames: number[] = []
  for (let k = 1; k <= Math.min(count, hl.cols * hl.rows) && (k - 1) / SHEET_FPS < Math.max(o.hookEndS, 2); k++) hookFrames.push(k)
  let hookSheet: Sheet | null = null
  if (hookFrames.length > 0) {
    const list = path.join(dir, 'hook.txt')
    await writeFile(list, concatList(dir, hookFrames), 'utf8')
    const file = path.join(dir, 'hook.jpg')
    await run('ffmpeg', tileArgs(list, file, hl), { timeoutMs: 60_000, ...(o.signal ? { signal: o.signal } : {}) })
    hookSheet = { file, shots: [], times: hookFrames.map((k) => (k - 1) / SHEET_FPS) }
  }
  return { shotSheets, hookSheet }
}
