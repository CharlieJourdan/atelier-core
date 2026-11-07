// Integration tests of the picture and render nodes of lot P4 (visuals.fulfil fake / through the local Cloud, and
// render.assemble with a hand-made plan) with real ffmpeg. No network except loopback to an in-process Cloud.
import { readdirSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, EngineServices, NodeOutputs } from '../../src/engine'
import { cloudHttpService } from '../../src/engine/cloud-http'
import { EngineError } from '../../src/engine/errors'
import { EDITPLAN_SCHEMA, type EditPlan, type GenItem, type GenList, type Shot } from '../../src/engine/formats/editplan'
import { measureLoudness, probe, type StreamInfo } from '../../src/engine/media/probe'
import { captionsMake } from '../../src/engine/nodes/captions-make'
import { renderAssemble, RenderParams } from '../../src/engine/nodes/render-assemble'
import { visualsFulfil, VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import { verify } from '../../src/engine/render/final'
import { motionFilter, segmentArgs, segmentKey, segmentSpecs } from '../../src/engine/render/segments'
import { parseScript } from '../../src/engine/text/script'
import { FFMPEG_LACKS, FFMPEG_PATH, MEDIA, NO_FULL_FFMPEG, art, hasFfmpeg, hasFullFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

// The Cloud's sources import each other with .ts extensions, which the app's tsconfig does not allow: they are loaded
// through a computed path (typed here by hand) so the typecheck of the app never walks into cloud/.
interface TestCloud {
  app: { listen(o: { host: string; port: number }): Promise<string>; server: { address(): unknown } }
  cloud: {
    db: { prepare(sql: string): { get(): unknown } }
    wallet: { entries(teamId: string): { entries: { kind: string }[] }; state(teamId: string): { balance: number } }
  }
}
interface Person {
  teamId: string
  accessToken: string
}
const HELPERS = 'helpers'
const { makeCloud, signUpAndIn } = (await import(`../../cloud/tests/${HELPERS}.ts`)) as {
  makeCloud(): TestCloud
  signUpAndIn(t: TestCloud, p: { credits: number }): Promise<Person>
}

const media = MEDIA as NonNullable<typeof MEDIA>
const signal = new AbortController().signal

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}
const ffmpeg = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })

// ---- visuals.fulfil -------------------------------------------------------------------------------------------------

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
const genlist = (items: GenItem[]): GenList => ({ items, totals: { credits: items.length, items: items.length, byKind: {} }, budget: null })
const listArt = (items: GenItem[]): Artefact => art('json.genlist', { value: genlist(items) as never })

interface Fulfilled {
  itemId: string
  file: number
  demo: boolean
  source: string
  degraded?: string
}
const recordOf = (o: NodeOutputs): Fulfilled[] => (o.images?.value ?? []) as unknown as Fulfilled[]

async function expectStill(file: string, w = 1920, h = 1080): Promise<void> {
  const info = await probe(media, file, signal)
  const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
  expect(v).toMatchObject({ width: w, height: h })
  expect(['mjpeg']).toContain(v.codec_name)
}

const cacheJpgs = (dir: string): Map<string, number> => {
  const d = path.join(dir, 'cache', 'visuals')
  return new Map(readdirSync(d).filter((f) => f.endsWith('.jpg')).map((f) => [f, statSync(path.join(d, f)).mtimeMs]))
}

describe.skipIf(!hasFullFfmpeg)(`visuals.fulfil fake (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  const params = VisualsParams.parse({ parallel: 2 })
  const items = (prompt2 = 'une plage au matin'): GenItem[] => [item('a', 'image.gen', 'un phare sous la tempête'), item('b', 'image.gen', prompt2), item('c', 'image.gen', 'un marin au port')]

  it('draws one 1920x1080 JPEG per item, with a record mapping itemId to file index', { timeout: 120_000 }, async () => {
    const dir = work('fulfil')
    const out = await visualsFulfil.fake(makeCtx(testServices(dir)), { list: listArt(items()) }, params)
    const files = out.images?.files ?? []
    expect(files).toHaveLength(3)
    for (const f of files) {
      expect(f).toMatch(/\.jpg$/)
      await expectStill(f)
    }
    const rec = recordOf(out)
    expect(rec.map((r) => [r.itemId, r.file])).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect(rec.every((r) => r.demo === true && r.source === 'drawn')).toBe(true)
    expect(out.images?.meta).toMatchObject({ count: 3, demo: true, degraded: 0 })
  })

  it('caches each item: a second run draws nothing, a changed prompt redraws only that item', { timeout: 120_000 }, async () => {
    const dir = work('fulfil-cache')
    const services = testServices(dir)
    await visualsFulfil.fake(makeCtx(services), { list: listArt(items()) }, params)
    const first = cacheJpgs(dir)
    expect(first.size).toBe(3)
    await new Promise((r) => setTimeout(r, 30))
    await visualsFulfil.fake(makeCtx(services), { list: listArt(items()) }, params)
    expect(cacheJpgs(dir)).toEqual(first)

    await visualsFulfil.fake(makeCtx(services), { list: listArt(items('un tout autre décor')) }, params)
    const third = cacheJpgs(dir)
    expect(third.size).toBe(4)
    const added = [...third.keys()].filter((k) => !first.has(k))
    expect(added).toHaveLength(1)
    for (const [k, m] of first) expect(third.get(k)).toBe(m)
    // a new node seed is a regeneration: every item is drawn again
    await visualsFulfil.fake(makeCtx(services, { seed: 5 }), { list: listArt(items()) }, params)
    expect(cacheJpgs(dir).size).toBe(7)
  })
})

describe.skipIf(!hasFfmpeg)('visuals.fulfil through the local Atelier Cloud', () => {
  it('renders cloud images as 1920x1080 stills, lists degraded items, and caches per item', { timeout: 120_000 }, async () => {
    const dir = work('fulfil-cloud')
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1_000_000 })
    await t.app.listen({ host: '127.0.0.1', port: 0 })
    const baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`
    const cloud = cloudHttpService({ baseUrl, token: () => p.accessToken, pollMs: 10 })
    const services: EngineServices = testServices(dir, { cloud })
    const jobs = (): number => (t.cloud.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n
    const list = [item('a', 'image.gen', 'un phare sous la tempête'), item('b', 'stock.photo', 'lighthouse storm'), item('c', 'video.gen', 'vagues sur la falaise')]
    const params = VisualsParams.parse({ parallel: 2 })
    const out = await visualsFulfil.run(makeCtx(services, { where: 'local' }), { list: listArt(list) }, params)
    const files = out.images?.files ?? []
    expect(files).toHaveLength(3)
    for (const f of files) await expectStill(f)
    const rec = recordOf(out)
    expect(rec.every((r) => r.source === 'cloud' && r.demo === true)).toBe(true)
    // the stock photo is a stock search now (the demo Cloud answers with local media), and the video is a real clip now (it used
    // to be listed as an animated still): nothing is degraded
    expect(rec.filter((r) => r.degraded).map((r) => r.itemId)).toEqual([])
    expect(rec[0]?.degraded).toBeUndefined()
    expect(rec[2]).toMatchObject({ itemId: 'c', video: true })
    expect(out.clips?.files).toHaveLength(1)
    expect(out.clips?.value).toMatchObject([{ itemId: 'c', file: 0, demo: true }])
    expect(rec[1]).toMatchObject({ itemId: 'b', stock: { source: 'demo', licence: 'Démo, libre de droits' } })
    expect(out.images?.meta).toMatchObject({ count: 3, demo: true, degraded: 0 })
    expect(jobs()).toBe(3)
    // the stock search is free (decision 0105): only the generated image and the clip are captured
    expect(t.cloud.wallet.entries(p.teamId).entries.filter((e) => e.kind === 'capture')).toHaveLength(2)

    await visualsFulfil.run(makeCtx(services), { list: listArt(list) }, params)
    expect(jobs()).toBe(3)
  })
})

// ---- render.assemble ------------------------------------------------------------------------------------------------

const FRAMES = 180
function shot(id: string, a: number, b: number, o: Partial<Shot> = {}): Shot {
  return { id, track: 'base', startFrame: a, endFrame: b, kind: 'image.gen', role: 'scene', beat: 0, transitionIn: 'cut', genItem: `i-${id}`, ...o } as Shot
}
function makePlan(): EditPlan {
  const base: Shot[] = [
    shot('s1', 0, 45, { motion: { kind: 'push', from: 1, to: 1.12 } }),
    shot('s2', 45, 90, { motion: { kind: 'pull', from: 1.12, to: 1 }, transitionIn: 'dissolve' }),
    shot('s3', 90, 135, { motion: { kind: 'left', from: 1.08, to: 1.08 }, transitionIn: 'dip' }),
    shot('s4', 135, 180, { motion: { kind: 'right', from: 1.08, to: 1.08 }, transitionIn: 'cut' })
  ]
  const labels: Shot[] = [
    { id: 'l1', track: 'labels', startFrame: 10, endFrame: 70, kind: 'label', text: 'Phare de Créac’h', role: 'scene', beat: 0, transitionIn: 'cut' },
    { id: 'l2', track: 'labels', startFrame: 100, endFrame: 160, kind: 'label', text: '1863', role: 'scene', beat: 1, transitionIn: 'cut' }
  ]
  return {
    schema: EDITPLAN_SCHEMA,
    fps: 30,
    size: [1920, 1080],
    frames: FRAMES,
    tracks: { base: base.map((s) => s.id), overlay: [], labels: labels.map((s) => s.id) },
    captionsPreset: 'highlight',
    shots: [...base, ...labels],
    chapters: [],
    diagnostics: []
  }
}

/** Four distinct 1920x1080 pictures, and the images artefact that maps shot items to them. */
async function makePictures(dir: string, demo: boolean): Promise<{ files: string[]; images: Artefact }> {
  const files: string[] = []
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, `pic-${i}.jpg`)
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-vf', `hue=h=${i * 80}`, '-frames:v', '1', '-q:v', '3', f])
    files.push(f)
  }
  return { files, images: imagesArt(files, demo) }
}
const imagesArt = (files: string[], demo: boolean, skip: number[] = []): Artefact =>
  art('media.image[]', {
    files,
    value: files.map((_, i) => ({ itemId: `i-s${i + 1}`, file: i, demo })).filter((_, i) => !skip.includes(i)) as never,
    meta: { demo }
  })

async function sine(file: string, hz: number, seconds: number, volume: number): Promise<void> {
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`, '-af', `volume=${volume},pan=mono|c0=c0`, '-c:a', 'flac', file])
}

describe.skipIf(!hasFullFfmpeg)(`render.assemble on a hand-made plan (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('motion filters and segment arguments never put a comma inside an expression', () => {
    for (const kind of ['push', 'pull', 'left', 'right'] as const) {
      const f = motionFilter({ kind, from: 1, to: 1.2 }, 45, 10)
      expect(f.startsWith('perspective=')).toBe(true)
      expect(f).not.toContain(',')
    }
    expect(motionFilter(undefined, 30)).not.toContain(',')
    const plan = makePlan()
    const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)
    const specs = segmentSpecs(base, (s) => `C:\\tmp\\with, comma\\${s.id}.jpg`, 'film')
    for (const spec of specs) {
      const args = segmentArgs(spec, 'out.mp4')
      const graph = args[args.indexOf('-filter_complex') + 1] as string
      // the graph is a list of filters separated by , or ; — each piece must start like a filter (name=args)
      const pieces = graph.split(/[,;]/).map((x) => x.replace(/^(\[[^\]]+\])+/, '').replace(/(\[[^\]]+\])+$/, ''))
      for (const piece of pieces) expect(piece, `in ${graph}`).toMatch(/^[a-z_]+(=[^,;]*)?$/)
      expect(graph).not.toMatch(/with, comma/)
    }
  })

  it('verify throws verify_failed in French when the frame count differs', { timeout: 120_000 }, async () => {
    const dir = work('verify')
    const f = path.join(dir, 'two-seconds.mp4')
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f
    ])
    const ok = await verify(media, f, 60, signal)
    expect(ok.frames).toBe(60)
    const err = await verify(media, f, 180, signal).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err).toMatchObject({ code: 'verify_failed' })
    expect((err as Error).message).toMatch(/^Le rendu a échoué à la vérification/)
  })

  it('renders the film, masters the sound, caches segments and re-renders only what a new picture touches', { timeout: 240_000 }, async () => {
    const dir = work('render')
    const services = testServices(dir)
    const plan = makePlan()
    const { files, images } = await makePictures(dir, true)
    const voice = path.join(dir, 'voice.flac')
    await sine(voice, 220, 6, 0.4)
    const music = path.join(dir, 'music.flac')
    await sine(music, 330, 6, 0.05)
    const script = 'Un phare solitaire veille sur la baie. Chaque soir, la lumière revient doucement.'
    const tokens = parseScript(script).tokens
    const words = tokens.map((t, i) => ({ w: t.w, start: 0.2 + i * 0.4, end: 0.2 + i * 0.4 + 0.35, sentence: t.sentence, paragraph: t.paragraph }))
    const subsOut = await captionsMake.run(
      makeCtx(services),
      { words: art('json.words', { value: words as never }), script: art('text.script', { value: script }), plan: art('json.editplan', { value: plan as never }) },
      captionsMake.params.parse({})
    )
    const subs = art('subs.track', { files: subsOut.subs?.files ?? [] })
    expect(subs.files?.some((f) => f.endsWith('.ass'))).toBe(true)

    const params = RenderParams.parse({ preset: 'ultrafast', crf: 24, workers: 2 })
    const inputs = (extra: Record<string, Artefact> = {}): Record<string, Artefact> => ({
      plan: art('json.editplan', { value: plan as never }),
      images,
      voice: art('audio.voice', { files: [voice], meta: { demo: true } }),
      subs,
      ...extra
    })
    const first = await renderAssemble.run(makeCtx(services), inputs(), params)
    const file = first.video?.files?.[0] as string
    const meta = first.video?.meta as Record<string, unknown>
    expect(meta).toMatchObject({ segments: 4, segmentsCached: 0, watermark: true, demo: true, held: [], captionsBurned: true })

    const info = await probe(media, file, signal, true)
    const v = info.streams.find((s) => s.codec_type === 'video') as StreamInfo
    const audio = info.streams.filter((s) => s.codec_type === 'audio')
    expect(v).toMatchObject({ width: 1920, height: 1080, codec_name: 'h264', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' })
    expect(Math.abs(Number(v.nb_read_frames) - FRAMES)).toBeLessThanOrEqual(1)
    expect(Math.abs(Number(v.nb_frames) - FRAMES)).toBeLessThanOrEqual(1)
    expect(audio).toHaveLength(1)
    expect(audio[0]).toMatchObject({ codec_name: 'aac', sample_rate: '48000' })
    expect(Math.abs(Number(audio[0]?.duration) - Number(v.duration))).toBeLessThan(0.07)
    expect(Math.abs(info.durationS - 6)).toBeLessThan(0.1)
    const loud = await measureLoudness(media, file, signal)
    expect(Math.abs(loud.integrated - -14)).toBeLessThanOrEqual(1)
    expect(loud.truePeak).toBeLessThanOrEqual(-1 + 0.3)

    // with a music bed: same segments (all cached), still mastered to -14
    const withMusic = await renderAssemble.run(makeCtx(services), inputs({ music: art('audio.music', { files: [music], meta: { demo: true } }) }), params)
    expect(withMusic.video?.meta).toMatchObject({ segments: 4, segmentsCached: 4 })
    const loud2 = await measureLoudness(media, withMusic.video?.files?.[0] as string, signal)
    expect(Math.abs(loud2.integrated - -14)).toBeLessThanOrEqual(1)
    expect(loud2.truePeak).toBeLessThanOrEqual(-1 + 0.3)

    // same inputs again: everything from the cache
    const again = await renderAssemble.run(makeCtx(services), inputs(), params)
    expect(again.video?.meta).toMatchObject({ segmentsCached: 4 })

    // one picture replaced (shot 1): its segment and the dissolve that follows it (shot 2) re-render
    const specsOf = (fs: string[]): ReturnType<typeof segmentSpecs> => {
      const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)
      return segmentSpecs(base, (s) => fs[Number(s.id.slice(1)) - 1] as string, 'none')
    }
    const replaced = path.join(dir, 'pic-0-new.jpg')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-vf', 'hue=h=200', '-frames:v', '1', '-q:v', '3', replaced])
    const newFiles = [replaced, ...files.slice(1)]
    const before = await Promise.all(specsOf(files).map(segmentKey))
    const after = await Promise.all(specsOf(newFiles).map(segmentKey))
    const expectedCached = before.filter((k, i) => k === after[i]).length
    expect(expectedCached).toBe(2)
    const swapped = await renderAssemble.run(makeCtx(services), inputs({ images: imagesArt(newFiles, true) }), params)
    expect(swapped.video?.meta).toMatchObject({ segments: 4, segmentsCached: expectedCached })
  })

  it('a shot whose picture is missing holds its neighbour; no demo input means no watermark', { timeout: 240_000 }, async () => {
    const dir = work('render-held')
    const services = testServices(dir)
    const plan = makePlan()
    const { files } = await makePictures(dir, false)
    const voice = path.join(dir, 'voice.flac')
    await sine(voice, 220, 6, 0.4)
    const out = await renderAssemble.run(
      makeCtx(services),
      { plan: art('json.editplan', { value: plan as never }), images: imagesArt(files, false, [2]), voice: art('audio.voice', { files: [voice] }) },
      RenderParams.parse({ preset: 'ultrafast', crf: 24, workers: 2 })
    )
    const meta = out.video?.meta as Record<string, unknown>
    expect(meta.held).toEqual(['s3'])
    expect(meta).toMatchObject({ watermark: false, demo: false, captionsBurned: false, segments: 4 })
    const info = await probe(media, out.video?.files?.[0] as string, signal)
    expect(Math.abs(info.durationS - 6)).toBeLessThan(0.1)
    // the held shot (3) uses shot 2's picture: its segment equals what a plan with that picture would key
    const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)
    const held = segmentSpecs(base, (s) => (s.id === 's3' ? files[1] : files[Number(s.id.slice(1)) - 1]) as string, 'none')
    const cached = path.join(dir, 'cache', 'segments')
    for (const s of held) expect(readdirSync(cached)).toContain(`${await segmentKey(s)}.mp4`)
  })
})

// H1 (Windows, the full gyan.dev build) must run every media test above: a skip there would hide a regression. On another
// machine set ATELIER_REQUIRE_FULL_FFMPEG=1 to demand the same.
describe.runIf(process.platform === 'win32' || process.env.ATELIER_REQUIRE_FULL_FFMPEG === '1')('this machine runs every media test', () => {
  it('has an ffmpeg with every filter and encoder the engine needs', () => {
    expect(FFMPEG_PATH, 'ffmpeg/ffprobe not found on PATH').not.toBeNull()
    expect(FFMPEG_LACKS, `${FFMPEG_PATH} lacks`).toEqual([])
  })
})
