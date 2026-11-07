// `visuals.fulfil@1` (docs/ENGINE-SPEC.md §21.6, §22, §23, R15.3): executes the generation list, item by item, each with its own
// cache entry (R7.6: replacing one item redoes only it). run: every paid item is its own Atelier Cloud job (one idempotency
// key per item). A stock item is a Cloud stock search (Pexels, Wikimedia Commons, or the demo files): the best result becomes
// the item's picture, with its licence and credit line kept in the images record (visuals-stock.ts); a stock VIDEO gives its
// first frame for now (the renderer places pictures only), listed as degraded; a search that finds nothing falls back to a
// generated image, listed, never silent (R36.1). fake (demo): drawn stills with the subject, the query or prompt and a DÉMO
// watermark.
//
// Generated stills (`image.make`, production-8, decision 0035): with a pin (`engine`, `fallbacks`), a brick style (`look`), the
// people / brand settings or references, each still is composed from the director's parts and the style (visuals-look.ts) and
// made by visuals-stills.ts (engines per item, references, refusal rewrite, checks, degraded path). A recurring object's first
// picture is the reference of its later ones; the presenter's portrait rides on the shots where the presenter acts. With
// `stillsOnly` (a `clip.make` brick follows), a generated-video item gets only its start still and a shot that shares a clip
// (`sameAs`) takes its partner's. Without any of these the list is fulfilled exactly as before.
//
// Generated video (`video.gen`) without a clip brick: in run each item is a Cloud `generateVideo` job (the director's prompt, the
// shot's length cut at the provider's longest clip, the plan's aspect); the clip goes to the `clips` output with a record, and its
// first frame is the item's picture in `images`. In demo mode the clip is drawn locally. Avatar items are made by `avatar.speak`.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { STYLE_BRANDS, STYLE_PEOPLE } from '../../shared/brick-styles'
import { EngineError } from '../errors'
import type { NodeOutputs } from '../artefacts'
import { GenList, type GenItem } from '../formats/editplan'
import { frameSizeOf, type Aspect } from '../formats/timing'
import { DRAW_VERSION, drawStill } from '../media/draw'
import { DRAW_VIDEO_VERSION } from '../media/draw-video'
import { FILM_CUT_VERSION, clipSeconds, filmFinder, makeClip } from './visuals-film'
import { planArchives } from './visuals-photo-plan'
import { probe } from '../media/probe'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need, type CloudService } from '../services'
import type { Json } from '../types'
import { atomicCopy, atomicWrite, eachLimited, hashOf, progress, readValue, scratch, throwIfAborted } from './common'
import { ImageEngineId } from './visuals-engines'
import { Look, composePicture, type Composed } from './visuals-look'
import { Locale, ObjectNotes } from '../text/locale'
import { makeStill, toStill, type Sized } from './visuals-stills'
import { archiveTroubleOf } from './archive-trouble'
import { findStock, isStockItem, type StockCredit } from './visuals-stock'
import { rescueGaps } from './visuals-rescue'
import { illustrationPass, type IllustrationNote } from './visuals-illustration'
import { distinctPass, type DistinctNote } from './visuals-distinct'
import { drawnInstead, standInsFound } from './visuals-found'

export const VisualsParams = z.object({
  /** Items fetched or generated at once (§23: up to ~8–10). */
  parallel: z.number().int().min(1).max(10).default(8),
  /** Picture size; default: the list's own shape (1920×1080 for 16:9, 1080×1920 for a 9:16 short). */
  width: z.number().int().min(360).max(3840).optional(),
  height: z.number().int().min(360).max(3840).optional(),
  /** The image engine the pipeline picked (its pin) and the engines each item may fall back to, in order. */
  engine: ImageEngineId.optional(),
  fallbacks: z.array(ImageEngineId).max(4).optional(),
  /** The brick style (`image` family) at its pinned version: suffix, negatives, people, brands, references. */
  look: Look.optional(),
  /** Options « Qui apparaît » and « Marques » (they win over the style's). */
  people: z.enum(STYLE_PEOPLE).optional(),
  brands: z.enum(STYLE_BRANDS).optional(),
  /** Where the video's world is and object-accuracy notes (text/locale.ts): every composed prompt carries them. */
  locale: Locale.optional(),
  objectNotes: ObjectNotes.optional(),
  /** Local image files: the presenter's portrait (`presenter-as-actor`), the channel's room (a style shooting in it). */
  references: z.object({ presenter: z.string().min(1).max(1000).optional(), room: z.string().min(1).max(1000).optional() }).optional(),
  /** The channel's presenter (`$style.presenter`, production-7): its portrait serves when `references.presenter` is not set. */
  presenter: z.object({ portrait: z.string().min(1).max(1000).optional() }).passthrough().optional(),
  /** A clip brick makes the clips: generated-video items get their start still only. */
  stillsOnly: z.boolean().optional(),
  /** The eyes check each generated still (text, fingers, a person when nobody), when the host has them. */
  vision: z.boolean().optional(),
  /** The illustration check (avatar-qualite, a setting of the pipeline, record 0055): Claude looks at every generated still
   *  against the words under its shot; one under this score (0–10) is rewritten and made again once. Unset: never looked at. */
  illustrationBar: z.number().min(0).max(10).optional(),
  /** Two stills alike within this many seconds: the later made again once with another framing (record 0053). Unset: off. */
  alikeWindowS: z.number().min(0).max(120).optional(),
  /** Archive items are searched in the public archives first, here on this computer (style-markets: the documentary base). */
  archives: z.boolean().optional(),
  /** documentary-2: `look` = films and photographs chosen by Claude on contact sheets (visuals-photo-plan.ts), archive films as clips. */
  archivePick: z.enum(['first', 'look']).optional(),
  standIns: z.enum(['drawn', 'found']).optional() // a demo's stand-ins (decision 0109): drawn slides, or found photos (visuals-found.ts)
})
type Params = z.infer<typeof VisualsParams>
type Full = Params & Sized

/** The shape every item of a list asks for (the director writes one per plan); 16:9 for an empty list. */
/** What the images record says of a stock or archive item nothing was found for (a gap, flagged; no picture generated). */
export const GAP_NOTE = 'aucun média trouvé (banques et archives) : manque signalé, aucune image générée'

const aspectOfList = (list: GenList): Aspect => list.items[0]?.constraints.aspect ?? '16:9'

/** One fulfilled item, in the order of the list (`images.files[file]`). */
interface Fulfilled {
  itemId: string
  kind: GenItem['kind']
  file: number
  source: 'cloud' | 'drawn'
  demo: boolean
  licence: string
  prompt: string
  degraded?: string
  /** A stock picture: its source, licence and the credit line to publish. */
  stock?: StockCredit
  /** A generated-video item: its picture is the clip's first frame, the clip is in `clips` (`clips.value`). */
  video?: true
  /** The engine that made it, the style it wore, the references it kept, what failed first, the checks still failing. */
  engine?: string
  style?: string
  references?: number
  fallback?: string
  checks?: string[]
  /** A shot that shares the clip of another item shows that item's start still. */
  sameAs?: string
  /** The illustration check's verdict (avatar-qualite): score 0–10 against the words under the shot, the first one if remade. */
  illustration?: IllustrationNote
  /** The scene of a picture made again by the illustration check (its clip moves this scene). */
  scene?: string
  /** Made again because it looked like a neighbour (avatar-qualite part 3): how alike, before and after, which one stays. */
  distinct?: DistinctNote
}

/** One generated clip, in the order of the items that have one (`clips.files[file]`). */
interface ClipRecord {
  itemId: string
  file: number
  durationS: number
  width: number
  height: number
  demo: boolean
}

/** What is kept next to a cached picture, so a cache hit still knows its origin. */
interface CacheNote {
  demo: boolean
  stock?: StockCredit
  degraded?: string
  /** A generated clip kept next to the picture: its extension and facts. */
  clip?: { ext: string; durationS: number; width: number; height: number }
  engine?: string
  references?: number
  fallback?: string
  checks?: string[]
}

/** The production-8 path: any pin, style, rule, reference, clip brick or check is set. */
const composes = (p: Params): boolean =>
  p.engine !== undefined || p.look !== undefined || p.people !== undefined || p.brands !== undefined || p.references !== undefined || p.stillsOnly === true || p.vision === true || p.locale !== undefined

const fileHash = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 24)

/**
 * Items in the order they can be made: a picture comes one level after the first pictures of the recurring objects it shows
 * (it keeps them as references), so every reference exists before the pictures that keep it, whatever the timing; shots that
 * share a clip come last (they copy their partner's still).
 */
function phases(items: readonly GenItem[], useRefs: boolean): { phase: number[]; headOf: Map<string, number> } {
  const headOf = new Map<string, number>()
  const phase = items.map((it, i) => {
    if (it.sameAs !== undefined || !useRefs || (it.kind !== 'image.gen' && it.kind !== 'video.gen')) return 0
    let level = 0
    for (const name of it.recurring ?? []) {
      const head = headOf.get(name)
      if (head === undefined) headOf.set(name, i)
    }
    // computed after registering, so a level only depends on earlier heads
    for (const name of it.recurring ?? []) {
      const head = headOf.get(name) as number
      if (head !== i) level = Math.max(level, 1)
    }
    return level
  })
  // a picture that heads a name AND keeps another's reference must be made before the pictures that keep its own
  for (let changed = true; changed; ) {
    changed = false
    items.forEach((it, i) => {
      if (phase[i] === undefined || it.sameAs !== undefined) return
      for (const name of it.recurring ?? []) {
        const head = headOf.get(name) as number
        if (head !== i && (phase[i] as number) <= (phase[head] as number)) {
          phase[i] = (phase[head] as number) + 1
          changed = true
        }
      }
    })
  }
  const last = Math.max(0, ...phase) + 1
  return { phase: items.map((it, i) => (it.sameAs !== undefined ? last : (phase[i] as number))), headOf }
}

async function fulfil(ctx: RunCtx, inputs: ResolvedInputs, params: Params, drawn: boolean): Promise<NodeOutputs> {
  const list = readValue(inputs.list, GenList, 'the generation list')
  // a presenter is not a picture: `avatar.speak` makes it
  const items = list.items.filter((it) => it.kind !== 'avatar')
  const aspect = aspectOfList(list)
  const [w, h] = frameSizeOf(aspect)
  const p: Full = { ...params, width: params.width ?? w, height: params.height ?? h, aspect }
  const fresh = composes(p)
  const dir = await scratch(ctx, 'visuals')
  const cacheDir = await need(ctx, 'workspace').cache('visuals')
  const files: string[] = new Array(items.length)
  const record: Fulfilled[] = new Array(items.length)
  const keys: string[] = new Array(items.length)
  const clipAt: ({ file: string; durationS: number; width: number; height: number; demo: boolean } | undefined)[] = new Array(items.length)
  const holds: number[] = []
  // the stock and archive items nothing was found for (flagged, never generated)
  const gaps: string[] = []
  const kept: string[] = []
  let billedImages = 0
  let billedSearches = 0
  let billedVideoS = 0
  let done = 0
  const font = path.join(need(ctx, 'library').root, 'fonts', 'Inter-Bold.ttf')
  const warn = (text: string): void => ctx.emit({ kind: 'log', level: 'warn', text })
  // the references the run has: a missing file is said once, and the pictures go without it
  const refFile = async (f: string | undefined, what: string): Promise<{ file: string; hash: string } | null> => {
    if (!f) return null
    if (!existsSync(f)) {
      warn(`${what}: ${f} not found, the pictures go without it`)
      return null
    }
    return { file: f, hash: await fileHash(f) }
  }
  const portrait = fresh ? await refFile(p.references?.presenter ?? p.presenter?.portrait, 'presenter portrait') : null
  const room = fresh ? await refFile(p.references?.room, 'room reference') : null
  const people = p.people ?? p.look?.people ?? 'anyone'
  if (fresh && people === 'presenter-as-actor' && !portrait) warn('« le présentateur joue l’action » without a portrait: the pictures describe the presenter in words only')
  const { phase, headOf } = phases(items, fresh)
  // the n-th time the same request appears in the list
  const seen = new Map<string, number>()
  const repeats = items.map((it) => {
    const k = `${it.kind}|${it.query ?? ''}|${it.prompt ?? ''}|${it.context.subject}`
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return n
  })
  const indexOf = new Map(items.map((it, i) => [it.id, i]))
  // archive films and photographs (documentary-2), all chosen at once by looking; a film item gets a photograph for when no film fits
  const plans = drawn || params.archivePick !== 'look' ? { films: new Map(), photos: new Map() } : await planArchives(ctx, items, { dir, films: p.stillsOnly !== true, landscape: p.width >= p.height })
  const [photoPlan, films] = [plans.photos, filmFinder(ctx, { dir: path.join(dir, 'films'), plan: plans.films, photos: plans.photos, items })]

  // issue #114: the picture of a shot whose clip or image could not be made: a found still on its subject, else a hold that
  // shows its neighbour's picture; always said in the record (`degraded`), never a failed node
  const stillInstead = async (item: GenItem, why: EngineError, tmp: string, key: string, jobDir: string): Promise<{ demo: boolean; stock?: StockCredit; degraded: string; hold: boolean }> => {
    const query = (item.context.keyTerms.slice(0, 3).join(' ') || item.context.subject).slice(0, 80)
    const what = item.kind === 'image.gen' ? 'image' : 'clip'
    const reason = why.code === 'refused' ? 'refusé' : 'impossible'
    try {
      const found = await findStock(ctx, { ...item, kind: 'stock.photo' }, query, p, { idempotencyKey: `stock-${key}-degraded`, dir: jobDir })
      billedSearches++
      if (found) {
        await toStill(ctx, found.src, tmp, p)
        return { demo: found.demo, stock: found.credit, degraded: `${what} ${reason} → photo de banque`, hold: false }
      }
    } catch (e) {
      if (ctx.signal.aborted || (e instanceof EngineError && e.code === 'budget')) throw e
    }
    return { demo: true, degraded: `${what} ${reason} → plan voisin`, hold: true }
  }

  const one = async (item: GenItem, i: number): Promise<void> => {
    throwIfAborted(ctx)
    const stock = isStockItem(item)
    // a generated-video item whose clip a clip brick makes is a still here
    const film = item.kind === 'stock.video' && params.archivePick === 'look' && p.stillsOnly !== true // an archive film, a clip
    const video = (item.kind === 'video.gen' && p.stillsOnly !== true) || film
    const generated = item.kind === 'image.gen' || (item.kind === 'video.gen' && !video)
    const composed: Composed | null = fresh && generated ? composePicture(item, p.look, { people: p.people, brands: p.brands, aspect, locale: p.locale, notes: p.objectNotes }) : null
    const prompt = stock ? (item.query ?? item.prompt ?? item.context.subject) : (composed?.prompt ?? item.prompt ?? item.context.subject)
    let degraded: string | undefined = item.kind === 'user.footage' ? 'tes rushes → image (footage.input arrive avec son lot)' : undefined
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${item.id}.jpg`)
    // a shot that shares a clip shows its partner's start still: nothing to make, nothing to bill
    if (fresh && item.sameAs !== undefined) {
      const head = indexOf.get(item.sameAs)
      const h = head !== undefined ? record[head] : undefined
      if (head === undefined || !h) throw new EngineError('bad_input', `${item.id} shares the clip of ${item.sameAs}, which has no picture`)
      const from = files[head]
      // a partner that holds its neighbour is filled with the holds below; this shot holds with it
      if (from) {
        await copyFile(from, out)
        files[i] = out
      } else holds.push(i)
      record[i] = { ...h, itemId: item.id, kind: item.kind, file: i, sameAs: item.sameAs }
      progress(ctx, ++done, items.length, `${done} images sur ${items.length}`)
      return
    }
    // the references this picture keeps, in priority order: the presenter acting, the room, its recurring objects' first pictures
    const refs: { file: string; hash: string }[] = []
    if (composed?.presenter && portrait) refs.push(portrait)
    if (composed?.room && room) refs.push(room)
    for (const name of item.recurring ?? []) {
      const head = headOf.get(name)
      if (head === undefined || head === i || !files[head]) continue
      refs.push({ file: files[head] as string, hash: keys[head] as string })
    }
    // per-item cache (R7.6, R33): everything that shapes the picture, the node seed, and the n-th repeat of the same
    // request, so two shots asking the same thing still get two different pictures (§21.5: never the same twice). A clip adds
    // its seconds (and, drawn, the drawing's version) so the keys of every other item stay what they were; the production-8
    // fields join only when set, so a list fulfilled before them keeps its keys.
    const key = hashOf({
      v: 3,
      kind: item.kind,
      prompt,
      subject: item.context.subject,
      w: p.width,
      h: p.height,
      how: drawn ? `drawn-${DRAW_VERSION}` : 'cloud',
      repeat: repeats[i],
      seed: ctx.seed,
      ...(video ? { clipS: clipSeconds(item), clipDraw: drawn ? DRAW_VIDEO_VERSION : 0, ...(film ? { film: FILM_CUT_VERSION } : {}) } : {}),
      ...(composed
        ? { negative: composed.negative ?? null, engines: p.engine ? [p.engine, ...(p.fallbacks ?? [])] : null, refs: refs.map((r) => r.hash), vision: p.vision === true, still: !video }
        : {})
    })
    keys[i] = key
    const cached = path.join(cacheDir, `${key}.jpg`)
    const noteFile = `${cached}.json`
    const readNote = async (): Promise<CacheNote> => readFile(noteFile, 'utf8').then((t) => JSON.parse(t) as CacheNote).catch(() => ({ demo: true }) as CacheNote)
    const clipCache = (ext: string): string => path.join(cacheDir, `${key}.clip.${ext}`)
    let demo = drawn
    let stockCredit: StockCredit | undefined
    let clip: CacheNote['clip']
    let note: Omit<CacheNote, 'demo' | 'stock' | 'degraded' | 'clip'> = {}
    const note0 = existsSync(cached) && (!drawn || video) ? await readNote() : null
    // a cached picture is a hit; a cached video item needs its clip too; a real run asks again for what a demo answered
    const demoInRealRun = note0?.demo === true && !drawn && ctx.services.cloud?.realRun === true
    const hit = existsSync(cached) && !demoInRealRun && (!video || (note0?.clip !== undefined && existsSync(clipCache(note0.clip.ext))))
    let hold = false
    if (!hit) {
      const tmp = path.join(dir, `${String(i + 1).padStart(3, '0')}-${key}.tmp.jpg`)
      const jobDir = path.join(dir, `job-${item.id}`)
      await mkdir(jobDir, { recursive: true })
      if (drawn) {
        await drawStill(
          need(ctx, 'media'),
          { out: tmp, hash: key, title: item.context.subject, detail: prompt, footer: `Image de démonstration · ${item.kind} · ${item.id}`, font, watermark: true, aspect },
          ctx.signal
        )
      }
      if (video) {
        let failed: EngineError | null = null
        // issue #114: a clip the Cloud refused or could not make (no clip engine, a demo answer) degrades THIS shot, never the run
        const made = await makeClip(ctx, item, { prompt, key, still: drawn ? tmp : null, tmpClip: path.join(jobDir, 'drawn.mp4'), jobDir, aspect: p.aspect, drawn, ...(film ? { film: () => films(item) } : {}) }).catch((e: unknown) => {
          if (drawn || film || ctx.signal.aborted || !(e instanceof EngineError) || e.code === 'budget' || e.code === 'missing_tool') throw e
          failed = e
          return null
        })
        if (failed) {
          const f = failed as EngineError
          warn(`${item.id}: the clip failed (${f.message.slice(0, 160)}): the shot falls back to a still`)
          const r = await stillInstead(item, f, tmp, `${key}-clip`, jobDir)
          demo = r.demo
          stockCredit = r.stock
          degraded = r.degraded
          hold = r.hold
        } else if (made?.still) {
          // no film fits but a photograph does: the shot shows it with a slow push (a full-frame still, as the reference does)
          await toStill(ctx, made.file, tmp, p)
          stockCredit = made.credit
          degraded = 'film d’archive introuvable → photo d’archive'
        } else if (!made) {
          // no archive film or photograph fits these words: a gap, flagged, never a generated clip in its place
          degraded = GAP_NOTE
          hold = true
          gaps.push(item.id)
          warn(`${item.id}: no archive film for « ${prompt.slice(0, 80)} », flagged as a gap`)
        } else {
          if (!drawn) {
            if (!film) billedVideoS += clipSeconds(item)
            // the picture of the item is the clip's first frame
            await toStill(ctx, made.file, tmp, p)
          }
          demo = made.demo
          stockCredit = made.credit ?? stockCredit
          const info = await probe(need(ctx, 'media'), made.file, ctx.signal)
          const v = info.streams.find((x) => x.codec_type === 'video')
          const ext = path.extname(made.file).slice(1).toLowerCase() || 'mp4'
          clip = { ext, durationS: Math.round(info.durationS * 1000) / 1000, width: v?.width ?? p.width, height: v?.height ?? p.height }
          await atomicCopy(made.file, clipCache(ext))
        }
      } else if (!drawn && composed) {
        const r = await makeStill(ctx, { item, composed, references: refs.map((x) => x.file), engines: p, key, jobDir, out: tmp, size: p, kept, vision: p.vision === true, people })
        billedImages += r.images
        billedSearches += r.searches
        demo = r.demo
        stockCredit = r.stock
        degraded = r.degraded ?? degraded
        hold = r.hold === true
        note = { ...(r.engine ? { engine: r.engine } : {}), ...(r.references ? { references: r.references } : {}), ...(r.fallback ? { fallback: r.fallback } : {}), ...(r.checks ? { checks: r.checks } : {}) }
      } else if (!drawn) {
        const found = stock ? await findStock(ctx, item, prompt, p, { idempotencyKey: `stock-${key}`, dir: jobDir, ...(params.archives ? { archives: true } : {}), ...(photoPlan.has(item.id) ? { planned: photoPlan.get(item.id) } : {}) }).then(async (f) => f ?? (photoPlan.has(item.id) ? await films.frame(item).then((x) => (x ? { src: x.file, credit: x.credit, kind: 'photo' as const, demo: false } : null)) : null)) : null
        if (stock) billedSearches++
        if (found) {
          demo = found.demo
          stockCredit = found.credit
          if (found.kind === 'video') degraded = 'vidéo de banque → image fixe (le rendu des clips arrive plus tard)'
          await toStill(ctx, found.src, tmp, p)
        } else if (stock) {
          // a stock or archive item that nothing matched is a gap: flagged (the record, the meta, the log) and shown as its
          // neighbour's picture, never replaced by a generated one (Charlie, 02/11: footage and stills that exist are found)
          degraded = GAP_NOTE
          hold = true
          gaps.push(item.id)
          warn(`${item.id}: no found media for « ${prompt.slice(0, 80)} », flagged as a gap (no picture generated)`)
        } else {
          // on the brick's pinned engines (an unpinned call asks the Cloud's legacy usage, a demo on the beta), and with the
          // brick's look a composed picture rather than the search words (clonage-traduction: « Malabar arrivée poivre »)
          const pic = p.look ? composePicture(item, p.look, { people: p.people, brands: p.brands, aspect, locale: p.locale, notes: p.objectNotes }) : null
          const engines: (string | undefined)[] = p.engine ? [p.engine, ...(p.fallbacks ?? [])] : [undefined]
          let res: Awaited<ReturnType<CloudService['generateImage']>> | null = null
          let failure: unknown = null
          for (const engine of engines) {
            try {
              res = await need(ctx, 'cloud').generateImage(
                { prompt: pic?.prompt ?? prompt, width: p.width, height: p.height, ...(engine ? { engine } : {}), ...(pic?.negative ? { negative: pic.negative } : {}) },
                { idempotencyKey: engine ? `image-${key}-${engine}` : `image-${key}`, signal: ctx.signal, dir: jobDir }
              )
              break
            } catch (e) {
              if (ctx.signal.aborted) throw e
              failure = e
            }
          }
          if (!res) {
            if (!(failure instanceof EngineError) || failure.code === 'budget' || ctx.signal.aborted) throw failure
            // issue #114: every engine of this shot failed: the shot degrades (stock, else the neighbour's picture), the run goes on
            warn(`${item.id}: no engine made the picture (${failure.message.slice(0, 160)}): the shot falls back`)
            const r = await stillInstead(item, failure, tmp, key, jobDir)
            demo = r.demo
            stockCredit = r.stock
            degraded = r.degraded
            hold = r.hold
          } else {
            billedImages++
            demo = res.demo
            const src = res.files[0]
            if (!src) throw new Error(`the Cloud returned no image for ${item.id}`)
            await toStill(ctx, src, tmp, p)
          }
        }
      }
      // a hold has no picture of its own: it is filled from a neighbour below, and never cached (the next run tries again)
      if (!hold) {
        await atomicCopy(tmp, cached)
        await atomicWrite(noteFile, JSON.stringify({ demo, ...(stockCredit ? { stock: stockCredit } : {}), ...(degraded ? { degraded } : {}), ...(clip ? { clip } : {}), ...note } satisfies CacheNote))
      }
    } else if (!drawn || video) {
      const n = note0 ?? (await readNote())
      demo = n.demo
      stockCredit = n.stock
      degraded = n.degraded ?? degraded
      clip = n.clip
      note = { ...(n.engine ? { engine: n.engine } : {}), ...(n.references ? { references: n.references } : {}), ...(n.fallback ? { fallback: n.fallback } : {}), ...(n.checks ? { checks: n.checks } : {}) }
    }
    if (hold) holds.push(i)
    else {
      await copyFile(cached, out)
      files[i] = out
    }
    if (video && clip) {
      const clipOut = path.join(dir, `${String(i + 1).padStart(3, '0')}-${item.id}.${clip.ext}`)
      await copyFile(clipCache(clip.ext), clipOut)
      clipAt[i] = { file: clipOut, durationS: clip.durationS, width: clip.width, height: clip.height, demo }
    }
    record[i] = {
      itemId: item.id,
      kind: item.kind,
      file: i,
      source: drawn ? 'drawn' : 'cloud',
      demo, // drawn pictures are demos; Cloud pictures are what the Cloud says (plan §4.12)
      licence: drawn ? 'Atelier (dessin de démonstration)' : (stockCredit?.licence ?? 'fournisseur (démo)'),
      prompt,
      ...(degraded ? { degraded } : {}),
      ...(stockCredit ? { stock: stockCredit } : {}),
      ...(video ? { video: true as const } : {}),
      ...(composed && p.look?.style ? { style: p.look.style } : {}),
      ...note
    }
    progress(ctx, ++done, items.length, `${done} images sur ${items.length}`)
  }
  for (const ph of [...new Set(phase)].sort((a, b) => a - b)) {
    const now = items.map((it, i) => ({ it, i })).filter((x) => (phase[x.i] ?? 0) === ph)
    await eachLimited(now, p.parallel, async ({ it, i }) => one(it, i))
  }
  // the illustration check (avatar-qualite): each generated still against the words under its shot; under the bar, made again
  // once with the judge's prompt (the clips are made from these stills afterwards, so a bad picture never costs a clip)
  let illustration: string | null = null
  if (!drawn && fresh && p.illustrationBar !== undefined && p.illustrationBar > 0 && ctx.services.claude) {
    const firstOf = new Map<number, { item: GenItem; record: Fulfilled }>()
    const r = await illustrationPass(ctx, {
      bar: p.illustrationBar,
      items,
      files,
      skip: new Set(holds),
      parallel: p.parallel,
      remake: async (i, item) => {
        firstOf.set(i, { item: items[i] as GenItem, record: record[i] as Fulfilled })
        items[i] = item
        await one(item, i)
      },
      restore: async (i) => {
        const s = firstOf.get(i)
        if (!s) return
        items[i] = s.item
        await one(s.item, i)
        record[i] = s.record
      }
    }).catch((e: unknown) => {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `illustration check failed: ${e instanceof Error ? e.message : String(e)}` })
      return { notes: new Map<number, IllustrationNote>(), remade: new Set<number>(), line: 'illustration : non vérifiée' }
    })
    for (const [i, note] of r.notes) {
      const remadeScene = r.remade.has(i) ? (items[i] as GenItem).shot?.scene : undefined
      if (record[i]) record[i] = { ...(record[i] as Fulfilled), illustration: note, ...(remadeScene ? { scene: remadeScene } : {}) }
    }
    // a shot sharing a remade clip shows its new start still
    for (const [i, it] of items.entries()) {
      const head = it.sameAs !== undefined ? indexOf.get(it.sameAs) : undefined
      if (head !== undefined && r.remade.has(head) && files[head] && files[i]) await copyFile(files[head] as string, files[i] as string)
    }
    illustration = r.line
  }
  // two stills alike within 20 s (avatar-qualite part 3): the later one made again once with another framing, the better kept;
  // never a stop at the render for it
  let distinct: string | null = null
  if (!drawn && fresh && p.alikeWindowS !== undefined && p.alikeWindowS > 0) {
    const saved = new Map<number, { item: GenItem; record: Fulfilled }>()
    // a check never stops a run (record 0055): a failure leaves the pictures as they are, said in the log
    const r = await distinctPass(ctx, {
      windowS: p.alikeWindowS,
      items,
      files,
      skip: new Set(holds),
      remake: async (i, item) => {
        saved.set(i, { item: items[i] as GenItem, record: record[i] as Fulfilled })
        items[i] = item
        await one(item, i)
      },
      restore: async (i) => {
        const s = saved.get(i)
        if (!s) return
        items[i] = s.item
        await one(s.item, i)
        record[i] = s.record
      }
    }).catch((e: unknown) => {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `alike-pictures check failed: ${e instanceof Error ? e.message : String(e)}` })
      return { notes: new Map<number, DistinctNote>(), remade: new Set<number>(), line: null }
    })
    for (const [i, note] of r.notes) {
      const scene = r.remade.has(i) ? (items[i] as GenItem).shot?.scene : undefined
      if (record[i]) record[i] = { ...(record[i] as Fulfilled), distinct: note, ...(scene ? { scene } : {}) }
    }
    for (const [i, it] of items.entries()) {
      const head = it.sameAs !== undefined ? indexOf.get(it.sameAs) : undefined
      if (head !== undefined && r.remade.has(head) && files[head] && files[i]) await copyFile(files[head] as string, files[i] as string)
    }
    distinct = r.line
  }
  // nothing found for the whole video: before stopping, each item is searched again with a wider query (issue #96)
  if (!drawn && items.length > 0 && gaps.length === items.length) billedSearches += await rescueGaps(ctx, { items, holds, gaps, files, record, keys, dir, size: p, archives: params.archives === true })
  // holds: the nearest picture before, else after (never a black slot, R36.1), in the list's order
  for (const i of holds.sort((a, b) => a - b)) {
    let j = files.slice(0, i).findLastIndex((f) => f)
    if (j < 0) j = files.findIndex((f, k) => k > i && f)
    const from = j >= 0 ? files[j] : undefined
    // the archives were asked and did not answer (throttled, down): a transient failure to retry, not « nothing found » (issue #106)
    if (!from && gaps.length === items.length && archiveTroubleOf(ctx) > 0) throw new EngineError('transient', 'Les archives publiques n’ont pas répondu (trop sollicitées ou indisponibles) : aucun média n’a pu être cherché jusqu’au bout. Réessaie dans un instant.')
    if (!from) throw new EngineError('refused', gaps.length === items.length ? 'Aucun média n’a été trouvé pour cette vidéo (banques et archives) : rien n’est généré à leur place, élargis les recherches ou ajoute tes propres médias.' : 'Aucune image n’a pu être faite pour cette vidéo : les moteurs ont tous refusé.')
    const out = path.join(dir, `${String(i + 1).padStart(3, '0')}-${(items[i] as GenItem).id}.jpg`)
    await copyFile(from, out)
    files[i] = out
    // a hold shows its neighbour's picture: demo only when that picture is (production-17: a real run's holds badged it DÉMO)
    const rec = record[i]
    if (rec) rec.demo = record[j]?.demo ?? rec.demo
  }
  if (!drawn) {
    ctx.reportCost({
      units: [
        { unit: 'images', qty: billedImages },
        ...(billedSearches > 0 ? [{ unit: 'searches' as const, qty: billedSearches }] : []),
        ...(billedVideoS > 0 ? [{ unit: 'video_s' as const, qty: billedVideoS }] : [])
      ],
      provider: 'image'
    })
  }
  const degradations = record.filter((r) => r.degraded).length
  if (degradations > 0) warn(`${degradations} items degraded (listed in the images record)`)
  const clips = clipAt.flatMap((c, i) => (c ? [{ c, itemId: (items[i] as GenItem).id }] : []))
  const clipRecord: ClipRecord[] = clips.map(({ c, itemId }, k) => ({ itemId, file: k, durationS: c.durationS, width: c.width, height: c.height, demo: c.demo }))
  return {
    // with holds the result is provisional: the engine never reuses it, so the next run tries those pictures again (production-17)
    images: {
      files,
      value: record as unknown as Json,
      meta: { count: files.length, demo: record.some((r) => r.demo), degraded: degradations, ...(gaps.length > 0 ? { gaps } : {}), ...(holds.length > 0 ? { provisional: true } : {}), ...(illustration ? { illustration } : {}), ...(distinct ? { distinct } : {}) }
    },
    clips: {
      files: clips.map(({ c }) => c.file),
      value: clipRecord as unknown as Json,
      meta: { count: clips.length, ...(clips.length > 0 ? { demo: clips.some(({ c }) => c.demo) } : {}) }
    }
  }
}

export const visualsFulfil = defineNode({
  type: 'visuals.fulfil@1',
  inputs: {
    list: { type: 'json.genlist', required: true },
    footage: { type: 'media.clip[]', required: false },
    voice: { type: 'audio.voice', required: false }
  },
  outputs: { clips: 'media.clip[]', images: 'media.image[]' },
  params: VisualsParams,
  executors: ['local'],
  estimate: (ctx, params) => {
    const meta = ctx.inputs.list?.meta
    const num = (k: string): number => (typeof meta?.[k] === 'number' ? (meta[k] as number) : 0)
    const stillsOnly = params.stillsOnly === true
    // a presenter is made by avatar.speak; a shot that shares a clip has no still of its own
    const items = (typeof meta?.items === 'number' ? meta.items : Math.round(ctx.minutes * 12)) - num('avatarItems') - (stillsOnly ? num('sharedItems') : 0)
    // generated video is billed by the second, its picture is a frame of the clip; with a clip brick, it is a still here
    const video = stillsOnly ? 0 : num('videoItems')
    // stock items are searches, not generations (a search that finds nothing falls back to one picture, billed when it happens)
    const stock = Math.min(items, num('stock'))
    return {
      units: [
        { unit: 'images', qty: Math.max(0, items - stock - video) },
        ...(stock > 0 ? [{ unit: 'searches' as const, qty: stock }] : []),
        ...(video > 0 ? [{ unit: 'video_s' as const, qty: num('videoSeconds') }] : [])
      ],
      provider: 'image',
      durationS: 5 + items * 2 + (stillsOnly ? 0 : num('videoSeconds') * 12)
    }
  },
  run: (ctx, inputs, p) => fulfil(ctx, inputs, p, false),
  fake: async (ctx, inputs, p) => { const f = p.standIns === 'found' ? await standInsFound(ctx, inputs, p) : null; return typeof f === 'object' && f ? f : drawnInstead(await fulfil(ctx, inputs, p, true), f) }
})
