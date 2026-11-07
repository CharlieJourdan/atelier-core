// The motion templates' specs (docs/ENGINE-SPEC.md §25): what the director writes in the edit plan for an animated overlay and what
// `motion.render` draws. A spec is a template id and its props (zod: field limits are the template's own, a bad field is a permanent
// error that names the template and the field, never a silent truncation), plus the channel's colour. Times inside props
// (`atS`, `endS`) are seconds from the START OF THE OVERLAY, so a plan can move an overlay and keep its inside.
import { z } from 'zod'
import { BrickValue, CustomTemplateId, isCustomTemplate } from './brick'
import { Map3dProps } from './map3d'
import { PovCardProps, povTimes } from './pov'
import { StudioProps, studioProblems } from './studio'
import { ArchiveCardProps, BarsCardProps, CARD_SECONDS, ChartCardProps, DocumentCardProps, MapCardProps, PrintsCardProps, TimelineCardProps, docText, phraseSpan } from './cards'

/** The overlays (over a picture), then the documentary cards (formats/cards.ts: the shot itself, opaque, on the base track). */
export const MOTION_TEMPLATES = ['title', 'lower-third', 'figure', 'list', 'quote', 'map-pin', 'conversation', 'kinetic', 'doc-tags', 'archive', 'map', 'bars', 'timeline', 'prints', 'document', 'chart', 'map3d', 'pov', 'studio'] as const
export type MotionTemplate = (typeof MOTION_TEMPLATES)[number]

const text = (max: number) => z.string().trim().min(1).max(max)

export const TitleProps = z.object({ title: text(80), subtitle: text(100).optional(), kicker: text(40).optional() })
export const LowerThirdProps = z.object({ name: text(40), role: text(50).optional() })
export const FigureProps = z.object({
  /** The number the counter ends on (as the script says it: 12000 for « 12 000 »). */
  value: z.number().finite(),
  /** Where the count starts; default 0. */
  from: z.number().finite().default(0),
  /** Digits after the decimal comma. */
  decimals: z.number().int().min(0).max(3).default(0),
  /** Written before and after the number (« € », « % », « millions »). */
  prefix: z.string().max(6).default(''),
  suffix: z.string().max(24).default(''),
  /** What the number counts, said in the viewer's words. */
  label: text(70)
})
export const ListProps = z.object({
  heading: text(50).optional(),
  items: z
    .array(z.object({ text: text(48), /** When the item shows, seconds from the start of the overlay. Missing: spread evenly. */ atS: z.number().min(0).optional() }))
    .min(2)
    .max(6),
  /** Big numerals in front of the items (a ranking). */
  numbered: z.boolean().default(true),
  /** `desc` counts down (5, 4, 3…): a top-N reveal. */
  order: z.enum(['asc', 'desc']).default('asc')
})
export const QuoteProps = z.object({ text: text(180), attribution: text(50).optional() })
export const MapPinProps = z.object({ place: text(40), caption: text(60).optional(), region: text(30).optional() })

export const ConversationTurn = z.object({
  /** Index in `speakers`. */
  speaker: z.number().int().min(0),
  text: text(240),
  /** The bubble appears here (the first word of its line), seconds from the start of the overlay. */
  atS: z.number().min(0),
  /** The typing dots show from here (before `atS`). Missing: a short moment before. */
  typingS: z.number().min(0).optional()
})
export const ConversationProps = z
  .object({
    /** The name in the header; default: the other speakers' names. */
    title: text(40).optional(),
    speakers: z.array(z.object({ name: text(24), /** `right` = the one who writes (coloured bubbles), `left` = the others. */ side: z.enum(['left', 'right']) })).min(2).max(5),
    turns: z.array(ConversationTurn).min(1).max(60)
  })
  .superRefine((p, ctx) => {
    p.turns.forEach((t, i) => {
      if (t.speaker >= p.speakers.length) ctx.addIssue({ code: 'custom', path: ['turns', i, 'speaker'], message: 'speaker is not in the list' })
      const before = p.turns[i - 1]
      if (before && t.atS < before.atS) ctx.addIssue({ code: 'custom', path: ['turns', i, 'atS'], message: 'turns must follow the order of the voice' })
    })
  })

export const KINETIC_STYLES = ['pop', 'slam', 'stack', 'typewriter', 'highlight'] as const
/**
 * Kinetic typography (motion-montage): the spoken words set on screen, each entering ON its time. An overlay: transparent unless
 * `background` is `solid` (a dark or light slate that hides the picture); `scrim` darkens the picture behind the words.
 */
/**
 * doc-tags (documentary-2): the texts laid over an archive film, each on its word: a typed date in a black box, a big figure with what it
 * counts, a name on a torn strip, a red bar (a quote, a key phrase, a chapter's title), small typed tags, plain serif words. Two at most
 * at once; `place` moves one from its usual spot (motion/doc-tags.ts DEFAULT_PLACE).
 */
export const DOC_TAG_KINDS = ['date', 'number', 'name', 'bar', 'chapter', 'tag', 'words'] as const
export const DocTagsProps = z.object({
  tags: z
    .array(
      z.object({
        kind: z.enum(DOC_TAG_KINDS),
        text: text(60),
        sub: text(60).optional(),
        atS: z.number().min(0).max(60).optional(),
        place: z.enum(['top-left', 'top', 'bottom', 'bottom-left', 'centre']).optional()
      })
    )
    .min(1)
    .max(3)
})
export type DocTagsProps = z.infer<typeof DocTagsProps>

export const KineticProps = z
  .object({
    words: z
      .array(z.object({ text: text(24), /** The word's spoken time, seconds from the start of the overlay. */ atS: z.number().min(0), emphasis: z.boolean().default(false) }))
      .min(1)
      .max(40),
    style: z.enum(KINETIC_STYLES).default('pop'),
    position: z.enum(['center', 'lower', 'upper']).default('center'),
    background: z.enum(['none', 'scrim', 'solid']).default('none'),
    case: z.enum(['as-is', 'upper']).default('as-is'),
    /** The face: the condensed sans of the kinetic styles, or the documentary's serif (a period film's big figures). */
    face: z.enum(['sans', 'serif']).default('sans')
  })
  .superRefine((p, ctx) => {
    p.words.forEach((w, i) => {
      const before = p.words[i - 1]
      if (before && w.atS < before.atS) ctx.addIssue({ code: 'custom', path: ['words', i, 'atS'], message: 'words must follow the order of the voice' })
    })
  })
export type KineticProps = z.infer<typeof KineticProps>

const common = { accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3B82F6'), theme: z.enum(['dark', 'light']).default('dark') }

export const MotionSpec = z.discriminatedUnion('template', [
  z.object({ template: z.literal('title'), props: TitleProps, ...common }),
  z.object({ template: z.literal('lower-third'), props: LowerThirdProps, ...common }),
  z.object({ template: z.literal('figure'), props: FigureProps, ...common }),
  z.object({ template: z.literal('list'), props: ListProps, ...common }),
  z.object({ template: z.literal('quote'), props: QuoteProps, ...common }),
  z.object({ template: z.literal('map-pin'), props: MapPinProps, ...common }),
  z.object({ template: z.literal('conversation'), props: ConversationProps, ...common }),
  z.object({ template: z.literal('kinetic'), props: KineticProps, ...common }),
  z.object({ template: z.literal('doc-tags'), props: DocTagsProps, ...common }),
  z.object({ template: z.literal('archive'), props: ArchiveCardProps, ...common }),
  z.object({ template: z.literal('map'), props: MapCardProps, ...common }),
  z.object({ template: z.literal('bars'), props: BarsCardProps, ...common }),
  z.object({ template: z.literal('timeline'), props: TimelineCardProps, ...common }),
  z.object({ template: z.literal('prints'), props: PrintsCardProps, ...common }),
  z.object({ template: z.literal('document'), props: DocumentCardProps, ...common }),
  z.object({ template: z.literal('chart'), props: ChartCardProps, ...common }),
  z.object({ template: z.literal('map3d'), props: Map3dProps, ...common }),
  z.object({ template: z.literal('pov'), props: PovCardProps, ...common }),
  z.object({ template: z.literal('studio'), props: StudioProps, ...common })
])
export type MotionSpec = z.infer<typeof MotionSpec>
/** What a plan holds (props and colours as written, defaults not yet applied). */
export type MotionSpecInput = z.input<typeof MotionSpec>

/**
 * A channel's own brick (`custom:<id>`, formats/brick.ts): its values are checked against the brick's field schema where the brick is known
 * (the director, `motion.render`); the plan only knows that they are values.
 */
export const CustomMotionSpec = z.object({ template: CustomTemplateId, props: z.record(z.string(), BrickValue), ...common })
export type CustomMotionSpec = z.infer<typeof CustomMotionSpec>
/**
 * What a `motion` shot of the plan holds: one of our templates, or a custom brick. Parsed by the schema its template says (so a bad field
 * is reported with its own path, as before, not as an « invalid input » of a union).
 */
export const GraphicSpec = z.unknown().transform((v, ctx): MotionSpec | CustomMotionSpec => {
  const template = typeof v === 'object' && v !== null && 'template' in v ? (v as { template: unknown }).template : undefined
  const r = isCustomTemplate(template) ? CustomMotionSpec.safeParse(v) : MotionSpec.safeParse(v)
  if (r.success) return r.data
  for (const i of r.error.issues) ctx.addIssue({ code: 'custom', message: i.message, path: i.path as (string | number)[] })
  return z.NEVER
})
export type GraphicSpec = MotionSpec | CustomMotionSpec
export type GraphicSpecInput = MotionSpecInput | z.input<typeof CustomMotionSpec>
export const isCustomSpec = (s: GraphicSpec | GraphicSpecInput): s is CustomMotionSpec => isCustomTemplate(s.template)
/** A custom brick's own limits are checked by `motion.render`; the plan keeps it between these. */
export const CUSTOM_SECONDS = { min: 0.5, max: 30 } as const

/** Shortest and longest an overlay of each template stays on screen (seconds). A conversation is as long as its talk. */
export const MOTION_SECONDS: Record<MotionTemplate, { min: number; max: number }> = {
  title: { min: 2, max: 6 },
  'lower-third': { min: 2.5, max: 7 },
  figure: { min: 2.5, max: 8 },
  list: { min: 4, max: 20 },
  quote: { min: 3, max: 10 },
  'map-pin': { min: 2.5, max: 7 },
  conversation: { min: 3, max: 120 },
  kinetic: { min: 1.5, max: 20 },
  'doc-tags': { min: 1, max: 30 },
  ...CARD_SECONDS
}

/** Problems of a spec on screen for `seconds`, in English with the template and the field (empty = it can be drawn). */
export function checkMotion(spec: unknown, seconds: number): string[] {
  const template = typeof spec === 'object' && spec !== null && 'template' in spec ? (spec as { template: unknown }).template : undefined
  if (isCustomTemplate(template)) {
    const c = CustomMotionSpec.safeParse(spec)
    if (!c.success) return c.error.issues.map((i) => `motion ${template}: ${i.path.join('.') || 'spec'} ${i.message}`)
    if (seconds < CUSTOM_SECONDS.min - 1e-6 || seconds > CUSTOM_SECONDS.max + 1e-6) return [`motion ${template}: ${seconds.toFixed(1)} s is outside ${CUSTOM_SECONDS.min}–${CUSTOM_SECONDS.max} s`]
    return []
  }
  const r = MotionSpec.safeParse(spec)
  if (!r.success) {
    return r.error.issues.map((i) => {
      const t = typeof spec === 'object' && spec !== null && 'template' in spec ? String((spec as { template: unknown }).template) : '?'
      return `motion ${t}: ${i.path.join('.') || 'spec'} ${i.message}`
    })
  }
  const s = r.data
  const out: string[] = []
  const lim = MOTION_SECONDS[s.template]
  if (seconds < lim.min - 1e-6) out.push(`motion ${s.template}: ${seconds.toFixed(1)} s is shorter than the ${lim.min} s it needs`)
  if (seconds > lim.max + 1e-6) out.push(`motion ${s.template}: ${seconds.toFixed(1)} s is longer than the ${lim.max} s it allows`)
  if (s.template === 'figure' && s.props.value === s.props.from) out.push('motion figure: value equals from, nothing to count')
  if (s.template === 'conversation') {
    const last = s.props.turns.at(-1)
    if (last && last.atS > seconds - 0.4) out.push(`motion conversation: the last bubble (${last.atS.toFixed(1)} s) comes too late for a ${seconds.toFixed(1)} s overlay`)
  }
  if (s.template === 'list') {
    for (const [i, it] of s.props.items.entries()) if (it.atS !== undefined && it.atS > seconds - 0.8) out.push(`motion list: item ${i + 1} (${it.atS.toFixed(1)} s) comes too late for a ${seconds.toFixed(1)} s overlay`)
  }
  // a documentary card's timed parts all land while it is on screen
  const late = (what: string, t: number | undefined): void => {
    if (t !== undefined && t > seconds - 0.3) out.push(`motion ${s.template}: ${what} (${t.toFixed(1)} s) comes too late for a ${seconds.toFixed(1)} s card`)
  }
  if (s.template === 'bars') s.props.rows.forEach((r, i) => late(`row ${i + 1}`, r.atS))
  if (s.template === 'timeline') s.props.events.forEach((e, i) => late(`event ${i + 1}`, e.atS))
  if (s.template === 'map') [...s.props.regions, ...s.props.pins, ...s.props.routes, ...s.props.names].forEach((x, i) => late(`part ${i + 1}`, x.atS))
  if (s.template === 'map3d') {
    const parts = [...s.props.regions, ...s.props.pins, ...s.props.routes, ...s.props.names, ...s.props.facts]
    parts.forEach((x, i) => late(`part ${i + 1}`, x.atS))
    s.props.camera.keys?.forEach((k, i) => late(`camera key ${i + 1}`, k.atS))
  }
  if (s.template === 'prints') {
    s.props.prints.forEach((x, i) => (late(`print ${i + 1}`, x.atS), late(`label ${i + 1}`, x.labelAtS)))
    s.props.bars.forEach((x, i) => late(`bar ${i + 1}`, x.atS))
    s.props.extraTags.forEach((x, i) => late(`tag ${i + 1}`, x.atS))
  }
  if (s.template === 'archive') {
    late('punch', s.props.punchAtS)
    late('lines', s.props.linesAtS)
    late('mark', s.props.markAtS)
    if (s.props.mark && !s.props.excerpt?.includes(s.props.mark)) out.push('motion archive: the mark is not in the excerpt')
  }
  if (s.template === 'kinetic') {
    const last = s.props.words.at(-1)
    if (last && last.atS > seconds - 0.25) out.push(`motion kinetic: the last word (${last.atS.toFixed(1)} s) comes too late for a ${seconds.toFixed(1)} s overlay`)
  }
  if (s.template === 'document') {
    const { text, marks } = s.props
    marks.forEach((m, i) => {
      late(`mark ${i + 1}`, m.atS)
      if (text !== undefined && m.phrase !== undefined && !phraseSpan(text, m.phrase)) out.push(`motion document: mark ${i + 1} phrase is not in the text`)
    })
    if (text !== undefined && docText(text) === '') out.push('motion document: the text is empty')
  }
  if (s.template === 'pov') povTimes(s.props.shot).forEach((x) => late(x.what, x.atS))
  if (s.template === 'studio') out.push(...studioProblems(s.props, seconds))
  if (s.template === 'chart') {
    const p = s.props
    if (p.kind === 'line' || p.kind === 'area') {
      const values = (p.points ?? []).map((x) => x.value)
      if (values.length < 2) out.push(`motion chart: a ${p.kind} chart needs at least 2 points`)
      else if (Math.max(...values) === Math.min(...values)) out.push(`motion chart: the ${values.length} points have the same value, there is no line to draw`)
      const start = p.atS ?? 1
      if (start + p.drawS > seconds - 0.3) out.push(`motion chart: the line starts at ${start.toFixed(1)} s and takes ${p.drawS.toFixed(1)} s, too long for a ${seconds.toFixed(1)} s card`)
    }
    p.slices?.forEach((x, i) => late(`slice ${i + 1}`, x.atS))
    p.counters?.forEach((x, i) => late(`counter ${i + 1}`, x.atS))
  }
  return out
}
