// The synthetic room (src/engine/media/room.ts): the impulse response has the decay, the early reflections and the band it promises, it is
// deterministic, and (with ffmpeg) the voice put through it keeps its length and its loudness and gains a tail where the dry voice has silence.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  applyRoom,
  bandEnergyShare,
  clarityDb,
  EARLY_WINDOW_S,
  estimateRt60,
  ROOM_BAND,
  ROOM_RATE,
  roomFilter,
  roomImpulseResponse,
  sti,
  writeRoomIr
} from '../../src/engine/media/room'
import { measureLoudness, probe } from '../../src/engine/media/probe'
import { writeWav } from '../../src/engine/media/wav'
import { hasFfmpeg, MEDIA, NO_FFMPEG } from './engine-node-helpers'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-room-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const rmsDb = (x: Float32Array, from: number, to: number): number => {
  let s = 0
  for (let i = from; i < to; i++) s += (x[i] as number) ** 2
  return 10 * Math.log10(Math.max(s / Math.max(1, to - from), 1e-20))
}

describe('roomImpulseResponse', () => {
  it('is as long as the decay time', () => {
    for (const rt of [0.3, 0.6, 1.2]) {
      const ir = roomImpulseResponse({ rt })
      expect(ir.samples.length / ir.rate).toBeCloseTo(rt, 2)
    }
  })

  it('decays by 60 dB in rt seconds (within 15 %)', () => {
    for (const [rt, seed] of [[0.6, 1], [0.6, 7], [0.4, 3], [1.0, 2]] as const) {
      const ir = roomImpulseResponse({ rt, seed })
      const got = estimateRt60(ir.samples, ir.rate)
      expect(got).toBeGreaterThan(rt * 0.85)
      expect(got).toBeLessThan(rt * 1.15)
    }
  })

  it('has nothing before the first reflection and its taps sit in 7-43 ms', () => {
    const ir = roomImpulseResponse({ rt: 0.6, seed: 5 })
    const [t0, t1] = EARLY_WINDOW_S
    expect(ir.taps.length).toBeGreaterThanOrEqual(8)
    for (const t of ir.taps) {
      expect(t.timeS).toBeGreaterThanOrEqual(t0)
      expect(t.timeS).toBeLessThanOrEqual(t1)
    }
    // causal filters: no sample before the first tap
    const first = Math.floor(Math.min(...ir.taps.map((t) => t.timeS)) * ir.rate)
    for (let i = 0; i < first; i++) expect(ir.samples[i]).toBe(0)
    // the taps are sparse, loud peaks over the diffuse part: the early window is stronger than the same length of tail further on
    const a = Math.round(t0 * ir.rate)
    const b = Math.round(t1 * ir.rate)
    expect(rmsDb(ir.samples, a, b)).toBeGreaterThan(rmsDb(ir.samples, b + 4800, b + 4800 + (b - a)) + 6)
  })

  it('keeps its energy in the 220-5200 Hz band and has a unit power gain there', () => {
    const ir = roomImpulseResponse({ rt: 0.6, seed: 1 })
    expect(bandEnergyShare(ir.samples, ir.rate, ROOM_BAND[0], ROOM_BAND[1])).toBeGreaterThan(0.88)
    expect(bandEnergyShare(ir.samples, ir.rate, 0, 150)).toBeLessThan(0.02)
    expect(bandEnergyShare(ir.samples, ir.rate, 8000, ir.rate / 2)).toBeLessThan(0.02)
    let e = 0
    for (const v of ir.samples) e += v * v
    expect(e).toBeCloseTo((ROOM_BAND[1] - ROOM_BAND[0]) / (ir.rate / 2), 3)
  })

  it('is deterministic for a seed and changes with it', () => {
    const a = roomImpulseResponse({ seed: 11 })
    const b = roomImpulseResponse({ seed: 11 })
    const c = roomImpulseResponse({ seed: 12 })
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true)
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(c.samples.buffer))).toBe(false)
  })
})

describe('room analysis', () => {
  it('the STI falls as the wet level rises (it saturates at 1 for a faint room)', () => {
    const ir = roomImpulseResponse({ rt: 0.6 })
    const s = [-30, -20, -14, -8, -2].map((m) => sti(ir.samples, ir.rate, m))
    for (let i = 1; i < s.length; i++) expect(s[i] as number).toBeLessThanOrEqual(s[i - 1] as number)
    expect(s[4] as number).toBeLessThan((s[2] as number) - 0.1)
    expect(sti(ir.samples, ir.rate, -60)).toBeGreaterThan(0.99)
    expect(sti(ir.samples, ir.rate, -14)).toBeGreaterThan(0.75)
  })

  it('the clarity rises with the direct energy', () => {
    const ir = roomImpulseResponse({ rt: 0.6 })
    expect(clarityDb(ir.samples, ir.rate, 10)).toBeGreaterThan(clarityDb(ir.samples, ir.rate, 0))
  })
})

describe('roomFilter', () => {
  it('mixes the convolved branch under the dry one', () => {
    const f = roomFilter({ irFile: 'C:\\x y\\ir.wav', mixDb: -20 })
    expect(f).toContain('afir=wet=0.100000')
    expect(f).toContain("amovie='C\\:/x y/ir.wav'")
    expect(f).toContain('amix=inputs=2:normalize=0')
  })
})

describe.skipIf(!hasFfmpeg)('applyRoom (ffmpeg)', () => {
  // a "word": 0.4 s of noise, then 1.1 s of digital silence
  const rate = ROOM_RATE
  const word = (): Float32Array => {
    const x = new Float32Array(Math.round(1.5 * rate))
    let a = 12345
    for (let i = 0; i < Math.round(0.4 * rate); i++) {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0
      x[i] = ((a / 4294967296) * 2 - 1) * 0.3 * Math.sin((Math.PI * i) / (0.4 * rate))
    }
    return x
  }
  const decode = async (file: string, channels: number): Promise<Float32Array> => {
    const { stdout } = await MEDIA!.run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-'], { signal: new AbortController().signal })
    return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length - (stdout.length % 4)))
  }

  it('keeps the length and the loudness, and leaves a tail in the silence after the word', async () => {
    const signal = new AbortController().signal
    const voice = path.join(tmp, 'voice.wav')
    const out = path.join(tmp, 'room.wav')
    await writeWav(voice, word(), rate, 1)
    const r = await applyRoom(MEDIA!, { voice, out, rt: 0.6, mixDb: -14, seed: 3, signal })
    const dry = await probe(MEDIA!, voice, signal)
    const wet = await probe(MEDIA!, out, signal)
    expect(Math.abs(wet.durationS - dry.durationS)).toBeLessThan(0.002)
    expect(r.durationS).toBeCloseTo(dry.durationS, 2)
    const a = await measureLoudness(MEDIA!, voice, signal)
    const b = await measureLoudness(MEDIA!, out, signal)
    expect(Math.abs(b.integrated - a.integrated)).toBeLessThan(1)
    // the tail: 0.45-0.9 s is silent in the dry voice, audible (and far below the word) in the roomed one
    const y = await decode(out, 1)
    // no latency: the first sound is where it was
    const onset = (v: Float32Array): number => v.findIndex((s) => Math.abs(s) > 0.01)
    expect(Math.abs(onset(y) - onset(word()))).toBeLessThanOrEqual(2)
    const loud = rmsDb(y, 0, Math.round(0.4 * rate))
    const tail = rmsDb(y, Math.round(0.45 * rate), Math.round(0.9 * rate))
    expect(tail).toBeGreaterThan(-75)
    expect(tail).toBeLessThan(loud - 15)
  }, 60_000)

  it('is deterministic and handles a stereo voice', async () => {
    const signal = new AbortController().signal
    const mono = word()
    const st = new Float32Array(mono.length * 2)
    for (let i = 0; i < mono.length; i++) st[2 * i] = st[2 * i + 1] = mono[i] as number
    const voice = path.join(tmp, 'stereo.wav')
    await writeWav(voice, st, rate, 2)
    const o1 = path.join(tmp, 'a.wav')
    const o2 = path.join(tmp, 'b.wav')
    await applyRoom(MEDIA!, { voice, out: o1, seed: 4, signal })
    await applyRoom(MEDIA!, { voice, out: o2, seed: 4, signal })
    const [x, y] = [await decode(o1, 2), await decode(o2, 2)]
    expect(Buffer.from(x.buffer).equals(Buffer.from(y.buffer))).toBe(true)
    const info = await probe(MEDIA!, o1, signal)
    expect(info.streams.find((s) => s.codec_type === 'audio')?.channels).toBe(2)
    await writeRoomIr(path.join(tmp, 'ir.wav'), roomImpulseResponse())
  }, 60_000)
})

describe.skipIf(hasFfmpeg)('without ffmpeg', () => {
  it.skip(NO_FFMPEG, () => undefined)
})
