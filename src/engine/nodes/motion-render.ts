// `motion.render@1` (docs/ENGINE-SPEC.md §25): the animated overlays of the edit plan, drawn from OUR templates. Every `motion` shot of the
// plan (template, fields, length) becomes one transparent video file (ProRes 4444, 30 fps, the frame's size): its HTML page is photographed
// frame by frame in a headless browser (the host's `browser` service) and piped to ffmpeg. `render.assemble` lays each file over the film
// from the shot's first frame, under the captions. Local, free, real in demo mode too. Cached per graphic by the hash of its spec, size,
// length and template version: editing one graphic's text redraws only it. A browser that dies is restarted and the graphic retried; a
// template error (a field too long, a number that does not count) is permanent and names the template and the field.
// A documentary card (formats/cards.ts: archive, map, bars, timeline) is not an overlay but the base shot itself: drawn opaque (H.264, the
// promo's encoder) with its own background, from its picture (`images`) or its map, and played by `render.assemble` like a clip.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError, isAbortError } from '../errors'
import { EditPlan, type Shot } from '../formats/editplan'
import { Brick, CustomTemplateId, brickHash, customTemplate, resolveValues, type BrickValues } from '../formats/brick'
import { GraphicSpec, MOTION_TEMPLATES, MotionSpec, checkMotion, isCustomSpec, type MotionSpecInput } from '../formats/motion'
import { FPS } from '../formats/timing'
import { requireFilters } from '../media/tools'
import { MOTION_VERSION, motionHtml } from '../motion'
import { docFontCssOf, fontCssOf, lookFontCss } from '../motion/fonts'
import { LOOK_TEMPLATES, MotionLook, resolveLook } from '../motion/look'
import { renderFast } from '../motion/fast'
import { MAP_MOVE_VERSION, MapMoveProps, renderMapMove } from '../motion/map-move'
import { CARD_ENCODER, MOTION_ENCODERS, MOTION_ENCODER, renderGraphic } from '../motion/render'
import { brickLabel, drawBrick } from '../motion/brick-render'
import { CardStyle, STYLED_VERSION, isStyledTemplate, needsDisplaySerif, type StyledTemplate } from '../motion/styled'
import { POV_VERSION } from '../motion/pov-cards'
import { styledCardHtml } from '../motion/styled-cards'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { eachLimited, hashOf, progress, readValue, throwIfAborted } from './common'
import { cardAssets, isCardShot, picturesOf, translateCaptions } from './motion-cards'

/** A map card with camera keys (drawn by map-move), else null. */
function movingMap(g: GraphicSpec): { props: MapMoveProps; accent: string; theme: 'dark' | 'light' } | null {
  if (g.template !== 'map') return null
  const r = MapMoveProps.safeParse(g.props)
  return r.success && 'accent' in g ? { props: r.data, accent: g.accent, theme: g.theme } : null
}

export const MotionParams = z.object({
  /** Graphics drawn at the same time (each in its own page); the frames of one graphic are always drawn in order. */
  parallel: z.number().int().min(1).max(4).default(2),
  /**
   * The channel's approved custom bricks (§25.2), put here by the app when a run starts: data drawn in a sandboxed page, never code of the
   * app. A `custom:<id>` shot is drawn from the brick of that id; its values are checked against the brick's fields.
   */
  bricks: z.array(Brick).max(16).default([]),
  /** The video's language: a documentary card's archive caption is written in it (clonage-traduction). */
  language: z.string().max(10).optional(),
  /**
   * The fast draw (motion-montage, motion/fast.ts): JPEG frames for a card, unchanged frames photographed once, several pages per graphic.
   * The same pictures as the classic draw (false), ≈ 7–10× faster on photographic cards.
   */
  fast: z.boolean().default(true),
  /**
   * Motion blur (fast draw only): pictures averaged per frame over its 1/30 s, like a film camera's shutter (3 = the usual). Costs only
   * where things move (≈ ×2.6 on fast kinetic type, ×1.1 on a chart); 1 = none.
   */
  motionBlur: z.number().int().min(1).max(4).default(1),
  /**
   * The video's look (motion/look.ts), set by its style: `'modern'` (the templates' own look, as without it), `'period'` (ink on ivory paper,
   * a serif, a red-brown: an engraving), `'newsprint'`, or `{ preset, palette?, type?, texture? }`. A paper look draws the kinetic type and
   * the charts on its paper and the documentary cards (and the moving map) in their parchment; it is in those graphics' cache keys.
   */
  look: MotionLook.optional(),
  /**
   * A cloned channel's measured card style (motion/styled.ts, decision 0099): its palette, face, easing, texture and coverage. The
   * templates of the styled family (title, figure, list, quote, lower third, kinetic, chart) are then drawn in it instead of their own look.
   */
  style: CardStyle.optional()
})
type Params = z.infer<typeof MotionParams>

/** What `graphics` says about each file: which shot it is for and the frames it covers (the render lays it from `startFrame`). */
export const MotionRecord = z.array(
  z.object({
    shotId: z.string(),
    file: z.number().int().min(0),
    startFrame: z.number().int().min(0),
    endFrame: z.number().int().min(1),
    template: z.union([z.enum(MOTION_TEMPLATES), CustomTemplateId]),
    /** A documentary card: an opaque file that IS the base shot (the render plays it as a clip, never lays it over). */
    base: z.boolean().optional()
  })
)

const TRIES = 3

/** The longest one graphic may take to draw: 40 ms a frame is the norm, so this only catches a render stuck in the browser. */
export const graphicLimitS = (frames: number): number => Math.max(120, Math.ceil(frames * 0.5))

/**
 * One attempt of one graphic, bounded in time (solidite: a map stuck in the browser held a documentary run for over ten
 * minutes): past its limit its signal aborts and the attempt fails, retried like a crashed page; the last one fails the
 * step with the graphic's name, never a run that waits forever.
 */
export async function boundedDraw<T>(signal: AbortSignal, seconds: number, label: string, attempt: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timer = new AbortController()
  let handle: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      timer.abort()
      reject(new EngineError('stalled', `${label} : pas dessinée après ${seconds} s (essai ${attempt} sur ${TRIES})`, attempt >= TRIES))
    }, seconds * 1000)
  })
  try {
    return await Promise.race([work(AbortSignal.any([signal, timer.signal])), late])
  } finally {
    clearTimeout(handle)
  }
}

export const motionShots = (plan: EditPlan): Shot[] =>
  plan.shots.filter((s) => s.kind === 'motion' && s.graphic !== undefined).sort((a, b) => a.startFrame - b.startFrame || (a.id < b.id ? -1 : 1))

/** The film without its overlays (no browser to draw them): an empty list, a visible warning, the reason in the meta. */
function skipped(ctx: RunCtx, count: number, reason: string): NodeOutputs {
  ctx.emit({ kind: 'log', level: 'warn', text: `Animations sautées (${count}) : ${reason}. Installe Chrome ou Edge, ou fais le rendu sur l’ordinateur d’équipe.` })
  return { graphics: { files: [], value: [], meta: { count: 0, skipped: count, reason, alpha: true } } }
}

async function draw(ctx: RunCtx, inputs: ResolvedInputs, p: Params, fake = false): Promise<NodeOutputs> {
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  const shots = motionShots(plan)
  if (shots.length === 0) {
    ctx.emit({ kind: 'log', level: 'info', text: 'the plan has no animated overlay' })
    return { graphics: { files: [], value: [], meta: { count: 0, alpha: true } } }
  }
  // a graphic the template cannot draw is a permanent error that says which one, before anything is drawn
  const bricks = new Map(p.bricks.map((b) => [customTemplate(b.id), b]))
  const brickValues = new Map<string, { brick: Brick; values: BrickValues }>()
  for (const s of shots) {
    const bad = checkMotion(s.graphic, (s.endFrame - s.startFrame) / FPS)
    if (bad.length > 0) throw new EngineError('bad_input', `L’animation ${s.id} n’est pas dessinable : ${bad.join(' ; ')}`)
    const g = GraphicSpec.parse(s.graphic)
    if (!isCustomSpec(g)) continue
    const brick = bricks.get(g.template)
    if (!brick) throw new EngineError('bad_input', `L’animation ${s.id} utilise la brique ${g.template}, qui n’est pas validée pour cette chaîne.`)
    const v = resolveValues(brick, g.props)
    if (!v.ok) throw new EngineError('bad_input', `L’animation ${s.id} (brique ${brickLabel(brick)}) n’est pas dessinable : ${v.problems.join(' ; ')}`)
    brickValues.set(s.id, { brick, values: v.values })
  }
  const media = need(ctx, 'media')
  // no browser on this computer (the installed desktop app has none of its own): the film is made without its animated
  // overlays, and says so, instead of failing the whole video
  const browser = ctx.services.browser
  if (!browser) return skipped(ctx, shots.length, 'aucun navigateur sur cet ordinateur')
  const page = browser
  await requireFilters(media, MOTION_ENCODERS, ctx.signal)
  const fontCss = await fontCssOf(need(ctx, 'library').root)
  // a paper look: its display serif (Instrument Serif) beside the documentary faces, and its graphics' cache keys carry it
  const paper = resolveLook(p.look)
  // POV cards typed in the measured serif italic need it too (their type rides in each graphic's props, not in `style`)
  const povSerif = shots.some((s) => (s.graphic as { template?: string; props?: { type?: { face?: string } } } | undefined)?.template === 'pov' && (s.graphic as { props?: { type?: { face?: string } } }).props?.type?.face === 'serif-italic')
  const lookFont = paper?.type === 'serif' || needsDisplaySerif(p.style) || povSerif ? `
${await lookFontCss()}` : ''
  const lookKey = (template: string): { look?: typeof paper; styled?: { v: number; style: CardStyle }; pov?: number } => ({
    ...(p.style && isStyledTemplate(template) ? { styled: { v: STYLED_VERSION, style: p.style } } : paper && LOOK_TEMPLATES.has(template) ? { look: paper } : {}),
    // the POV cards' drawing has its own version: a change to how they are drawn redraws them, the other templates stay cached
    ...(template === 'pov' ? { pov: POV_VERSION } : {})
  })
  /** The page of a graphic: the channel's measured style for the styled family, else the template's own drawing. */
  const styledOr = (input: MotionSpecInput, c: { width: number; height: number; durationS: number; fontCss: string }, own: () => string, opaque = false): string => {
    if (!p.style || !isStyledTemplate(input.template)) return own()
    const spec = MotionSpec.parse(input)
    // a documentary card (chart) is an opaque base shot: drawn full screen on the channel's ground, never an overlay over nothing
    return styledCardHtml(spec.template as StyledTemplate, spec.props, c, opaque ? { ...p.style, fullScreen: true } : p.style)
  }
  const docFontCss = shots.some(isCardShot) ? `${await docFontCssOf(need(ctx, 'library').root)}${lookFont}` : ''
  const pictures = picturesOf(inputs.images)
  const clips = picturesOf(inputs.clips)
  if (shots.some(isCardShot)) await translateCaptions(ctx, pictures, p.language, fake)
  const cacheDir = await need(ctx, 'workspace').cache('motion')
  // a blurred graphic is another file (no blur: the keys of before)
  const blurKey = p.fast && p.motionBlur > 1 ? { blur: p.motionBlur } : {}
  const [width, height] = plan.size
  const files: string[] = new Array(shots.length)
  let cached = 0
  let drawn = 0
  let done = 0
  progress(ctx, 0, shots.length, 'Je dessine les animations')
  const drawAll = (): Promise<void> =>
    eachLimited(shots, p.parallel, async (s, i) => {
    throwIfAborted(ctx)
    const frames = s.endFrame - s.startFrame
    const custom = brickValues.get(s.id)
    const graphic = GraphicSpec.parse(s.graphic)
    const found = movingMap(graphic)
    // a paper look draws the moving map in its parchment, in the look's accent
    const moving = found && paper ? { ...found, accent: paper.accent, theme: 'light' as const } : found
    if (moving) {
      // a map whose camera goes through keys (motion-montage): the world drawn once, the camera moved by ffmpeg (motion/map-move.ts)
      const key = hashOf({ v: MOTION_VERSION, mapMove: MAP_MOVE_VERSION, spec: moving, width, height, frames, encoder: CARD_ENCODER })
      const out = path.join(cacheDir, `${key}.mp4`)
      files[i] = out
      if (existsSync(out)) cached++
      else {
        const prepare = { libraryRoot: need(ctx, 'library').root, cacheDir: await need(ctx, 'workspace').cache('maps') }
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await boundedDraw(ctx.signal, graphicLimitS(frames), `carte ${s.id}`, attempt, (signal) =>
              renderMapMove({ browser: page, media, props: moving.props, accent: moving.accent, theme: moving.theme, width, height, frames, fontCss: docFontCss, out, signal, prepare })
            )
            for (const w of r.warnings) ctx.emit({ kind: 'log', level: 'warn', text: `map ${s.id}: ${w}` })
            break
          } catch (e) {
            if (isAbortError(e) || (e instanceof EngineError && e.permanent) || attempt >= TRIES) throw e
            ctx.emit({ kind: 'log', level: 'warn', text: `map ${s.id} failed (attempt ${attempt}): ${(e as Error).message.slice(0, 300)}` })
          }
        }
        drawn++
      }
      progress(ctx, ++done, shots.length, `${done} animation${done > 1 ? 's' : ''} sur ${shots.length}`)
      return
    }
    if (isCardShot(s)) {
      // a card: its assets first (the picture, the map), named in its key; opaque H.264
      const { assets, key: made, spec } = await cardAssets(ctx, s, pictures, plan.size, { clips, fake })
      const key = hashOf({ v: MOTION_VERSION, spec, made, width, height, frames, encoder: CARD_ENCODER, ...blurKey, ...lookKey(spec.template) })
      const out = path.join(cacheDir, `${key}.mp4`)
      files[i] = out
      if (existsSync(out)) cached++
      else {
        const cardCtx = { width, height, durationS: frames / FPS, fontCss: docFontCss }
        const html = styledOr(spec, cardCtx, () => motionHtml(spec, cardCtx, assets, paper), true)
        for (let attempt = 1; ; attempt++) {
          try {
            await boundedDraw<unknown>(ctx.signal, graphicLimitS(frames), `carte ${s.id}`, attempt, (signal) =>
              p.fast
                ? renderFast({ browser: page, media, html, width, height, frames, out, signal, encoder: CARD_ENCODER, opaque: true, motionBlur: p.motionBlur })
                : renderGraphic({ browser: page, media, html, width, height, frames, out, signal, encoder: CARD_ENCODER })
            )
            break
          } catch (e) {
            if (isAbortError(e) || (e instanceof EngineError && e.permanent) || attempt >= TRIES) throw e
            ctx.emit({ kind: 'log', level: 'warn', text: `card ${s.id} failed (attempt ${attempt}): ${(e as Error).message.slice(0, 300)}` })
          }
        }
        drawn++
      }
      progress(ctx, ++done, shots.length, `${done} animation${done > 1 ? 's' : ''} sur ${shots.length}`)
      return
    }
    // a custom brick's cache key is its content hash (and version), its values and the look: a new version redraws, the same one never
    const key = custom
      ? hashOf({ v: MOTION_VERSION, brick: brickHash(custom.brick), values: custom.values, accent: graphic.accent, theme: graphic.theme, width, height, frames, encoder: MOTION_ENCODER })
      : hashOf({ v: MOTION_VERSION, spec: MotionSpec.parse(s.graphic), width, height, frames, encoder: MOTION_ENCODER, ...blurKey, ...lookKey(graphic.template) })
    const out = path.join(cacheDir, `${key}.mov`)
    files[i] = out
    if (existsSync(out)) cached++
    else if (custom) {
      for (let attempt = 1; ; attempt++) {
        try {
          const found = await boundedDraw(ctx.signal, graphicLimitS(frames), `animation ${s.id}`, attempt, (signal) =>
            drawBrick({ brick: custom.brick, values: custom.values, ctx: { width, height, durationS: frames / FPS, fontCss }, look: { accent: graphic.accent, theme: graphic.theme }, browser: page, media, frames, out, signal })
          )
          if (found.blocked.length > 0 || found.console.length > 0) ctx.emit({ kind: 'log', level: 'warn', text: `brick ${custom.brick.id}: ${[...found.console, ...found.blocked.map((u) => `blocked ${u}`)].join(' ; ').slice(0, 300)}` })
          break
        } catch (e) {
          if (isAbortError(e) || (e instanceof EngineError && e.permanent) || attempt >= TRIES) throw e
          ctx.emit({ kind: 'log', level: 'warn', text: `animation ${s.id} failed (attempt ${attempt}): ${(e as Error).message.slice(0, 300)}` })
        }
      }
      drawn++
    } else {
      const spec = MotionSpec.parse(s.graphic)
      // kinetic type is set in the documentary faces (Oswald), with Inter behind them
      const css = spec.template === 'kinetic' || (p.style && isStyledTemplate(spec.template)) || (povSerif && spec.template === 'pov') ? `${fontCss}
${await docFontCssOf(need(ctx, 'library').root)}${lookFont}` : fontCss
      const pageCtx = { width, height, durationS: frames / FPS, fontCss: css }
      const html = styledOr(spec, pageCtx, () => motionHtml(spec, pageCtx, {}, paper))
      for (let attempt = 1; ; attempt++) {
        try {
          await boundedDraw<unknown>(ctx.signal, graphicLimitS(frames), `animation ${s.id}`, attempt, (signal) =>
            p.fast ? renderFast({ browser: page, media, html, width, height, frames, out, signal, motionBlur: p.motionBlur }) : renderGraphic({ browser: page, media, html, width, height, frames, out, signal })
          )
          break
        } catch (e) {
          // a browser that is missing, a cancel or a template error is not retried; a crashed page is, with a fresh page
          if (isAbortError(e) || (e instanceof EngineError && e.permanent) || attempt >= TRIES) throw e
          ctx.emit({ kind: 'log', level: 'warn', text: `animation ${s.id} failed (attempt ${attempt}): ${(e as Error).message.slice(0, 300)}` })
        }
      }
      drawn++
    }
    progress(ctx, ++done, shots.length, `${done} animation${done > 1 ? 's' : ''} sur ${shots.length}`)
  })
  try {
    await drawAll()
  } catch (e) {
    // the browser could not be started (none found): same as no browser at all
    if (e instanceof EngineError && e.code === 'missing_tool') return skipped(ctx, shots.length, e.message)
    throw e
  }
  progress(ctx, 1, 1, 'Animations prêtes')
  return {
    graphics: {
      files,
      value: shots.map((s, i) => ({ shotId: s.id, file: i, startFrame: s.startFrame, endFrame: s.endFrame, template: (s.graphic as { template: string }).template, ...(isCardShot(s) ? { base: true } : {}) })),
      meta: { count: shots.length, drawn, cached, alpha: true, width, height, fps: FPS, codec: 'prores_4444' }
    }
  }
}

export const motionRender = defineNode({
  type: 'motion.render@1',
  inputs: {
    plan: { type: 'json.editplan', required: true, label: 'Plan de montage (les animations)' },
    // the pictures an archive card frames (documentary cards only; overlays never need them)
    images: { type: 'media.image[]', required: false, label: 'Images (cartes d’archives)' },
    // the films played inside a print (a prints board's `film`)
    clips: { type: 'media.clip[]', required: false, label: 'Films (dans une photo)' }
  },
  outputs: { graphics: 'media.graphic[]' },
  params: MotionParams,
  executors: ['local'],
  render: true,
  // about 40 ms a frame: a 5 s graphic takes ~6 s
  estimate: (ctx) => ({ units: [], durationS: 5 + ctx.minutes * 20 }),
  run: (ctx, inputs, p) => draw(ctx, inputs, p),
  fake: (ctx, inputs, p) => draw(ctx, inputs, p, true)
})
