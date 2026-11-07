// visuals.fulfil@1 with stock items: one Cloud search per item, the best result (the first whose orientation fits) becomes the
// picture, its licence and credit line are kept (and survive the cache), a search with no match is a flagged gap (never a
// generated picture), a stock video gives a frame (listed), and the package lists the credits. A stub Cloud service and real
// ffmpeg; no network.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artefact, CloudService, EngineServices } from '../../src/engine'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { creditsFrom } from '../../src/engine/nodes/package-youtube'
import { GAP_NOTE, visualsFulfil, VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import { pickBest } from '../../src/engine/nodes/visuals-stock'
import type { StockHit } from '../../src/engine/services'
import { MEDIA, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

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

function item(id: string, kind: GenItem['kind'], text: string): GenItem {
  const search = kind === 'stock.photo' || kind === 'stock.video'
  return {
    id,
    kind,
    ...(search ? { query: text } : { prompt: text }),
    constraints: { durationS: 4, aspect: '16:9' },
    context: { beatText: text, subject: `Sujet ${id}`, keyTerms: [] },
    unitPrice: 1,
    units: 1,
    priority: 1,
    shotIds: [`s-${id}`]
  }
}
const listArt = (items: GenItem[]): Artefact =>
  art('json.genlist', { value: { items, totals: { credits: items.length, items: items.length, byKind: {} }, budget: null } as GenList as never })

const hit = (over: Partial<StockHit> = {}): StockHit => ({
  id: 'pexels-photo-1',
  source: 'pexels',
  kind: 'photo',
  title: 'Phare',
  creator: 'Ada Lovelace',
  creatorUrl: 'https://www.pexels.com/@ada',
  pageUrl: 'https://www.pexels.com/photo/1/',
  licence: 'Pexels License',
  attribution: 'Photo by Ada Lovelace on Pexels',
  attributionRequired: false,
  width: 1920,
  height: 1080,
  orientation: 'landscape',
  durationS: null,
  file: '',
  ...over
})

interface Stub {
  cloud: CloudService
  searches: { query: string; orientation: string; kind: string; count: number }[]
  images: string[]
  /** The engine each generated picture asked (undefined: the Cloud's default usage). */
  engines: (string | undefined)[]
}

/** A Cloud whose searches answer from `answer` (files are real pictures made by ffmpeg in the job folder). */
function stubCloud(answer: (n: number) => { hits: Partial<StockHit>[]; video?: boolean }): Stub {
  const searches: Stub['searches'] = []
  const images: string[] = []
  const engines: (string | undefined)[] = []
  const make = async (dir: string, name: string, video: boolean): Promise<string> => {
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    const args = video
      ? ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=10', '-pix_fmt', 'yuv420p', file]
      : ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-frames:v', '1', file]
    await media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })
    return file
  }
  const cloud: CloudService = {
    synthesize: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used')),
    generateImage: async (req, opts) => {
      images.push(req.prompt)
      engines.push(req.engine)
      return { files: [await make(opts.dir, 'gen.png', false)], demo: false, credits: 1 }
    },
    searchStock: async (req, opts) => {
      searches.push({ query: req.query, orientation: req.orientation, kind: req.kind, count: req.count })
      const { hits, video } = answer(searches.length)
      const results: StockHit[] = []
      for (const [i, h] of hits.entries()) results.push(hit({ ...h, kind: video ? 'video' : 'photo', file: await make(opts.dir, `stock-${i + 1}.${video ? 'mp4' : 'png'}`, video === true) }))
      return { results, files: results.map((r) => r.file), demo: false, credits: 1 }
    }
  }
  return { cloud, searches, images, engines }
}

const params = VisualsParams.parse({ parallel: 1, width: 640, height: 360 })
const still = async (file: string): Promise<StreamInfo> => {
  const info = await probe(media, file, signal)
  return info.streams.find((s) => s.codec_type === 'video') as StreamInfo
}

describe('pickBest', () => {
  it('is the first result whose orientation fits, and none when none does', () => {
    const hits = [hit({ id: 'a', orientation: 'portrait' }), hit({ id: 'b' }), hit({ id: 'c' })]
    expect(pickBest(hits, 'landscape')?.id).toBe('b')
    expect(pickBest(hits, 'portrait')?.id).toBe('a')
    expect(pickBest(hits, 'square')).toBeUndefined()
  })
})

describe.skipIf(!hasFfmpeg)('visuals.fulfil: stock items', () => {
  it('searches once per stock item, picks the first fitting result, normalises it, and keeps the licence and credit line', async () => {
    const dir = work('stock-pick')
    const stub = stubCloud(() => ({ hits: [{ id: 'p', orientation: 'portrait', attribution: 'not me' }, { id: 'good', attribution: 'Photo by Ada Lovelace on Pexels' }] }))
    const services: EngineServices = testServices(dir, { cloud: stub.cloud })
    const out = await visualsFulfil.run(makeCtx(services), { list: listArt([item('a', 'stock.photo', 'lighthouse storm'), item('b', 'image.gen', 'un phare')]) }, params)
    expect(stub.searches).toEqual([{ query: 'lighthouse storm', orientation: 'landscape', kind: 'photo', count: 3 }])
    expect(stub.images).toEqual(['un phare'])
    const files = out.images?.files ?? []
    expect(files).toHaveLength(2)
    expect(await still(files[0] as string)).toMatchObject({ width: 640, height: 360, codec_name: 'mjpeg' })
    const rec = out.images?.value as unknown as { itemId: string; licence: string; degraded?: string; stock?: { id: string; attribution: string; source: string } }[]
    expect(rec[0]).toMatchObject({ itemId: 'a', licence: 'Pexels License', stock: { id: 'good', attribution: 'Photo by Ada Lovelace on Pexels', source: 'pexels' } })
    expect(rec[0]?.degraded).toBeUndefined()
    expect(rec[1]?.stock).toBeUndefined()
    expect(out.images?.meta).toMatchObject({ count: 2, degraded: 0 })
    // the package lists the credit lines of the stock pictures
    expect(creditsFrom(out.images?.value)).toEqual(['Photo by Ada Lovelace on Pexels'])
  })

  it('a cached item keeps its credit: a second run searches nothing and still knows where the picture came from', async () => {
    const dir = work('stock-cache')
    const stub = stubCloud(() => ({ hits: [{}] }))
    const services = testServices(dir, { cloud: stub.cloud })
    const list = listArt([item('a', 'stock.photo', 'lighthouse')])
    await visualsFulfil.run(makeCtx(services), { list }, params)
    const again = await visualsFulfil.run(makeCtx(services), { list }, params)
    expect(stub.searches).toHaveLength(1)
    expect((again.images?.value as unknown as { stock?: { attribution: string } }[])[0]?.stock?.attribution).toBe('Photo by Ada Lovelace on Pexels')
  })

  it('a real run asks again for a picture a demo answered and an earlier run cached; a demo run reuses it', async () => {
    const dir = work('stock-cache-demo')
    const stub = stubCloud(() => ({ hits: [{}] }))
    const demoCloud: CloudService = { ...stub.cloud, searchStock: async (req, opts) => ({ ...(await stub.cloud.searchStock(req, opts)), demo: true }) }
    const list = listArt([item('a', 'stock.photo', 'lighthouse')])
    await visualsFulfil.run(makeCtx(testServices(dir, { cloud: demoCloud })), { list }, params)
    await visualsFulfil.run(makeCtx(testServices(dir, { cloud: demoCloud })), { list }, params)
    expect(stub.searches).toHaveLength(1)
    const real = await visualsFulfil.run(makeCtx(testServices(dir, { cloud: { ...stub.cloud, realRun: true } })), { list }, params)
    expect(stub.searches).toHaveLength(2)
    expect(real.images?.meta).toMatchObject({ demo: false })
  })

  // clone-markets-2 (02/11, changed on purpose, Charlie's rule): footage and stills that exist are found, never generated. A stock
  // or archive item with no usable result used to fall back to a generated picture; it is now a gap, flagged in the record, the
  // meta and the log, and shown as its neighbour's picture.
  it('a search with no usable result is a flagged gap, never a generated picture', async () => {
    const dir = work('stock-empty')
    const stub = stubCloud((n) => ({ hits: n === 1 ? [] : n === 2 ? [{ orientation: 'portrait' }] : [{}] }))
    const services = testServices(dir, { cloud: stub.cloud })
    const items = [item('a', 'stock.photo', 'rien'), item('b', 'stock.photo', 'seulement vertical'), item('c', 'stock.photo', 'un phare')]
    const out = await visualsFulfil.run(makeCtx(services), { list: listArt(items) }, params)
    expect(stub.searches).toHaveLength(3)
    expect(stub.images).toEqual([])
    const rec = out.images?.value as unknown as { itemId: string; degraded?: string; stock?: unknown }[]
    expect(rec.map((r) => r.degraded)).toEqual([GAP_NOTE, GAP_NOTE, undefined])
    expect(rec[2]?.stock).toBeDefined()
    expect(out.images?.meta).toMatchObject({ degraded: 2, gaps: ['a', 'b'], provisional: true })
    // the gaps show their neighbour's picture (never a black slot)
    expect(out.images?.files).toHaveLength(3)
  })

  it('a video where nothing at all is found stops with a message that says so (nothing generated in its place)', async () => {
    const dir = work('stock-none-at-all')
    const stub = stubCloud(() => ({ hits: [] }))
    const services = testServices(dir, { cloud: stub.cloud })
    await expect(visualsFulfil.run(makeCtx(services), { list: listArt([item('a', 'stock.photo', 'rien')]) }, params)).rejects.toThrow(/Aucun média n’a été trouvé/)
    expect(stub.images).toEqual([])
  })

  // issue #96: a flaky search that finds nothing once must not stop the whole sample; when NOTHING was found for the video, the
  // items are searched again with a wider query (their subject) before the stop
  it('a video where the first searches find nothing goes on with a wider query instead of stopping (#96)', async () => {
    const dir = work('stock-wide')
    const stub = stubCloud((n) => ({ hits: n <= 2 ? [] : [{}] }))
    const services = testServices(dir, { cloud: stub.cloud })
    const items = [item('a', 'stock.photo', 'requête très précise'), item('b', 'stock.photo', 'autre requête')]
    const out = await visualsFulfil.run(makeCtx(services), { list: listArt(items) }, params)
    expect(stub.searches.map((s) => s.query)).toEqual(['requête très précise', 'autre requête', 'Sujet a', 'Sujet b'])
    expect(stub.images).toEqual([])
    const rec = out.images?.value as unknown as { degraded?: string; stock?: unknown }[]
    expect(rec.map((r) => r.degraded)).toEqual([undefined, undefined])
    expect(rec[0]?.stock).toBeDefined()
    expect(out.images?.meta).toMatchObject({ degraded: 0 })
    expect(out.images?.meta).not.toHaveProperty('gaps')
    expect(out.images?.files).toHaveLength(2)
  })

  it('a video with no media even with the wider query stops with the clear French reason (#96)', async () => {
    const dir = work('stock-wide-none')
    const stub = stubCloud(() => ({ hits: [] }))
    await expect(visualsFulfil.run(makeCtx(testServices(dir, { cloud: stub.cloud })), { list: listArt([item('a', 'stock.photo', 'rien')]) }, params)).rejects.toThrow(/Aucun média n’a été trouvé/)
    expect(stub.searches.map((s) => s.query)).toEqual(['rien', 'Sujet a'])
  })

  it('a real run never takes a demo answer from the stock search: it is a gap, not a « DÉMO » film', async () => {
    const dir = work('stock-demo-in-real')
    const stub = stubCloud(() => ({ hits: [{}] }))
    let n = 0
    const cloud: CloudService = {
      ...stub.cloud,
      realRun: true,
      searchStock: async (req, opts) => ({ ...(await stub.cloud.searchStock(req, opts)), demo: ++n === 1 })
    }
    const out = await visualsFulfil.run(makeCtx(testServices(dir, { cloud })), { list: listArt([item('a', 'stock.photo', 'démo'), item('b', 'stock.photo', 'réel')]) }, params)
    const rec = out.images?.value as unknown as { degraded?: string; demo: boolean }[]
    expect(rec.map((r) => r.degraded)).toEqual([GAP_NOTE, undefined])
    expect(out.images?.meta).toMatchObject({ demo: false, gaps: ['a'] })
  })

  it('an archive pipeline asks the public archives first, then the Cloud\'s found-media chain, never a generated picture', async () => {
    const dir = work('stock-archives-none')
    const stub = stubCloud(() => ({ hits: [{}] }))
    const services = testServices(dir, { cloud: stub.cloud })
    // every public archive is unreachable here: nothing is found there, the Cloud's chain answers
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
    try {
      const out = await visualsFulfil.run(
        makeCtx(services),
        { list: listArt([item('a', 'stock.photo', 'Cantino planisphere 1502')]) },
        VisualsParams.parse({ parallel: 1, width: 640, height: 360, archives: true, engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low'] })
      )
      expect(stub.searches).toHaveLength(1)
      expect(stub.images).toEqual([])
      const rec = out.images?.value as unknown as { degraded?: string; stock?: unknown }[]
      expect(rec[0]?.degraded).toBeUndefined()
      expect(rec[0]?.stock).toBeDefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a stock video gives its first frame as the still, listed as degraded', async () => {
    const dir = work('stock-video')
    const stub = stubCloud(() => ({ hits: [{ id: 'v', attribution: 'Video by Grace on Pexels' }], video: true }))
    const services = testServices(dir, { cloud: stub.cloud })
    const out = await visualsFulfil.run(makeCtx(services), { list: listArt([item('a', 'stock.video', 'waves')]) }, params)
    expect(stub.searches[0]).toMatchObject({ kind: 'video', count: 2 })
    expect(await still((out.images?.files ?? [])[0] as string)).toMatchObject({ width: 640, height: 360, codec_name: 'mjpeg' })
    const rec = out.images?.value as unknown as { degraded?: string; stock?: { kind: string } }[]
    expect(rec[0]?.degraded).toMatch(/vidéo de banque/)
    expect(rec[0]?.stock?.kind).toBe('video')
  })

  it('asks for the orientation of the picture size (a vertical short asks for portrait)', async () => {
    const dir = work('stock-portrait')
    const stub = stubCloud(() => ({ hits: [{ orientation: 'portrait' }] }))
    await visualsFulfil.run(makeCtx(testServices(dir, { cloud: stub.cloud })), { list: listArt([item('a', 'stock.photo', 'rue')]) }, VisualsParams.parse({ width: 1080, height: 1920 }))
    expect(stub.searches[0]?.orientation).toBe('portrait')
  })

  it('estimates stock items as searches and the others as images', () => {
    const est = visualsFulfil.estimate({ inputs: { list: { meta: { items: 10, stock: 4 } } }, minutes: 5 } as never, {} as never)
    expect(est.units).toEqual([
      { unit: 'images', qty: 6 },
      { unit: 'searches', qty: 4 }
    ])
    const old = visualsFulfil.estimate({ inputs: { list: { meta: { items: 10 } } }, minutes: 5 } as never, {} as never)
    expect(old.units).toEqual([{ unit: 'images', qty: 10 }])
  })
})
