// P2 evidence frames (chantier moteur-analyse): ONE ffmpeg pass draws a frame every 0.5 s of the whole video into a scratch
// folder; the frames that serve as evidence are copied into the clone's folder (one per shot, at its middle, plus the dense
// frames every 0.5 s on the hook and around each part change), and the look sheets tile the shot frames for the vision
// pass. The scratch folder is deleted by the caller. Programs run through the injectable `run`.
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RunFn } from '../../../../engine/sourcing/types'
import type { Folder } from '../store'

export const FRAME_FPS = 2
export const FRAME_W = 384
export const FRAME_H = 216
/** Look sheets: 5 × 4 shots, one frame each (1920 × 864). */
export const SHEET_COLS = 5
export const SHEET_ROWS = 4
export const SHOTS_PER_SHEET = SHEET_COLS * SHEET_ROWS

/** The 0.5 s frames' size: wide, or upright for a vertical video (moteur-pov-2: a Short was shrunk inside a wide frame). */
export const frameSize = (portrait: boolean): { w: number; h: number } => (portrait ? { w: FRAME_H, h: FRAME_W } : { w: FRAME_W, h: FRAME_H })

export const allFramesArgs = (file: string, dir: string, size = frameSize(false)): string[] => [
  '-hide_banner', '-v', 'error', '-i', file, '-an', '-vf',
  `fps=${FRAME_FPS},scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2`,
  '-q:v', '4', '-y', path.join(dir, 'f_%05d.jpg')
]

/** Index (from 1) of the scratch frame nearest a time. */
export const frameIndex = (t: number, count: number): number => Math.min(count, Math.max(1, Math.floor(t * FRAME_FPS) + 1))
export const scratchName = (k: number): string => `f_${String(k).padStart(5, '0')}.jpg`
/** Evidence frame name for a time (tenths of a second). */
export const evidenceName = (t: number): string => `t${String(Math.round(t * 10)).padStart(6, '0')}.jpg`
/** The time a shot's evidence frame shows: its middle, on the 0.5 s grid, inside the shot when it lasts ≥ 0.5 s. */
export const shotFrameTime = (s: { startS: number; lengthS: number }): number => {
  const mid = s.startS + s.lengthS / 2
  const t = Math.floor(mid * FRAME_FPS) / FRAME_FPS
  return t >= s.startS ? t : Math.ceil(s.startS * FRAME_FPS) / FRAME_FPS
}

/** Copies the frames at `times` from the scratch folder into `<dir>/frames/`; returns the relative path of each time. */
export async function keepFrames(scratch: string, count: number, times: readonly number[], dir: Folder): Promise<Map<number, string>> {
  await mkdir(path.join(dir.abs, 'frames'), { recursive: true })
  const out = new Map<number, string>()
  for (const t of times) {
    if (out.has(t)) continue
    const name = evidenceName(t)
    await copyFile(path.join(scratch, scratchName(frameIndex(t, count))), path.join(dir.abs, 'frames', name))
    out.set(t, `${dir.rel}/frames/${name}`)
  }
  return out
}

export const tileArgs = (list: string, out: string): string[] => ['-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${SHEET_COLS}x${SHEET_ROWS}:color=black`, '-frames:v', '1', '-q:v', '4', '-y', out]

export interface LookSheet { file: string; rel: string; shots: number[] }

/** Tiles the shot frames (in shot order) into look sheets under `<dir>/sheets/`. */
export async function buildLookSheets(scratch: string, count: number, shots: readonly { n: number; startS: number; lengthS: number }[], dir: Folder, run: RunFn, signal?: AbortSignal): Promise<LookSheet[]> {
  await mkdir(path.join(dir.abs, 'sheets'), { recursive: true })
  const sheets: LookSheet[] = []
  for (let i = 0; i < shots.length; i += SHOTS_PER_SHEET) {
    const group = shots.slice(i, i + SHOTS_PER_SHEET)
    const name = `sheet_${String(sheets.length + 1).padStart(3, '0')}`
    const list = path.join(scratch, `${name}.txt`)
    const lines = group.map((s) => `file '${path.join(scratch, scratchName(frameIndex(shotFrameTime(s), count))).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration 0.04`)
    await writeFile(list, lines.join('\n') + '\n', 'utf8')
    const file = path.join(dir.abs, 'sheets', `${name}.jpg`)
    await run('ffmpeg', tileArgs(list, file), { timeoutMs: 120_000, ...(signal ? { signal } : {}) })
    sheets.push({ file, rel: `${dir.rel}/sheets/${name}.jpg`, shots: group.map((s) => s.n) })
  }
  return sheets
}
