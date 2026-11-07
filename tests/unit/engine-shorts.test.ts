// Real vertical shorts: the picture's shape (16:9 or 9:16) is a property of the run, threaded through the director, the
// drawn stills, the background clips, the intro card, the captions, the render and the checks; and the shorts caption
// style (a few words at a time, the spoken one in the accent colour). Pure tests first, then real ffmpeg.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkEditPlan, EditPlan, GenList, type EditPlan as EditPlanT, type GenItem } from '../../src/engine/formats/editplan'
import { Outline } from '../../src/engine/formats/outline'
import { ASPECTS, aspectOfSize, FRAME_SIZE, frameSizeOf, toFrame, type Beat, type Word } from '../../src/engine/formats/timing'
import { probe, type StreamInfo } from '../../src/engine/media/probe'
import { BackgroundParams, backgroundClips, pieceArgs } from '../../src/engine/nodes/background-clips'
import { BeatsParams, splitBeats } from '../../src/engine/nodes/beats-split'
import { captionsMake } from '../../src/engine/nodes/captions-make'
import { CardParams, cardHeight, cardIntro } from '../../src/engine/nodes/card-intro'
import { DirectorParams, buildPlan } from '../../src/engine/nodes/director-cuts'
import { packageYoutube, PackageParams } from '../../src/engine/nodes/package-youtube'
import { QcParams, qcCheck, type QcReport } from '../../src/engine/nodes/qc-check'
import { renderAssemble, RenderParams } from '../../src/engine/nodes/render-assemble'
import { visualsFulfil, VisualsParams } from '../../src/engine/nodes/visuals-fulfil'
import { productionRegistry } from '../../src/engine/nodes'
import { PipelineSchema } from '../../src/engine/pipeline-schema'
import { simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import { cardGraph, cardY, verify } from '../../src/engine/render/final'
import { segmentArgs, segmentKey, segmentSpecs } from '../../src/engine/render/segments'
import {
  buildAss,
  captionSize,
  cueOptionsFor,
  CAPTION_PRESETS,
  makeCues,
  type AssOptions,
  type Cue
} from '../../src/engine/text/captions'
import { anchorOf, parseScript } from '../../src/engine/text/script'
import { validatePipeline } from '../../src/engine/validate'
import { art, hasFullFfmpeg, MEDIA, makeCtx, NO_FULL_FFMPEG, tempDir, testServices } from './engine-node-helpers'

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
const ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']

// ---- a small film (a script with word times, its beats) ------------------------------------------------------------------

interface Film {
  script: string
  words: Word[]
  durationS: number
  outline: Outline
  beats: Beat[]
}

function makeFilm(sentences = 8): Film {
  const script = Array.from({ length: sentences }, (_, i) => `Au matin ${i + 1}, Brest voyait partir ${100 + i} hommes vers Lyon, sans un bruit.`).join(' ')
  const parsed = parseScript(script)
  let t = 0.4
  const words: Word[] = parsed.tokens.map((tok) => {
    const start = t
    t += 0.33
    return { w: tok.w, start: Math.round(start * 1000) / 1000, end: Math.round(t * 1000) / 1000, sentence: tok.sentence, paragraph: tok.paragraph }
  })
  const durationS = Math.ceil(((words.at(-1) as Word).end + 0.4) * 30) / 30
  const outline = Outline.parse({
    language: 'fr',
    title: 'La marche des hommes',
    shape: 'chronicle',
    kind: 'story',
    promise: 'Comprendre pourquoi ils partirent.',
    hook: 'Au matin, ils partent.',
    beats: [{ index: 0, purpose: 'hook', summary: 'départ', wordBudget: 100, tags: ['hook'], anchor: anchorOf(parsed.sentences[0]?.text ?? '') }],
    chapters: []
  })
  return { script, words, durationS, outline, beats: splitBeats(script, words, outline, durationS, BeatsParams.parse({})) }
}
const FILM = makeFilm()

function planFor(aspect: '16:9' | '9:16', over: Record<string, unknown> = {}): { plan: EditPlanT; list: GenList } {
  return buildPlan({
    beats: FILM.beats,
    words: FILM.words,
    durationS: FILM.durationS,
    title: FILM.outline.title,
    script: FILM.script,
    drafts: new Map(),
    p: DirectorParams.parse({ aspect, ...over }),
    seed: 3,
    diagnostics: []
  })
}

// ---- the frame ----------------------------------------------------------------------------------------------------------

describe('the frame is a property of the run', () => {
  it('has two shapes: 1920×1080 (default) and 1080×1920', () => {
    expect(ASPECTS).toEqual(['16:9', '9:16'])
    expect(frameSizeOf('16:9')).toEqual([1920, 1080])
    expect(frameSizeOf('9:16')).toEqual([1080, 1920])
    expect([...FRAME_SIZE]).toEqual([1920, 1080])
    expect(aspectOfSize([1080, 1920])).toBe('9:16')
    expect(aspectOfSize([1920, 1080])).toBe('16:9')
    expect(aspectOfSize([1280, 720])).toBeNull()
  })

  it('the edit plan holds either size and nothing else', () => {
    const { plan } = planFor('16:9')
    expect(EditPlan.safeParse(plan).success).toBe(true)
    expect(EditPlan.safeParse({ ...plan, size: [1080, 1920] }).success).toBe(true)
    for (const size of [[1280, 720], [1080, 1080], [1920, 1920]]) expect(EditPlan.safeParse({ ...plan, size }).success).toBe(false)
  })

  it('the director sizes the plan and asks its items for the same shape; 16:9 stays what it was', () => {
    const long = planFor('16:9')
    expect(long.plan.size).toEqual([1920, 1080])
    expect(long.list.items.every((i) => i.constraints.aspect === '16:9')).toBe(true)
    expect(long.list.items.every((i) => !/vertical/.test(i.prompt ?? ''))).toBe(true)
    expect(DirectorParams.parse({}).aspect).toBe('16:9')
    const short = planFor('9:16')
    expect(short.plan.size).toEqual([1080, 1920])
    expect(short.list.items.length).toBeGreaterThan(0)
    expect(short.list.items.every((i) => i.constraints.aspect === '9:16')).toBe(true)
    expect(short.list.items.filter((i) => i.prompt).every((i) => /vertical 9:16/.test(i.prompt ?? ''))).toBe(true)
    expect(GenList.safeParse(short.list).success && EditPlan.safeParse(short.plan).success).toBe(true)
    expect(checkEditPlan(short.plan, short.list, toFrame(FILM.durationS))).toEqual([])
    // only the shape differs: the same cuts
    expect(short.plan.shots.map((s) => [s.startFrame, s.endFrame])).toEqual(long.plan.shots.map((s) => [s.startFrame, s.endFrame]))
  })

  it('the checker refuses a list that asks for another shape than the plan', () => {
    const short = planFor('9:16')
    const wrong = { ...short.list, items: short.list.items.map((i): GenItem => ({ ...i, constraints: { ...i.constraints, aspect: '16:9' } })) }
    const problems = checkEditPlan(short.plan, wrong, toFrame(FILM.durationS))
    expect(problems.some((p) => /asks for 16:9, the plan is 9:16/.test(p))).toBe(true)
  })
})

describe('segments and the final pass take the frame from the plan', () => {
  const shots = planFor('9:16').plan.shots.filter((s) => s.track === 'base')

  it('cover-crops every picture to the plan’s size; the default is 1920×1080 exactly as before', () => {
    const portrait = segmentSpecs(shots, () => 'pic.jpg', 'none', [1080, 1920])
    const landscape = segmentSpecs(shots, () => 'pic.jpg', 'none')
    const graph = (s: (typeof portrait)[number]): string => segmentArgs(s, 'out.mp4')[segmentArgs(s, 'out.mp4').indexOf('-filter_complex') + 1] as string
    expect(graph(portrait[0] as (typeof portrait)[number])).toContain('scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920')
    expect(graph(landscape[0] as (typeof landscape)[number])).toContain('scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080')
    expect(landscape[0]).not.toHaveProperty('size')
  })

  it('the segment cache key follows the size (a picture is never reused across shapes)', async () => {
    const dir = work('seg-key')
    const pic = path.join(dir, 'pic.jpg')
    writeFileSync(pic, 'not really a picture: only its bytes are hashed')
    const k = (size?: readonly [number, number]) => segmentKey(segmentSpecs(shots, () => pic, 'none', size)[0] as ReturnType<typeof segmentSpecs>[number])
    expect(await k()).toBe(await k([1920, 1080]))
    expect(await k([1080, 1920])).not.toBe(await k())
  })

  it('the intro card is centred in landscape and sits in the upper third of a portrait frame, never above 180 px', () => {
    expect(cardY([1920, 1080], 400)).toBe('(H-h)/2')
    expect(cardY([1920, 1080], undefined)).toBe('(H-h)/2')
    // 27 % of 1920 = 518, minus half a 400 px card = 318
    expect(cardY([1080, 1920], 400)).toBe('318')
    expect(cardY([1080, 1920], 1000)).toBe('180')
    expect(cardGraph({ startS: 0, endS: 3 }, 2)).toContain('overlay=x=(W-w)/2:y=(H-h)/2:')
    expect(cardGraph({ startS: 0, endS: 3, height: 400 }, 2, [1080, 1920])).toContain('overlay=x=(W-w)/2:y=318:')
  })

  it('background pieces are cut to the shape asked: 1080×1920 for a short', () => {
    const vf = (a: string[]): string => a[a.indexOf('-vf') + 1] as string
    const piece = { file: 'c.mp4', startS: 0, frames: 30 }
    expect(vf(pieceArgs(piece, 'o.mp4', '9:16'))).toContain('scale=1080:1920:force_original_aspect_ratio=increase')
    expect(vf(pieceArgs(piece, 'o.mp4', '9:16'))).toContain('crop=1080:1920')
    expect(vf(pieceArgs(piece, 'o.mp4'))).toContain('crop=1920:1080')
    expect(BackgroundParams.parse({}).aspect).toBe('16:9')
    expect(CardParams.parse({}).aspect).toBe('16:9')
  })
})

// ---- the pipeline document ----------------------------------------------------------------------------------------------

describe('the pipeline format carries the aspect', () => {
  const registry = productionRegistry()
  const styleFields = ['language', 'voice', 'pace', 'captions', 'burn']
  const withFormat = (format: Record<string, unknown>, tweak?: (d: ReturnType<typeof simpleVideoPipeline>) => void) => {
    const d = simpleVideoPipeline(1)
    tweak?.(d)
    return { ...d, format: { ...d.format, ...format } }
  }

  it('is 16:9 when the document does not say', () => {
    const d = simpleVideoPipeline(1) as unknown as { format: Record<string, unknown> }
    const { aspect: _gone, ...bare } = d.format
    expect(PipelineSchema.parse({ ...d, format: bare }).format.aspect).toBe('16:9')
    expect(validatePipeline({ ...d, format: bare }, registry, { styleFields }).ok).toBe(true)
  })

  it('accepts 9:16 and a youtube_short, refuses other shapes and a short that is not vertical', () => {
    const ok = (f: Record<string, unknown>) => PipelineSchema.safeParse(withFormat(f)).success
    expect(ok({ aspect: '9:16' })).toBe(true)
    expect(ok({ kind: 'youtube_short', aspect: '9:16' })).toBe(true)
    expect(ok({ kind: 'youtube_short', aspect: '16:9' })).toBe(false)
    expect(ok({ aspect: '4:3' })).toBe(false)
  })

  it('a vertical pipeline needs its drawing nodes to draw vertical: a director left at 16:9 is reported, a matching one passes', () => {
    const bad = withFormat({ aspect: '9:16' })
    const v = validatePipeline(bad, registry, { styleFields })
    // (the template's director carries no `aspect`: it would draw 16:9 for a 9:16 film)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.errors.map((e) => [e.code, e.path.join('.')])).toContainEqual(['bad_params', 'nodes.4.params.aspect'])
    const good = withFormat({ aspect: '9:16' }, (d) => {
      const director = d.nodes.find((n) => n.id === 'director') as { params: Record<string, unknown> }
      director.params = { ...director.params, aspect: '9:16' }
    })
    expect(validatePipeline(good, registry, { styleFields }).ok).toBe(true)
    // and a 16:9 pipeline whose node says 9:16 is as wrong
    const other = withFormat({}, (d) => {
      const director = d.nodes.find((n) => n.id === 'director') as { params: Record<string, unknown> }
      director.params = { ...director.params, aspect: '9:16' }
    })
    expect(validatePipeline(other, registry, { styleFields }).ok).toBe(false)
  })
})

// ---- the shorts caption style -------------------------------------------------------------------------------------------

describe('captions: the shorts style', () => {
  const PORTRAIT = [1080, 1920] as const
  const options = (over: Partial<AssOptions> = {}): AssOptions => ({ preset: 'shorts', maxChars: 42, lines: 1, position: 'bottom', leadMs: 50, accent: '#FFD84D', burn: true, size: PORTRAIT, ...over })
  const cuesOf = (o: AssOptions): Cue[] => makeCues(FILM.words, { shots: [] } as unknown as EditPlanT, o)
  const parse = (ass: string) => {
    const styles: Record<string, string[]> = {}
    const dialogues: { start: string; end: string; style: string; text: string }[] = []
    const info: Record<string, string> = {}
    for (const line of ass.split('\n')) {
      if (line.startsWith('Style: ')) {
        const f = line.slice(7).split(',')
        styles[f[0] ?? ''] = f
      } else if (line.startsWith('Dialogue: ')) {
        const f = line.slice(10).split(',')
        dialogues.push({ start: f[1] ?? '', end: f[2] ?? '', style: f[3] ?? '', text: f.slice(9).join(',') })
      } else if (/^Play(Res[XY]): /.test(line)) info[line.split(': ')[0] as string] = line.split(': ')[1] as string
    }
    return { styles, dialogues, info }
  }

  it('is one of the presets, and cuts 1 to 3 words at a time', () => {
    expect(CAPTION_PRESETS).toContain('shorts')
    expect(cueOptionsFor({ preset: 'shorts', maxChars: 42, lines: 2 })).toMatchObject({ lines: 1, maxWords: 3 })
    const cues = cuesOf(options())
    expect(cues.length).toBeGreaterThan(FILM.words.length / 3 - 1)
    for (const c of cues) {
      expect(c.lines).toHaveLength(1)
      expect(c.lines[0]?.length).toBeGreaterThanOrEqual(1)
      expect(c.lines[0]?.length).toBeLessThanOrEqual(3)
    }
  })

  it('lays out in the 1080×1920 frame: centred, bold, big, outlined, above the bottom UI zone', () => {
    const ass = parse(buildAss(cuesOf(options()), [{ text: 'Brest, 1914', start: 1, end: 3 }], options()))
    expect(ass.info).toMatchObject({ PlayResX: '1080', PlayResY: '1920' })
    const cap = ass.styles.Cap as string[]
    // Fontname, Fontsize, Bold, BorderStyle, Outline, Alignment, MarginL, MarginV
    expect(cap[1]).toBe('Inter')
    expect(Number(cap[2])).toBeGreaterThanOrEqual(100)
    expect(cap[7]).toBe('-1')
    expect(cap[15]).toBe('1')
    expect(Number(cap[16])).toBeGreaterThanOrEqual(8)
    expect(cap[18]).toBe('2') // bottom centre
    expect(Number(cap[19])).toBeLessThanOrEqual(80)
    // the baseline is 25 % of the height from the bottom: the text stays out of the phone's bottom zone
    expect(Number(cap[21])).toBe(480)
    // the label is below the top bar
    expect(Number((ass.styles.Label as string[])[21])).toBeGreaterThanOrEqual(150)
  })

  it('highlights the spoken word, one window per word, in upper case, sized to fit between the margins', () => {
    const o = options()
    const cues = cuesOf(o)
    const ass = parse(buildAss(cues, [], o))
    const total = cues.reduce((n, c) => n + c.lines[0]!.length, 0)
    expect(ass.dialogues).toHaveLength(total)
    for (const d of ass.dialogues) {
      expect(d.style).toBe('Cap')
      // exactly one word in the accent colour (the others are white), in upper case
      const accent = d.text.match(/\{\\1c&H4DD8FF&\}([^{ ]+)/g) ?? []
      expect(accent).toHaveLength(1)
      const spoken = d.text.replace(/\{[^}]*\}/g, '')
      expect(spoken).toBe(spoken.toUpperCase())
      // the size override is never wider than 960 px for the line (60 px side margins, ≈ 0.7 em per upper-case glyph)
      const size = Number(/\\fs(\d+)/.exec(d.text)?.[1])
      expect(size).toBeGreaterThanOrEqual(30)
      expect(size).toBeLessThanOrEqual(captionSize('shorts', 42, PORTRAIT))
      expect(size * 0.7 * spoken.length).toBeLessThanOrEqual(960 + size) // within one glyph of the safe width
    }
    // the colour follows the voice: in a cue of three words the accent is on word 1, then 2, then 3
    const firstCue = cues.find((c) => c.lines[0]!.length === 3)
    expect(firstCue).toBeDefined()
    const at = cues.slice(0, cues.indexOf(firstCue as Cue)).reduce((n, c) => n + c.lines[0]!.length, 0)
    const words = ass.dialogues.slice(at, at + 3).map((d) => /\{\\1c&H4DD8FF&\}([^{ ]+)/.exec(d.text)?.[1])
    expect(words).toEqual((firstCue as Cue).lines[0]!.map((w) => w.text.toUpperCase()))
  })

  it('shrinks a line of long words to fit, and honours the accent and the position', () => {
    const long: Cue = { start: 0, end: 2, lines: [[{ text: 'extraordinairement', start: 0, end: 0.5 }, { text: 'invraisemblable', start: 0.5, end: 1 }]] }
    const ass = parse(buildAss([long], [], options({ accent: '#00FF00', position: 'top' })))
    const size = Number(/\\fs(\d+)/.exec(ass.dialogues[0]?.text ?? '')?.[1])
    expect(size).toBeLessThan(captionSize('shorts', 42, PORTRAIT))
    expect(size * 0.7 * 'EXTRAORDINAIREMENT INVRAISEMBLABLE'.length).toBeLessThanOrEqual(960 + size)
    expect(ass.dialogues[0]?.text).toContain('&H00FF00&')
    expect((ass.styles.Cap as string[])[18]).toBe('8')
    // top: 10 % of the height, below the phone's top bar
    expect((ass.styles.Cap as string[])[21]).toBe('192')
  })

  it('the SRT is unaffected by the style (the same cues, plain text)', () => {
    // the package's captions file: no styling, original case
    const text = cuesOf(options()).map((c) => c.lines[0]!.map((w) => w.text).join(' ')).join(' ')
    expect(text).toBe(FILM.words.map((w) => w.w).join(' '))
  })

  it('long-form presets keep their landscape layout and the PlayRes of 1920×1080 when no size is given', () => {
    const o: AssOptions = { ...options({ preset: 'highlight' }), size: undefined }
    const ass = parse(buildAss(cuesOf(o), [], o))
    expect(ass.info).toMatchObject({ PlayResX: '1920', PlayResY: '1080' })
    expect((ass.styles.Cap as string[])[21]).toBe('90')
    expect(captionSize('highlight', 42)).toBe(captionSize('highlight', 42, [1920, 1080]))
  })
})

// ---- real ffmpeg --------------------------------------------------------------------------------------------------------

const probeStream = async (file: string): Promise<StreamInfo> => {
  const shown = await media.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file], { signal })
  return (JSON.parse(shown.stdout.toString('utf8')) as { streams: StreamInfo[] }).streams[0] as StreamInfo
}

describe.skipIf(!hasFullFfmpeg)(`vertical pictures with real ffmpeg (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, () => {
  it('visuals.fulfil draws 1080×1920 stills for a 9:16 list and 1920×1080 for a 16:9 one', { timeout: 120_000 }, async () => {
    const dir = work('visuals')
    const listOf = (aspect: '16:9' | '9:16') => {
      const items = planFor(aspect).list.items.slice(0, 2)
      return art('json.genlist', { value: { items, totals: { credits: 0, items: items.length, byKind: {} }, budget: null } as never })
    }
    const params = VisualsParams.parse({ parallel: 2 })
    const tall = await visualsFulfil.fake(makeCtx(testServices(dir)), { list: listOf('9:16') }, params)
    for (const f of tall.images?.files ?? []) expect(await probeStream(f)).toMatchObject({ width: 1080, height: 1920 })
    const wide = await visualsFulfil.fake(makeCtx(testServices(dir)), { list: listOf('16:9') }, params)
    for (const f of wide.images?.files ?? []) expect(await probeStream(f)).toMatchObject({ width: 1920, height: 1080 })
    expect((tall.images?.files ?? []).length).toBe(2)
  })

  it('card.intro draws a card that fits a phone: 960 px wide, its height from its lines', { timeout: 60_000 }, async () => {
    const dir = work('card')
    const run = (aspect: '16:9' | '9:16') =>
      cardIntro.run(makeCtx(testServices(dir)), { outline: art('json.outline', { value: FILM.outline as never }) }, CardParams.parse({ channel: 'Histoires Vraies', title: 'Mon voisin m’a demandé de garder une clé pour le week-end', aspect }))
    const tall = await run('9:16')
    const stream = await probeStream(tall.card?.files?.[0] as string)
    expect(stream).toMatchObject({ width: 960, pix_fmt: 'rgba' })
    expect(tall.card?.meta).toMatchObject({ width: 960, height: stream.height })
    // 59 characters wrap on 24-character lines: 3 lines
    expect(stream.height).toBe(cardHeight(3, '9:16'))
    expect(Number(stream.width)).toBeLessThanOrEqual(1080 - 60)
    const wide = await run('16:9')
    expect(await probeStream(wide.card?.files?.[0] as string)).toMatchObject({ width: 1440 })
  })

  it('background.clips cover-crops landscape clips to a 1080×1920 layer', { timeout: 120_000 }, async () => {
    const dir = work('bg')
    const folder = path.join(dir, 'gameplay')
    mkdirSync(folder, { recursive: true })
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', ...ENC, '-an', path.join(folder, 'a.mp4')])
    const out = await backgroundClips.run(makeCtx(testServices(dir)), { voice: art('audio.voice', { files: ['voice.wav'], meta: { durationS: 3 } }) }, BackgroundParams.parse({ folder, aspect: '9:16', minPieceS: 1, maxPieceS: 2 }))
    expect(await probeStream(out.layer?.files?.[0] as string)).toMatchObject({ width: 1080, height: 1920, r_frame_rate: '30/1' })
    expect(out.layer?.meta).toMatchObject({ width: 1080, height: 1920 })
  })

  /** A portrait plan of 90 frames (3 s): two base shots, and a voice of that length. */
  async function portraitFilm(dir: string, size: readonly [number, number]) {
    const base = [
      { id: 's1', track: 'base', startFrame: 0, endFrame: 45, kind: 'image.gen', role: 'scene', beat: 0, transitionIn: 'cut', genItem: 'i-s1', motion: { kind: 'push', from: 1, to: 1.1 } },
      { id: 's2', track: 'base', startFrame: 45, endFrame: 90, kind: 'image.gen', role: 'scene', beat: 0, transitionIn: 'cut', genItem: 'i-s2' }
    ]
    const plan = { schema: 'atelier.editplan/1', fps: 30, size: [...size], frames: 90, tracks: { base: ['s1', 's2'], overlay: [], labels: [] }, captionsPreset: 'shorts', shots: base, chapters: [], diagnostics: [] } as unknown as EditPlanT
    const pics: string[] = []
    for (const i of [0, 1]) {
      const f = path.join(dir, `pic-${i}.jpg`)
      await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=${size[0]}x${size[1]}:d=1`, '-vf', `hue=h=${i * 90}`, '-frames:v', '1', '-q:v', '3', f])
      pics.push(f)
    }
    const voice = path.join(dir, 'voice.flac')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-af', 'volume=0.4,pan=mono|c0=c0', '-c:a', 'flac', voice])
    const images = art('media.image[]', { files: pics, value: pics.map((_, i) => ({ itemId: `i-s${i + 1}`, file: i, demo: true })) as never, meta: { demo: true } })
    return { plan, images, voice }
  }

  it('render.assemble makes a 1080×1920 film from a 9:16 plan, verifies it at that size, and says so; qc.check expects the plan’s size', { timeout: 240_000 }, async () => {
    const dir = work('render')
    const services = testServices(dir)
    const { plan, images, voice } = await portraitFilm(dir, [1080, 1920])
    const script = 'Un phare solitaire veille sur la baie. Chaque soir, la lumière revient.'
    const words = parseScript(script).tokens.map((t, i) => ({ w: t.w, start: 0.2 + i * 0.3, end: 0.2 + i * 0.3 + 0.25, sentence: t.sentence, paragraph: t.paragraph }))
    const subsOut = await captionsMake.run(
      makeCtx(services),
      { words: art('json.words', { value: words as never }), script: art('text.script', { value: script }), plan: art('json.editplan', { value: plan as never }) },
      captionsMake.params.parse({ preset: 'shorts' })
    )
    const ass = subsOut.subs?.files?.find((f) => f.endsWith('.ass')) as string
    expect(ass).toBeDefined()
    const card = await cardIntro.run(makeCtx(services), { outline: art('json.outline', { value: FILM.outline as never }) }, CardParams.parse({ aspect: '9:16', seconds: 1.5 }))
    const out = await renderAssemble.run(
      makeCtx(services),
      {
        plan: art('json.editplan', { value: plan as never }),
        images,
        voice: art('audio.voice', { files: [voice], meta: { demo: true } }),
        subs: art('subs.track', { files: subsOut.subs?.files ?? [] }),
        graphics: art('media.graphic[]', { files: card.card?.files ?? [], meta: card.card?.meta as never })
      },
      RenderParams.parse({ preset: 'ultrafast', crf: 24, workers: 2 })
    )
    const film = out.video?.files?.[0] as string
    expect(out.video?.meta).toMatchObject({ width: 1080, height: 1920, aspect: '9:16', segments: 2, captionsBurned: true, introCardS: 1.5 })
    const info = await probe(media, film, signal, true)
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920, codec_name: 'h264', r_frame_rate: '30/1' })
    // the final pass's own check is at the plan's size: a 16:9 expectation of the same film fails
    expect((await verify(media, film, 90, signal, [1080, 1920])).frames).toBe(90)
    await expect(verify(media, film, 90, signal)).rejects.toMatchObject({ code: 'verify_failed' })

    // qc.check: the plan says 1080×1920 → format ok; a 16:9 plan on the same film → format fails
    const qc = async (p: EditPlanT) =>
      ((await qcCheck.run(makeCtx(services), { video: art('video.final', { files: [film] }), plan: art('json.editplan', { value: p as never }) }, QcParams.parse({}))).report?.value as unknown as QcReport).checks.find((c) => c.id === 'format')
    expect(await qc(plan)).toMatchObject({ status: 'ok', data: { width: 1080, height: 1920 } })
    const wrong = await qc({ ...plan, size: [1920, 1080] })
    expect(wrong?.status).toBe('fail')
    expect(wrong?.detail).toMatch(/1080×1920.*1920×1080 attendu/)
    // without a plan either of our two shapes is fine, another one is not
    const bare = (await qcCheck.run(makeCtx(services), { video: art('video.final', { files: [film] }) }, QcParams.parse({}))).report?.value as unknown as QcReport
    expect(bare.checks.find((c) => c.id === 'format')?.status).toBe('ok')
  })

  it('render.assemble refuses a background made for another shape, in French', { timeout: 120_000 }, async () => {
    const dir = work('render-bg')
    const { plan, voice } = await portraitFilm(dir, [1080, 1920])
    const bg = path.join(dir, 'bg.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=3', ...ENC, '-an', bg])
    await expect(
      renderAssemble.run(
        makeCtx(testServices(dir)),
        { plan: art('json.editplan', { value: plan as never }), background: art('media.clip[]', { files: [bg], meta: { width: 1920, height: 1080 } }), voice: art('audio.voice', { files: [voice] }) },
        RenderParams.parse({ preset: 'ultrafast' })
      )
    ).rejects.toThrow(/Le fond vidéo est en 1920×1080, le plan en 1080×1920/)
  })
})

// ---- the package --------------------------------------------------------------------------------------------------------

describe('package.youtube says when the film is a short', () => {
  it('a 9:16 plan gives a Short: no chapters, a shorts tag, a checklist line and a format in the metadata; 16:9 is untouched', async () => {
    const dir = work('package')
    const video = path.join(dir, 'film.mp4')
    writeFileSync(video, 'film')
    const srt = path.join(dir, 'captions.srt')
    writeFileSync(srt, '')
    const run = async (aspect: '16:9' | '9:16') => {
      const { plan } = planFor(aspect)
      const inputs = {
        video: art('video.final', { files: [video] }),
        script: art('text.script', { value: FILM.script }),
        outline: art('json.outline', { value: FILM.outline as never }),
        words: art('json.words', { value: FILM.words as never }),
        subs: art('subs.track', { files: [srt] }),
        plan: art('json.editplan', { value: plan as never })
      }
      const ctx = makeCtx(testServices(dir), { node: packageYoutube, minutes: 1 })
      return packageYoutube.fake(ctx, inputs, PackageParams.parse({}))
    }
    const short = await run('9:16')
    const meta = short.metadata?.value as unknown as { format?: string; aspect?: string; chapters: unknown[]; tags: string[] }
    expect(meta).toMatchObject({ format: 'short', aspect: '9:16', chapters: [] })
    expect(meta.tags).toContain('shorts')
    expect(short.metadata?.meta).toMatchObject({ short: true })
    const checklist = (short.package?.files ?? []).find((f) => f.endsWith('checklist.md')) as string
    expect((await import('node:fs')).readFileSync(checklist, 'utf8')).toMatch(/9:16 \(Short\)/)
    const long = await run('16:9')
    const longMeta = long.metadata?.value as unknown as Record<string, unknown>
    expect(longMeta).not.toHaveProperty('format')
    expect(longMeta).not.toHaveProperty('aspect')
    expect(long.metadata?.meta).not.toHaveProperty('short')
  })
})
