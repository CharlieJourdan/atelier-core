// The mix of a pipeline (decision 0022, docs/specs/production-model.md §6.2): the target share of SCREEN TIME per picture
// kind, and the curve that says how the shares move along the video. Shares add to 1; moving one share rescales the others
// (R6.1). A named or explicit curve is a shape: the rows actually used are the shape rescaled so that, over the video,
// each kind gets its share (R6.2), so the opening of `hook-heavy` stays without stills whatever the stills' share.
// Pure: no I/O.
import { z } from 'zod'

/** The picture kinds a mix shares screen time between (R6.1). */
export const MIX_KINDS = ['presenter', 'clipAi', 'imageAi', 'stock', 'archive', 'userFootage', 'motion'] as const
export type MixKind = (typeof MIX_KINDS)[number]
export type Shares = Partial<Record<MixKind, number>>

/** Named curves: `flat` (the same shares all along), `hook-heavy` (pipeline-avatar.md §4, from the Headcast measure). */
export const NAMED_CURVES = ['flat', 'hook-heavy'] as const
export type NamedCurve = (typeof NAMED_CURVES)[number]

/** A row of a curve: the shares from `fromS` seconds until the next row (the first row starts at 0). */
export interface CurveRow {
  fromS: number
  shares: Shares
}

/** The `hook-heavy` shape: the opening is presenter and moving pictures only, stills grow towards the end. */
export const HOOK_HEAVY: readonly CurveRow[] = [
  { fromS: 0, shares: { presenter: 0.5, clipAi: 0.5, imageAi: 0 } },
  { fromS: 30, shares: { presenter: 0.28, clipAi: 0.6, imageAi: 0.12 } },
  { fromS: 120, shares: { presenter: 0.25, clipAi: 0.35, imageAi: 0.4 } },
  { fromS: 300, shares: { presenter: 0.26, clipAi: 0.14, imageAi: 0.6 } },
  { fromS: 600, shares: { presenter: 0.24, clipAi: 0.03, imageAi: 0.73 } }
]

/** Shares add to 1 within this tolerance (rounded shares typed by a person or an agent). */
export const SHARE_TOLERANCE = 0.005

const share = z.number().min(0).max(1)
const SharesSchema = z.strictObject({
  presenter: share.optional(),
  clipAi: share.optional(),
  imageAi: share.optional(),
  stock: share.optional(),
  archive: share.optional(),
  userFootage: share.optional(),
  motion: share.optional()
})

const sumOf = (s: Shares): number => MIX_KINDS.reduce((a, k) => a + (s[k] ?? 0), 0)

export const CurveSchema = z.union([
  z.enum(NAMED_CURVES),
  z
    .array(z.strictObject({ fromS: z.number().min(0).max(36_000), shares: SharesSchema }))
    .min(1)
    .max(24)
    .refine((rows) => rows[0]?.fromS === 0 && rows.every((r, i) => i === 0 || r.fromS > (rows[i - 1] as CurveRow).fromS), 'the rows start at 0 and go forward')
    .refine((rows) => rows.every((r) => Math.abs(sumOf(r.shares) - 1) <= SHARE_TOLERANCE), 'the shares of each row add to 1')
])
export type Curve = z.infer<typeof CurveSchema>

/**
 * What a video may cost and where the savings go first (nodes/director-budget.ts makes the curve from it, for the video's real
 * length, at the director's run and in its forecast). One of `maxCredits` (the whole video) and `maxCreditsPerMinute`.
 */
export const BudgetSchema = z.strictObject({
  maxCredits: z.number().positive().max(1_000_000).optional(),
  maxCreditsPerMinute: z.number().positive().max(10_000).optional(),
  saveFirst: z.enum(['end', 'body', 'even']).optional(),
  protect: z.array(z.enum(['hook', 'setup', 'body', 'outro'])).max(4).optional(),
  floors: z.strictObject({ presenter: share.optional(), clipAi: share.optional() }).optional(),
  hookS: z.number().min(5).max(600).optional(),
  setupS: z.number().min(10).max(3600).optional(),
  outroS: z.number().min(10).max(600).optional(),
  prices: z.strictObject({ presenterPerS: z.number().positive().optional(), clipPerS: z.number().positive().optional(), stillEach: z.number().positive().optional(), voicePerMin: z.number().min(0).optional(), fixed: z.number().min(0).optional() }).optional()
})
export type Budget = z.infer<typeof BudgetSchema>

export const MixSchema = SharesSchema.extend({
  /** A budget instead of a fixed curve: the rows are made from it for the video's length (see `BudgetSchema`). */
  budget: BudgetSchema.optional(),
  curve: CurveSchema.default('flat'),
  /** Target shot length per kind, in seconds (R6.3); unset: the base pipeline's or the channel's measured profile. */
  shotLengthS: z.strictObject({ presenter: z.number().min(0.5).max(60).optional(), clipAi: z.number().min(0.5).max(60).optional(), imageAi: z.number().min(0.5).max(60).optional(), stock: z.number().min(0.5).max(60).optional(), archive: z.number().min(0.5).max(60).optional() }).optional()
}).refine((m) => Math.abs(sumOf(m) - 1) <= SHARE_TOLERANCE, { message: 'the shares of the mix add to 1', path: ['presenter'] })
export type Mix = z.infer<typeof MixSchema>

/** The shares of a mix (its kinds only, zeros dropped). */
export function sharesOf(mix: Shares): Shares {
  const out: Shares = {}
  for (const k of MIX_KINDS) if ((mix[k] ?? 0) > 0) out[k] = mix[k]
  return out
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000

/** Rounds shares to 4 decimals and puts the rounding drift on the largest, so they add to exactly 1. */
function normalise(s: Shares): Shares {
  const total = sumOf(s)
  if (total <= 0) return {}
  const out: Shares = {}
  for (const k of MIX_KINDS) if ((s[k] ?? 0) > 0) out[k] = round4((s[k] as number) / total)
  const largest = MIX_KINDS.filter((k) => out[k] !== undefined).sort((a, b) => (out[b] as number) - (out[a] as number))[0]
  if (largest) out[largest] = round4((out[largest] as number) + 1 - sumOf(out))
  return out
}

/**
 * Sets one kind's share and rescales the others in proportion so the shares still add to 1 (R6.1). When every other
 * share is 0, the rest goes to AI stills (or to the presenter when the stills are the kind being set).
 */
export function setShare<M extends Shares>(mix: M, kind: MixKind, value: number): M {
  const v = Math.min(1, Math.max(0, value))
  const others = MIX_KINDS.filter((k) => k !== kind)
  const rest = others.reduce((a, k) => a + (mix[k] ?? 0), 0)
  const next: Shares = { [kind]: v }
  if (rest > 0) for (const k of others) next[k] = ((mix[k] ?? 0) / rest) * (1 - v)
  else if (v < 1) next[kind === 'imageAi' ? 'presenter' : 'imageAi'] = 1 - v
  const shares = normalise(next)
  const out = { ...mix } as M
  for (const k of MIX_KINDS) delete out[k]
  return { ...out, ...shares }
}

/** The shape rows of a curve (a named one, or the explicit rows). */
export function curveShape(curve: Curve): readonly CurveRow[] {
  if (curve === 'flat') return [{ fromS: 0, shares: {} }]
  if (curve === 'hook-heavy') return HOOK_HEAVY
  return curve
}

/** The length a curve is fitted on (Charlie's rule, Part D: the mix's shares « as if it were a long video », 12 min). */
export const CURVE_FIT_S = 720

/**
 * The rows the director targets for a video of `durationS` seconds: the curve's shape rescaled (iterative proportional
 * fitting) so that, weighted by time over a long video (at least CURVE_FIT_S), every kind gets the mix's share; a shorter
 * video keeps that long video's first rows (production-17: fitted on 60 s alone, a clip-heavy hook pushed the next 30 s to
 * stills only). A kind the shape does not mention is flat at its share; a kind the mix leaves at 0 disappears from every row.
 */
export function curveRows(mix: Mix, durationS: number): CurveRow[] {
  const target = sharesOf(mix)
  const kinds = MIX_KINDS.filter((k) => (target[k] ?? 0) > 0)
  const fitS = Math.max(durationS, CURVE_FIT_S)
  const shape = curveShape(mix.curve).filter((r) => r.fromS < fitS || r.fromS === 0)
  const spans = shape.map((r, i) => Math.max(0, Math.min(fitS, shape[i + 1]?.fromS ?? fitS) - r.fromS))
  const total = spans.reduce((a, b) => a + b, 0)
  if (kinds.length === 0 || total <= 0) return [{ fromS: 0, shares: target }]
  // a kind with no time in the shape starts flat at its share
  const inShape = (k: MixKind): boolean => shape.some((r, i) => (r.shares[k] ?? 0) > 0 && (spans[i] as number) > 0)
  let rows: Shares[] = shape.map((r) => {
    const s: Shares = {}
    for (const k of kinds) s[k] = inShape(k) ? (r.shares[k] ?? 0) : (target[k] as number)
    return s
  })
  for (let pass = 0; pass < 60; pass++) {
    const avg = (k: MixKind): number => rows.reduce((a, s, i) => a + (s[k] ?? 0) * (spans[i] as number), 0) / total
    const factor = Object.fromEntries(kinds.map((k) => [k, avg(k) > 0 ? (target[k] as number) / avg(k) : 1])) as Record<MixKind, number>
    rows = rows.map((s) => {
      const scaled: Shares = {}
      for (const k of kinds) scaled[k] = (s[k] ?? 0) * factor[k]
      const sum = sumOf(scaled)
      if (sum <= 0) return { ...target }
      for (const k of kinds) scaled[k] = (scaled[k] as number) / sum
      return scaled
    })
  }
  return shape.map((r, i) => ({ fromS: r.fromS, shares: normalise(rows[i] as Shares) })).filter((r) => r.fromS < durationS || r.fromS === 0)
}

/** The time-weighted shares the rows give over `durationS` (what a curve really delivers; the tests compare it to the mix). */
export function averageShares(rows: readonly CurveRow[], durationS: number): Shares {
  const out: Shares = {}
  rows.forEach((r, i) => {
    const span = Math.max(0, Math.min(durationS, rows[i + 1]?.fromS ?? durationS) - r.fromS)
    for (const k of MIX_KINDS) if (r.shares[k] !== undefined) out[k] = (out[k] ?? 0) + ((r.shares[k] as number) * span) / durationS
  })
  return out
}
