// What `motion.render` prepares for a documentary card (formats/cards.ts) before drawing it: the found or made picture of an archive card,
// made small enough to sit in the page (a JPEG of at most 1600 px, inlined as a data: URI: the page has no file or network access), and
// the background and paths of a map (motion/geo.ts). The cache key of a card names what went into it (the picture's bytes, the map data's
// version), so a new picture redraws the card and the same one never does.
// The director wrote an archive card's caption before any picture was found: the caption of a FOUND archive is the archive's own
// (its title and its maker, from its licence record), never a guess; a made picture gets no caption that would pass it for an archive.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Artefact } from '../artefacts'
import { EngineError } from '../errors'
import { PictureRect, type CardAssets, type MapCardProps, type PrintsCardProps } from '../formats/cards'
import { isCardTemplate } from '../formats/cards'
import type { Shot } from '../formats/editplan'
import { MotionSpec, type MotionSpecInput } from '../formats/motion'
import { prepareMapAssets } from '../motion/geo'
import { prepareMap3d } from '../motion/map3d-data'
import { prepareStudio } from '../motion/studio'
import { FPS } from '../formats/timing'
import type { RunCtx } from '../registry'
import { z } from 'zod'
import { need } from '../services'
import { askJson, scratch } from './common'

/** Longest side of a picture inside a card: sharp at 1080p (a print covers at most ~70 % of the frame), light in the page. */
const PICTURE_MAX = 1600

/** A card shot of the plan: a motion shot whose template is one of the documentary cards (it is the base shot itself). */
export const isCardShot = (s: Shot): boolean => s.kind === 'motion' && isCardTemplate((s.graphic as { template?: unknown } | undefined)?.template)

/** A found archive's own record (`visuals.fulfil` keeps it with the picture): what its caption says. */
export interface PictureCredit {
  title: string
  creator: string
}
export interface CardPicture {
  file: string
  /** Absent: a made picture (or a stock one without a record). */
  credit?: PictureCredit
}

/** The pictures of `visuals.fulfil` by item id (a missing record: no pictures, the cards draw their placeholder). */
export function picturesOf(a: Artefact | undefined): Map<string, CardPicture> {
  const out = new Map<string, CardPicture>()
  const rec = a?.value
  if (!Array.isArray(rec)) return out
  for (const r of rec as { itemId?: unknown; file?: unknown; stock?: { title?: unknown; creator?: unknown } }[]) {
    const file = typeof r.file === 'number' ? a?.files?.[r.file] : undefined
    const title = typeof r.stock?.title === 'string' ? r.stock.title.trim() : ''
    const creator = typeof r.stock?.creator === 'string' ? r.stock.creator.trim() : ''
    if (typeof r.itemId === 'string' && file) out.set(r.itemId, { file, ...(title ? { credit: { title, creator } } : {}) })
  }
  return out
}

/**
 * The archives' captions in the video's language (clonage-traduction: Commons titles are often English or Dutch): ONE model call for all
 * the cards of a run, titles only (a maker's name is never translated). Without a language, in English, or when the call fails, the
 * captions stay as the archive wrote them (said in the log).
 */
export async function translateCaptions(ctx: RunCtx, pictures: Map<string, CardPicture>, language: string | undefined, fake: boolean): Promise<void> {
  const lang = language?.slice(0, 2).toLowerCase()
  const titles = [...new Set([...pictures.values()].map((p) => p.credit?.title).filter((t): t is string => !!t))]
  if (!lang || lang === 'en' || fake || titles.length === 0) return
  try {
    const schema = z.object({ titles: z.array(z.string().trim().min(1).max(200)).length(titles.length) })
    const answer = await askJson(ctx, {
      role: 'scriptwriter',
      tier: 'fast',
      system: 'You translate the titles of archive pictures (paintings, prints, photographs, documents) for the captions of a history documentary. Keep proper names, keep it short and natural, as a museum label in that language. Answer with ONE JSON object {"titles": [...]} in the same order, nothing else.',
      prompt: `Language: ${lang}
Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
      schema
    })
    const map = new Map(titles.map((t, i) => [t, answer.titles[i] ?? t]))
    for (const [id, p] of pictures) if (p.credit) pictures.set(id, { ...p, credit: { ...p.credit, title: map.get(p.credit.title) ?? p.credit.title } })
  } catch (e) {
    if (ctx.signal.aborted) throw e
    ctx.emit({ kind: 'log', level: 'warn', text: `archive captions left as written (${(e as Error).message.slice(0, 160)})` })
  }
}

const fit = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const stems = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 5))
/** Whether an archive's record names what the narration calls it (a word of four letters or more in common). */
const names = (credit: PictureCredit, label: string): boolean => {
  const own = new Set(stems(`${credit.title} ${credit.creator}`))
  return stems(label).some((w) => own.has(w))
}

/**
 * An archive card's caption from what was found: a painting or a scene (`full`) is captioned with its title and maker; a print (`board`)
 * keeps the name the narration gives and shows its maker under it; a document (`paper`) names its source; a made picture keeps only
 * the narration's own words on it (punch, lines, excerpt), no caption.
 */
export function captioned(props: Record<string, unknown>, credit: PictureCredit | undefined): Record<string, unknown> {
  const { label: _label, sub: _sub, source: _source, ...rest } = props
  if (!credit) return props.frame === 'board' && typeof props.label === 'string' ? { ...rest, label: props.label } : rest
  const maker = fit(credit.creator, 80)
  switch (props.frame) {
    case 'full':
    case 'tv':
      return { ...rest, label: fit(credit.title, 60), ...(maker ? { sub: maker } : {}) }
    case 'board':
      // the narration's name only when the archive is of it (« Lucas de Clercq » on Frans Hals' portrait of him), else the archive's title
      return { ...rest, label: typeof props.label === 'string' && names(credit, props.label) ? props.label : fit(credit.title, 60), ...(maker ? { sub: maker } : {}) }
    default:
      return { ...rest, source: fit([credit.title, credit.creator].filter(Boolean).join(' · ').toUpperCase(), 70) }
  }
}

/** The picture as a small JPEG data: URI and the hash of its source bytes (for the cache key). */
async function pictureUri(ctx: RunCtx, file: string, name: string): Promise<{ uri: string; hash: string; tall: boolean }> {
  const bytes = await readFile(file)
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const dir = await scratch(ctx, 'card-pictures')
  const out = path.join(dir, `${name}-${hash}.jpg`)
  await need(ctx, 'media').run(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', file, '-vf', `scale='min(${PICTURE_MAX},iw)':'min(${PICTURE_MAX},ih)':force_original_aspect_ratio=decrease`, '-frames:v', '1', '-q:v', '3', out],
    { signal: ctx.signal }
  )
  const size = await need(ctx, 'media').run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { signal: ctx.signal })
  const [w, h] = size.stdout.toString().trim().split(',').map(Number) as [number, number]
  const jpeg = await readFile(out)
  await rm(out, { force: true })
  return { uri: `data:image/jpeg;base64,${jpeg.toString('base64')}`, hash, tall: h > w * 1.05 }
}

/** Frames a second of a film played inside a print (old films run at 16–18: 10 reads as film at a print's size), and their width. */
export const PRINT_FILM_FPS = 10
const PRINT_FILM_W = 640

/** A film's frames for a print, as JPEG data: URIs (≈ 30 KB each, at most the card's length). */
async function filmFrames(ctx: RunCtx, file: string, name: string, seconds: number): Promise<{ frames: string[]; hash: string }> {
  const dir = path.join(await scratch(ctx, 'card-films'), name)
  await mkdir(dir, { recursive: true })
  await need(ctx, 'media').run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-t', seconds.toFixed(2), '-vf', `fps=${PRINT_FILM_FPS},scale=${PRINT_FILM_W}:-2`, '-q:v', '5', path.join(dir, 'f%04d.jpg')], { signal: ctx.signal })
  const names = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort()
  const hash = createHash('sha256')
  const frames: string[] = []
  for (const f of names) {
    const bytes = await readFile(path.join(dir, f))
    hash.update(bytes)
    frames.push(`data:image/jpeg;base64,${bytes.toString('base64')}`)
  }
  await rm(dir, { recursive: true, force: true })
  return { frames, hash: hash.digest('hex').slice(0, 16) }
}

const LineFound = z.object({ found: z.boolean(), rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(), quote: z.string().max(300).optional() })
const FIND_LINE_RULES = [
  'You look at a scanned archive document for a history documentary. Find the line (or two lines) of its printed or typed text that best says what the narration says.',
  'Answer with ONE JSON object: {"found": true, "rect": {"x":…, "y":…, "w":…, "h":…}, "quote": "<the words you read there>"} where rect is that line\'s box as fractions of the whole picture (0 to 1, x and y its top left corner), tight around the words.',
  'Answer {"found": false} when the picture is not a readable text document, or when nothing on it says this. Never guess a line you cannot read.'
].join('\n')

/** The key line of a scan, looked for by Claude (the box, or null: not a readable document, nothing says it, or no model in this run). */
export async function findKeyLine(ctx: RunCtx, file: string, find: string, fake: boolean): Promise<PictureRect | null> {
  if (fake || !ctx.services.claude) return null
  try {
    const a = await askJson(ctx, { role: 'director', tier: 'fast', system: FIND_LINE_RULES, prompt: `The narration says: « ${find} »`, schema: LineFound, images: [file] })
    const r = a.found ? PictureRect.safeParse(a.rect) : undefined
    // a box as tall as half the page is not a line
    return r?.success && r.data.h <= 0.2 ? r.data : null
  } catch (e) {
    if (ctx.signal.aborted) throw e
    ctx.emit({ kind: 'log', level: 'warn', text: `scan: the key line was not found (${(e as Error).message.slice(0, 160)})` })
    return null
  }
}

/**
 * The assets of one card and what its cache key must include. An archive card without its picture (a picture that could not be made)
 * draws its placeholder and says so; a map whose places are unknown is a permanent error naming them.
 */
export async function cardAssets(
  ctx: RunCtx,
  s: Shot,
  pictures: ReadonlyMap<string, CardPicture>,
  size: readonly [number, number],
  o: { clips?: ReadonlyMap<string, CardPicture>; fake?: boolean } = {}
): Promise<{ assets: CardAssets; key: Record<string, string>; spec: MotionSpecInput }> {
  const spec = MotionSpec.parse(s.graphic)
  // a document to read on a real scan: the line that says the narration's words is found by looking; no scan or no such line keeps the typed page
  if (spec.template === 'document' && spec.props.scan) {
    const { scan, text: _text, paper: _paper, heading: _heading, ...kept } = spec.props
    const pic = s.genItem ? pictures.get(s.genItem) : undefined
    const line = pic ? await findKeyLine(ctx, pic.file, scan.find, o.fake === true) : null
    if (!pic || !line) {
      ctx.emit({ kind: 'log', level: 'info', text: `card ${s.id}: no scan with the line, typed page` })
      const { scan: _s, ...typed } = spec.props
      return { assets: {}, key: { scan: 'typed' }, spec: MotionSpec.parse({ ...spec, props: { ...typed, camera: 'follow' } }) }
    }
    const p = await pictureUri(ctx, pic.file, s.id)
    const marks = spec.props.marks.slice(0, 1).map((m) => ({ atS: m.atS, rect: line, style: 'band' as const }))
    return { assets: { picture: p.uri }, key: { picture: p.hash, line: JSON.stringify(line) }, spec: MotionSpec.parse({ ...spec, props: { ...kept, marks, camera: 'read' } }) }
  }
  if (spec.template === 'archive') {
    const pic = s.genItem ? pictures.get(s.genItem) : undefined
    if (!pic) {
      ctx.emit({ kind: 'log', level: 'warn', text: `card ${s.id}: no picture for ${s.genItem ?? 'it'}, drawn with a placeholder` })
      return { assets: {}, key: { picture: 'none' }, spec }
    }
    const p = await pictureUri(ctx, pic.file, s.id)
    // a tall picture (a portrait) cropped to the full 16:9 frame loses its face: it is shown as a print on the board instead
    const props = spec.props as Record<string, unknown>
    const framed = props.frame === 'full' && p.tall ? { ...props, frame: 'board' } : props
    const own = MotionSpec.parse({ ...spec, props: captioned(framed, pic.credit) })
    return { assets: { picture: p.uri }, key: { picture: p.hash }, spec: own }
  }
  // a document card without text is a scan: it gets its shot's picture like an archive card does (no caption to make)
  if (spec.template === 'document' && spec.props.text === undefined) {
    const pic = s.genItem ? pictures.get(s.genItem) : undefined
    if (!pic) {
      ctx.emit({ kind: 'log', level: 'warn', text: `card ${s.id}: no picture for ${s.genItem ?? 'it'}, drawn with a placeholder` })
      return { assets: {}, key: { picture: 'none' }, spec }
    }
    const p = await pictureUri(ctx, pic.file, s.id)
    return { assets: { picture: p.uri }, key: { picture: p.hash }, spec }
  }
  if (spec.template === 'prints') {
    // a board of prints: its pictures in the order of its prints (the first is `genItem`, the others `alsoItems`); a missing one is a stand-in
    const ids = [s.genItem, ...(s.alsoItems ?? [])]
    const found = await Promise.all(
      ids.map(async (id) => {
        const pic = id ? pictures.get(id) : undefined
        if (!pic) return undefined
        return pictureUri(ctx, pic.file, `${s.id}-${id}`)
      })
    )
    if (found.some((f) => !f)) ctx.emit({ kind: 'log', level: 'warn', text: `card ${s.id}: ${found.filter((f) => !f).length} print(s) without a picture, drawn with a placeholder` })
    // a film inside a print: its frames (a print whose film was not found stays a photograph)
    const printsProps = spec.props as PrintsCardProps
    if (printsProps.prints.some((x) => x.film)) {
      const seconds = (s.endFrame - s.startFrame) / FPS
      const films = await Promise.all(
        ids.map(async (id, i) => {
          const clip = printsProps.prints[i]?.film && id ? o.clips?.get(id) : undefined
          return clip ? filmFrames(ctx, clip.file, `${s.id}-${i}`, seconds) : undefined
        })
      )
      return { assets: { pictures: found.map((f) => f?.uri), films: films.map((f) => f?.frames), filmFps: PRINT_FILM_FPS }, key: { pictures: found.map((f) => f?.hash ?? 'none').join(','), films: films.map((f) => f?.hash ?? 'none').join(',') }, spec }
    }
    // the same picture twice on one board (a gap filled with its neighbour's picture) is shown once: the board keeps fewer prints
    // (documentary-2 round 4: three prints of one photograph); a bar over a dropped print goes with it
    const keep = found.map((f, i) => i === 0 || !f || !found.slice(0, i).some((g) => g?.hash === f.hash))
    if (keep.some((k) => !k)) {
      const props = spec.props as PrintsCardProps
      const index = keep.map((k, i) => (k ? keep.slice(0, i).filter(Boolean).length : -1))
      const bars = props.bars.flatMap((b) => (b.over === undefined ? [b] : (index[b.over] ?? -1) >= 0 ? [{ ...b, over: index[b.over] as number }] : []))
      const own = MotionSpec.parse({ ...spec, props: { ...props, prints: props.prints.filter((_, i) => keep[i]), bars } })
      const kept = found.filter((_, i) => keep[i])
      return { assets: { pictures: kept.map((f) => f?.uri) }, key: { pictures: kept.map((f) => f?.hash ?? 'none').join(',') }, spec: own }
    }
    return { assets: { pictures: found.map((f) => f?.uri) }, key: { pictures: found.map((f) => f?.hash ?? 'none').join(',') }, spec }
  }
  if (spec.template === 'map') {
    const libraryRoot = need(ctx, 'library').root
    const cacheDir = await need(ctx, 'workspace').cache('maps')
    try {
      const map = await prepareMapAssets(spec.props as MapCardProps, { width: size[0], height: size[1], libraryRoot, cacheDir, media: need(ctx, 'media'), signal: ctx.signal })
      return { spec, assets: { map }, key: { map: createHash('sha256').update(map.image.slice(0, 4096)).update(map.detail?.image.slice(0, 4096) ?? '').update(map.borders).digest('hex').slice(0, 16) } }
    } catch (e) {
      if (e instanceof EngineError) throw e
      throw new EngineError('bad_input', `La carte ${s.id} n’est pas dessinable : ${(e as Error).message}`)
    }
  }
  if (spec.template === 'map3d') {
    // the 3D map: tiles along the camera's path (NASA GIBS, AWS Terrain Tiles; kept in the workspace's cache), shapes, the library
    const cacheDir = await need(ctx, 'workspace').cache('maps3d')
    const durationS = (s.endFrame - s.startFrame) / FPS
    try {
      const map3d = await prepareMap3d(spec.props, { width: size[0], height: size[1], durationS, libraryRoot: need(ctx, 'library').root, cacheDir, signal: ctx.signal })
      for (const w of map3d.warnings ?? []) ctx.emit({ kind: 'log', level: 'warn', text: `card ${s.id}: ${w}` })
      const tiles = createHash('sha256')
      for (const k of Object.keys(map3d.tiles).sort()) tiles.update(k).update((map3d.tiles[k] as string).slice(0, 256))
      return { spec, assets: { map3d }, key: { map3d: `${map3d.lib.version}.${tiles.digest('hex').slice(0, 16)}` } }
    } catch (e) {
      if (e instanceof EngineError) throw e
      throw new EngineError('bad_input', `La carte 3D ${s.id} n’est pas dessinable : ${(e as Error).message}`)
    }
  }
  if (spec.template === 'studio') {
    // the motion studio: three.js (inlined) and the outlines of the characters the scene writes
    const studio = await prepareStudio(spec.props, { libraryRoot: need(ctx, 'library').root })
    return { spec, assets: { studio }, key: { studio: `three-${studio.lib.version}` } }
  }
  return { assets: {}, key: {}, spec }
}
