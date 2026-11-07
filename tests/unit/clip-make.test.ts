// `clip.make@1` (production-8, decision 0035): clips made FROM their still with the pipeline's clip engines. Two shots that share
// one generation are made and priced once (wide, then a tight crop); a refused clip goes to the next engine, then becomes the
// still with a camera move in the render; an engine past its timeout hands the clip to the next one. Real ffmpeg on tiny
// clips, a stub Cloud, no network.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, Cost } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import type { GenItem, GenList, Shot } from '../../src/engine/formats/editplan'
import { probe } from '../../src/engine/media/probe'
import { ClipParams, clipMake, type ClipMade } from '../../src/engine/nodes/clip-make'
import { CLIP_MISSING_MOTION, segmentSpecs } from '../../src/engine/render/segments'
import type { CloudService } from '../../src/engine/services'
import { MEDIA, NO_FFMPEG, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

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

function item(id: string, durationS: number, sameAs?: string): GenItem {
  return {
    id,
    kind: 'video.gen',
    prompt: `medium shot of a pan on the stove ${id}, phone look`,
    shot: { size: 'medium shot', scene: `a pan on the stove ${id}` },
    constraints: { durationS, aspect: '16:9' },
    context: { beatText: `beat ${id}`, subject: `pan ${id}`, keyTerms: [] },
    unitPrice: 12,
    units: sameAs ? 0 : Math.ceil(durationS),
    priority: 1,
    shotIds: [`s-${id}`],
    ...(sameAs ? { sameAs } : {})
  }
}
const listArt = (items: GenItem[]): Artefact =>
  art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } satisfies GenList as never, meta: {} })

async function stillsArt(dir: string, ids: string[]): Promise<Artefact> {
  await mkdir(dir, { recursive: true })
  const files: string[] = []
  for (const id of ids) {
    const f = path.join(dir, `${id}.jpg`)
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', f], { signal })
    files.push(f)
  }
  return art('media.image[]', { files, value: ids.map((itemId, file) => ({ itemId, file })) as never })
}

interface Call {
  engine: string | undefined
  seconds: number
  image: string | undefined
  prompt: string
  negative: string | undefined
}
/** A Cloud whose clips are test patterns; `fail` decides per engine (null = works, 'hang' = never answers until aborted). */
function stubCloud(calls: Call[], fail: (engine: string | undefined) => EngineError | 'hang' | null = () => null): CloudService {
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used')),
    generateImage: () => Promise.reject(new Error('not used')),
    generateVideo: async (req, opts) => {
      calls.push({ engine: req.engine, seconds: req.seconds, image: req.image, prompt: req.prompt, negative: req.negative })
      const f = fail(req.engine)
      if (f === 'hang') {
        await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      } else if (f) throw f
      await mkdir(opts.dir, { recursive: true })
      const file = path.join(opts.dir, 'clip.mp4')
      await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=1280x720:d=${req.seconds}:r=24`, '-pix_fmt', 'yuv420p', file], { signal })
      return { files: [file], demo: false, credits: 5 }
    }
  }
}

const params = (o: Record<string, unknown> = {}) => ClipParams.parse({ engine: 'clip:veo31-lite-relaxed', fallbacks: ['clip:veo31-lite-vertex', 'clip:minimax-h3-lite'], ...o })

describe.skipIf(!hasFfmpeg)(`clip.make (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  it('two shots from one clip share one generation and are priced once: wide, then a tight crop', { timeout: 120_000 }, async () => {
    const dir = work('clip-pair')
    const calls: Call[] = []
    const costs: Cost[] = []
    const list = [item('a', 3.5), item('b', 3.6, 'a'), item('c', 3)]
    const out = await clipMake.run(makeCtx(testServices(dir, { cloud: stubCloud(calls) }), { costs }), { list: listArt(list), images: await stillsArt(path.join(dir, 'stills'), ['a', 'b', 'c']) }, params())
    // two generations, not three: the pair asks for one clip as long as both shots (7.1 s → Veo's 8 s), from a's still
    // (made in parallel: the order of the calls is not fixed)
    const pair = calls.find((c) => c.seconds === 8)
    expect(calls.map((c) => [c.engine, c.seconds]).sort((x, y) => (y[1] as number) - (x[1] as number))).toEqual([
      ['clip:veo31-lite-relaxed', 8],
      ['clip:veo31-lite-relaxed', 4]
    ])
    expect(calls.every((c) => c.image?.endsWith('.jpg'))).toBe(true)
    expect(pair?.image).toContain(`${path.sep}a.jpg`)
    expect(pair?.prompt).toMatch(/^medium shot of a pan on the stove a\. .*nothing new appears/)
    expect(pair?.negative).toContain('new objects appearing')
    // billed once per generation, by the seconds asked
    expect(costs).toEqual([{ units: [{ unit: 'video_s', qty: 12 }], provider: 'video' }])
    const rec = out.clips?.value as unknown as ClipMade[]
    expect(rec.map((r) => [r.itemId, r.part ?? null, r.engine])).toEqual([
      ['a', 'wide', 'clip:veo31-lite-relaxed'],
      ['b', 'tight', 'clip:veo31-lite-relaxed'],
      ['c', null, 'clip:veo31-lite-relaxed']
    ])
    expect(out.clips?.meta).toMatchObject({ count: 3, generations: 2, demo: false })
    // each piece has its shot's length; the pair's pieces are full frame
    const [wa, wb] = await Promise.all([0, 1].map(async (k) => probe(media, out.clips?.files?.[k] as string, signal)))
    expect(wa?.durationS).toBeCloseTo(3.5, 0)
    expect(wb?.durationS).toBeCloseTo(3.6, 0)
    expect(wb?.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1920, height: 1080 })
  })

  it('a refused clip falls back to the next engine, then to the still with a camera move', { timeout: 120_000 }, async () => {
    const dir = work('clip-refused')
    const calls: Call[] = []
    const costs: Cost[] = []
    const fail = (e: string | undefined): EngineError | null =>
      e === 'clip:veo31-lite-relaxed' ? new EngineError('refused', 'moderation') : e === 'clip:veo31-lite-vertex' ? null : null
    const images = await stillsArt(path.join(dir, 'stills'), ['a'])
    const ok = await clipMake.run(makeCtx(testServices(dir, { cloud: stubCloud(calls, fail) }), { costs }), { list: listArt([item('a', 3)]), images }, params())
    expect(calls.map((c) => c.engine)).toEqual(['clip:veo31-lite-relaxed', 'clip:veo31-lite-vertex'])
    expect(ok.clips?.value).toMatchObject([{ itemId: 'a', engine: 'clip:veo31-lite-vertex', fallback: 'clip:veo31-lite-relaxed en échec → clip:veo31-lite-vertex' }])
    // only the clip that was made is billed
    expect(costs).toEqual([{ units: [{ unit: 'video_s', qty: 4 }], provider: 'video' }])

    // every engine says no: no clip, listed, and the render shows the still with a slow push
    const dir2 = work('clip-refused-all')
    const calls2: Call[] = []
    const none = await clipMake.run(
      makeCtx(testServices(dir2, { cloud: stubCloud(calls2, () => new EngineError('refused', 'moderation')) })),
      { list: listArt([item('a', 3)]), images },
      params()
    )
    expect(calls2.map((c) => c.engine)).toEqual(['clip:veo31-lite-relaxed', 'clip:veo31-lite-vertex', 'clip:minimax-h3-lite'])
    expect(none.clips?.files).toEqual([])
    expect(none.clips?.meta).toMatchObject({ count: 0, generations: 0, degraded: [{ itemId: 'a', reason: expect.stringContaining('l’image avec un mouvement de caméra') }] })
    const shot: Shot = { id: 's-a', track: 'base', startFrame: 0, endFrame: 90, kind: 'video.gen', genItem: 'a', transitionIn: 'cut', role: 'scene', beat: 0 }
    expect(segmentSpecs([shot], () => 'still.jpg', 'none', [1920, 1080], () => undefined)[0]?.motion).toEqual(CLIP_MISSING_MOTION)
    // a still keeps its own move; a clip that exists has none added
    expect(segmentSpecs([{ ...shot, kind: 'image.gen' }], () => 'still.jpg', 'none')[0]?.motion).toBeUndefined()
    expect(segmentSpecs([shot], () => 'still.jpg', 'none', [1920, 1080], () => ({ file: 'c.mp4', durationS: 3 }))[0]?.motion).toBeUndefined()
  })

  it('an engine past its timeout hands the clip to the next one; money stops the node', { timeout: 120_000 }, async () => {
    const dir = work('clip-timeout')
    const calls: Call[] = []
    const images = await stillsArt(path.join(dir, 'stills'), ['a'])
    const out = await clipMake.run(
      makeCtx(testServices(dir, { cloud: stubCloud(calls, (e) => (e === 'clip:veo31-lite-relaxed' ? 'hang' : null)) })),
      { list: listArt([item('a', 3)]), images },
      params({ timeoutS: 1 })
    )
    expect(calls.map((c) => c.engine)).toEqual(['clip:veo31-lite-relaxed', 'clip:veo31-lite-vertex'])
    expect(out.clips?.value).toMatchObject([{ itemId: 'a', engine: 'clip:veo31-lite-vertex' }])

    const broke = stubCloud([], () => new EngineError('budget', 'crédits insuffisants'))
    await expect(clipMake.run(makeCtx(testServices(work('clip-budget'), { cloud: broke })), { list: listArt([item('a', 3)]), images }, params())).rejects.toMatchObject({ code: 'budget' })
  })

  it('a blank clip is generated once more on the same engine', { timeout: 120_000 }, async () => {
    const dir = work('clip-blank')
    const calls: Call[] = []
    let n = 0
    const cloud: CloudService = {
      ...stubCloud(calls),
      generateVideo: async (req, opts) => {
        calls.push({ engine: req.engine, seconds: req.seconds, image: req.image, prompt: req.prompt, negative: req.negative })
        await mkdir(opts.dir, { recursive: true })
        const file = path.join(opts.dir, `clip-${++n}.mp4`)
        const src = n === 1 ? `color=c=black:s=640x360:d=${req.seconds}:r=24` : `testsrc2=s=640x360:d=${req.seconds}:r=24`
        await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-pix_fmt', 'yuv420p', file], { signal })
        return { files: [file], demo: false }
      }
    }
    const out = await clipMake.run(makeCtx(testServices(dir, { cloud })), { list: listArt([item('a', 3)]), images: await stillsArt(path.join(dir, 'stills'), ['a']) }, params())
    expect(calls.map((c) => c.engine)).toEqual(['clip:veo31-lite-relaxed', 'clip:veo31-lite-relaxed'])
    expect((out.clips?.value as unknown as ClipMade[])[0]?.checks).toBeUndefined()
  })

  it('fake: draws the clip from the still and cuts a shared one the same way, free', { timeout: 120_000 }, async () => {
    const dir = work('clip-fake')
    const costs: Cost[] = []
    const out = await clipMake.fake(
      makeCtx(testServices(dir), { costs }),
      { list: listArt([item('a', 2), item('b', 2, 'a')]), images: await stillsArt(path.join(dir, 'stills'), ['a', 'b']) },
      params()
    )
    expect((out.clips?.value as unknown as ClipMade[]).map((r) => [r.itemId, r.part, r.demo])).toEqual([
      ['a', 'wide', true],
      ['b', 'tight', true]
    ])
    expect(costs).toEqual([])
  })
})
