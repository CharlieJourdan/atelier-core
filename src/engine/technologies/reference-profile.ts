// The method behind a pipeline's requirements (record 0055, Charlie 01/11: « c'est pour apporter un niveau d'exigence plutôt
// que mettre des barrières pour plus tard, et c'est vraiment propre à cette pipeline »): measure the reference videos, derive the
// pipeline's settings from the measure, render, compare the render with the reference, adjust. Nothing here is an engine limit:
// a pipeline built from other references (motion design, documentary, 3D…) gets other values, or none.
//   - `measureEditing`: the « profil mesuré » of one video from its shots (what each shows) and its word timings.
//   - `settingsFromProfile`: the settings of the director, the pictures and the clips that reproduce it.
//   - `compareProfiles`: what differs between a render and its reference, each difference in plain words.
//   - `curveFromProfile`: the mix's curve with the presenter's measured share in each window (avatar-qualite part 5).
// Pure: no I/O.
import type { PresenterLayouts } from '../nodes/director-layouts'
import { type CurveRow, MIX_KINDS, type Shares } from './mix'

/** What a reference video measures (the « profil mesuré » of a pipeline built from it). Every field is optional: unmeasured. */
export interface ReferenceProfile {
  /** Where the numbers come from. */
  source?: string
  /** The presenter's share of screen time in each window of the video that is measured (any layout): its curve. */
  presenterCurve?: CurvePoint[]
  /** The presenter's full-frame runs (shots back to back): the longest and the median, seconds. */
  presenterRunMaxS?: number
  presenterRunMedianS?: number
  /** Seconds from a picture's cut to the word that names it (median): how early a picture lands. */
  cutLeadS?: number
  /** Share of the pictures that show what the words under them say (the object, gesture, problem, place, result). */
  literalShare?: number
  /** On-screen text labels a minute. */
  labelsPerMinute?: number
  /** No subject twice within this many seconds (a choice made on the reference, not a measure). */
  repeatWindowS?: number
  /** The light and the camera of the pictures. */
  light?: 'overcast' | 'warm' | 'studio' | 'mixed'
  camera?: 'steady' | 'handheld' | 'moving'
  /** Share of the pictures in which the presenter acts the scene (style-japanese: 21–40 % in The Japanese Method). */
  presenterActs?: number
  /** The illustration check's bar a pipeline built from it keeps (0–10), and the window within which two stills must differ. */
  illustrationBar?: number
  alikeWindowS?: number
  /** The presenter's layouts: full frame before `fromS`, then the shares of its time in full frame, split screen and inset. */
  presenterLayouts?: PresenterLayouts
  /** Where the reference's world is (`fr-FR`): homes, equipment, brands, money, units (text/locale.ts). */
  locale?: string
}

/** The presenter's share of screen time from `fromS` to `toS` (null: to the end of the video). */
export interface CurvePoint {
  fromS: number
  toS: number | null
  share: number
}

/** The windows a presenter curve is measured on: the opening's two halves, then the rows of the long video's curve. */
export const CURVE_WINDOWS_S = [0, 30, 60, 120, 300, 600] as const

/** One shot of a measured video: its span, whether it is the presenter full frame, and its link to the words (when labelled). */
export interface ProfileShot {
  start: number
  end: number
  presenter: boolean
  /** The presenter on screen but not full frame (split screen, inset): counted in the curve, not in the runs. */
  withPresenter?: boolean
  /** Which of the two that is (the presenter's layouts). */
  layout?: 'split' | 'pip'
  /** `noun` | `action` | `problem` | `place` | `result` show what is said; `generic` | `unrelated` do not. */
  link?: string
  /** An on-screen text label shown in the shot. */
  label?: boolean
}

export interface ProfileWord {
  w: string
  start: number
}

const LITERAL = new Set(['noun', 'action', 'problem', 'place', 'result'])
/** French function words a picture never starts on (the first word that names comes after them). */
const FUNCTION = new Set('le la les l un une des de du d et en à au aux dans sur par pour vous on ce c ça qui que qu il elle je j est a avez avec même mais ou se s y ne n pas plus très tout cette ces son sa ses votre vos comme quand si alors donc car puis aussi'.split(' '))
const bare = (w: string): string => w.toLowerCase().replace(/^.*['’]/, '').replace(/[^a-zàâçéèêëîïôûùüÿœ0-9]/g, '')

const median = (xs: readonly number[]): number | undefined => {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)] as number
}
const round = (x: number, step: number): number => Math.round(x / step) * step

/** From this share of acting pictures the references' grammar is the presenter acting everyday scenes (`presenter-vlog`). */
export const ACTING_SHARE = 0.15
/** The clips' motion of references filmed hand-held (the camera follows the people; Headcast's is held steady). */
export const HANDHELD_CLIP_MOTION =
  'Real phone video held in the hand at eye level: the camera follows the person gently (a slow step, a small turn), the people move naturally doing what the scene says; one simple action, the place stays the same'
const STEADY_CLIP_MOTION =
  'Real phone video held steady at eye level, close to the subject: the camera barely moves; only what is already in the picture moves (the hands when they are in it, else the object, the water or the light), slowly and naturally, doing what the scene says; nobody and nothing enters the frame, no hands appear, the scene stays the same'
/** The presenter's share in each window the shots cover (at least half of it, or 30 s of the last, open one). */
function curveOf(shots: readonly ProfileShot[]): CurvePoint[] {
  const out: CurvePoint[] = []
  CURVE_WINDOWS_S.forEach((a, k) => {
    const b = CURVE_WINDOWS_S[k + 1] ?? null
    const within = (x: ProfileShot): number => Math.max(0, Math.min(b ?? Infinity, x.end) - Math.max(a, x.start))
    const covered = shots.reduce((s, x) => s + within(x), 0)
    if (covered < (b === null ? 30 : (b - a) / 2)) return
    const on = shots.reduce((s, x) => s + (x.presenter || x.withPresenter ? within(x) : 0), 0)
    out.push({ fromS: a, toS: b, share: Math.round((on / covered) * 100) / 100 })
  })
  return out
}

/** The presenter's layouts (pure): from the first split or inset shot on, each layout's share of the presenter's time. */
function layoutsOf(shots: readonly ProfileShot[]): PresenterLayouts | undefined {
  const first = shots.find((s) => s.layout !== undefined)
  if (!first) return undefined
  const time = { full: 0, split: 0, pip: 0 }
  for (const s of shots) {
    const k = s.presenter ? 'full' : s.layout
    if (k && s.start >= first.start) time[k] += s.end - s.start
  }
  const all = time.full + time.split + time.pip
  const r2 = (x: number): number => Math.round((x / all) * 100) / 100
  const split = r2(time.split)
  const pip = r2(time.pip)
  return { fromS: Math.floor(first.start), full: Math.round((1 - split - pip) * 100) / 100, split, pip }
}

/** The profile of one video from its shots and words (what a pipeline built from it should reproduce). */
export function measureEditing(shots: readonly ProfileShot[], words: readonly ProfileWord[]): ReferenceProfile {
  const sorted = [...shots].sort((a, b) => a.start - b.start)
  const runs: number[] = []
  let run: { start: number; end: number } | null = null
  for (const s of sorted) {
    if (!s.presenter) {
      if (run) runs.push(run.end - run.start)
      run = null
      continue
    }
    if (run && Math.abs(run.end - s.start) < 0.05) run.end = s.end
    else {
      if (run) runs.push(run.end - run.start)
      run = { start: s.start, end: s.end }
    }
  }
  if (run) runs.push(run.end - run.start)
  const pictures = sorted.filter((s) => !s.presenter)
  const leads: number[] = []
  for (const s of pictures) {
    const k = words.findIndex((w) => w.start >= s.start - 0.25)
    if (k < 0) continue
    const named = words.findIndex((w, i) => i >= k && i <= k + 4 && bare(w.w).length > 2 && !FUNCTION.has(bare(w.w)))
    if (named >= 0) leads.push((words[named] as ProfileWord).start - s.start)
  }
  const linked = pictures.filter((s) => s.link !== undefined)
  const minutes = sorted.length > 0 ? ((sorted.at(-1) as ProfileShot).end - (sorted[0] as ProfileShot).start) / 60 : 0
  const lead = median(leads)
  const curve = curveOf(sorted)
  const layouts = layoutsOf(sorted)
  return {
    ...(layouts ? { presenterLayouts: layouts } : {}),
    ...(curve.length > 0 ? { presenterCurve: curve } : {}),
    ...(runs.length > 0 ? { presenterRunMaxS: Math.max(...runs), presenterRunMedianS: median(runs) as number } : {}),
    ...(lead !== undefined ? { cutLeadS: Math.max(0, lead) } : {}),
    ...(linked.length > 0 ? { literalShare: linked.filter((s) => LITERAL.has(s.link as string)).length / linked.length } : {}),
    ...(minutes > 0 && sorted.some((s) => s.label !== undefined) ? { labelsPerMinute: sorted.filter((s) => s.label).length / minutes } : {})
  }
}

/** The settings of a pipeline's bricks that reproduce a profile: brick → setting → value. Unmeasured: left unset (no limit). */
export function settingsFromProfile(p: ReferenceProfile): Record<'director.plan' | 'visuals.fulfil' | 'clip.make', Record<string, unknown>> {
  const literal = (p.literalShare ?? 0) >= 0.8
  const acting = (p.presenterActs ?? 0) >= ACTING_SHARE
  return {
    'director.plan': {
      ...(p.presenterRunMaxS !== undefined ? { presenterRunMaxS: Math.max(3, Math.floor(p.presenterRunMaxS * 2) / 2) } : {}),
      ...(p.cutLeadS !== undefined ? { cutLeadS: Math.min(0.5, round(p.cutLeadS, 0.05)) } : {}),
      ...(p.repeatWindowS !== undefined ? { repeatWindowS: p.repeatWindowS } : {}),
      ...(p.labelsPerMinute !== undefined ? { labelsPerMin: Math.round(p.labelsPerMinute) } : {}),
      // a reference that shows what its words say gets its literal grammar, and its presenter on the talk sentences; one whose
      // presenter acts the scenes (in warm daylight, hand-held) gets that grammar instead
      ...(literal && !acting ? { illustration: 'reference-literal', presenterOnTalk: true } : acting ? { illustration: 'presenter-vlog' } : {}),
      ...(p.presenterLayouts ? { presenterLayouts: p.presenterLayouts, layouts: (['full', 'split', 'pip'] as const).filter((k) => k === 'full' || (p.presenterLayouts as PresenterLayouts)[k] > 0) } : {}),
      ...(p.locale ? { locale: p.locale } : {})
    },
    'visuals.fulfil': {
      ...(p.illustrationBar !== undefined ? { illustrationBar: p.illustrationBar } : {}),
      ...(p.alikeWindowS !== undefined ? { alikeWindowS: p.alikeWindowS } : {}),
      ...(p.locale ? { locale: p.locale } : {})
    },
    'clip.make': {
      ...(p.camera === 'steady' ? { clipMotion: STEADY_CLIP_MOTION } : p.camera === 'handheld' ? { clipMotion: HANDHELD_CLIP_MOTION } : {})
    }
  }
}

/**
 * The curve that gives the presenter its measured share in each measured window: `shape`'s rows (the pipeline's curve, its
 * mix's shares when it is flat) cut at the windows, the presenter's share replaced and the other kinds rescaled to the rest.
 * Past the measured windows the shape goes on unchanged. The rows are a shape: `curveRows` fits them to the mix (a short video
 * takes the long video's first rows, production-17).
 */
export function curveFromProfile(points: readonly CurvePoint[], shape: readonly CurveRow[]): CurveRow[] | null {
  if (points.length === 0 || shape.length === 0) return null
  const cuts = [...new Set([0, ...shape.map((r) => r.fromS), ...points.flatMap((p) => [p.fromS, ...(p.toS === null ? [] : [p.toS])])])].sort((a, b) => a - b)
  return cuts.map((fromS) => {
    const row = [...shape].reverse().find((r) => r.fromS <= fromS) ?? (shape[0] as CurveRow)
    const p = points.find((q) => q.fromS <= fromS && (q.toS === null || fromS < q.toS))
    return { fromS, shares: p ? withPresenter(row.shares, p.share) : { ...row.shares } }
  })
}

/** `shares` with the presenter at `p` and the other kinds scaled to `1 − p` (stills take it all when there are none). */
function withPresenter(shares: Shares, p: number): Shares {
  const others = MIX_KINDS.filter((k) => k !== 'presenter' && (shares[k] ?? 0) > 0)
  const rest = others.reduce((a, k) => a + (shares[k] as number), 0)
  const out: Shares = { presenter: p }
  if (rest > 0) for (const k of others) out[k] = ((shares[k] as number) / rest) * (1 - p)
  else out.imageAi = 1 - p
  const r4 = (x: number): number => Math.round(x * 10_000) / 10_000
  for (const k of MIX_KINDS) if (out[k] !== undefined) out[k] = r4(out[k] as number)
  const largest = MIX_KINDS.filter((k) => out[k] !== undefined).sort((a, b) => (out[b] as number) - (out[a] as number))[0]
  if (largest) out[largest] = r4((out[largest] as number) + 1 - MIX_KINDS.reduce((a, k) => a + (out[k] ?? 0), 0))
  return out
}

/** One difference between a render and its reference. */
export interface ProfileGap {
  field: keyof ReferenceProfile
  reference: number | string
  render: number | string
  /** In French, for the owner. */
  text: string
}

/** What differs between a render's profile and its reference's, beyond a tolerance per measure (the « compare » step). */
export function compareProfiles(reference: ReferenceProfile, render: ReferenceProfile): ProfileGap[] {
  const gaps: ProfileGap[] = []
  const num = (field: 'presenterRunMaxS' | 'presenterRunMedianS' | 'cutLeadS' | 'literalShare' | 'labelsPerMinute', tol: number, text: (r: number, m: number) => string): void => {
    const r = reference[field]
    const m = render[field]
    if (r === undefined || m === undefined || Math.abs(r - m) <= tol) return
    gaps.push({ field, reference: r, render: m, text: text(r, m) })
  }
  num('presenterRunMaxS', 1, (r, m) => `présentateur d'affilée : ${m.toFixed(1)} s au plus, la référence ${r.toFixed(1)} s`)
  num('presenterRunMedianS', 1.5, (r, m) => `plan de présentateur typique : ${m.toFixed(1)} s, la référence ${r.toFixed(1)} s`)
  num('cutLeadS', 0.1, (r, m) => `l'image arrive ${m.toFixed(2)} s avant le mot qu'elle montre, la référence ${r.toFixed(2)} s`)
  num('literalShare', 0.1, (r, m) => `${Math.round(m * 100)} % des images montrent ce qui est dit, la référence ${Math.round(r * 100)} %`)
  num('labelsPerMinute', 0.5, (r, m) => `${m.toFixed(1)} texte(s) à l'écran par minute, la référence ${r.toFixed(1)}`)
  for (const r of reference.presenterCurve ?? []) {
    const m = render.presenterCurve?.find((x) => x.fromS === r.fromS)
    if (!m || Math.abs(m.share - r.share) <= 0.1) continue
    const span = r.toS === null ? `après ${r.fromS} s` : `de ${r.fromS} à ${r.toS} s`
    gaps.push({ field: 'presenterCurve', reference: r.share, render: m.share, text: `présentateur ${span} : ${Math.round(m.share * 100)} % du temps, la référence ${Math.round(r.share * 100)} %` })
  }
  return gaps
}
