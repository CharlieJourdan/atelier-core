// P7 — the instruments: what ffmpeg measures on a video file (cuts, duration, loudness, dominant colours), used the SAME
// way on the reference passage and on our render so the curves compare like with like. Programs run through an
// injectable `run` (tests pass a fake); nothing here talks to the network or to a model.
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { detectCuts, probeDuration } from '../../../../engine/sourcing/measure-video'
import type { RunFn } from '../../../../engine/sourcing/types'
import type { FileMeasures } from './curves'

/** ffmpeg arguments: cut `fromS..toS` of a file into `out` (re-encoded, so cuts and loudness read the passage only). */
export const segmentArgs = (file: string, fromS: number, toS: number, out: string): string[] =>
  ['-y', '-v', 'error', '-ss', String(fromS), '-t', String(Math.max(0.1, toS - fromS)), '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', out]

/** ffmpeg arguments: integrated loudness of a file (EBU R128 through loudnorm's JSON report on stderr). */
export const loudnessArgs = (file: string): string[] => ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']

/** The integrated loudness (LUFS) in loudnorm's report, null when absent or silent. */
export function parseLoudness(stderr: string): number | null {
  const m = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(stderr)
  if (!m || m[1] === '-inf') return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

/** Palette sample size: one frame every 2 s, shrunk to 16 × 9 pixels. */
export const PALETTE_W = 16
export const PALETTE_H = 9
export const paletteArgs = (file: string, out: string): string[] =>
  ['-y', '-v', 'error', '-i', file, '-an', '-vf', `fps=0.5,scale=${PALETTE_W}:${PALETTE_H}:flags=area,format=rgb24`, '-f', 'rawvideo', out]

/** Dominant colours of raw RGB pixels: quantised to 3 bits a channel, the `top` most frequent bins with their share. */
export function dominantColours(rgb: Uint8Array, top = 6): { hex: string; share: number }[] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  const pixels = Math.floor(rgb.length / 3)
  for (let i = 0; i < pixels; i++) {
    const r = rgb[i * 3]!
    const g = rgb[i * 3 + 1]!
    const b = rgb[i * 3 + 2]!
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++
    c.r += r
    c.g += g
    c.b += b
    counts.set(key, c)
  }
  const hex = (x: number): string => Math.round(x).toString(16).padStart(2, '0')
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, top).map((c) => ({ hex: `#${hex(c.r / c.n)}${hex(c.g / c.n)}${hex(c.b / c.n)}`, share: Math.round((c.n / (pixels || 1)) * 1000) / 1000 }))
}

/** Words per minute of a script read over a render of `durationS` seconds. */
export function scriptPace(script: string, durationS: number): number | null {
  const words = script.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return words >= 20 && durationS > 0 ? Math.round((words / durationS) * 60 * 10) / 10 : null
}

/** Measure a file: cuts, duration, loudness, palette; `wordsPerMinute` comes from the caller (script or word timings). */
export async function measureFile(file: string, run: RunFn, tmpDir: string, wordsPerMinute: number | null): Promise<FileMeasures> {
  const durationS = (await probeDuration(file, run)) ?? 0
  const cutsS = await detectCuts(file, run)
  const { stderr } = await run('ffmpeg', loudnessArgs(file), { timeoutMs: 600_000 })
  const raw = path.join(tmpDir, `palette-${path.basename(file)}.rgb`)
  await run('ffmpeg', paletteArgs(file, raw), { timeoutMs: 600_000 })
  const palette = dominantColours(new Uint8Array(await readFile(raw)))
  await rm(raw, { force: true })
  return { cutsS, durationS, loudnessLufs: parseLoudness(stderr), palette, wordsPerMinute }
}
