// `thumbnail.make@1` v0 (docs/ENGINE-SPEC.md §29): from the working title, the outline (promise, hook, chapters) and the
// channel's thumbnail style, N concepts (a short headline, an art prompt, where the headline goes), the art through the
// Cloud's `generateImage` at 1280×720, the headline laid out by us (media/headline.ts: the image models draw NO text), and N
// PNGs out. run: Claude writes the concepts, the Cloud draws the art (one paid item per concept, its own idempotency key and
// cache entry). fake: template concepts and drawn gradient backgrounds, the headline laid out for real, a DÉMO watermark.
// The art goes through the image engines like the stills (production-17): the brick's pin (`engine`, `fallbacks`), else the
// default image engine and its fallbacks (src/shared/cloud-engines.ts), never the Cloud's anonymous default provider (the
// first real run's thumbnails were drawn by its demo and charged).
// Gate: owner (the owner picks): the FIRST thumbnail is the chosen one, and the pick replaces this output with the picked
// one first (`replaceOutput`), so `package.youtube` writes it as `thumbnail.png`. A failed concept is skipped; no thumbnail
// at all is an error. Deliberately no `claudeRole`: the node pays for images, and a Claude node is quoted as free.
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { isAbortError, EngineError } from '../errors'
import { Outline } from '../formats/outline'
import { composeThumbnail, HEADLINE_LAYOUTS, THUMB_H, THUMB_W, type HeadlinePosition } from '../media/headline'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { DEFAULT_ENGINES } from '../../shared/cloud-engines'
import { normWord, STOP_WORDS } from '../text/script'
import type { Json } from '../types'
import { askJson, atomicCopy, atomicWrite, hashOf, languageLine, progress, readText, readValue, scratch, throwIfAborted } from './common'
import { firstThatWorks, ImageEngineId } from './visuals-engines'

export const ThumbnailParams = z.object({
  /** How many thumbnails (1–4). */
  count: z.number().int().min(1).max(4).default(3),
  language: z.string().min(2).default('fr'),
  layout: z.enum(HEADLINE_LAYOUTS).default('scrim'),
  /** The channel's thumbnail style in a sentence or two: palette, mood, kind of subject. */
  style: z.string().max(600).default(''),
  /** The style shows a face (an expressive one); otherwise the art is a scene or an object. */
  withFace: z.boolean().default(false),
  /** The image engine of the brick's pin and its fallbacks, tried in order; unset: DEFAULT_ENGINES.image. */
  engine: ImageEngineId.optional(),
  fallbacks: z.array(ImageEngineId).max(4).optional()
})
type Params = z.infer<typeof ThumbnailParams>

const Concept = z.object({
  headline: z.string().max(80).default(''),
  position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
  prompt: z.string().min(10).max(900)
})
type Concept = z.infer<typeof Concept>
const Concepts = z.object({ concepts: z.array(Concept).min(1).max(6) })

/** One thumbnail as the output's value records it (file = index in the output's files). */
export interface ThumbnailRecord {
  file: number
  headline: string
  position: HeadlinePosition
  prompt: string
  demo: boolean
}

const NO_TEXT = 'No text, no letters, no logos, no watermark anywhere in the picture.'

/** 2–4 words in capitals, no quotes or brackets, at most 28 characters. */
export function cleanHeadline(raw: string): string {
  const words = raw
    .replace(/["“”«»<>()[\]{}#*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .split(' ')
    .filter(Boolean)
  let out = ''
  for (const w of words.slice(0, 4)) {
    if (`${out} ${w}`.trim().length > 28) break
    out = `${out} ${w}`.trim()
  }
  return out
}

/** A headline of our own when the model gave none (or repeated the title): the first content words of the hook, the promise or the title. */
export function derivedHeadline(outline: Outline, taken: readonly string[] = []): string {
  for (const source of [outline.hook, outline.promise, outline.title]) {
    const words = source
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(normWord(w)))
    for (const n of [3, 2, 1]) {
      const h = cleanHeadline(words.slice(0, n).join(' '))
      if (h && !taken.includes(h) && normWord(h) !== normWord(outline.title)) return h
    }
  }
  return cleanHeadline(outline.title.split(/\s+/).slice(0, 3).join(' ')) || 'À VOIR'
}

/** Concept checks (§29 step 6, the deterministic ones): a headline of 2–4 capital words that is not the title and not another concept's. */
export function checkConcepts(concepts: readonly Concept[], outline: Outline): Concept[] {
  const taken: string[] = []
  return concepts.map((c) => {
    let headline = cleanHeadline(c.headline)
    if (!headline || normWord(headline) === normWord(outline.title) || taken.includes(headline)) headline = derivedHeadline(outline, taken)
    taken.push(headline)
    return { ...c, headline }
  })
}

function templateConcepts(outline: Outline, p: Params): Concept[] {
  const angles = [
    { source: outline.title, position: 'bottom' as const, mood: 'dramatic low light' },
    { source: outline.promise, position: 'top' as const, mood: 'bright, high contrast' },
    { source: outline.hook, position: 'middle' as const, mood: 'tense, shadowed' },
    { source: outline.chapters[0]?.title ?? outline.title, position: 'bottom' as const, mood: 'warm and curious' }
  ]
  return angles.slice(0, p.count).map((a) => ({ headline: '', position: a.position, prompt: `${a.source}. ${a.mood}, one clear subject.` }))
}

async function claudeConcepts(ctx: RunCtx, outline: Outline, script: string, p: Params): Promise<Concept[]> {
  const system = [
    'You design YouTube thumbnails for a narrated video. You write CONCEPTS: a headline and an art prompt each.',
    'headline: 2–4 short words in the video language, in capitals, that sell the promise or the threat. It does not restate or summarise the title, and never exceeds 28 characters.',
    'prompt: English, for an image model. ONE subject readable at 320 px wide, staged for THIS video (never generic to the channel), a quiet third left calm where the headline will go, explicit light, palette and mood. ' +
      NO_TEXT,
    'position: where the headline goes: top, middle or bottom, on the side of the quiet third.',
    'The concepts differ from each other in subject and angle.',
    'Answer with ONE JSON object {"concepts":[{"headline":"…","position":"top|middle|bottom","prompt":"…"}]}.'
  ].join('\n')
  const prompt = [
    languageLine(p.language),
    `Number of concepts: ${p.count}`,
    `Working title: ${outline.title}`,
    `Promise: ${outline.promise}`,
    `Hook: ${outline.hook}`,
    ...(outline.chapters.length > 0 ? [`Chapters: ${outline.chapters.map((c) => c.title).join(' | ')}`] : []),
    ...(p.style ? [`Channel thumbnail style: ${p.style}`] : []),
    p.withFace ? 'The style shows an expressive human face.' : 'No human face: a scene, an object or a place.',
    'Script (excerpt):',
    script.slice(0, 3000)
  ].join('\n')
  return (await askJson(ctx, { role: 'thumbnail', system, prompt, schema: Concepts })).concepts.slice(0, p.count)
}

async function make(ctx: RunCtx, inputs: ResolvedInputs, p: Params, real: boolean): Promise<NodeOutputs> {
  const outline = readValue(inputs.outline, Outline, 'the outline')
  const script = readText(inputs.script, 'the script')
  const concepts = checkConcepts(real ? await claudeConcepts(ctx, outline, script, p) : templateConcepts(outline, p), outline)
  const dir = await scratch(ctx, 'thumbnails')
  const cacheDir = await need(ctx, 'workspace').cache('thumbnails')
  const font = path.join(need(ctx, 'library').root, 'fonts', 'Inter-Bold.ttf')
  const media = need(ctx, 'media')
  const engines = p.engine ? [p.engine, ...(p.fallbacks ?? [])] : [DEFAULT_ENGINES.image.engine, ...DEFAULT_ENGINES.image.fallbacks]
  const files: string[] = []
  const records: ThumbnailRecord[] = []
  const failures: Error[] = []
  let billed = 0
  for (const [i, c] of concepts.entries()) {
    throwIfAborted(ctx)
    // per concept (§29): the concept, the layout, the size, the node seed and its place in the set (two equal concepts still differ)
    const key = hashOf({ v: 2, how: real ? 'cloud' : 'drawn', engines: real ? engines : null, headline: c.headline, position: c.position, prompt: c.prompt, layout: p.layout, w: THUMB_W, h: THUMB_H, seed: ctx.seed, i })
    const cached = path.join(cacheDir, `${key}.png`)
    let demo = !real
    try {
      if (!existsSync(cached)) {
        const tmp = path.join(dir, `${String(i + 1).padStart(2, '0')}-${key}.tmp.png`)
        let src: string | undefined
        if (real) {
          const jobDir = path.join(dir, `job-${i + 1}`)
          await mkdir(jobDir, { recursive: true })
          const art = `${c.prompt}${p.style ? ` Style: ${p.style}.` : ''} Wide 16:9 composition. ${NO_TEXT}`
          const cloud = need(ctx, 'cloud')
          const got = await firstThatWorks(
            engines,
            (engine) => cloud.generateImage({ prompt: art, width: THUMB_W, height: THUMB_H, ...(engine ? { engine } : {}) }, { idempotencyKey: `thumb-${key}-${engine ?? 'default'}`, signal: ctx.signal, dir: jobDir }),
            { refusals: 'next', log: (text) => ctx.emit({ kind: 'log', level: 'warn', text: `thumbnail ${i + 1}: ${text}` }) }
          )
          if (got.value === null) throw new EngineError('refused', `no image engine made thumbnail ${i + 1}: ${got.tried.map((t) => `${t.engine ?? 'default'} (${t.message})`).join(', ')}`)
          billed++
          demo = got.value.demo
          src = got.value.files[0]
          if (!src) throw new EngineError('internal', 'the Cloud returned no picture for a thumbnail')
        }
        await composeThumbnail(media, { ...(src ? { src } : {}), out: tmp, hash: key, text: c.headline, position: c.position, layout: p.layout, font, watermark: !real || demo }, ctx.signal)
        await atomicCopy(tmp, cached)
        await atomicWrite(`${cached}.json`, JSON.stringify({ demo }))
      } else if (real) {
        demo = ((await readFile(`${cached}.json`, 'utf8').then(JSON.parse).catch(() => ({ demo: true }))) as { demo: boolean }).demo
      }
    } catch (e) {
      // a stop, or a missing tool (no Cloud, no ffmpeg) ends the node; any other failure only skips this concept
      if (isAbortError(e) || (e instanceof EngineError && e.code === 'missing_tool')) throw e
      failures.push(e instanceof Error ? e : new Error(String(e)))
      progress(ctx, i + 1, concepts.length, `${i + 1} miniatures sur ${concepts.length}`)
      continue
    }
    const out = path.join(dir, `thumbnail-${files.length + 1}.png`)
    await copyFile(cached, out)
    files.push(out)
    records.push({ file: files.length - 1, headline: c.headline, position: c.position, prompt: c.prompt, demo })
    progress(ctx, i + 1, concepts.length, `${i + 1} miniatures sur ${concepts.length}`)
  }
  if (real) ctx.reportCost({ units: [{ unit: 'images', qty: billed }], provider: 'image' })
  if (files.length === 0) throw failures[0] ?? new EngineError('internal', 'no thumbnail could be made')
  if (failures.length > 0) ctx.emit({ kind: 'log', level: 'warn', text: `${failures.length} thumbnail concept(s) skipped` })
  return { thumbnails: { files, value: records as unknown as Json, meta: { count: files.length, chosen: 0, demo: records.some((r) => r.demo), skipped: failures.length } } }
}

export const thumbnailMake = defineNode({
  type: 'thumbnail.make@1',
  inputs: {
    script: { type: 'text.script', required: true },
    outline: { type: 'json.outline', required: true }
  },
  outputs: { thumbnails: 'image.thumbnail[]' },
  params: ThumbnailParams,
  executors: ['local'],
  defaultGate: 'owner',
  estimate: (_ctx, p) => ({ units: [{ unit: 'images', qty: p.count }, { unit: 'calls', qty: 1 }], provider: 'image', durationS: 30 + p.count * 25 }),
  run: (ctx, inputs, p) => make(ctx, inputs, p, true),
  fake: (ctx, inputs, p) => make(ctx, inputs, p, false)
})
