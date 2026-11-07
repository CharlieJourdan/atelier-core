// P2 sound measures (chantier moteur-analyse): the whole file's loudness (EBU R128, integrated) and the music bed's level
// under the voice, from ONE ffmpeg pass that logs the momentary loudness every 0.1 s. The music level is measured, not
// guessed: the median momentary loudness inside the voice's pauses (where only the bed and effects remain) minus the
// median while words are spoken. Parsing is pure; the program runs through the injectable `run`.
import type { RunFn } from '../../../../engine/sourcing/types'
import { quantile, type Word } from './measures'

/** Under this momentary loudness a pause is silent (no music bed). */
export const SILENT_LUFS = -50
/** Pauses at least this long are sampled (the momentary window is 0.4 s). */
export const SAMPLED_PAUSE_S = 0.5

export const loudnessArgs = (file: string): string[] => ['-hide_banner', '-nostats', '-v', 'verbose', '-i', file, '-vn', '-af', 'ebur128=framelog=verbose', '-f', 'null', '-']

export interface LoudnessLog {
  /** Momentary loudness (LUFS) at each logged time. */
  points: { t: number; m: number }[]
  integratedLufs: number | null
  lraLu: number | null
}

/** The ebur128 filter's log (stderr) → points and summary. Pure. */
export function parseEbur128(text: string): LoudnessLog {
  const points: LoudnessLog['points'] = []
  for (const m of text.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+|-inf)/g)) {
    const v = m[2] === '-inf' ? -120 : Number(m[2])
    points.push({ t: Number(m[1]), m: v })
  }
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const i = /I:\s*(-?[\d.]+)\s*LUFS/.exec(summary)
  const lra = /LRA:\s*(-?[\d.]+)\s*LU/.exec(summary)
  return { points, integratedLufs: i ? Number(i[1]) : null, lraLu: lra ? Number(lra[1]) : null }
}

export interface MusicLevel {
  /** A bed is heard in the pauses. */
  present: boolean
  /** Bed minus voice (dB); null when no bed. */
  underVoiceDb: number | null
  pauseLufs: number
  speechLufs: number
  /** The pause times sampled (evidence). */
  samples: number[]
}

/** The music bed's level under the voice from momentary loudness and word timings. Null when too few pauses to say. */
export function musicLevel(log: LoudnessLog, words: readonly Word[]): MusicLevel | null {
  if (log.points.length === 0 || words.length < 20) return null
  const at = (t: number): number | null => {
    // points are 0.1 s apart: the nearest one
    let lo = 0
    let hi = log.points.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (log.points[mid]!.t < t) lo = mid + 1; else hi = mid }
    // the last point at or before t: its 0.4 s window ends inside the span asked
    const p = log.points[lo] && log.points[lo]!.t > t ? log.points[lo - 1] : log.points[lo]
    return p && t - p.t <= 0.15 ? p.m : null
  }
  const pauses: number[] = []
  const speech: number[] = []
  const pauseTimes: number[] = []
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1]!
    const b = words[i]!
    const gap = b.start - a.end
    if (gap >= SAMPLED_PAUSE_S) {
      const t = b.start - 0.05 // the 0.4 s window ending here lies inside the pause
      const v = at(t)
      if (v !== null) { pauses.push(v); pauseTimes.push(Math.round(t * 10) / 10) }
    }
    if (b.end - b.start >= 0.2 && i % 4 === 0) {
      const v = at(b.end)
      if (v !== null) speech.push(v)
    }
  }
  if (pauses.length < 5 || speech.length < 10) return null
  const pauseLufs = Math.round(quantile(pauses, 0.5) * 10) / 10
  const speechLufs = Math.round(quantile(speech, 0.5) * 10) / 10
  const present = pauseLufs > SILENT_LUFS
  return { present, underVoiceDb: present ? Math.round((pauseLufs - speechLufs) * 10) / 10 : null, pauseLufs, speechLufs, samples: pauseTimes.slice(0, 12) }
}

/** Runs the loudness pass on a file. */
export async function measureLoudness(file: string, run: RunFn, signal?: AbortSignal): Promise<LoudnessLog> {
  const { stdout, stderr } = await run('ffmpeg', loudnessArgs(file), { timeoutMs: 900_000, ...(signal ? { signal } : {}) })
  return parseEbur128(`${stderr}\n${stdout}`)
}

/** Mono 8 kHz signed 16-bit PCM of a file (for the pitch measure), written to `out`. */
export const pcmArgs = (file: string, out: string): string[] => ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(PITCH_RATE), '-f', 's16le', '-y', out]
export const PITCH_RATE = 8000

/**
 * The voice's median fundamental frequency (Hz) by autocorrelation on 64 ms windows taken in the middle of spoken words
 * (a music bed under the voice moves it little: the median of voiced windows). Null when fewer than 30 voiced windows.
 * Pure: `pcm` is the 8 kHz mono signal.
 */
export function medianPitchHz(pcm: Int16Array, words: readonly Word[], maxWindows = 400): number | null {
  const n = Math.round(0.064 * PITCH_RATE)
  const minLag = Math.floor(PITCH_RATE / 350)
  const maxLag = Math.ceil(PITCH_RATE / 70)
  const step = Math.max(1, Math.floor(words.length / maxWindows))
  const found: number[] = []
  for (let i = 0; i < words.length; i += step) {
    const w = words[i]!
    if (w.end - w.start < 0.12) continue
    const c = Math.round(((w.start + w.end) / 2) * PITCH_RATE)
    const a = c - (n >> 1)
    if (a < 0 || a + n + maxLag >= pcm.length) continue
    let energy = 0
    for (let k = 0; k < n; k++) energy += pcm[a + k]! * pcm[a + k]!
    if (energy / n < 250_000) continue // too quiet to be voiced (|x| < ~500)
    const rs: number[] = []
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0
      for (let k = 0; k < n; k++) s += pcm[a + k]! * pcm[a + k + lag]!
      rs.push(s / energy)
    }
    const best = Math.max(...rs)
    if (best <= 0.5) continue
    // the first local peak close to the best one (a period's multiples correlate almost as well: no octave error)
    const i0 = rs.findIndex((r, j) => r >= best * 0.85 && (j === 0 || r >= rs[j - 1]!) && (j === rs.length - 1 || r >= rs[j + 1]!))
    if (i0 >= 0) found.push(PITCH_RATE / (minLag + i0))
  }
  if (found.length < 30) return null
  return Math.round(quantile(found, 0.5))
}

/** A plain timbre line from the measured pitch. */
export function timbreFromPitch(hz: number | null): string {
  if (hz === null) return 'not measured (too few voiced windows)'
  const band = hz < 105 ? 'very low' : hz < 135 ? 'low' : hz < 165 ? 'medium-low' : hz < 200 ? 'medium' : hz < 240 ? 'medium-high' : 'high'
  const likely = hz < 160 ? 'a male-range voice' : hz > 175 ? 'a female-range voice' : 'an ambiguous-range voice'
  return `${band} pitch (median F0 ${hz} Hz), ${likely}`
}
