// Generated video in visuals.fulfil (docs/ENGINE-SPEC.md §23): a `video.gen` item is a Cloud `generateVideo` job (the director's
// prompt, the shot's length cut at the provider's longest clip, the plan's aspect), stored as a clip with a record; its picture
// is the clip's first frame; in demo mode the clip is drawn locally. Real ffmpeg on tiny clips, a stub Cloud, no network.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, Cost } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { visualsFulfil, VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import type { CloudService } from '../../src/engine/services'
import { MEDIA, NO_FFMPEG, NO_FULL_FFMPEG, art, hasFfmpeg, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

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

function item(id: string, kind: GenItem['kind'], durationS: number, aspect: '16:9' | '9:16' = '16:9'): GenItem {
  return {
    id,
    kind,
    ...(kind === 'stock.photo' ? { query: `query ${id}` } : { prompt: `une falaise battue par les vagues ${id}` }),
    constraints: { durationS, aspect },
    context: { beatText: `beat ${id}`, subject: `Sujet ${id}`, keyTerms: [] },
    unitPrice: 1,
    units: 1,
    priority: 1,
    shotIds: [`s-${id}`]
  }
}
const listArt = (items: GenItem[], meta: Record<string, number> = {}): Artefact =>
  art('json.genlist', { value: { items, totals: { credits: items.length, items: items.length, byKind: {} }, budget: null } satisfies GenList as never, meta })

interface Calls {
  video: { prompt: string; seconds: number; aspect: string; key: string }[]
  image: string[]
}
/** A Cloud whose pictures and clips are ffmpeg test patterns (a 3 s, 640x360 clip), counted. */
function stubCloud(calls: Calls, fail?: Error): CloudService {
  const make = async (dir: string, name: string, args: string[]): Promise<string> => {
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await media.run('ffmpeg', ['-v', 'error', '-y', ...args, file], { signal })
    return file
  }
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used')),
    generateImage: async (req, opts) => {
      calls.image.push(req.prompt)
      return { files: [await make(opts.dir, 'gen.png', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-frames:v', '1'])], demo: false, credits: 1 }
    },
    generateVideo: async (req, opts) => {
      calls.video.push({ prompt: req.prompt, seconds: req.seconds, aspect: req.aspect, key: opts.idempotencyKey })
      if (fail) throw fail
      const size = req.aspect === '9:16' ? '360x640' : '640x360'
      return { files: [await make(opts.dir, 'clip.mp4', ['-f', 'lavfi', '-i', `testsrc2=s=${size}:d=3:r=10`, '-pix_fmt', 'yuv420p'])], demo: false, credits: 5 }
    }
  }
}
const newCalls = (): Calls => ({ video: [], image: [] })

const info = async (file: string): Promise<{ v: StreamInfo; audio: number; durationS: number }> => {
  const p = await probe(media, file, signal)
  return { v: p.streams.find((s) => s.codec_type === 'video') as StreamInfo, audio: p.streams.filter((s) => s.codec_type === 'audio').length, durationS: p.durationS }
}
interface Rec {
  itemId: string
  file: number
  demo: boolean
  video?: true
  degraded?: string
}
const params = VisualsParams.parse({ parallel: 2 })

describe.skipIf(!hasFfmpeg)(`visuals.fulfil run: generated video (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  it('asks the Cloud for the clip with the director’s prompt, the shot’s seconds cut at the longest clip and the plan’s aspect; stores it with a record and a picture', { timeout: 120_000 }, async () => {
    const dir = work('video-run')
    const calls = newCalls()
    const costs: Cost[] = []
    const list = [item('a', 'image.gen', 4), item('b', 'video.gen', 3.2), item('c', 'video.gen', 14)]
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(calls) }), { costs }), { list: listArt(list) }, params)
    // two clips, asked in the shot's seconds (3.2 s → 4) or the provider's longest (14 s → 10), 16:9, one key each
    expect(calls.video.map((c) => [c.seconds, c.aspect]).sort()).toEqual([[10, '16:9'], [4, '16:9']])
    expect(calls.video.every((c) => c.prompt.startsWith('une falaise battue par les vagues') && /camera movement/.test(c.prompt) && c.key.startsWith('video-'))).toBe(true)
    expect(new Set(calls.video.map((c) => c.key)).size).toBe(2)
    expect(calls.image).toHaveLength(1)
    // the pictures: every item has one (a clip’s is its first frame), the records say which are videos
    const rec = out.images?.value as unknown as Rec[]
    expect(out.images?.files).toHaveLength(3)
    expect(rec.map((r) => [r.itemId, r.video === true])).toEqual([['a', false], ['b', true], ['c', true]])
    expect(rec.filter((r) => r.degraded)).toEqual([])
    for (const f of out.images?.files ?? []) expect((await info(f)).v).toMatchObject({ width: 1920, height: 1080 })
    // the clips and their record
    expect(out.clips?.files).toHaveLength(2)
    const clips = out.clips?.value as unknown as { itemId: string; file: number; durationS: number; width: number; height: number; demo: boolean }[]
    expect(clips.map((c) => [c.itemId, c.file])).toEqual([['b', 0], ['c', 1]])
    for (const [i, c] of clips.entries()) {
      expect(c).toMatchObject({ width: 640, height: 360, demo: false })
      expect(c.durationS).toBeGreaterThan(2.5)
      expect((await info(out.clips?.files?.[i] as string)).v).toMatchObject({ width: 640, height: 360 })
    }
    expect(out.clips?.meta).toMatchObject({ count: 2, demo: false })
    // billed: one picture, and the video by the second (4 + 10)
    expect(costs).toEqual([{ units: [{ unit: 'images', qty: 1 }, { unit: 'video_s', qty: 14 }], provider: 'image' }])
  })

  it('a vertical list asks for 9:16 clips and keeps the 1080x1920 pictures', { timeout: 120_000 }, async () => {
    const dir = work('video-tall')
    const calls = newCalls()
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(calls) })), { list: listArt([item('a', 'video.gen', 2, '9:16')]) }, params)
    expect(calls.video.map((c) => c.aspect)).toEqual(['9:16'])
    expect((await info(out.images?.files?.[0] as string)).v).toMatchObject({ width: 1080, height: 1920 })
    expect((await info(out.clips?.files?.[0] as string)).v).toMatchObject({ width: 360, height: 640 })
  })

  it('caches the clip per item: a second run asks for nothing and bills nothing, the same files come back', { timeout: 120_000 }, async () => {
    const dir = work('video-cache')
    const calls = newCalls()
    const services = testServices(dir, { cloud: stubCloud(calls) })
    const list = listArt([item('b', 'video.gen', 3)])
    await visualsFulfil.run(makeCtx(services), { list }, params)
    expect(calls.video).toHaveLength(1)
    const costs: Cost[] = []
    const again = await visualsFulfil.run(makeCtx(services, { costs }), { list }, params)
    expect(calls.video).toHaveLength(1)
    expect(costs).toEqual([{ units: [{ unit: 'images', qty: 0 }], provider: 'image' }])
    expect(again.clips?.files).toHaveLength(1)
    expect(again.clips?.value).toMatchObject([{ itemId: 'b', durationS: expect.any(Number) }])
    expect((await info(again.clips?.files?.[0] as string)).v).toMatchObject({ width: 640, height: 360 })
    // another run seed is another clip
    await visualsFulfil.run(makeCtx(services, { seed: 9 }), { list }, params)
    expect(calls.video).toHaveLength(2)
  })

  it('a provider that fails is an error shown, never a silent animated picture', { timeout: 60_000 }, async () => {
    const dir = work('video-fail')
    const calls = newCalls()
    const err = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(calls, new Error('le fournisseur a refusé le prompt')) })), { list: listArt([item('b', 'video.gen', 3)]) }, params).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/refusé/)
  })

  it('#114: a clip the Cloud refused (a demo engine in a real run) degrades that shot to a neighbour picture; the run and the other shots go on', { timeout: 120_000 }, async () => {
    const dir = work('video-degrade')
    const calls = newCalls()
    const refusal = new EngineError('refused', 'Un clip : Atelier Cloud a répondu en démo pendant une fabrication réelle')
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(calls, refusal) })), { list: listArt([item('a', 'image.gen', 4), item('b', 'video.gen', 3)]) }, params)
    const rec = out.images?.value as unknown as Rec[]
    expect(out.images?.files).toHaveLength(2)
    expect(rec.find((r) => r.itemId === 'a')?.degraded).toBeUndefined()
    expect(rec.find((r) => r.itemId === 'b')?.degraded).toMatch(/clip refusé → plan voisin/)
    expect(out.images?.meta).toMatchObject({ degraded: 1, provisional: true })
    expect(out.clips?.files ?? []).toHaveLength(0)
  })

  it('#114: every engine of an image refusing degrades that shot, not the run', { timeout: 120_000 }, async () => {
    const dir = work('image-degrade')
    const calls = newCalls()
    let n = 0
    const cloud: CloudService = {
      ...stubCloud(calls),
      generateImage: async (req, opts) => {
        if (++n === 1) throw new EngineError('refused', 'Une image : Atelier Cloud a répondu en démo')
        return stubCloud(calls).generateImage(req, opts)
      }
    }
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud })), { list: listArt([item('a', 'image.gen', 4), item('b', 'image.gen', 3)]) }, params)
    const rec = out.images?.value as unknown as Rec[]
    expect(out.images?.files).toHaveLength(2)
    expect(rec.filter((r) => r.degraded).map((r) => r.degraded)).toEqual([expect.stringMatching(/image refusé → plan voisin/)])
  })

  it('leaves an avatar item to avatar.speak: no picture, no call', { timeout: 60_000 }, async () => {
    const dir = work('video-avatar')
    const calls = newCalls()
    const avatar: GenItem = { ...item('avatar-hook', 'avatar', 6), voiceRange: { startFrame: 0, endFrame: 180 }, layout: 'full' }
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(calls) })), { list: listArt([item('a', 'image.gen', 4), avatar]) }, params)
    expect(out.images?.files).toHaveLength(1)
    expect((out.images?.value as unknown as Rec[]).map((r) => r.itemId)).toEqual(['a'])
    expect(calls.video).toHaveLength(0)
    expect(out.clips?.files).toEqual([])
  })

  it('a list without video items answers exactly what it did before: no clips, an empty record, the same meta', { timeout: 60_000 }, async () => {
    const dir = work('video-none')
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud(newCalls()) })), { list: listArt([item('a', 'image.gen', 4)]) }, params)
    expect(out.clips).toEqual({ files: [], value: [], meta: { count: 0 } })
  })
})

describe.skipIf(!hasFullFfmpeg)(`visuals.fulfil fake: a drawn clip (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('draws a silent 30 fps clip of the shot’s length in the film’s shape, with a drawn picture and a demo record', { timeout: 180_000 }, async () => {
    const dir = work('video-drawn')
    const out = await visualsFulfil.fake(makeCtx(testServices(dir)), { list: listArt([item('a', 'image.gen', 4), item('b', 'video.gen', 2.5)]) }, params)
    expect(out.clips?.files).toHaveLength(1)
    const c = await info(out.clips?.files?.[0] as string)
    expect(c.v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', r_frame_rate: '30/1' })
    expect(c.audio).toBe(0)
    expect(c.durationS).toBeGreaterThan(2.7)
    expect(c.durationS).toBeLessThan(3.3) // 2.5 s asks for 3 s, the seconds the Cloud would bill
    expect(out.clips?.value).toMatchObject([{ itemId: 'b', file: 0, demo: true, width: 1920, height: 1080 }])
    expect(out.clips?.meta).toMatchObject({ count: 1, demo: true })
    expect((out.images?.value as unknown as Rec[])[1]).toMatchObject({ itemId: 'b', video: true, source: 'drawn', demo: true })
    expect((await info(out.images?.files?.[1] as string)).v).toMatchObject({ width: 1920, height: 1080 })
    // the picture moves: two frames of the clip differ
    const frame = async (t: number): Promise<Buffer> =>
      (await media.run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out.clips?.files?.[0] as string, '-frames:v', '1', '-vf', 'scale=192:108,format=gray', '-f', 'rawvideo', '-'], { signal })).stdout
    const [a, b] = [await frame(0.1), await frame(2.5)]
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs((a[i] as number) - (b[i] as number))
    expect(diff / a.length).toBeGreaterThan(0.5)
  })

  it('a vertical drawn clip is 1080x1920', { timeout: 180_000 }, async () => {
    const dir = work('video-drawn-tall')
    const out = await visualsFulfil.fake(makeCtx(testServices(dir)), { list: listArt([item('b', 'video.gen', 2, '9:16')]) }, params)
    expect((await info(out.clips?.files?.[0] as string)).v).toMatchObject({ width: 1080, height: 1920 })
  })
})

describe('visuals.fulfil estimate with video and a presenter in the list', () => {
  const est = (meta: Record<string, number>) =>
    visualsFulfil.estimate({ where: 'local', budgetMode: 'usage_max', minutes: 1, inputs: { list: { type: 'json.genlist', meta } } }, params as never)

  it('prices pictures as images, stock as searches, generated video by the second, and leaves the presenter to avatar.speak', () => {
    expect(est({ items: 10, stock: 4 }).units).toEqual([{ unit: 'images', qty: 6 }, { unit: 'searches', qty: 4 }])
    const e = est({ items: 10, stock: 4, videoItems: 2, videoSeconds: 14, avatarItems: 2, avatarSeconds: 14 })
    // 10 items: 2 are presenters (not made here), 2 are clips (billed in seconds), 4 are searches: 2 pictures remain
    expect(e.units).toEqual([{ unit: 'images', qty: 2 }, { unit: 'searches', qty: 4 }, { unit: 'video_s', qty: 14 }])
    expect(est({ items: 4, stock: 0 }).units).toEqual([{ unit: 'images', qty: 4 }])
  })
})
