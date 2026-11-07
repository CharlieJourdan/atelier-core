// P8 — engine calibration rules (spec §3 « each improvement goes into the ENGINE »): when the Style Definition already
// says the reference's value and our render still misses it, the cause is a brick that does not deliver what it is asked
// (e.g. a voice engine speaking 10 % slower than the words-per-minute it is given). The fix is a calibration factor for
// that brick and field, kept for EVERY later clone (one file per data folder, not per clone). The plan → recipe compiler
// multiplies the setting by it. Pure helpers + one small JSON file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export const CALIBRATION_PREFIX = 'calibration:'

export const CalibrationEntry = z.object({ factor: z.number().positive(), from: z.array(z.string()) })
export const Calibration = z.record(z.string(), CalibrationEntry)
export type Calibration = z.infer<typeof Calibration>

/** The change target of a calibration (`calibration:<node>:<field>`). */
export const calibrationTarget = (node: string, field: string): string => `${CALIBRATION_PREFIX}${node}:${field}`

export function parseTarget(target: string): { node: string; field: string } | null {
  if (!target.startsWith(CALIBRATION_PREFIX)) return null
  const [node, field] = target.slice(CALIBRATION_PREFIX.length).split(':')
  return node && field ? { node, field } : null
}

/** Engine-wide file: `<dataDir>/clones/calibration.json`. */
export const calibrationFile = (dataDir: string): string => path.join(dataDir, 'clones', 'calibration.json')

export function loadCalibration(dataDir: string): Calibration {
  const f = calibrationFile(dataDir)
  return existsSync(f) ? Calibration.parse(JSON.parse(readFileSync(f, 'utf8'))) : {}
}

export function saveCalibration(dataDir: string, c: Calibration): void {
  mkdirSync(path.dirname(calibrationFile(dataDir)), { recursive: true })
  writeFileSync(calibrationFile(dataDir), JSON.stringify(c, null, 2) + '\n', 'utf8')
}

/** The factor for a brick's field (1 when never calibrated). */
export const factorOf = (c: Calibration, node: string, field: string): number => c[`${node}:${field}`]?.factor ?? 1

/** A copy with one factor set (bounded to 0.5–2: a brick that misses by more is broken, not miscalibrated). */
export function withFactor(c: Calibration, node: string, field: string, factor: number, from: string): Calibration {
  const key = `${node}:${field}`
  const bounded = Math.max(0.5, Math.min(2, Math.round(factor * 1000) / 1000))
  return { ...c, [key]: { factor: bounded, from: [...(c[key]?.from ?? []), from] } }
}
