// production-7, `presenter.talk` v2 inside `avatar.speak@1` (pipeline-avatar §2.5 b, decision 0034): the presenter of a video
// generated once (several calls only past the engine's longest generation) and cut back on each shot; ONE presenter engine
// for the whole video: a fallback only before the first generation exists, never in the middle (an engine swap mid-run is
// refused); the cache per call; the registration an engine returns; re-crops; the pure planner's rules. Real ffmpeg, a stub
// Cloud. No network.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, Cost } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { probe } from '../../src/engine/media/probe'
import { AvatarParams, avatarSpeak } from '../../src/engine/nodes/avatar-speak'
import { BATCH_DEFAULTS, framingsOf, planBatches } from '../../src/engine/presenter/batch'
import { callLimitS, type TalkClip } from '../../src/engine/presenter/talk'
import type { CloudService } from '../../src/engine/services'
import { MEDIA, NO_FULL_FFMPEG, art, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })

const item = (id: string, startS: number, endS: number, over: Partial<GenItem> = {}): GenItem => ({
  id,
  kind: 'avatar',
  constraints: { durationS: endS - startS, aspect: '16:9' },
  context: { beatText: '', subject: 'Présentateur', keyTerms: [] },
  unitPrice: 4,
  units: Math.ceil(endS - startS),
  priority: 8,
  shotIds: [`av-${id}`],
  voiceRange: { startFrame: Math.round(startS * 30), endFrame: Math.round(endS * 30) },
  layout: 'full',
  ...over
})
const listArt = (items: GenItem[]): Artefact => art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } satisfies GenList as never })
const words = (n: number): Word[] => Array.from({ length: n }, (_, i) => ({ w: `m${i}`, start: 0.25 + i * 0.5, end: 0.6 + i * 0.5, sentence: Math.floor(i / 8), paragraph: 0 }))
const wordsArt = (s: number): Artefact => art('json.words', { value: words(Math.floor(s * 2) - 1) as never, meta: { durationS: s, alignment: 'provider', matched: 1, language: 'fr' } })

async function voice(file: string, seconds: number): Promise<Artefact> {
  await ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:r=48000:seed=3:a=0.3`, '-c:a', 'flac', file])
  return art('audio.voice', { files: [file], meta: { demo: true } })
}

interface Asked {
  engine: string | undefined
  avatarId: string
  seconds: number
  audioS: number
  portraitFile: string | undefined
  resolution: string | undefined
}
/** A Cloud whose talking heads are ffmpeg test patterns as long as the audio; `fail(n, engine)` may throw for call n. */
function stubCloud(asked: Asked[], o: { fail?: (n: number, engine: string | undefined) => Error | null; registration?: string } = {}): CloudService {
  let n = 0
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    generateImage: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    talkingAvatar: async (req, opts) => {
      const err = o.fail?.(++n, req.engine) ?? null
      if (err) throw err
      const a = await probe(media, req.audioFile, signal)
      asked.push({ engine: req.engine, avatarId: req.avatarId, seconds: req.seconds, audioS: a.durationS, portraitFile: req.portraitFile, resolution: req.resolution })
      await mkdir(opts.dir, { recursive: true })
      const file = path.join(opts.dir, 'avatar.mp4')
      await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=640x360:d=${a.durationS.toFixed(3)}:r=30`, '-pix_fmt', 'yuv420p', file])
      return { files: [file], demo: false, credits: 7, ...(o.registration ? { registration: o.registration } : {}) }
    }
  }
}

async function run(o: { seconds: number; items: GenItem[]; params: Record<string, unknown>; cloud: CloudService; dir?: string }) {
  const dir = o.dir ?? work('talk')
  const v = await voice(path.join(dir, 'voice.flac'), o.seconds)
  const costs: Cost[] = []
  const ctx = makeCtx({ ...testServices(dir), cloud: o.cloud }, { costs })
  const out = await avatarSpeak.run(ctx, { genlist: listArt(o.items), voice: v, words: wordsArt(o.seconds) }, AvatarParams.parse(o.params))
  return { out, clips: out.clips?.value as unknown as TalkClip[], meta: out.clips?.meta as Record<string, unknown>, costs }
}

describe('the presenter planner (pure)', () => {
  const o = { ...BATCH_DEFAULTS, maxCallS: 60, voiceS: 600 }
  it('a call is never longer than the Cloud can bring back (Marcel’s 162 s HeyGen call, ≈ 97 MB at 1080p, was not downloaded)', () => {
    // the Cloud downloads a provider file up to 40 MB; a 1080p presenter is about 4.8 Mbit/s
    expect(callLimitS('presenter:heygen-mcp')).toBe(60)
    expect(callLimitS('presenter:kling-avatar-kie')).toBe(60)
    expect(callLimitS('presenter:hedra-c3')).toBe(60)
    expect(callLimitS(undefined)).toBe(60)
    expect(callLimitS('presenter:heygen-mcp') * 4.8e6 / 8).toBeLessThan(40 * 1024 * 1024)
    // 209 s of presenter (Marcel's 13 min video): every call within the limit
    const shots = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, startS: i * 15, endS: i * 15 + 4.1 }))
    const plan = planBatches(shots, { ...BATCH_DEFAULTS, maxCallS: callLimitS('presenter:heygen-mcp'), voiceS: 780 })
    for (const c of plan.calls) expect(c.seconds).toBeLessThanOrEqual(60)
  })
  it('joins two shots when generating the gap costs less than two handles and a silence; else two stretches', () => {
    const p = planBatches([{ id: 'a', startS: 10, endS: 14 }, { id: 'b', startS: 14.4, endS: 18 }, { id: 'c', startS: 30, endS: 34 }], o)
    expect(p.stretches.map((s) => s.shots)).toEqual([['a', 'b'], ['c']])
    expect(p.stretches[0]).toMatchObject({ fromS: 9.8, toS: 18.2 })
    expect(p.calls).toHaveLength(1)
    // the second stretch after the first and a silence; each shot found again at its own offset
    expect(p.calls[0]?.pieces.map((x) => x.atS)).toEqual([0, 8.5])
    expect(p.cuts).toEqual([
      { shotId: 'a', call: 0, offsetS: 0.2, durationS: 4 },
      { shotId: 'b', call: 0, offsetS: 4.6, durationS: 3.6 },
      { shotId: 'c', call: 0, offsetS: 8.7, durationS: 4 }
    ])
    expect(p.generatedS).toBe(12.9)
  })
  it('starts a new call only past the engine’s longest generation, and keeps the handles inside the voice', () => {
    const shots = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, startS: i * 10, endS: i * 10 + 5 }))
    const p = planBatches(shots, { ...o, voiceS: 115 })
    for (const c of p.calls) expect(c.seconds).toBeLessThanOrEqual(60)
    expect(p.calls.length).toBe(2)
    expect(p.stretches[0]?.fromS).toBe(0)
    expect(p.stretches.at(-1)?.toS).toBe(115)
  })
  it('makes each angle its own series of calls; a shot longer than one generation is refused', () => {
    const p = planBatches([{ id: 'a', startS: 0, endS: 4, source: 'medium' }, { id: 'b', startS: 6, endS: 9, source: 'close' }, { id: 'c', startS: 12, endS: 15, source: 'medium' }], o)
    expect(p.calls.map((c) => c.source)).toEqual(['medium', 'close'])
    expect(p.cuts.map((c) => c.call)).toEqual([0, 1, 0])
    expect(() => planBatches([{ id: 'x', startS: 0, endS: 70 }], o)).toThrow(/longer than the engine/)
  })
  it('gives neighbours different framings with re-crops and angles, the portrait otherwise', () => {
    expect(framingsOf(3, 'single')).toEqual(['medium', 'medium', 'medium'])
    const r = framingsOf(7, 'recrops')
    expect(r[0]).toBe('wide')
    for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1])
    expect(framingsOf(4, 'multi', ['medium', 'wide', 'close'])).toEqual(['medium', 'wide', 'close', 'medium'])
  })
})

describe.skipIf(!hasFullFfmpeg)(`avatar.speak with talk: one generation, then cut${NO_FULL_FFMPEG}`, () => {
  const items = [item('a', 0, 3), item('b', 8, 12), item('c', 12.4, 15)]

  it('makes the whole presenter in one call on the pinned engine, sends the portrait, cuts every shot to its frames', { timeout: 120_000 }, async () => {
    const dir = work('talk-one')
    const portrait = path.join(dir, 'portrait.png')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x334455:s=320x180:d=1', '-frames:v', '1', portrait])
    const asked: Asked[] = []
    const r = await run({
      dir,
      seconds: 20,
      items,
      cloud: stubCloud(asked),
      params: { avatarId: 'portrait', engine: 'presenter:hedra-c3', fallbacks: ['presenter:kling-avatar2-std'], presenter: { id: 'p1', portrait }, talk: { resolution: '720p' } }
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ engine: 'presenter:hedra-c3', portraitFile: portrait, resolution: '720p' })
    // 3 s + 4 s + 2.6 s shown; handles 0.2 on each side of two stretches (b and c are one), a 0.1 s silence between them
    expect(asked[0]?.audioS).toBeCloseTo(3.2 + 0.1 + 7.4, 1)
    expect(r.meta).toMatchObject({ calls: 1, engine: 'presenter:hedra-c3', shownS: 9.6 })
    expect(r.clips.map((c) => [c.itemId, c.call, c.framing, c.engine])).toEqual([
      ['a', 0, 'medium', 'presenter:hedra-c3'],
      ['b', 0, 'medium', 'presenter:hedra-c3'],
      ['c', 0, 'medium', 'presenter:hedra-c3']
    ])
    for (const [i, c] of r.clips.entries()) {
      const p = await probe(media, r.out.clips?.files?.[i] as string, signal)
      expect(Math.abs(p.durationS - (c.endFrame - c.startFrame) / 30)).toBeLessThan(0.05)
      expect(p.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1920, height: 1080 })
    }
    expect(r.costs).toEqual([{ units: [{ unit: 'avatar_s', qty: 11 }], provider: 'avatar' }])

    // the same video again: every call from the cache, nothing billed
    const again: Asked[] = []
    const r2 = await run({ dir, seconds: 20, items, cloud: stubCloud(again), params: { avatarId: 'portrait', engine: 'presenter:hedra-c3', presenter: { id: 'p1', portrait }, talk: { resolution: '720p' } } })
    expect(again).toHaveLength(0)
    expect(r2.clips).toHaveLength(3)
  })

  it('splits only at the engine’s longest generation', { timeout: 180_000 }, async () => {
    const long = Array.from({ length: 10 }, (_, i) => item(`s${i}`, i * 9, i * 9 + 6))
    const asked: Asked[] = []
    const r = await run({ seconds: 90, items: long, cloud: stubCloud(asked), params: { engine: 'presenter:hedra-c3', talk: {} } })
    expect(asked.length).toBe(2)
    for (const a of asked) expect(a.audioS).toBeLessThanOrEqual(60.05)
    expect(r.clips).toHaveLength(10)
  })

  it('falls back to the next engine for the WHOLE presenter when the first fails before any generation', { timeout: 120_000 }, async () => {
    const asked: Asked[] = []
    const long = Array.from({ length: 10 }, (_, i) => item(`s${i}`, i * 9, i * 9 + 6))
    const cloud = stubCloud(asked, { fail: (_n, engine) => (engine === 'presenter:hedra-c3' ? new EngineError('transient', 'Hedra is down') : null) })
    const r = await run({ seconds: 90, items: long, cloud, params: { engine: 'presenter:hedra-c3', fallbacks: ['presenter:kling-avatar2-std'], talk: {}, parallel: 1 } })
    expect(asked.map((a) => a.engine)).toEqual(['presenter:kling-avatar2-std', 'presenter:kling-avatar2-std'])
    expect(new Set(r.clips.map((c) => c.engine))).toEqual(new Set(['presenter:kling-avatar2-std']))
  })

  it('refuses an engine swap mid-run: once a generation exists, a failure is reported and no other engine takes over', { timeout: 120_000 }, async () => {
    const asked: Asked[] = []
    const long = Array.from({ length: 10 }, (_, i) => item(`s${i}`, i * 9, i * 9 + 6))
    // the first call works on Hedra, the second fails: Kling must never be asked
    const cloud = stubCloud(asked, { fail: (n) => (n === 2 ? new EngineError('transient', 'Hedra timed out') : null) })
    const err = await run({ seconds: 90, items: long, cloud, params: { engine: 'presenter:hedra-c3', fallbacks: ['presenter:kling-avatar2-std'], talk: {}, parallel: 1 } }).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).message).toMatch(/au milieu de la vidéo/)
    expect(asked.map((a) => a.engine)).toEqual(['presenter:hedra-c3'])
  })

  it('keeps the registration an engine returns, and re-crops the one generation for « recadrages »', { timeout: 120_000 }, async () => {
    const asked: Asked[] = []
    const r = await run({
      seconds: 20,
      items,
      cloud: stubCloud(asked, { registration: 'look-77' }),
      params: { engine: 'presenter:heygen-avatar4', talk: { framing: 'recrops', resolution: '1080p' } }
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]?.resolution).toBe('1080p')
    expect(r.meta.registrations).toEqual({ 'presenter:heygen-avatar4': 'look-77' })
    expect(r.clips.map((c) => c.framing)).toEqual(['wide', 'medium', 'close'])
    // the registration is used instead of the portrait label on the next video
    const next: Asked[] = []
    await run({ seconds: 20, items: [item('z', 1, 4)], cloud: stubCloud(next), params: { engine: 'presenter:heygen-avatar4', presenter: { id: 'p', registrations: { 'presenter:heygen-avatar4': 'look-77' } }, talk: {} } })
    expect(next[0]?.avatarId).toBe('look-77')
  })
})
