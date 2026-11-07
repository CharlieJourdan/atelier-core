// moteur-doublures (decision 0109): the free demo's FOUND stand-ins. A demo run's Cloud reaches only the free stock search (any
// other usage refused, any priced quote refused before a job exists); `visuals.fulfil` in a demo with `standIns: 'found'` turns
// every picture item into a stock photograph searched with its planned words, full frame, no text, no repeated photograph, video
// items as stills; `clip.make` draws no clip; `avatar.speak` shows the presenter's photograph (its own picture, else one stock
// photo of the planned type) instead of the drawn silhouette; the gate's demo recipe sets them. Real ffmpeg, stub Clouds, no network.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact } from '../../src/engine'
import { demoCloudService, freeUsagesOnly } from '../../src/engine/cloud-demo'
import type { GenItem, GenList } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { probe } from '../../src/engine/media/probe'
import { AvatarParams, avatarSpeak } from '../../src/engine/nodes/avatar-speak'
import { ClipParams, clipMake } from '../../src/engine/nodes/clip-make'
import { VisualsParams, visualsFulfil } from '../../src/engine/nodes/visuals-fulfil'
import { lookGrade, lookQueries, standInQueries } from '../../src/engine/nodes/visuals-found'
import { STAND_IN_ZOOM, standInGraph } from '../../src/engine/presenter/stand-in'
import type { CloudService, StockHit } from '../../src/engine/services'
import { createProductionHost } from '../../src/main/production/host'
import { standInPerson, withFoundStandIns, withoutWatermark } from '../../src/main/production/clone/compare/runner'
import type { StyleDefinition } from '../../src/shared/clone'
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

const NOW = new Date().toISOString()
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const quote = (credits: number): unknown => ({ id: `q-${credits}`, usage: 'searchStock', gridVersion: 1, creditValueEur: 0.01, lines: [], totalCredits: credits, referenceEur: null, demo: false, createdAt: NOW, expiresAt: new Date(Date.now() + 600_000).toISOString() })

const genItem = (id: string, kind: GenItem['kind'], over: Partial<GenItem> = {}): GenItem => ({
  id,
  kind,
  constraints: { durationS: 3, aspect: '16:9' },
  context: { beatText: 'Le compte affiche 397 €.', subject: 'brokerage account', keyTerms: ['brokerage', 'account', 'screen'] },
  unitPrice: 1,
  units: 1,
  priority: 5,
  shotIds: [`s-${id}`],
  ...over
})
const listArt = (items: GenItem[]): Artefact => art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } satisfies GenList as never })

/** A stock Cloud whose results are coloured test photographs (one colour per query and rank); `none` finds nothing. */
function stockCloud(asked: string[], o: { none?: (q: string) => boolean; hits?: number } = {}): CloudService {
  const no = (): Promise<never> => Promise.reject(new Error('a demo never asks this'))
  return {
    synthesize: no,
    generateImage: no,
    generateVideo: no,
    talkingAvatar: no,
    searchStock: async (req, opts) => {
      asked.push(req.query)
      if (o.none?.(req.query)) return { results: [], files: [], demo: false, credits: 0 }
      // like the real client: the results are downloaded into a folder the caller made (never made here)
      if (!existsSync(opts.dir)) throw new Error(`ENOENT: ${opts.dir}`)
      const results: (StockHit & { file: string })[] = []
      for (let k = 0; k < Math.min(req.count, o.hits ?? 2); k++) {
        const file = path.join(opts.dir, `hit-${k}.jpg`)
        const c = ((asked.length * 40 + k * 90) % 200) + 30
        await ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${c.toString(16).padStart(2, '0')}5050:s=800x450:d=1`, '-frames:v', '1', file])
        results.push({ id: `${req.query}-${k}`, source: 'pixabay', kind: 'photo', title: req.query, creator: 'x', creatorUrl: null, pageUrl: null, licence: 'Pixabay', attribution: '', attributionRequired: false, orientation: 'landscape', file } as StockHit & { file: string })
      }
      return { results, files: results.map((r) => r.file), demo: false, credits: 0 }
    }
  }
}

describe('the demo run’s Cloud: free usages only, never a spend', () => {
  it('refuses every paid usage before any request', async () => {
    const calls: string[] = []
    const inner: CloudService = {
      synthesize: async () => { calls.push('synthesize'); return { audioFile: '', words: [], demo: false } },
      generateImage: async () => { calls.push('image'); return { files: [], demo: false } },
      generateVideo: async () => { calls.push('video'); return { files: [], demo: false } },
      talkingAvatar: async () => { calls.push('avatar'); return { files: [], demo: false } },
      searchStock: async () => { calls.push('stock'); return { results: [], files: [], demo: false } }
    }
    const c = freeUsagesOnly(inner)
    const opts = { idempotencyKey: 'k', signal, dir: process.cwd() }
    await expect(c.synthesize({ text: 'a', voiceId: 'v', wordTimings: true }, opts)).rejects.toThrow(/démo est gratuite/)
    await expect(c.generateImage({ prompt: 'a', width: 10, height: 10 }, opts)).rejects.toThrow(/démo est gratuite/)
    await expect(c.generateVideo({ prompt: 'a', seconds: 2, aspect: '16:9' }, opts)).rejects.toThrow(/démo est gratuite/)
    await expect(c.talkingAvatar({ avatarId: 'a', audioFile: 'x', seconds: 2, aspect: '16:9' }, opts)).rejects.toThrow(/démo est gratuite/)
    await c.searchStock({ query: 'q', orientation: 'landscape', kind: 'photo', count: 1 }, opts)
    expect(calls).toEqual(['stock'])
    expect(c.realRun).toBeUndefined()
  })

  it('refuses a stock quote the Cloud prices above 0 credits before a job exists; a free one goes on to its job', async () => {
    for (const credits of [3, 0]) {
      const hits: string[] = []
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        hits.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
        if (url.endsWith('/v1/quotes')) return json(200, quote(credits))
        return json(500, { error: { code: 'internal', message: 'stop here' } })
      }) as unknown as typeof fetch
      const c = demoCloudService({ baseUrl: 'http://cloud.test', token: () => 'tok', fetchImpl, pollMs: 5, busyBudgetMs: 0 })
      const r = c.searchStock({ query: 'q', orientation: 'landscape', kind: 'photo', count: 1 }, { idempotencyKey: `k-${credits}`, signal, dir: work('freeonly') })
      if (credits > 0) {
        await expect(r).rejects.toThrow(/ne dépense rien/)
        expect(hits).toEqual(['POST /v1/quotes'])
      } else {
        await expect(r).rejects.toThrow()
        expect(hits.slice(0, 2)).toEqual(['POST /v1/quotes', 'POST /v1/jobs'])
      }
    }
  })

  it('the production host gives a demo run that client while a Cloud is connected, nothing otherwise', () => {
    const dir = work('host')
    const base = { dataDir: dir, resourcesDir: dir, worker: { command: process.execPath, args: [] } }
    const none = createProductionHost({ ...base, cloud: null })
    expect(none.forDemoRun({ dataDir: dir, resourcesDir: dir })).toBeNull()
    const host = createProductionHost({ ...base, cloud: { baseUrl: () => 'http://cloud.test', token: async () => 'tok' } })
    const demo = host.forDemoRun({ dataDir: dir, resourcesDir: dir })
    expect(demo?.services.cloud).toBeDefined()
    expect(demo?.services.cloud?.realRun).toBeUndefined()
    return expect(demo?.services.cloud?.talkingAvatar({ avatarId: 'a', audioFile: 'x', seconds: 1, aspect: '16:9' }, { idempotencyKey: 'k', signal, dir })).rejects.toThrow(/démo est gratuite/)
  })
})

describe('found stand-ins: the pure parts', () => {
  it('searches with the item’s own words: its search for a stock item, then its key terms, then its subject', () => {
    expect(standInQueries(genItem('a', 'stock.photo', { query: 'stock market screen' }))).toEqual(['stock market screen', 'brokerage account screen'])
    expect(standInQueries(genItem('b', 'image.gen', { prompt: 'a long generation prompt, photoreal, grade' }))).toEqual(['brokerage account screen', 'brokerage account'])
  })
  it('reads the subjects a measured look names, never its style words', () => {
    const finary = 'photoreal cinematic studio still, saturated red and black grade, warm dramatic key light, shallow depth of field, fine grain; one unique concrete illustration per narrated sentence (e.g. brokerage account screen with a 397 € figure, couple in a legal dispute, documents, courtroom imagery); never text lists, keywords or prompt text rendered in the image'
    expect(lookQueries(finary)).toEqual(['brokerage account screen', 'couple legal dispute', 'documents', 'courtroom imagery'])
    expect(lookQueries('flat vector style, bold colours')).toEqual([])
    expect(lookQueries(undefined)).toEqual([])
  })
  it('puts the look’s measured colour treatment on the photograph, nothing when it names none', () => {
    expect(lookGrade('documentary archive, black and white, grain')).toMatch(/^hue=s=0/)
    expect(lookGrade('photoreal studio still, saturated red and black grade')).toMatch(/colorbalance=rs=0\.28.*contrast.*saturation=1\.3/)
    expect(lookGrade('flat vector shapes')).toBe('')
    expect(lookGrade(undefined)).toBe('')
  })
  it('crops a close framing tighter than a picture that has no close angle, never a wide one', () => {
    expect(STAND_IN_ZOOM).toEqual({ wide: 1, medium: 1, close: 0.66 })
    expect(standInGraph({ w: 1920, h: 1080, zoom: 0.66, n: 90 })).toMatch(/crop=iw\*0\.66/)
    expect(standInGraph({ w: 1920, h: 1080, zoom: 1, n: 90 })).not.toMatch(/crop=iw\*/)
    expect(standInGraph({ w: 1920, h: 1080, zoom: 1, n: 90 })).not.toMatch(/drawtext/)
  })
})

describe.skipIf(!hasFullFfmpeg)(`found stand-ins in the demo nodes${NO_FULL_FFMPEG}`, () => {
  it('visuals.fulfil: every picture item a stock photograph, full frame, never the same twice, a miss takes a photo left by a neighbour', { timeout: 120_000 }, async () => {
    const dir = work('found')
    const asked: string[] = []
    const items = [
      genItem('i1', 'image.gen'),
      genItem('i2', 'image.gen'),
      genItem('v1', 'video.gen', { context: { beatText: '', subject: 'courtroom', keyTerms: ['courtroom', 'judge'] } }),
      genItem('s1', 'stock.video', { query: 'old documents' }),
      genItem('g1', 'stock.photo', { query: 'nothing here', context: { beatText: '', subject: 'nothing', keyTerms: ['nothing'] } }),
      genItem('a1', 'avatar')
    ]
    const ctx = makeCtx({ ...testServices(dir), cloud: stockCloud(asked, { none: (q) => q.startsWith('nothing') }) })
    const out = await visualsFulfil.fake(ctx, { list: listArt(items) }, VisualsParams.parse({ standIns: 'found', look: { suffix: 'saturated red and black grade' } }))
    const rec = out.images?.value as unknown as { itemId: string; standIn: string; demo: boolean; stock?: { id: string }; degraded?: string }[]
    // the presenter is not a picture; the four found items and the gap
    expect(rec.map((r) => r.itemId)).toEqual(['i1', 'i2', 'v1', 's1', 'g1'])
    expect(rec.every((r) => r.standIn === 'found' && r.demo)).toBe(true)
    expect(out.images?.meta).toMatchObject({ demo: true, standIns: 'found' })
    expect(out.images?.meta).not.toHaveProperty('provisional')
    // i1 and i2 asked the same words: the second takes the next result, never the same photograph
    expect(rec[0]?.stock?.id).not.toBe(rec[1]?.stock?.id)
    expect(rec[2]?.degraded).toMatch(/photo fixe/)
    // g1 found nothing for its own words: a photograph no item took, from the nearest results (its own picture, never a hold)
    expect(rec[4]?.degraded).toMatch(/recherche voisine/)
    expect(new Set(rec.map((r) => r.stock?.id)).size).toBe(5)
    expect(asked).toContain('old documents')
    expect(asked).toContain('courtroom judge')
    // video items are stills: no clip
    expect(out.clips?.files).toEqual([])
    for (const f of out.images?.files ?? []) {
      const p = await probe(media, f, signal)
      expect(p.streams[0]).toMatchObject({ width: 1920, height: 1080 })
    }
  })

  it('visuals.fulfil: more misses than the render accepts → the drawn stand-ins (the render never stops on borrowed pictures)', { timeout: 120_000 }, async () => {
    const dir = work('found-misses')
    const items = [genItem('i1', 'image.gen'), ...['a', 'b', 'c'].map((k) => genItem(`m${k}`, 'image.gen', { context: { beatText: '', subject: `nothing ${k}`, keyTerms: [`nothing${k}`] } }))]
    const ctx = makeCtx({ ...testServices(dir), cloud: stockCloud([], { none: (q) => q.startsWith('nothing'), hits: 1 }) })
    const out = await visualsFulfil.fake(ctx, { list: listArt(items) }, VisualsParams.parse({ standIns: 'found' }))
    expect((out.images?.value as unknown as { source: string }[]).every((r) => r.source === 'drawn')).toBe(true)
    // the fallback says why, in the artefact a run keeps
    expect(out.images?.meta?.standInFallback).toMatch(/3 of 4 items without a photograph/)
  })

  it('visuals.fulfil: items whose template words find nothing take photographs of the subjects the look names', { timeout: 120_000 }, async () => {
    const dir = work('found-look')
    const asked: string[] = []
    const items = ['a', 'b', 'c'].map((k) => genItem(`m${k}`, 'image.gen', { context: { beatText: '', subject: `nothing ${k}`, keyTerms: [`nothing${k}`] } }))
    const ctx = makeCtx({ ...testServices(dir), cloud: stockCloud(asked, { none: (q) => q.startsWith('nothing') }) })
    const out = await visualsFulfil.fake(ctx, { list: listArt(items) }, VisualsParams.parse({ standIns: 'found', look: { suffix: 'photoreal still (e.g. brokerage account screen, courtroom imagery)' } }))
    const rec = out.images?.value as unknown as { standIn?: string; degraded?: string; prompt: string }[]
    expect(rec.every((r) => r.standIn === 'found' && /sujet du style/.test(r.degraded ?? ''))).toBe(true)
    expect(new Set(rec.map((r) => r.prompt))).toEqual(new Set(['brokerage account screen', 'courtroom imagery']))
    expect(asked).toEqual(expect.arrayContaining(['brokerage account screen', 'courtroom imagery']))
  })

  it('visuals.fulfil: without a Cloud the demo draws its stand-ins as before', { timeout: 120_000 }, async () => {
    const dir = work('found-nocloud')
    const ctx = makeCtx(testServices(dir))
    const out = await visualsFulfil.fake(ctx, { list: listArt([genItem('i1', 'image.gen')]) }, VisualsParams.parse({ standIns: 'found' }))
    expect((out.images?.value as unknown as { source: string }[])[0]?.source).toBe('drawn')
  })

  it('clip.make: no drawn clip over found pictures (the found still takes the shot’s move); drawn pictures keep their drawn clips', { timeout: 120_000 }, async () => {
    const dir = work('clips')
    const ctx = makeCtx(testServices(dir))
    const found = await clipMake.fake(ctx, { list: listArt([genItem('v1', 'video.gen')]), images: art('media.image[]', { files: [], value: [], meta: { standIns: 'found' } }) }, ClipParams.parse({ standIns: 'found' }))
    expect(found.clips?.files).toEqual([])
    const still = path.join(dir, 'still.jpg')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x335577:s=640x360:d=1', '-frames:v', '1', still])
    const drawn = await clipMake.fake(ctx, { list: listArt([genItem('v1', 'video.gen')]), images: art('media.image[]', { files: [still], value: [{ itemId: 'v1', file: 0 }] as never }) }, ClipParams.parse({ standIns: 'found' }))
    expect(drawn.clips?.files).toHaveLength(1)
  })

  const words = (n: number): Word[] => Array.from({ length: n }, (_, i) => ({ w: `m${i}`, start: 0.25 + i * 0.5, end: 0.6 + i * 0.5, sentence: 0, paragraph: 0 }))
  const avatarItem = (id: string, a: number, b: number): GenItem => ({ ...genItem(id, 'avatar'), constraints: { durationS: b - a, aspect: '16:9' }, voiceRange: { startFrame: a * 30, endFrame: b * 30 }, layout: 'full' })
  async function speak(dir: string, cloud: CloudService | undefined, params: Record<string, unknown>) {
    const voice = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=12:c=pink:r=48000:seed=3:a=0.3', '-c:a', 'flac', voice])
    const ctx = makeCtx({ ...testServices(dir), ...(cloud ? { cloud } : {}) })
    return avatarSpeak.fake(
      ctx,
      { genlist: listArt([avatarItem('p1', 0, 3), avatarItem('p2', 6, 9)]), voice: art('audio.voice', { files: [voice], meta: { demo: true } }), words: art('json.words', { value: words(23) as never, meta: { durationS: 12 } }) },
      AvatarParams.parse({ talk: { framing: 'multi' }, ...params })
    )
  }

  it('avatar.speak: the presenter’s own pictures speak, no search; the stand-in has the planned framings', { timeout: 120_000 }, async () => {
    const dir = work('speak-own')
    const portrait = path.join(dir, 'portrait.png')
    const wide = path.join(dir, 'wide.png')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x223355:s=960x540:d=1', '-frames:v', '1', portrait])
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x553322:s=960x540:d=1', '-frames:v', '1', wide])
    const asked: string[] = []
    const out = await speak(dir, stockCloud(asked), { standIns: 'found', standInPerson: 'man black turtleneck portrait', presenter: { id: 'p', portrait, angles: [{ framing: 'wide', file: wide }] } })
    expect(asked).toEqual([])
    const clips = out.clips?.value as unknown as { framing: string; demo: boolean }[]
    expect(clips.map((c) => c.framing)).toEqual(['medium', 'wide'])
    expect(clips.every((c) => c.demo)).toBe(true)
    // the photograph, not the silhouette: the first frame keeps the portrait's colour
    const frame = path.join(dir, 'f.png')
    await ffmpeg(['-i', out.clips?.files?.[0] as string, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame])
    const { readFile } = await import('node:fs/promises')
    const [r, , b] = [...(await readFile(frame))]
    expect(b as number).toBeGreaterThan(r as number)
  })

  it('avatar.speak: without a picture, one stock photo of the planned type for every call; without a Cloud, the drawn silhouette', { timeout: 120_000 }, async () => {
    const asked: string[] = []
    const found = await speak(work('speak-stock'), stockCloud(asked), { standIns: 'found', standInPerson: 'man 35-45 black turtleneck portrait' })
    expect([...new Set(asked)]).toEqual(['man 35-45 black turtleneck portrait'])
    expect(found.clips?.files).toHaveLength(2)
    const dd = work('speak-drawn')
    const drawn = await speak(dd, undefined, { standIns: 'found', standInPerson: 'man portrait' })
    expect(drawn.clips?.files).toHaveLength(2)
    // the silhouette was drawn, no photograph call was made (and the cache keeps it under the drawn key, never the found one)
    const { readdirSync } = await import('node:fs')
    const made = readdirSync(dd, { recursive: true }).map(String)
    expect(made.some((f) => f.endsWith('drawn.mp4'))).toBe(true)
    expect(made.some((f) => f.endsWith('stand-in.mp4'))).toBe(false)
  })
})

describe('the free gate’s demo recipe', () => {
  const def = (over: Record<string, unknown> = {}): StyleDefinition => ({
    presenter: {
      kind: { value: 'real' },
      mode: { value: 'look-alike-placeholder' },
      identity: { value: { age: '35-45', gender: 'man', face: 'oval', hair: 'short', wardrobe: 'fitted black turtleneck', setting: 'dark studio', lighting: 'blue' } },
      placeholder: { value: null },
      ...over
    }
  }) as unknown as StyleDefinition
  const recipe = { bricks: [{ tech: 'visuals.fulfil@1', settings: { look: { suffix: 'x' } } }, { tech: 'clip.make@1', settings: {} }, { tech: 'avatar.speak@1', settings: { framing: 'multi' } }, { tech: 'render.assemble@1', settings: {} }] }

  it('sets found stand-ins on the pictures, the clips and the presenter, keeping every other setting; the judge copy also loses its mark', () => {
    const doc = withoutWatermark(withFoundStandIns(recipe, def())) as typeof recipe
    expect(doc.bricks.map((b) => b.settings)).toEqual([
      { look: { suffix: 'x' }, standIns: 'found' },
      { standIns: 'found' },
      { framing: 'multi', standIns: 'found', standInPerson: 'man 35-45 fitted black turtleneck portrait' },
      { watermark: 'off' }
    ])
    // the plan's own recipe is untouched (a paid run never carries stand-ins)
    expect(recipe.bricks[0]?.settings).toEqual({ look: { suffix: 'x' } })
  })
  it('searches the person of the look-alike’s type first, nobody when the style has no presenter', () => {
    expect(standInPerson(def({ placeholder: { value: { type: { age: '60', gender: 'woman', hair: 'grey', wardrobe: 'red coat', setting: '', lighting: '', framing: '' } } } }))).toBe('woman 60 red coat portrait')
    expect(standInPerson(def({ kind: { value: 'none' } }))).toBeNull()
  })
})
