// Contact sheets and frame grabs with ffmpeg: what lets a Claude agent LOOK at candidates (one picture with numbered tiles) and what
// the verification of cut clips reads (3 frames per clip). ffmpeg is the system one (injectable `run`, so tests never start it).
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { RunFn } from './types.ts'

/** A font file for the tile numbers, by platform (the engine's own fonts are not needed for a label). */
export function labelFont(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'C\\:/Windows/Fonts/arial.ttf'
  if (platform === 'darwin') return '/System/Library/Fonts/Supplemental/Arial.ttf'
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
}

export interface SheetOptions {
  cols?: number
  cellW?: number
  cellH?: number
  /** The text printed on each tile; default: 1, 2, 3… */
  labels?: string[]
  platform?: NodeJS.Platform
}

/** The ffmpeg arguments that tile `files` (in order) into `out`, each tile scaled to fit its cell, padded, and numbered. */
export function sheetArgs(files: readonly string[], out: string, o: SheetOptions = {}): string[] {
  const cols = Math.max(1, o.cols ?? 4)
  const w = o.cellW ?? 320
  const h = o.cellH ?? 180
  const font = labelFont(o.platform)
  const chains = files.map((_, i) => {
    const label = (o.labels?.[i] ?? String(i + 1)).replace(/[^A-Za-z0-9 _.-]/g, '')
    return `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x202020,drawtext=fontfile='${font}':text='${label}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.7:x=4:y=4[t${i}]`
  })
  const layout = files.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join('|')
  const stack = files.length === 1 ? '[t0]null[v]' : `${files.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[v]`
  return ['-y', '-v', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', [...chains, stack].join(';'), '-map', '[v]', '-frames:v', '1', '-q:v', '3', out]
}

export async function buildSheet(files: readonly string[], out: string, run: RunFn, o: SheetOptions = {}): Promise<string> {
  if (files.length === 0) throw new Error('a contact sheet needs at least one picture')
  await mkdir(path.dirname(out), { recursive: true })
  await run('ffmpeg', sheetArgs(files, out, o), { timeoutMs: 120_000 })
  return out
}

/** One frame of a video file at `atS` seconds, as a JPEG. */
export async function grabFrame(file: string, atS: number, out: string, run: RunFn): Promise<string> {
  await mkdir(path.dirname(out), { recursive: true })
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, atS)), '-i', file, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60_000 })
  return out
}

/** Three frames of a clip (at 15 %, 50 % and 85 % of its length), for the verification sheet. */
export async function clipFrames(file: string, durationS: number, outDir: string, stem: string, run: RunFn): Promise<string[]> {
  const out: string[] = []
  for (const [i, f] of [0.15, 0.5, 0.85].entries()) out.push(await grabFrame(file, durationS * f, path.join(outDir, `${stem}-${i + 1}.jpg`), run))
  return out
}
