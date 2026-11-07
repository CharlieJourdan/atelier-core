// Reading media: ffprobe facts, loudness (EBU R128) and a 10 ms energy envelope for alignment, trimming and ducking.
import { EngineError } from '../errors'
import type { MediaService } from '../services'

export interface StreamInfo {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_frames?: string
  nb_read_frames?: string
  duration?: string
  sample_rate?: string
  channels?: number
  pix_fmt?: string
  color_primaries?: string
  color_transfer?: string
  color_space?: string
  profile?: string
}

export interface ProbeInfo {
  durationS: number
  streams: StreamInfo[]
}

export async function probe(media: MediaService, file: string, signal: AbortSignal, countFrames = false): Promise<ProbeInfo> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']
  if (countFrames) args.push('-count_frames')
  const { stdout } = await media.run('ffprobe', [...args, file], { signal })
  let parsed: { format?: { duration?: string }; streams?: StreamInfo[] }
  try {
    parsed = JSON.parse(stdout.toString('utf8')) as typeof parsed
  } catch {
    throw new EngineError('bad_input', `ffprobe could not read ${file}`)
  }
  const durationS = Number(parsed.format?.duration ?? NaN)
  if (!Number.isFinite(durationS)) throw new EngineError('bad_input', `no duration in ${file}`)
  return { durationS, streams: parsed.streams ?? [] }
}

export interface Loudness {
  /** Integrated loudness, LUFS. */
  integrated: number
  /** True peak, dBTP. */
  truePeak: number
}

/** Measures integrated loudness and true peak once (one decode). */
export async function measureLoudness(media: MediaService, file: string, signal: AbortSignal): Promise<Loudness> {
  const { stderr } = await media.run('ffmpeg', ['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { signal })
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  let j: { input_i?: string; input_tp?: string }
  try {
    j = JSON.parse(stderr.slice(start, end + 1)) as typeof j
  } catch {
    throw new EngineError('internal', 'loudness measurement gave no result')
  }
  const integrated = Number(j.input_i)
  const truePeak = Number(j.input_tp)
  // pure silence measures -inf: report a very low level instead of NaN
  return { integrated: Number.isFinite(integrated) ? integrated : -70, truePeak: Number.isFinite(truePeak) ? truePeak : -70 }
}

/** Sample rate of the energy analysis (speech energy lives well below 8 kHz). */
export const ENERGY_RATE = 16_000
export const ENERGY_FRAME_S = 0.01

/**
 * Energy envelope in dBFS, one value per 10 ms, decoded as mono 16 kHz floats and streamed (constant memory: a
 * 30-minute voice is 180 000 values).
 */
export async function energyEnvelope(media: MediaService, file: string, signal: AbortSignal): Promise<Float32Array> {
  const perFrame = Math.round(ENERGY_RATE * ENERGY_FRAME_S)
  const { stdout, done } = media.stream('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(ENERGY_RATE), '-f', 'f32le', '-'], { signal })
  const out: number[] = []
  let carry = Buffer.alloc(0)
  let sum = 0
  let n = 0
  for await (const chunk of stdout) {
    const buf = carry.length > 0 ? Buffer.concat([carry, Buffer.from(chunk)]) : Buffer.from(chunk)
    const usable = buf.length - (buf.length % 4)
    for (let i = 0; i < usable; i += 4) {
      const v = buf.readFloatLE(i)
      sum += v * v
      if (++n === perFrame) {
        out.push(10 * Math.log10(sum / n + 1e-12))
        sum = 0
        n = 0
      }
    }
    carry = buf.subarray(usable)
  }
  await done
  if (n > 0) out.push(10 * Math.log10(sum / n + 1e-12))
  return Float32Array.from(out)
}

export interface SpeechRegion {
  start: number
  end: number
}

/**
 * Where someone speaks, from an energy envelope: frames above the noise floor + `marginDb` (the floor is the quietest
 * 5 % of frames, R19.6), gaps shorter than `bridgeS` bridged, blips shorter than `minS` dropped. Seconds.
 */
export function speechRegions(env: Float32Array, opts: { marginDb?: number; bridgeS?: number; minS?: number } = {}): SpeechRegion[] {
  if (env.length === 0) return []
  const sorted = Float32Array.from(env).sort()
  const floor = sorted[Math.floor(sorted.length * 0.05)] as number
  const peak = sorted[Math.floor(sorted.length * 0.95)] as number
  // the threshold sits above the floor but never above a third of the way to the loud level
  const threshold = Math.min(floor + (opts.marginDb ?? 18), floor + (peak - floor) / 3)
  const bridge = Math.round((opts.bridgeS ?? 0.12) / ENERGY_FRAME_S)
  const min = Math.round((opts.minS ?? 0.05) / ENERGY_FRAME_S)
  const raw: [number, number][] = []
  let open = -1
  for (let i = 0; i <= env.length; i++) {
    const on = i < env.length && (env[i] as number) > threshold
    if (on && open < 0) open = i
    if (!on && open >= 0) {
      raw.push([open, i])
      open = -1
    }
  }
  const merged: [number, number][] = []
  for (const r of raw) {
    const last = merged.at(-1)
    if (last && r[0] - last[1] <= bridge) last[1] = r[1]
    else merged.push([r[0], r[1]])
  }
  return merged.filter(([a, b]) => b - a >= min).map(([a, b]) => ({ start: a * ENERGY_FRAME_S, end: b * ENERGY_FRAME_S }))
}
