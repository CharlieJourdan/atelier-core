// thumbnail.make@1 (docs/ENGINE-SPEC.md §29): concepts (Claude, fake in tests), art through the Cloud (a stub here), the headline
// laid out by us with ffmpeg, N PNGs of 1280×720, per-concept cache, failed concepts skipped, and the package writing the pick as
// thumbnail.png. Real ffmpeg; no network.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, CloudService, ClaudeService, EngineServices } from '../../src/engine'
import { EngineError } from '../../src/engine/errors'
import type { Outline } from '../../src/engine/formats/outline'
import { layoutHeadline } from '../../src/engine/media/headline'
import { packageYoutube } from '../../src/engine/nodes/package-youtube'
import { checkConcepts, cleanHeadline, derivedHeadline, thumbnailMake, ThumbnailParams } from '../../src/engine/nodes/thumbnail-make'
import { MEDIA, art, hasFfmpeg, hasFullFfmpeg, makeCtx, NO_FULL_FFMPEG, tempDir, testServices } from './engine-node-helpers'

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

const OUTLINE = {
  language: 'fr',
  title: 'Le phare qui ne s’est jamais éteint',
  shape: 'chronicle',
  kind: 'story',
  promise: 'Découvrir pourquoi personne n’a osé éteindre la lumière',
  hook: 'Une nuit de 1863, le gardien disparaît mais la lampe brûle encore',
  beats: [{ index: 0, purpose: 'accroche', summary: 'Le gardien disparaît', wordBudget: 120, tags: [], anchor: 'Une nuit', marks: [] }],
  chapters: [{ title: 'La nuit de 1863', firstBeat: 0, anchor: 'Une nuit' }],
  planted: [],
  dropped: []
} as unknown as Outline
const SCRIPT = 'Une nuit de 1863, le gardien du phare disparaît. La lampe, elle, brûle toujours. Personne ne comprend.'
const inputs = (): Record<string, Artefact> => ({ script: art('text.script', { value: SCRIPT }), outline: art('json.outline', { value: OUTLINE as never }) })
const params = (over: Record<string, unknown> = {}) => ThumbnailParams.parse(over)
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

async function dims(file: string): Promise<{ width: number; height: number; codec_name: string }> {
  const r = await media.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', file], { signal })
  return (JSON.parse(r.stdout.toString('utf8')) as { streams: { width: number; height: number; codec_name: string }[] }).streams[0] as { width: number; height: number; codec_name: string }
}

describe('headline text rules', () => {
  it('cleanHeadline: capitals, 2–4 words, no quotes or brackets, at most 28 characters', () => {
    expect(cleanHeadline('« la lampe  brûle encore » vraiment pas')).toBe('LA LAMPE BRÛLE ENCORE')
    expect(cleanHeadline('(secret) <interdit>')).toBe('SECRET INTERDIT')
    expect(cleanHeadline('un titre vraiment très long pour la vignette')).toBe('UN TITRE VRAIMENT TRÈS')
    expect(cleanHeadline('anticonstitutionnellement extraordinairement')).toBe('ANTICONSTITUTIONNELLEMENT')
    expect(cleanHeadline('   ')).toBe('')
  })

  it('derivedHeadline: content words of the hook, never the title, never one already taken', () => {
    const h = derivedHeadline(OUTLINE)
    expect(h).toMatch(/^[A-ZÀ-Ý0-9 ]+$/)
    expect(h.split(' ').length).toBeLessThanOrEqual(3)
    expect(derivedHeadline(OUTLINE, [h])).not.toBe(h)
  })

  it('checkConcepts: an empty headline, the title itself, or a repeat is replaced', () => {
    const c = (headline: string) => ({ headline, position: 'bottom' as const, prompt: 'a lighthouse at night, cold light' })
    const out = checkConcepts([c('LE PHARE QUI NE S’EST JAMAIS ÉTEINT'), c(''), c('NUIT 1863'), c('nuit 1863')], OUTLINE)
    expect(out.every((x) => x.headline.length > 0)).toBe(true)
    expect(new Set(out.map((x) => x.headline)).size).toBe(4)
    expect(out[2]?.headline).toBe('NUIT 1863')
  })

  it('layoutHeadline: one line when short, two balanced lines when long, a bigger font for fewer letters', () => {
    const short = layoutHeadline('stop')
    const long = layoutHeadline('la lampe brûle encore')
    expect(short.lines).toEqual(['STOP'])
    expect(long.lines).toHaveLength(2)
    expect(long.lines.join(' ')).toBe('LA LAMPE BRÛLE ENCORE')
    expect(short.size).toBeGreaterThan(long.size)
    for (const b of [short, long]) {
      expect(b.size).toBeGreaterThanOrEqual(72)
      expect(Math.max(...b.lines.map((l) => l.length)) * b.size * 0.72).toBeLessThanOrEqual(1120 + 1)
    }
  })
})

describe.skipIf(!hasFullFfmpeg)(`thumbnail.make fake (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('draws N distinct 1280×720 PNGs with a headline each, the first being the chosen one', { timeout: 120_000 }, async () => {
    const dir = work('thumb-fake')
    const out = await thumbnailMake.fake(makeCtx(testServices(dir)), inputs(), params())
    const files = out.thumbnails?.files ?? []
    expect(files).toHaveLength(3)
    for (const f of files) {
      expect(f).toMatch(/\.png$/)
      expect(await dims(f)).toMatchObject({ width: 1280, height: 720, codec_name: 'png' })
    }
    expect(new Set(files.map(sha)).size).toBe(3)
    const rec = out.thumbnails?.value as unknown as { file: number; headline: string; demo: boolean }[]
    expect(rec.map((r) => r.file)).toEqual([0, 1, 2])
    expect(rec.every((r) => r.demo && r.headline.length > 0)).toBe(true)
    expect(new Set(rec.map((r) => r.headline)).size).toBe(3)
    expect(out.thumbnails?.meta).toMatchObject({ count: 3, chosen: 0, demo: true, skipped: 0 })
  })

  it('the headline is really laid out: two headlines on one background give two different pictures; the band layout differs from the scrim', { timeout: 120_000 }, async () => {
    const a = await thumbnailMake.fake(makeCtx(testServices(work('thumb-layout-a'))), inputs(), params({ count: 1 }))
    const b = await thumbnailMake.fake(makeCtx(testServices(work('thumb-layout-b'))), inputs(), params({ count: 1, layout: 'band' }))
    expect(sha((a.thumbnails?.files ?? [])[0] as string)).not.toBe(sha((b.thumbnails?.files ?? [])[0] as string))
  })

  it('caches each concept: a second run draws nothing', { timeout: 120_000 }, async () => {
    const dir = work('thumb-cache')
    const services = testServices(dir)
    await thumbnailMake.fake(makeCtx(services), inputs(), params())
    const cache = path.join(dir, 'cache', 'thumbnails')
    const mtimes = () => new Map(readdirSync(cache).filter((f) => f.endsWith('.png')).map((f) => [f, statSync(path.join(cache, f)).mtimeMs]))
    const first = mtimes()
    expect(first.size).toBe(3)
    await new Promise((r) => setTimeout(r, 30))
    await thumbnailMake.fake(makeCtx(services), inputs(), params())
    expect(mtimes()).toEqual(first)
    // a new node seed is a new set
    await thumbnailMake.fake(makeCtx(services, { seed: 9 }), inputs(), params())
    expect(mtimes().size).toBe(6)
  })
})

interface Calls {
  prompts: string[]
  sizes: [number, number][]
  keys: string[]
  engines?: (string | undefined)[]
}

/** A Cloud whose pictures are ffmpeg test patterns; `fail(i)` makes the i-th generation fail. */
function stubCloud(calls: Calls, fail: (i: number) => Error | null = () => null): CloudService {
  return {
    synthesize: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    generateImage: async (req, opts) => {
      const i = calls.prompts.length
      calls.prompts.push(req.prompt)
      calls.sizes.push([req.width, req.height])
      calls.keys.push(opts.idempotencyKey)
      calls.engines?.push(req.engine)
      const err = fail(i)
      if (err) throw err
      await mkdir(opts.dir, { recursive: true })
      const file = path.join(opts.dir, 'art.png')
      await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=1344x768:d=1,hue=h=${i * 70}`, '-frames:v', '1', file], { signal })
      return { files: [file], demo: false, credits: 1 }
    }
  }
}

const CONCEPTS = {
  concepts: [
    { headline: 'La lampe brûle encore', position: 'bottom', prompt: 'A lone lighthouse lamp burning in a storm, cold teal light, one subject' },
    { headline: '1863 : il disparaît', position: 'top', prompt: 'An empty keeper room, an open logbook and a lit lantern, warm amber shadows' },
    { headline: 'Personne n’a osé', position: 'middle', prompt: 'A rowing boat approaching a dark island at dusk with one light on the cliff' }
  ]
}

describe.skipIf(!hasFullFfmpeg)('thumbnail.make run (stub Claude and Cloud)', () => {
  const claude = (reply: unknown = CONCEPTS, asks: string[] = []): ClaudeService => ({
    ask: (req) => {
      asks.push(`${req.role}\n${req.system}\n${req.prompt}`)
      return Promise.resolve({ text: JSON.stringify(reply) })
    }
  })

  it('asks Claude for concepts, draws each at 1280×720 with a no-text art prompt, and lays the headline out itself', { timeout: 120_000 }, async () => {
    const dir = work('thumb-run')
    const calls: Calls = { prompts: [], sizes: [], keys: [] }
    const asks: string[] = []
    const services: EngineServices = testServices(dir, { claude: claude(CONCEPTS, asks), cloud: stubCloud(calls) })
    const out = await thumbnailMake.run(makeCtx(services), inputs(), params({ style: 'cold teal palette, no face' }))
    // Claude saw the title, the promise, the hook, the chapters and the style, in the output language
    expect(asks[0]).toContain('thumbnail')
    expect(asks[0]).toContain(OUTLINE.title)
    expect(asks[0]).toContain('cold teal palette')
    expect(asks[0]).toContain('French')
    // one paid picture per concept, 1280×720, the art prompt carries the concept and forbids text; the keys differ
    expect(calls.prompts).toHaveLength(3)
    expect(calls.sizes.every(([w, h]) => w === 1280 && h === 720)).toBe(true)
    expect(calls.prompts[0]).toContain('lone lighthouse lamp')
    expect(calls.prompts.every((p) => /No text, no letters/.test(p))).toBe(true)
    expect(new Set(calls.keys).size).toBe(3)
    const files = out.thumbnails?.files ?? []
    expect(files).toHaveLength(3)
    for (const f of files) expect(await dims(f)).toMatchObject({ width: 1280, height: 720, codec_name: 'png' })
    const rec = out.thumbnails?.value as unknown as { headline: string; position: string; demo: boolean }[]
    expect(rec.map((r) => r.headline)).toEqual(['LA LAMPE BRÛLE ENCORE', '1863 : IL DISPARAÎT', 'PERSONNE N’A OSÉ'])
    expect(rec.map((r) => r.position)).toEqual(['bottom', 'top', 'middle'])
    expect(rec.every((r) => r.demo === false)).toBe(true)
    expect(out.thumbnails?.meta).toMatchObject({ count: 3, chosen: 0, demo: false })
    // a second run is all cache: no new paid picture
    await thumbnailMake.run(makeCtx(services), inputs(), params({ style: 'cold teal palette, no face' }))
    expect(calls.prompts).toHaveLength(3)
  })

  it('fills in a headline when the concept gives none or repeats the title', { timeout: 120_000 }, async () => {
    const dir = work('thumb-headline')
    const reply = { concepts: [{ headline: '', position: 'bottom', prompt: 'A lighthouse in fog, soft grey light, one subject' }, { headline: OUTLINE.title, position: 'top', prompt: 'A lamp room at night, warm light, one subject' }] }
    const out = await thumbnailMake.run(makeCtx(testServices(dir, { claude: claude(reply), cloud: stubCloud({ prompts: [], sizes: [], keys: [] }) })), inputs(), params({ count: 2 }))
    const rec = out.thumbnails?.value as unknown as { headline: string }[]
    expect(rec).toHaveLength(2)
    expect(rec.every((r) => r.headline.length > 0 && r.headline !== OUTLINE.title.toUpperCase())).toBe(true)
    expect(new Set(rec.map((r) => r.headline)).size).toBe(2)
  })

  it('skips a concept whose picture fails, fills nothing in by copy, and errors only when none is left', { timeout: 120_000 }, async () => {
    const dir = work('thumb-fail')
    const calls: Calls = { prompts: [], sizes: [], keys: [] }
    // one engine, no fallback: the failed concept has nowhere else to go
    const one = params({ engine: 'image:gpt-image-25-low' })
    const some = await thumbnailMake.run(makeCtx(testServices(dir, { claude: claude(), cloud: stubCloud(calls, (i) => (i === 1 ? new EngineError('refused', 'le fournisseur a échoué') : null)) })), inputs(), one)
    expect(some.thumbnails?.files).toHaveLength(2)
    expect(some.thumbnails?.meta).toMatchObject({ count: 2, skipped: 1 })
    const dir2 = work('thumb-fail-all')
    await expect(
      thumbnailMake.run(makeCtx(testServices(dir2, { claude: claude(), cloud: stubCloud({ prompts: [], sizes: [], keys: [] }, () => new EngineError('refused', 'tout échoue')) })), inputs(), one)
    ).rejects.toThrow('tout échoue')
  })

  it('draws the art on the image engines like the stills: the default engine, its fallback when it fails, or the brick’s pin (production-17)', { timeout: 120_000 }, async () => {
    // unpinned: the default image engine (never the Cloud's anonymous default provider, a demo on the beta)
    const calls: Calls = { prompts: [], sizes: [], keys: [], engines: [] }
    await thumbnailMake.run(makeCtx(testServices(work('thumb-engine'), { claude: claude(), cloud: stubCloud(calls) })), inputs(), params({ count: 1 }))
    expect(calls.engines).toEqual(['image:gpt-image-25-low'])
    // the engine fails: its fallback makes the picture
    const fb: Calls = { prompts: [], sizes: [], keys: [], engines: [] }
    const out = await thumbnailMake.run(makeCtx(testServices(work('thumb-fallback'), { claude: claude(), cloud: stubCloud(fb, (i) => (i === 0 ? new EngineError('transient', 'en panne') : null)) })), inputs(), params({ count: 1 }))
    expect(fb.engines).toEqual(['image:gpt-image-25-low', 'image:gpt-image-25-fal-low'])
    expect(out.thumbnails?.files).toHaveLength(1)
    // the brick's pin
    const pinned: Calls = { prompts: [], sizes: [], keys: [], engines: [] }
    await thumbnailMake.run(makeCtx(testServices(work('thumb-pin'), { claude: claude(), cloud: stubCloud(pinned) })), inputs(), params({ count: 1, engine: 'image:gpt-image-25-medium' }))
    expect(pinned.engines).toEqual(['image:gpt-image-25-medium'])
  })

  it('a missing Cloud ends the node at once with the French message, and a stop is not swallowed', { timeout: 120_000 }, async () => {
    const dir = work('thumb-nocloud')
    await expect(thumbnailMake.run(makeCtx(testServices(dir, { claude: claude() })), inputs(), params())).rejects.toMatchObject({ code: 'missing_tool' })
    const ac = new AbortController()
    ac.abort()
    await expect(thumbnailMake.run(makeCtx(testServices(work('thumb-abort'), { claude: claude(), cloud: stubCloud({ prompts: [], sizes: [], keys: [] }) }), { signal: ac.signal }), inputs(), params())).rejects.toBeDefined()
  })

  it('estimates its images and is gated for the owner', () => {
    expect(thumbnailMake.estimate({ inputs: {}, minutes: 5 } as never, params({ count: 2 }))).toMatchObject({ units: [{ unit: 'images', qty: 2 }, { unit: 'calls', qty: 1 }], provider: 'image' })
    expect(thumbnailMake.defaultGate).toBe('owner')
    expect(thumbnailMake.claudeRole).toBeUndefined() // a Claude node is quoted as free: this one pays for pictures
  })
})

describe.skipIf(!hasFfmpeg)('package.youtube with thumbnails', () => {
  it('writes the first thumbnail as thumbnail.png (the owner’s pick) and the others beside it, and lists them in the package files', async () => {
    const dir = work('thumb-package')
    const mk = (n: string, bytes: string): string => {
      const f = path.join(dir, n)
      writeFileSync(f, bytes)
      return f
    }
    const words = Array.from({ length: 12 }, (_, i) => ({ w: `mot${i}`, start: i, end: i + 0.8, sentence: 0, paragraph: 0 }))
    const ins: Record<string, Artefact> = {
      video: art('video.final', { files: [mk('video.mp4', 'video')], meta: { demo: true } }),
      script: art('text.script', { value: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9 mot10 mot11.' }),
      outline: art('json.outline', { value: OUTLINE as never }),
      words: art('json.words', { value: words as never }),
      subs: art('subs.track', { files: [mk('captions.srt', '1\n00:00:00,000 --> 00:00:01,000\nmot\n')] }),
      thumbnails: art('image.thumbnail[]', { files: [mk('t1.png', 'PNG-ONE'), mk('t2.png', 'PNG-TWO')] })
    }
    const out = await packageYoutube.fake(makeCtx(testServices(dir), { node: packageYoutube }), ins, { language: 'fr', avoidTitles: [], footer: [] })
    const files = out.package?.files ?? []
    const names = files.map((f) => path.basename(f))
    expect(names).toEqual(['video.mp4', 'description.txt', 'captions.srt', 'metadata.json', 'checklist.md', 'thumbnail.png', 'thumbnail-2.png'])
    expect(readFileSync(files[5] as string, 'utf8')).toBe('PNG-ONE')
    expect(readFileSync(files[6] as string, 'utf8')).toBe('PNG-TWO')
    expect((out.package?.value as { files: string[] }).files).toEqual(names)
    expect(out.metadata?.value).toMatchObject({ thumbnail: 'thumbnail.png', thumbnails: ['thumbnail.png', 'thumbnail-2.png'] })
    expect(existsSync(files[5] as string)).toBe(true)
    // without thumbnails the package is as before
    const plain = await packageYoutube.fake(makeCtx(testServices(dir), { node: packageYoutube }), { ...ins, thumbnails: undefined as never }, { language: 'fr', avoidTitles: [], footer: [] })
    expect((plain.package?.files ?? []).map((f) => path.basename(f))).toEqual(['video.mp4', 'description.txt', 'captions.srt', 'metadata.json', 'checklist.md'])
  })
})
