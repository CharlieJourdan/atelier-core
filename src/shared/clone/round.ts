// P6–P8 — one round (spec §2 P6–P8, §3): what was produced, the SAVED comparison (matched frame pairs, compared curves,
// defects, blind « same channel? » verdict with per-axis scores and their defects), cost and time per minute, and what
// changed vs the previous round. « A comparison that is not saved did not happen. »
import { z } from 'zod'
import { COMPARE_AXES, CompareAxisSchema, Evidence, LayoutSchema, MediaOriginSchema, head } from './common'

export const ROUND_STAGES = ['produced', 'compared', 'improved'] as const
export const ROUND_DECISIONS = ['continue', 'stop-plateau', 'stop-budget', 'stop-max-rounds', 'stop-nothing-to-fix'] as const
export const CHANGE_CAUSES = ['definition', 'brick', 'rule', 'prompt'] as const

/** Fewest matched frame pairs a comparison must save. */
export const MIN_FRAME_PAIRS = 6

/** What a round is for: `quality` rounds fix defects; `cost` rounds (after the quality plateau) try cheaper engines and
 *  settings and are kept only when no axis drops (spec §2 P8). */
export const ROUND_KINDS = ['quality', 'cost'] as const

/** One shot of our render, as the run placed it (seconds from the start of the render). */
export const OurShot = z.object({
  startS: z.number().min(0),
  lengthS: z.number().positive(),
  origin: MediaOriginSchema,
  layout: LayoutSchema,
  /** True when the shot is (or carries) a motion-design element. */
  motion: z.boolean()
})
export type OurShot = z.infer<typeof OurShot>

export const Production = z.object({
  /** The reference passage reproduced (60–180 s of a corpus video). */
  passage: z.object({ videoId: z.string().min(1), fromS: z.number().min(0), toS: z.number().min(0) }),
  videoPath: z.string().min(1),
  scriptPath: z.string().min(1),
  durationS: z.number().positive(),
  costUsd: z.number().min(0),
  makeSeconds: z.number().min(0),
  usdPerMinute: z.number().min(0),
  makeSecondsPerMinute: z.number().min(0),
  /** Run id(s) on the real engines, when there are some. */
  runs: z.array(z.string()),
  /** Our shots as the run placed them (from its edit plan), times relative to the render. P7 compares layouts, presence
   *  and motion density from it; without it those curves say « not measured on ours ». */
  timeline: z.array(OurShot).optional(),
  /** Re-render only what changed (spec §2 P8): the cache key of each brick, and which bricks this round re-ran. */
  bricks: z.object({ keys: z.record(z.string(), z.string()), rerun: z.array(z.string()), reused: z.array(z.string()) }).optional()
})
export type Production = z.infer<typeof Production>

/** Curves every comparison must measure on both videos (spec §2 P7). */
export const REQUIRED_CURVES = ['shot-length', 'layout-share', 'presence', 'motion-density', 'palette', 'pace', 'loudness'] as const
/** A review defect at or above this weight blocks showing an example. */
export const BLOCKING_DEFECT_WEIGHT = 0.8

/** What the blind judge receives: anonymous items (A, B…) mixing reference and ours, video + frames; the key that says
 *  which is which is saved in the comparison, never sent to the judge. */
export const BlindItem = z.object({ label: z.string().min(1), video: z.string().min(1), frames: z.array(z.string().min(1)).min(1) })
export type BlindItem = z.infer<typeof BlindItem>
export const BlindKey = z.record(z.string(), z.enum(['reference', 'ours']))

export const FramePair = z.object({ atS: z.number().min(0), reference: z.string().min(1), ours: z.string().min(1), sideBySide: z.string().min(1) })
export type FramePair = z.infer<typeof FramePair>

export const Defect = z.object({ axis: CompareAxisSchema, atS: z.number().min(0).nullable(), description: z.string().min(1), weight: z.number().min(0).max(1) })
export type Defect = z.infer<typeof Defect>

export const AxisScore = z.object({ axis: CompareAxisSchema, score: z.number().min(0).max(100), defects: z.array(z.string()) })
export type AxisScore = z.infer<typeof AxisScore>

export const BlindVerdict = z.object({
  /** The judge saw reference and ours mixed, without knowing which is which. */
  blind: z.literal(true),
  sameChannel: z.enum(['yes', 'no']),
  scores: z.array(AxisScore).min(1),
  reason: z.string().min(1),
  judge: z.string().min(1),
  /** What the judge's call cost (recorded in the spend ledger by the service that made it). */
  costUsd: z.number().min(0).optional()
})
export type BlindVerdict = z.infer<typeof BlindVerdict>

export const Comparison = z.object({
  pairs: z.array(FramePair).min(MIN_FRAME_PAIRS),
  /** Which anonymous item was which (the judge never saw it). */
  blindKey: BlindKey,
  curves: z.array(z.object({
    axis: CompareAxisSchema, name: z.string(), reference: z.array(z.number()), ours: z.array(z.number()), distance: z.number().min(0),
    /** How it was measured (units, bins, what could not be measured). */
    note: z.string().optional(),
    /** What each value stands for (`hook:full`, `body`…), when the vector is per part. */
    labels: z.array(z.string()).optional()
  })).min(1),
  /** The review agent's defect list (decision 0086). */
  defects: z.array(Defect),
  verdict: BlindVerdict,
  /** Path (relative to the clone folder) of the saved comparison sheet. */
  sheet: z.string().min(1),
  /** The contact sheet image: every matched pair, reference above ours, at the same moments. */
  contactSheet: z.string().min(1).optional(),
  /** The side-by-side film of the passage (reference left, ours right, our sound), when it could be made. */
  sideBySideVideo: z.string().optional()
})
export type Comparison = z.infer<typeof Comparison>

export const Change = z.object({
  cause: z.enum(CHANGE_CAUSES),
  /** A definition field path, a brick id, a rule or prompt name. */
  target: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
  why: z.string().min(1),
  /** The defects it answers. */
  fixes: z.array(z.string()),
  /** Where the reference measured the new value (a definition change with it is `measured`; one without is the improver's
   *  proposal, saved as such, never passed off as a measurement). */
  evidence: z.array(Evidence).optional()
})
export type Change = z.infer<typeof Change>

export const Round = z.object({
  ...head('round'),
  n: z.number().int().min(1),
  stage: z.enum(ROUND_STAGES),
  /** Quality (default) or cost round, set by P8 when it scores the round. */
  kind: z.enum(ROUND_KINDS).optional(),
  definitionVersion: z.number().int().min(1),
  production: Production,
  comparison: Comparison.nullable(),
  /** What changed vs the previous round (filled by P8). */
  changes: z.array(Change),
  improvedAxes: z.array(CompareAxisSchema),
  regressedAxes: z.array(CompareAxisSchema),
  decision: z.enum(ROUND_DECISIONS).nullable()
})
export type Round = z.infer<typeof Round>

/** Anonymous items for the blind judge from matched pairs; the order depends on `seed` (pure). */
export function blindItems(pairs: readonly FramePair[], referenceVideo: string, oursVideo: string, seed: number): { items: BlindItem[]; key: z.infer<typeof BlindKey> } {
  const ref = { video: referenceVideo, frames: pairs.map((p) => p.reference) }
  const ours = { video: oursVideo, frames: pairs.map((p) => p.ours) }
  const flip = seed % 2 === 1
  const [a, b] = flip ? [ours, ref] : [ref, ours]
  return { items: [{ label: 'A', ...a }, { label: 'B', ...b }], key: { A: flip ? 'ours' : 'reference', B: flip ? 'reference' : 'ours' } }
}

/** Problems of a blind verdict + key shared by P7 and P9: every axis scored, each score below 100 with its defects. */
export function verdictProblems(where: string, verdict: BlindVerdict, key: z.infer<typeof BlindKey>): string[] {
  const p: string[] = []
  for (const axis of COMPARE_AXES) if (!verdict.scores.some((s) => s.axis === axis)) p.push(`${where}: axis ${axis} not scored`)
  for (const s of verdict.scores) if (s.score < 100 && s.defects.length === 0) p.push(`${where}: ${s.axis} scored ${s.score} without its defects`)
  const roles = Object.values(key)
  if (!roles.includes('reference') || !roles.includes('ours')) p.push(`${where}: the blind key does not mix reference and ours`)
  return p
}
