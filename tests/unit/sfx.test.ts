// Sound effects (src/engine/media/sfx.ts): the library holds real recordings, valid, credited and present; a recording is picked
// per event without repeating the last ones of its kind, with a bounded seeded variation; synthesis is opt-in (an event with no
// recording is dropped and reported); synthesised kinds stay deterministic at the right level; events merge and land on their time,
// the stem never clips, the mix over a bed keeps its length; recordings are cut into takes and checked against their kind.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildSfxStem,
  buildSfxStemReport,
  loadSfxLibrary,
  lowBandShare,
  mergeEvents,
  mixStemInto,
  pickAvoidingRecent,
  resampleRate,
  SFX_KINDS,
  SFX_RATE,
  SfxLibraryFile,
  sfxVariation,
  spectralCentroid,
  synthSfx,
  writeSfxStem,
  type SfxEvent,
  type SfxKind
} from '../../src/engine/media/sfx'
import { describeSfx, findSoundEvents, sfxKindFit } from '../../src/engine/media/sfx-analysis'
import { writeWav } from '../../src/engine/media/wav'
import { hasFfmpeg, MEDIA, NO_FFMPEG } from './engine-node-helpers'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-sfx-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12))
const peakOf = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const argmax = (a: Float32Array): number => {
  let best = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] as number) > Math.abs(a[best] as number)) best = i
  return best
}
/** Seconds during which the sound stays within `floorDb` of its peak (short-window RMS). */
function significantS(a: Float32Array, floorDb: number): number {
  const w = 48
  const limit = peakOf(a) * Math.pow(10, floorDb / 20)
  let n = 0
  for (let i = 0; i + w <= a.length; i += w) {
    let s = 0
    for (let j = 0; j < w; j++) s += (a[i + j] as number) ** 2
    if (Math.sqrt(s / w) > limit) n += w
  }
  return n / SFX_RATE
}
const lengthS = (k: SfxKind): number => synthSfx(k, 3).samples.length / SFX_RATE

describe('synthSfx', () => {
  for (const kind of SFX_KINDS) {
    it(`${kind}: deterministic, about -1 dBFS, key moment inside it`, () => {
      const a = synthSfx(kind, 7)
      const b = synthSfx(kind, 7)
      expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true)
      expect(a.peakS).toBe(b.peakS)
      expect(a.samples.length).toBeGreaterThan(SFX_RATE * 0.01)
      const p = db(peakOf(a.samples))
      expect(p).toBeLessThanOrEqual(-0.9)
      expect(p).toBeGreaterThan(-6)
      expect(a.peakS).toBeGreaterThanOrEqual(0)
      expect(a.peakS).toBeLessThanOrEqual(a.samples.length / SFX_RATE)
      expect(a.samples.every(Number.isFinite)).toBe(true)
    })
    it(`${kind}: another seed gives another sound`, () => {
      const a = synthSfx(kind, 1).samples
      const b = synthSfx(kind, 2).samples
      expect(a.length !== b.length || a.some((v, i) => v !== b[i])).toBe(true)
    })
  }

  it('lengths and energy sit where each recipe says', () => {
    expect(lengthS('whoosh')).toBeGreaterThan(0.33)
    expect(lengthS('whoosh')).toBeLessThan(0.55)
    expect(lengthS('whoosh-soft')).toBeGreaterThan(lengthS('whoosh'))
    expect(lengthS('paper')).toBeGreaterThan(0.23)
    expect(lengthS('paper')).toBeLessThan(0.42)
    expect(lengthS('pop')).toBeLessThan(0.12)
    expect(lengthS('impact')).toBeGreaterThan(0.5)
    expect(lengthS('stamp')).toBeLessThan(0.32)
    expect(lengthS('riser')).toBeGreaterThan(1.0)
    expect(lengthS('tick')).toBeLessThan(0.1)
    // impact: a low thump, most of its energy under 200 Hz
    expect(lowBandShare(synthSfx('impact', 3).samples, 200)).toBeGreaterThan(0.6)
    // click: a transient, less than 30 ms of significant energy
    expect(significantS(synthSfx('click', 3).samples, -30)).toBeLessThan(0.03)
    // whoosh swells then falls: its peak sits near 70 %
    const w = synthSfx('whoosh', 3)
    expect(w.peakS / (w.samples.length / SFX_RATE)).toBeGreaterThan(0.6)
    expect(w.peakS / (w.samples.length / SFX_RATE)).toBeLessThan(0.8)
    // the soft whoosh is darker; paper is far brighter than the stamp's thud; the riser ends at its peak
    expect(spectralCentroid(synthSfx('whoosh-soft', 3).samples)).toBeLessThan(spectralCentroid(w.samples))
    expect(spectralCentroid(synthSfx('paper', 3).samples)).toBeGreaterThan(spectralCentroid(synthSfx('stamp', 3).samples) * 4)
    const r = synthSfx('riser', 3)
    expect(r.peakS).toBeGreaterThan((r.samples.length / SFX_RATE) * 0.97)
  })
})

describe('mergeEvents', () => {
  it('sorts, and keeps the first of a same-kind pair closer than 80 ms', () => {
    const ev: SfxEvent[] = [
      { atS: 2, kind: 'pop' },
      { atS: 1.05, kind: 'click' },
      { atS: 1, kind: 'click' },
      { atS: 1.02, kind: 'pop' },
      { atS: 1.2, kind: 'click' }
    ]
    expect(mergeEvents(ev).map((e) => `${e.kind}@${e.atS}`)).toEqual(['click@1', 'pop@1.02', 'click@1.2', 'pop@2'])
  })
  it('a chain of close events is measured against the one kept', () => {
    const ev: SfxEvent[] = [0, 0.05, 0.1, 0.15].map((atS) => ({ atS, kind: 'tick' as const }))
    expect(mergeEvents(ev).map((e) => e.atS)).toEqual([0, 0.1])
  })
  it('does not mutate its input', () => {
    const ev: SfxEvent[] = [
      { atS: 2, kind: 'pop' },
      { atS: 1, kind: 'pop' }
    ]
    mergeEvents(ev)
    expect(ev[0]?.atS).toBe(2)
  })
})

describe('buildSfxStem', () => {
  it('puts a click peak within 2 ms of its time, at the base level', async () => {
    const stem = await buildSfxStem({ events: [{ atS: 1.5, kind: 'click' }], durationS: 3, seed: 5, allowSynth: true })
    expect(stem.length).toBe(3 * SFX_RATE)
    expect(Math.abs(argmax(stem) / SFX_RATE - 1.5)).toBeLessThan(0.002)
    expect(db(peakOf(stem))).toBeGreaterThan(-20.5)
    expect(db(peakOf(stem))).toBeLessThan(-19.5)
  })
  it('honours gainDb and levelDb', async () => {
    const base = peakOf(await buildSfxStem({ events: [{ atS: 1, kind: 'pop' }], durationS: 2, seed: 1, allowSynth: true }))
    const louder = peakOf(await buildSfxStem({ events: [{ atS: 1, kind: 'pop', gainDb: 6 }], durationS: 2, seed: 1, allowSynth: true }))
    const lower = peakOf(await buildSfxStem({ events: [{ atS: 1, kind: 'pop' }], durationS: 2, seed: 1, levelDb: -26, allowSynth: true }))
    expect(db(louder) - db(base)).toBeGreaterThan(5.8)
    expect(db(louder) - db(base)).toBeLessThan(6.2)
    expect(db(base) - db(lower)).toBeGreaterThan(5.8)
    expect(db(base) - db(lower)).toBeLessThan(6.2)
  })
  it('clips the head at 0 and the tail at durationS, and is deterministic', async () => {
    const o = {
      events: [
        { atS: 0.01, kind: 'impact' as const },
        { atS: 1.99, kind: 'whoosh' as const },
        { atS: 5, kind: 'pop' as const }
      ],
      durationS: 2,
      seed: 9,
      allowSynth: true
    }
    const a = await buildSfxStem(o)
    const b = await buildSfxStem(o)
    expect(a.length).toBe(2 * SFX_RATE)
    expect(a.every(Number.isFinite)).toBe(true)
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
  })
  it('stays under -1 dBFS with 30 overlapping impacts, even at full level', async () => {
    // same-kind events closer than 80 ms merge, so the impacts are 100 ms apart and overlap through their 0.6 s tails
    const impacts: SfxEvent[] = Array.from({ length: 30 }, (_, i) => ({ atS: 0.5 + i * 0.1, kind: 'impact', gainDb: 17 }))
    const loud = await buildSfxStem({ events: impacts, durationS: 5, seed: 2, levelDb: 0, allowSynth: true })
    expect(db(peakOf(loud))).toBeLessThanOrEqual(-0.99)
    expect(db(peakOf(loud))).toBeGreaterThan(-1.2)
    const normal = await buildSfxStem({ events: impacts.map((e) => ({ ...e, gainDb: 0 })), durationS: 5, seed: 2, allowSynth: true })
    expect(db(peakOf(normal))).toBeLessThanOrEqual(-0.99)
  })
  it('writes a stereo 48 kHz 16-bit WAV', async () => {
    const f = path.join(tmp, 'stem.wav')
    await writeSfxStem({ events: [{ atS: 0.5, kind: 'stamp' }], durationS: 1, seed: 3, allowSynth: true, out: f })
    const buf = await readFile(f)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.readUInt16LE(22)).toBe(2)
    expect(buf.readUInt32LE(24)).toBe(48000)
    expect(buf.readUInt16LE(34)).toBe(16)
    expect(buf.readUInt32LE(40)).toBe(48000 * 4)
  })
})

describe('library', () => {
  const file = (sounds: unknown[]): unknown => ({ version: 1, sounds })
  const ok = { id: 'w1', kind: 'whoosh', file: 'w1.wav', licence: 'CC0-1.0', peakS: 0.1 }
  it('accepts a well-formed file and rejects a bad kind, a bad version, an escaping path, a missing licence', () => {
    expect(SfxLibraryFile.safeParse(file([ok])).success).toBe(true)
    expect(SfxLibraryFile.safeParse(file([{ ...ok, source: 'https://example.org/x' }])).success).toBe(true)
    expect(SfxLibraryFile.safeParse(file([{ ...ok, kind: 'boing' }])).success).toBe(false)
    expect(SfxLibraryFile.safeParse({ version: 2, sounds: [] }).success).toBe(false)
    expect(SfxLibraryFile.safeParse(file([{ ...ok, file: '../w1.wav' }])).success).toBe(false)
    expect(SfxLibraryFile.safeParse(file([{ ...ok, licence: undefined }])).success).toBe(false)
  })
  it('takes only CC0, public domain or CC BY, and a CC BY sound only with its author, source and credit', () => {
    for (const licence of ['CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'CC-BY-ND-4.0', 'Sampling+', 'unknown']) {
      expect(SfxLibraryFile.safeParse(file([{ ...ok, licence }])).success).toBe(false)
    }
    expect(SfxLibraryFile.safeParse(file([{ ...ok, licence: 'PD' }])).success).toBe(true)
    expect(SfxLibraryFile.safeParse(file([{ ...ok, licence: 'CC-BY-4.0' }])).success).toBe(false)
    const credited = { ...ok, licence: 'CC-BY-4.0', author: 'A', source: 'https://example.org/x', credit: 'x — A, CC BY 4.0, via Example' }
    expect(SfxLibraryFile.safeParse(file([credited])).success).toBe(true)
  })
  it('a missing file is an empty library; a bad one throws', async () => {
    expect((await loadSfxLibrary(path.join(tmp, 'nowhere'))).sounds).toEqual([])
    const bad = path.join(tmp, 'bad')
    await mkdir(path.join(bad, 'sfx'), { recursive: true })
    await writeFile(path.join(bad, 'sfx', 'library.json'), JSON.stringify(file([{ ...ok, kind: 'boing' }])))
    await expect(loadSfxLibrary(bad)).rejects.toThrow(/invalid/)
  })
  it('the shipped library: valid, every file exists, at least 4 recordings per kind, all credited, under 4 MB', async () => {
    const resources = path.join(__dirname, '..', '..', 'resources')
    const lib = await loadSfxLibrary(resources)
    let bytes = 0
    for (const f of readdirSync(lib.dir)) bytes += statSync(path.join(lib.dir, f)).size
    expect(bytes).toBeLessThan(4 * 1024 * 1024)
    const credits = readFileSync(path.join(lib.dir, 'CREDITS.md'), 'utf8')
    for (const kind of SFX_KINDS) expect(lib.sounds.filter((s) => s.kind === kind).length, kind).toBeGreaterThanOrEqual(4)
    expect(new Set(lib.sounds.map((s) => s.id)).size).toBe(lib.sounds.length)
    for (const s of lib.sounds) {
      expect(existsSync(path.join(lib.dir, s.file)), s.file).toBe(true)
      expect(['CC0-1.0', 'PD', 'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0']).toContain(s.licence)
      expect(s.author && s.source && s.credit, s.id).toBeTruthy()
      expect(credits).toContain(s.file)
      expect(s.peakS).toBeLessThanOrEqual(s.durationS ?? Infinity)
      expect(s.durationS ?? 0).toBeLessThanOrEqual(s.kind === 'riser' ? 3.05 : 1.55)
    }
  })
  it.skipIf(!hasFfmpeg)('a library recording plays for its kind; a kind without one is dropped and reported, synthesised only on request (needs ffmpeg)', async () => {
    const root = path.join(tmp, 'lib')
    await mkdir(path.join(root, 'sfx'), { recursive: true })
    // a recording whose only loud samples are at 0.2 s
    const rec = new Float32Array(SFX_RATE / 2)
    rec[Math.round(0.2 * SFX_RATE)] = 0.5
    rec[Math.round(0.2 * SFX_RATE) + 1] = -0.5
    await writeWav(path.join(root, 'sfx', 'tick.wav'), rec, SFX_RATE, 1)
    await writeFile(path.join(root, 'sfx', 'library.json'), JSON.stringify(file([{ id: 't', kind: 'tick', file: 'tick.wav', licence: 'CC0-1.0', peakS: 0.2 }])))
    const library = await loadSfxLibrary(root)
    const events: SfxEvent[] = [
      { atS: 1, kind: 'tick' },
      { atS: 2, kind: 'pop' }
    ]
    const { samples: stem, report } = await buildSfxStemReport({ events, durationS: 3, seed: 1, library, media: MEDIA ?? undefined })
    expect(Math.abs(argmax(stem.subarray(0, 1.5 * SFX_RATE)) / SFX_RATE - 1)).toBeLessThan(0.002)
    // a two-sample recording: only a couple of non-zero samples around 1 s, unlike the 70 ms synthesised tick
    let nonZero = 0
    for (let i = 0; i < 1.5 * SFX_RATE; i++) if (Math.abs(stem[i] as number) > 1e-6) nonZero++
    expect(nonZero).toBeLessThan(10)
    // pop is not in the library: silent by default, and reported
    expect(peakOf(stem.subarray(1.9 * SFX_RATE))).toBe(0)
    expect(report.placed).toEqual([{ atS: 1, kind: 'tick', file: 'tick.wav' }])
    expect(report.dropped).toEqual([{ atS: 2, kind: 'pop', reason: 'no-recording' }])
    // opted in: synthesised
    const synth = await buildSfxStemReport({ events, durationS: 3, seed: 1, library, media: MEDIA ?? undefined, allowSynth: true })
    expect(peakOf(synth.samples.subarray(1.9 * SFX_RATE))).toBeGreaterThan(0.05)
    expect(synth.report.placed.map((p) => p.file)).toEqual(['tick.wav', 'synth'])
    expect(synth.report.dropped).toEqual([])
  })
  it.skipIf(!hasFfmpeg)('never plays the same recording twice in a row for a kind, nor one of the last two when there are three or more (needs ffmpeg)', async () => {
    const root = path.join(tmp, 'lib4')
    await mkdir(path.join(root, 'sfx'), { recursive: true })
    const sounds = []
    for (let n = 0; n < 4; n++) {
      const rec = new Float32Array(SFX_RATE / 10)
      rec[100 + n] = 0.5
      await writeWav(path.join(root, 'sfx', `w${n}.wav`), rec, SFX_RATE, 1)
      sounds.push({ id: `w${n}`, kind: 'whoosh', file: `w${n}.wav`, licence: 'CC0-1.0', peakS: 0.002 })
    }
    await writeFile(path.join(root, 'sfx', 'library.json'), JSON.stringify(file(sounds)))
    const library = await loadSfxLibrary(root)
    const events: SfxEvent[] = Array.from({ length: 40 }, (_, i) => ({ atS: 0.5 + i * 0.3, kind: 'whoosh' }))
    for (const seed of [1, 2, 3]) {
      const a = await buildSfxStemReport({ events, durationS: 13, seed, library, media: MEDIA ?? undefined })
      const files = a.report.placed.map((p) => p.file)
      expect(files).toHaveLength(40)
      for (let i = 2; i < files.length; i++) {
        expect(files[i]).not.toBe(files[i - 1])
        expect(files[i]).not.toBe(files[i - 2])
      }
      expect(new Set(files).size).toBe(4)
      const b = await buildSfxStemReport({ events, durationS: 13, seed, library, media: MEDIA ?? undefined })
      expect(b.report.placed).toEqual(a.report.placed)
      expect(Buffer.from(b.samples.buffer).equals(Buffer.from(a.samples.buffer))).toBe(true)
    }
  })
})

describe('picking and varying a recording', () => {
  const ch = (n: number): { file: string }[] => Array.from({ length: n }, (_, i) => ({ file: `f${i}` }))
  it('never returns the last file; with three or more choices, not the last two either', () => {
    for (let r = 0; r < 1; r += 0.01) {
      expect(pickAvoidingRecent(ch(2), ['f0'], r)?.file).toBe('f1')
      expect(['f0', 'f1']).not.toContain(pickAvoidingRecent(ch(3), ['f0', 'f1'], r)?.file)
      expect(['f2', 'f3']).not.toContain(pickAvoidingRecent(ch(5), ['f1', 'f2', 'f3'], r)?.file)
    }
    // one choice: it plays (better the same sound than none); none: nothing
    expect(pickAvoidingRecent(ch(1), ['f0'], 0.5)?.file).toBe('f0')
    expect(pickAvoidingRecent([], [], 0.5)).toBeUndefined()
  })
  it('the variation is seeded and stays within +/- 2 dB and +/- 4 %', () => {
    expect(sfxVariation(42)).toEqual(sfxVariation(42))
    const vs = Array.from({ length: 500 }, (_, i) => sfxVariation(i * 7919 + 1))
    for (const v of vs) {
      expect(Math.abs(v.gainDb)).toBeLessThanOrEqual(2)
      expect(Math.abs(v.rate - 1)).toBeLessThanOrEqual(0.04)
    }
    expect(new Set(vs.map((v) => v.rate.toFixed(4))).size).toBeGreaterThan(300)
    expect(Math.max(...vs.map((v) => v.gainDb)) - Math.min(...vs.map((v) => v.gainDb))).toBeGreaterThan(3)
  })
  it('resampling changes the length by the rate and keeps a spike in place, scaled', () => {
    const a = new Float32Array(1000)
    a[500] = 1
    const fast = resampleRate(a, 1.04)
    expect(Math.abs(fast.length - 1000 / 1.04)).toBeLessThan(2)
    expect(Math.abs(argmax(fast) - 500 / 1.04)).toBeLessThan(1.5)
    expect(resampleRate(a, 1)).not.toBe(a)
  })
  it('without a library and without allowSynth every event is dropped and reported, and the stem is silent', async () => {
    const events: SfxEvent[] = [
      { atS: 0.5, kind: 'whoosh' },
      { atS: 1, kind: 'impact' }
    ]
    const { samples, report } = await buildSfxStemReport({ events, durationS: 2, seed: 1 })
    expect(peakOf(samples)).toBe(0)
    expect(report.placed).toEqual([])
    expect(report.dropped.map((d) => d.kind)).toEqual(['whoosh', 'impact'])
    const on = await buildSfxStemReport({ events, durationS: 2, seed: 1, allowSynth: true })
    expect(on.report.placed.map((p) => p.file)).toEqual(['synth', 'synth'])
    expect(peakOf(on.samples)).toBeGreaterThan(0.05)
  })
})

describe('cutting and checking recordings', () => {
  it('finds the separate takes of a recording', () => {
    const a = new Float32Array(SFX_RATE * 2)
    for (const at of [0.3, 0.9, 1.5]) a.set(synthSfx('click', 1).samples, Math.round(at * SFX_RATE))
    const ev = findSoundEvents(a, SFX_RATE, { gapS: 0.08 })
    expect(ev).toHaveLength(3)
    expect(Math.abs((ev[1]?.start ?? 0) / SFX_RATE - 0.9)).toBeLessThan(0.02)
  })
  it('a click fits click and not whoosh; a riser fits riser; a clipped sound fits nothing', () => {
    const click = describeSfx(synthSfx('click', 2).samples)
    expect('score' in sfxKindFit('click', click)).toBe(true)
    expect('reason' in sfxKindFit('whoosh', click)).toBe(true)
    expect('score' in sfxKindFit('riser', describeSfx(synthSfx('riser', 2).samples))).toBe(true)
    const clipped = synthSfx('impact', 2).samples.map((v) => Math.max(-1, Math.min(1, v * 4)))
    expect(sfxKindFit('impact', describeSfx(clipped))).toEqual({ reason: 'clipped' })
  })
})

describe.skipIf(!hasFfmpeg)(`mixStemInto (${NO_FFMPEG})`, () => {
  it('lays the stem over the bed without changing levels or length (WAV and m4a)', async () => {
    const media = MEDIA as NonNullable<typeof MEDIA>
    const bed = path.join(tmp, 'bed.wav')
    const bedStereo = new Float32Array(2 * 2 * SFX_RATE)
    for (let i = 0; i < bedStereo.length; i += 2) bedStereo[i] = bedStereo[i + 1] = 0.1 * Math.sin((2 * Math.PI * 220 * (i / 2)) / SFX_RATE)
    await writeWav(bed, bedStereo, SFX_RATE, 2)
    const stem = path.join(tmp, 'mix-stem.wav')
    await writeSfxStem({ events: [{ atS: 1, kind: 'impact', gainDb: 10 }], durationS: 1.5, seed: 4, allowSynth: true, out: stem }) // shorter than the bed
    const ctl = new AbortController()
    const wavOut = path.join(tmp, 'mixed.wav')
    await mixStemInto({ media, bed, stem, out: wavOut, signal: ctl.signal })
    const m4aOut = path.join(tmp, 'mixed.m4a')
    await mixStemInto({ media, bed, stem, out: m4aOut, signal: ctl.signal })
    for (const f of [wavOut, m4aOut]) {
      const p = await media.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { signal: ctl.signal })
      expect(Math.abs(Number(p.stdout.toString().trim()) - 2)).toBeLessThan(0.1)
    }
    // before the effect the output is the bed alone: 0.1 peak, not halved
    const { stdout, done } = media.stream('ffmpeg', ['-v', 'error', '-i', wavOut, '-t', '0.9', '-af', 'pan=mono|c0=c0', '-f', 'f32le', '-ar', '48000', '-'], { signal: ctl.signal })
    const chunks: Buffer[] = []
    for await (const c of stdout) chunks.push(Buffer.from(c))
    await done
    const buf = Buffer.concat(chunks)
    const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))
    expect(peakOf(pcm)).toBeGreaterThan(0.098)
    expect(peakOf(pcm)).toBeLessThan(0.102)
  })
})
