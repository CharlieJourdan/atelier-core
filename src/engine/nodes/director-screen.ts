// The mix director's settings and its targets (split out of director-mix.ts, style-markets): the screen params a pipeline sets
// (decision 0022, record 0055), the mix the director can make, the curve's rows per part of the video and the shares a track achieved.
import { z } from 'zod'
import { STYLE_BRANDS, STYLE_PEOPLE } from '../../shared/brick-styles'
import { LAYOUTS } from '../formats/directives'
import type { Shot } from '../formats/editplan'
import { FPS } from '../formats/timing'
import { MixSchema, curveRows, setShare, type CurveRow, type Mix, type MixKind, type Shares } from '../technologies/mix'
import { ILLUSTRATION_PRESETS } from './director-grammars'
import { PresenterLayouts } from './director-layouts'
import { Locale, ObjectNotes } from '../text/locale'

export { plannedLayouts } from './director-layouts'

/** Shot lengths per kind when neither the pipeline nor the channel's measure gives one (pipeline-avatar §2.4, Headcast medians). */
export const SHOT_LENGTHS = { presenter: 4, clipAi: 3.7, imageAi: 3.4, stock: 3.4, archive: 3.4 } as const
export const PICTURE_KINDS = ['clipAi', 'imageAi', 'stock', 'archive'] as const
export type PictureKind = (typeof PICTURE_KINDS)[number]

/**
 * The cadence along the video (reverse-pipeline: the channel's mean shot length measured part by part): from each row's `fromS` on,
 * every shot's target length is its kind's length (the mix director) or the rhythm's (the rhythm director) times `factor`. Absent:
 * one cadence all along, as before.
 */
export const PaceRows = z
  .array(z.strictObject({ fromS: z.number().min(0).max(36_000), factor: z.number().min(0.3).max(3) }))
  .min(1)
  .max(24)
  .refine((rows) => rows[0]?.fromS === 0 && rows.every((r, i) => i === 0 || r.fromS > (rows[i - 1] as { fromS: number }).fromS), 'the rows start at 0 and go forward')
export type PaceRows = z.infer<typeof PaceRows>

/** The shot-length factor at `t` seconds (1 without rows). */
export function paceAt(rows: PaceRows | undefined, t: number): number {
  if (!rows) return 1
  let f = 1
  for (const r of rows) if (r.fromS <= t + 1e-9) f = r.factor
  return f
}

export const ScreenParams = z.object({
  /** The pipeline's mix: shares of screen time, the curve, shot lengths per kind (decision 0022). */
  mix: MixSchema,
  /** `short`: a presenter shot per sentence or two; `stretches`: fewer, longer ones (`presenterStretchS`, the channel's measure). */
  placement: z.enum(['short', 'stretches']).default('short'),
  presenterStretchS: z.number().min(4).max(60).optional(),
  /** Presenter layouts the director may use (`split` and `pip` only where the scene pass asks for them, never in the opening). */
  layouts: z.array(z.enum(LAYOUTS)).min(1).default(['full', 'split']),
  /** Who may appear in the pictures and whether real brands may (the style's rules, options « Qui apparaît », « Marques »). */
  people: z.enum(STYLE_PEOPLE).default('not-presenter'),
  brands: z.enum(STYLE_BRANDS).default('real'),
  /** How the director must think for this channel's look (the director style's `rules`), plain English. */
  styleRules: z.string().max(4000).optional(),
  /** The pictures' style reference (`phone-real@3`), written on the timeline. */
  pictureStyle: z.string().max(60).optional(),
  // The pipeline's measured requirements (record 0055, « des réglages mesurés de la pipeline, pas des barrières du moteur »):
  // each is off unless the pipeline sets it; avatar@1 sets them from its reference videos.
  /** The longest run of presenter shots back to back (seconds), runs then end on a sentence's end; unset: no limit. */
  presenterRunMaxS: z.number().min(3).max(120).optional(),
  /** The presenter on the sentences that speak to the viewer (a talk / show sort), the pictures on what is named. */
  presenterOnTalk: z.boolean().default(false),
  /** A picture is cut this long before the word that names it (not on the function word before it); unset: on its anchor. */
  cutLeadS: z.number().min(0).max(0.5).optional(),
  /** No subject twice within this many seconds (0: only never twice in a row). */
  repeatWindowS: z.number().min(0).max(120).default(0),
  /** The pipeline's illustration preset (director-grammars.ts): its references' way of illustrating a sentence. */
  illustration: z.enum(ILLUSTRATION_PRESETS).optional(),
  /** The presenter's layouts as the references measure them (director-layouts.ts); unset: a split or an inset where the scene pass asks. */
  presenterLayouts: PresenterLayouts.optional(),
  /** Where the video's world is (text/locale.ts): its homes, equipment, brands, money and units. */
  locale: Locale.optional(),
  /** Object-accuracy notes for the subject (« condensate pipe: a thin 16 mm flexible white PVC tube »). */
  objectNotes: ObjectNotes.optional(),
  /**
   * Documentary cards (style-markets, formats/cards.ts): the scene pass may ask for maps, data cards and timelines (the mix's `motion`
   * share is their budget) and frame its archives (a print on a board, a document on paper, a caption, an old television). Off: the
   * `motion` share is shown as stills, as before.
   */
  cards: z.boolean().default(false),
  /** Where the soft transitions go: `paragraph` (a dissolve at each new paragraph, a dip at a chapter) or `sentence` (a dissolve at each new sentence: the documentary references, ≈ 40 % of their changes). */
  transitions: z.enum(['paragraph', 'sentence']).default('paragraph'),
  /** Whether a clip engine exists in this pipeline (a clip brick): `false` (set by the compiler) plans no generated clip, their share goes to AI stills (issue #114). */
  clips: z.boolean().default(true),
  /** The documentary cards' motion-design style (clonage-traduction): `dark` (the reference's) or `light` (« parchemin »). */
  cardTheme: z.enum(['dark', 'light']).default('dark')
})
export type ScreenParams = z.infer<typeof ScreenParams>

export interface Part {
  fromS: number
  toS: number
  shares: Shares
}
const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c))

/**
 * The mix the director can make: the presenter's share goes to the pictures when no brick makes a presenter; the user's
 * footage is not filled here yet (its brick comes later), its share goes to the AI stills, and so does the motion share unless the
 * pipeline makes documentary cards (`cards`: the pictures fill all the time off the presenter, the cards then take their share of it).
 */
export function directorMix(mix: Mix, hasPresenter: boolean, diag: string[], cards = false, clips = true): Mix {
  let m: Mix = { ...mix }
  if (!clips && (m.clipAi ?? 0) > 0) {
    diag.push(`mix: no clip brick, the clipAi share (${Math.round((m.clipAi ?? 0) * 100)} %) is shown as AI stills`)
    m = { ...m, clipAi: 0, imageAi: (m.imageAi ?? 0) + (m.clipAi ?? 0) }
  }
  for (const k of cards ? (['userFootage'] as const) : (['userFootage', 'motion'] as const)) {
    const v = m[k] ?? 0
    if (v > 0) {
      m = { ...m, [k]: 0, imageAi: (m.imageAi ?? 0) + v }
      diag.push(`mix: the ${k} share (${Math.round(v * 100)} %) is shown as AI stills until its brick exists`)
    }
  }
  if (!hasPresenter && (m.presenter ?? 0) > 0) {
    diag.push('mix: no presenter brick, its share goes to the pictures')
    m = setShare(m, 'presenter', 0)
  }
  return m
}

export function partsOf(rows: readonly CurveRow[], D: number): Part[] {
  const live = rows.filter((r, i) => i === 0 || r.fromS < D)
  return live.map((r, i) => ({ fromS: r.fromS, toS: Math.min(D, live[i + 1]?.fromS ?? D), shares: r.shares }))
}
/** The screen-time shares of a base track per part (avatar = presenter, generated video = clips…), against the targets. */
export function sharesByPart(shots: readonly Shot[], parts: readonly Part[]): { fromS: number; toS: number; target: Shares; achieved: Record<string, number> }[] {
  const kindOf = (s: Shot): MixKind | null =>
    s.kind === 'avatar' ? 'presenter' : s.kind === 'motion' ? (s.genItem ? 'archive' : 'motion') : s.kind === 'video.gen' ? 'clipAi' : s.kind === 'image.gen' ? 'imageAi' : s.kind === 'stock.video' ? 'stock' : s.kind === 'stock.photo' ? 'archive' : null
  return parts.map((p) => {
    const achieved: Record<string, number> = {}
    for (const s of shots) {
      if (s.track !== 'base') continue
      const k = kindOf(s)
      if (!k) continue
      achieved[k] = (achieved[k] ?? 0) + overlap(s.startFrame / FPS, s.endFrame / FPS, p.fromS, p.toS) / (p.toS - p.fromS)
    }
    return { fromS: p.fromS, toS: p.toS, target: p.shares, achieved }
  })
}

/** The rows the director targets for a voice of `D` seconds (the mix the director can make, its curve fitted). */
export function screenRows(screen: ScreenParams, hasPresenter: boolean, D: number, diag: string[]): Part[] {
  return partsOf(curveRows(directorMix(screen.mix, hasPresenter, diag, screen.cards, screen.clips), D), D)
}

/** What a prompt must respect, whatever the scene pass wrote (people and brand rules, R4.2). */
export function promptRules(s: ScreenParams): string {
  const people = s.people === 'nobody' ? ', no people' : s.people === 'not-presenter' ? ', never the presenter' : ''
  return `${people}${s.brands === 'none' ? ', no logos or brand names' : ''}`
}
