// How each shot's picture was MADE, measured on its pixels (chantier rea-video, decision 0110): is the picture RENDERED
// (a few flat colours: motion design, drawn 2D, vector scenes) or PHOTOGRAPHIC (hundreds of colours: camera footage, photos,
// AI pictures), and does anything move. The vision model names what is shown; it may not call a rendered picture « generated »
// or « found footage » against this measure (the guard in src/main/production/clone/analysis/forensic-guard.ts).
// The method — the palette size as the decisive pixel test, the model deciding the rest — comes from rea-video (Apache-2.0,
// © 2026 JuneYaooo, VENDOR.md); the code and the thresholds are ours, calibrated on Finary, Le Monde en POV and Markets of the
// Past (research note rea-video-2026-11 (old repository)). A grain overlay defeats texture tests (Le Monde en POV adds film grain to flat
// drawings), so texture is not used: colours are.
//
// ONE ffmpeg pass draws a small RGB frame every 0.5 s of the whole video into a raw file; every measure is pure on those
// frames. Programs run through the injectable `run` (tests never start one).
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { RunFn } from '../sourcing/types.ts'

/** The frames' size and rate (160 × 90 RGB, every 0.5 s: 43 kB a frame, ≈ 155 MB for 30 minutes, read once). */
export const FX_W = 160
export const FX_H = 90
export const FX_FPS = 2

export interface RgbFrame {
  w: number
  h: number
  /** RGB bytes, row by row. */
  px: Uint8Array
}

/** Thresholds (calibration in the research note). */
export const FX = {
  /** Colours (4 bits a channel) that cover 95 % of the pixels: at most this, the picture is rendered … */
  renderedPalette: 48,
  /** … at least this, photographic; between, mixed (a photo inside a designed card, a gradient sky). */
  photoPalette: 140,
  /** Mean absolute change (0–255, grey) under which two frames 0.5 s apart are the same picture. */
  staticChange: 1.2
} as const

export type ShotTexture = 'rendered' | 'photographic' | 'mixed'

export interface ShotForensics {
  /** 1-based shot number. */
  n: number
  /** Frames measured inside the shot. */
  frames: number
  texture: ShotTexture
  /** Median palette size over the shot's frames. */
  palette95: number
  /** Nothing moves (every pair of frames under `FX.staticChange`); false with one frame. */
  static: boolean
  /** Mean grey change between frames 0.5 s apart (0–255); 0 with one frame. */
  change: number
}

/** ffmpeg arguments: the whole video as RGB 160 × 90 frames every 0.5 s, raw, in one file. */
export const rgbFramesArgs = (file: string, out: string): string[] =>
  ['-hide_banner', '-v', 'error', '-i', file, '-an', '-vf', `fps=${FX_FPS},scale=${FX_W}:${FX_H}:flags=neighbor,format=rgb24`, '-f', 'rawvideo', '-y', out]

/** Splits a raw RGB file into frames (frame k is at k / FX_FPS seconds). Pure. */
export function splitFrames(buf: Uint8Array, w = FX_W, h = FX_H): RgbFrame[] {
  const size = w * h * 3
  const out: RgbFrame[] = []
  for (let o = 0; o + size <= buf.length; o += size) out.push({ w, h, px: buf.subarray(o, o + size) })
  return out
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** How many colours (4 bits a channel, 4096 bins) cover 95 % of the pixels. Pure. */
export function palette95(f: RgbFrame): number {
  const counts = new Uint32Array(4096)
  const n = f.w * f.h
  for (let i = 0; i < n; i++) counts[((f.px[3 * i]! >> 4) << 8) | ((f.px[3 * i + 1]! >> 4) << 4) | (f.px[3 * i + 2]! >> 4)]!++
  const sorted = [...counts].filter((c) => c > 0).sort((a, b) => b - a)
  let acc = 0
  for (let k = 0; k < sorted.length; k++) {
    acc += sorted[k]!
    if (acc >= 0.95 * n) return k + 1
  }
  return sorted.length
}

/** Mean absolute grey difference of two frames (0–255). Pure. */
export function meanChange(a: RgbFrame, b: RgbFrame): number {
  const n = a.w * a.h
  let s = 0
  for (let i = 0; i < n; i++) {
    const ga = (a.px[3 * i]! * 3 + a.px[3 * i + 1]! * 6 + a.px[3 * i + 2]!) / 10
    const gb = (b.px[3 * i]! * 3 + b.px[3 * i + 1]! * 6 + b.px[3 * i + 2]!) / 10
    s += Math.abs(ga - gb)
  }
  return n ? s / n : 0
}

export const textureOf = (palette: number): ShotTexture => (palette <= FX.renderedPalette ? 'rendered' : palette >= FX.photoPalette ? 'photographic' : 'mixed')

/** Frame indexes inside a shot (every 0.5 s, at least one: the middle). */
export function framesIn(startS: number, endS: number, count: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(startS * FX_FPS + 0.25); k / FX_FPS < endS - 0.1 && k < count; k++) out.push(k)
  if (out.length === 0 && count > 0) out.push(Math.min(count - 1, Math.max(0, Math.round(((startS + endS) / 2) * FX_FPS))))
  return out
}

/** The forensics of one shot from its frames. Pure. */
export function shotForensics(n: number, frames: readonly RgbFrame[]): ShotForensics {
  const palette = Math.round(median(frames.map(palette95)))
  const changes: number[] = []
  for (let i = 1; i < frames.length; i++) changes.push(meanChange(frames[i - 1]!, frames[i]!))
  const change = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0
  return { n, frames: frames.length, texture: textureOf(palette), palette95: palette, static: changes.length > 0 && changes.every((c) => c < FX.staticChange), change: Math.round(change * 100) / 100 }
}

/** Every shot's forensics from the video's frames. Pure. */
export function forensicsOf(shots: readonly { n: number; startS: number; endS: number }[], frames: readonly RgbFrame[]): ShotForensics[] {
  return shots.map((s) => shotForensics(s.n, framesIn(s.startS, s.endS, frames.length).map((k) => frames[k]!)))
}

/** Reads a local video's shots' forensics: one ffmpeg pass into `dir`, then the pure measures; the raw file is removed. */
export async function readForensics(file: string, shots: readonly { n: number; startS: number; endS: number }[], run: RunFn, dir: string, signal?: AbortSignal): Promise<ShotForensics[]> {
  const raw = path.join(dir, 'fx-rgb.raw')
  try {
    await run('ffmpeg', rgbFramesArgs(file, raw), { timeoutMs: 900_000, ...(signal ? { signal } : {}) })
    return forensicsOf(shots, splitFrames(new Uint8Array(await readFile(raw))))
  } finally {
    await rm(raw, { force: true }).catch(() => undefined)
  }
}
