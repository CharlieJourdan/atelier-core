// `image.make` inside visuals.fulfil (production-8, decision 0035): each still is composed from the director's parts and the
// brick's style, made by the pipeline's image engines per item (references to the engines that read them, a plainer rewrite
// after a refusal, the next engine when one is down, a found still or a neighbour when all say no), checked (blank,
// near-duplicate, the eyes) with one regeneration. With a clip brick, a generated-video item gets only its start still and a
// shot that shares a clip takes its partner's. Real ffmpeg on tiny pictures, a stub Cloud, no network.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BASE_STYLES } from '../../src/main/production/styles/seeds'
import type { BrickStyle } from '../../src/shared/brick-styles'
import type { Artefact, Cost } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import { lookOf } from '../../src/engine/nodes/visuals-look'
import { visualsFulfil, VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import type { CloudService, StockHit, VisionService } from '../../src/engine/services'
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
const style = (id: string): BrickStyle => BASE_STYLES.find((s) => s.id === id) as BrickStyle

function item(id: string, scene: string, o: Partial<GenItem> = {}): GenItem {
  return {
    id,
    kind: 'image.gen',
    prompt: `medium shot of ${scene}, documentary photograph`,
    shot: { size: 'medium shot', scene },
    constraints: { durationS: 3, aspect: '16:9' },
    context: { beatText: `beat ${id}`, subject: `subject ${id}`, keyTerms: ['pan', 'stove'] },
    unitPrice: 2,
    units: 1,
    priority: 1,
    shotIds: [`s-${id}`],
    ...o
  }
}
const listArt = (items: GenItem[]): Artefact => art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } satisfies GenList as never, meta: {} })

interface Req {
  prompt: string
  engine: string | undefined
  negative: string | undefined
  references: string[]
  key: string
}
/** Pictures are test patterns, each different (a seed per call), or a flat frame when `blank` says so; `fail` decides per call. */
function stubCloud(o: { calls: Req[]; fail?: (r: Req, n: number) => EngineError | null; blank?: (n: number) => boolean; stock?: StockHit[] }): CloudService {
  let n = 0
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    searchStock: async () => ({ results: o.stock ?? [], files: [], demo: false }),
    generateImage: async (req, opts) => {
      const r: Req = { prompt: req.prompt, engine: req.engine, negative: req.negative, references: req.references ?? [], key: opts.idempotencyKey }
      o.calls.push(r)
      const k = ++n
      const f = o.fail?.(r, k)
      if (f) throw f
      await mkdir(opts.dir, { recursive: true })
      const file = path.join(opts.dir, `gen-${k}.png`)
      const src = o.blank?.(k) ? 'color=c=gray:s=320x180' : `mandelbrot=s=320x180:start_scale=${(0.5 + k * 0.7).toFixed(2)}`
      await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', file], { signal })
      return { files: [file], demo: false, credits: 1 }
    }
  }
}
const engines = { engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-medium'] }

describe.skipIf(!hasFfmpeg)(`visuals.fulfil: generated stills (${hasFfmpeg ? 'ffmpeg' : NO_FFMPEG})`, () => {
  it('the same item with two styles gives two different prompts and the same engine call shape', { timeout: 120_000 }, async () => {
    const reqs: Record<string, Req> = {}
    for (const id of ['phone-real', 'clean-stock']) {
      const calls: Req[] = []
      const dir = work(`stills-${id}`)
      const params = VisualsParams.parse({ ...engines, look: lookOf(style(id)) })
      const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud({ calls }) })), { list: listArt([item('a', 'a burnt pan on the stove')]) }, params)
      expect(calls).toHaveLength(1)
      reqs[id] = calls[0] as Req
      expect(out.images?.value).toMatchObject([{ itemId: 'a', engine: 'image:gpt-image-25-low', style: `${id}@1` }])
    }
    const [a, b] = [reqs['phone-real'] as Req, reqs['clean-stock'] as Req]
    expect(a.prompt).not.toBe(b.prompt)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect([a.engine, b.engine]).toEqual(['image:gpt-image-25-low', 'image:gpt-image-25-low'])
    expect(typeof a.negative).toBe('string')
    expect(typeof b.negative).toBe('string')
    // a picture made before production-8 keeps its idempotency key's shape, an engine is added to it
    expect(a.key).toMatch(/^image-[0-9a-f]+-image:gpt-image-25-low$/)
  })

  it('« joue l’action »: the portrait rides to an engine that reads references; a recurring object’s later picture gets its first one', { timeout: 120_000 }, async () => {
    const dir = work('stills-refs')
    const portrait = path.join(dir, 'portrait.jpg')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x320', '-frames:v', '1', portrait], { signal })
    const calls: Req[] = []
    const params = VisualsParams.parse({
      engine: 'image:flux-schnell',
      fallbacks: ['image:gpt-image-25-low'],
      look: lookOf(style('phone-real')),
      people: 'presenter-as-actor',
      references: { presenter: portrait }
    })
    const list = [
      item('a', 'the presenter scrubs a blue enamel casserole', { recurring: ['casserole'] }),
      item('b', 'a wooden spoon on the counter'),
      item('c', 'the blue enamel casserole on the table', { recurring: ['casserole'] })
    ]
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud({ calls }) })), { list: listArt(list) }, params)
    const of = (id: string): Req => calls.find((c) => c.prompt.includes(id === 'a' ? 'scrubs' : id === 'b' ? 'spoon' : 'on the table')) as Req
    // FLUX reads no reference: the pictures that keep one go to GPT Image first, the others stay on FLUX
    expect(of('a')).toMatchObject({ engine: 'image:gpt-image-25-low', references: [portrait] })
    expect(of('b')).toMatchObject({ engine: 'image:flux-schnell', references: [] })
    expect(of('c').engine).toBe('image:gpt-image-25-low')
    expect(of('c').references).toHaveLength(1)
    expect(of('c').references[0]).toBe(out.images?.files?.[0])
    expect(of('a').prompt).toContain('the person is the one in the reference portrait')
    expect(out.images?.value).toMatchObject([{ itemId: 'a', references: 1 }, { itemId: 'b' }, { itemId: 'c', references: 1 }])
  })

  it('a refused still is rewritten once on the same engine, then found in stock, else holds its neighbour; a down engine hands over', { timeout: 120_000 }, async () => {
    const dir = work('stills-refused')
    const calls: Req[] = []
    const costs: Cost[] = []
    const fail = (r: Req): EngineError | null =>
      r.prompt.includes('rusty') ? new EngineError('refused', 'moderation') : r.engine === 'image:gpt-image-25-low' && r.prompt.includes('kettle') ? new EngineError('transient', 'down') : null
    const list = [item('a', 'a kettle on the stove'), item('b', 'a rusty weapon on the table')]
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stubCloud({ calls, fail }) }), { costs }), { list: listArt(list) }, VisualsParams.parse({ ...engines, look: lookOf(style('phone-real')) }))
    // the kettle: GPT low is down, GPT medium makes it
    expect(calls.filter((c) => c.prompt.includes('kettle')).map((c) => c.engine)).toEqual(['image:gpt-image-25-low', 'image:gpt-image-25-medium'])
    // the refused one: once as asked, once plainer, same engine; never shopped to the next engine
    const refused = calls.filter((c) => c.prompt.includes('rusty'))
    expect(refused.map((c) => c.engine)).toEqual(['image:gpt-image-25-low', 'image:gpt-image-25-low'])
    expect(refused[1]?.key.endsWith('-plain')).toBe(true)
    const rec = out.images?.value as unknown as { itemId: string; degraded?: string; fallback?: string }[]
    expect(rec[0]).toMatchObject({ itemId: 'a', fallback: 'image:gpt-image-25-low en échec → image:gpt-image-25-medium' })
    expect(rec[1]).toMatchObject({ itemId: 'b', degraded: 'image refusée → plan voisin' })
    // production-17: the hold shows a real picture (not a demo: no DÉMO badge for it), and the output is provisional (never reused)
    expect((out.images?.value as unknown as { demo: boolean }[]).map((r) => r.demo)).toEqual([false, false])
    expect(out.images?.meta).toMatchObject({ demo: false, provisional: true })
    // the hold shows the neighbour's picture; billed: the kettle once, the stock search once (the failed calls cost nothing)
    expect(out.images?.files).toHaveLength(2)
    expect(costs).toEqual([{ units: [{ unit: 'images', qty: 1 }, { unit: 'searches', qty: 1 }], provider: 'image' }])
  })

  it('a blank picture and a near-duplicate are generated once more; the eyes catch text and a person when nobody', { timeout: 120_000 }, async () => {
    const dir = work('stills-checks')
    const calls: Req[] = []
    let jarLooks = 0
    const vision: VisionService = {
      inspect: async (req) => ({ text: req.prompt.includes('jar') && jarLooks++ === 0, anatomy: false, drift: false, person: false })
    }
    const out = await visualsFulfil.run(
      makeCtx(testServices(dir, { cloud: stubCloud({ calls, blank: (n) => n === 1 }), vision })),
      { list: listArt([item('a', 'a pan'), item('b', 'a jar of jam')]) },
      VisualsParams.parse({ ...engines, look: lookOf(style('phone-real')), vision: true, parallel: 1 })
    )
    // a: blank the first time → once more; b: the eyes saw text the first time → once more, asked for no writing
    expect(calls.filter((c) => c.prompt.includes('a pan')).map((c) => c.key.endsWith('-r1'))).toEqual([false, true])
    const jar = calls.filter((c) => c.prompt.includes('jar'))
    expect(jar.map((c) => c.key.endsWith('-r1'))).toEqual([false, true])
    expect(jar[1]?.prompt).toContain('no writing anywhere')
    expect((out.images?.value as unknown as { checks?: string[] }[]).every((r) => r.checks === undefined)).toBe(true)
  })

  it('with a clip brick: a generated-video item gets only its start still, a shared shot copies its partner’s, nothing billed twice', { timeout: 120_000 }, async () => {
    const dir = work('stills-clipbrick')
    const calls: Req[] = []
    const costs: Cost[] = []
    const list = [item('a', 'a pan', { kind: 'video.gen' }), item('b', 'a pan', { kind: 'video.gen', sameAs: 'a', units: 0 }), item('c', 'a jar')]
    const out = await visualsFulfil.run(
      makeCtx(testServices(dir, { cloud: stubCloud({ calls }) }), { costs }),
      { list: listArt(list) },
      VisualsParams.parse({ ...engines, look: lookOf(style('phone-real')), stillsOnly: true })
    )
    expect(calls).toHaveLength(2)
    expect(out.clips?.files).toEqual([])
    expect(out.images?.files).toHaveLength(3)
    expect(out.images?.value).toMatchObject([{ itemId: 'a', kind: 'video.gen' }, { itemId: 'b', sameAs: 'a' }, { itemId: 'c' }])
    expect(costs).toEqual([{ units: [{ unit: 'images', qty: 2 }], provider: 'image' }])
  })

  it('a provider job that failed (not moderation) goes to the next engine; a shared shot whose partner holds a neighbour holds too', { timeout: 120_000 }, async () => {
    const dir = work('stills-failed')
    const calls: Req[] = []
    const fail = (r: Req): EngineError | null =>
      r.prompt.includes('rusty') ? new EngineError('refused', 'Le fournisseur a échoué : refused: content policy') : r.engine === 'image:gpt-image-25-low' ? new EngineError('refused', 'Le fournisseur a échoué : upstream 500') : null
    const list = [item('a', 'a kettle'), item('b', 'a rusty pan', { kind: 'video.gen' }), item('c', 'a rusty pan', { kind: 'video.gen', sameAs: 'b', units: 0 })]
    const out = await visualsFulfil.run(
      makeCtx(testServices(dir, { cloud: stubCloud({ calls, fail }) })),
      { list: listArt(list) },
      VisualsParams.parse({ ...engines, look: lookOf(style('phone-real')), stillsOnly: true, parallel: 1 })
    )
    // the kettle: the failed job on GPT low is not a refusal, GPT medium makes it (no plainer rewrite)
    expect(calls.filter((c) => c.prompt.includes('kettle')).map((c) => [c.engine, c.key.endsWith('-plain')])).toEqual([
      ['image:gpt-image-25-low', false],
      ['image:gpt-image-25-medium', false]
    ])
    // the moderation refusal: rewritten once on the same engine, then the neighbour; its partner follows it
    expect(out.images?.files).toHaveLength(3)
    expect(out.images?.value).toMatchObject([{ itemId: 'a' }, { itemId: 'b', degraded: 'image refusée → plan voisin' }, { itemId: 'c', sameAs: 'b' }])
  })
})
