// The backend contract of the one objective (docs/METHODE-REVERSE-PIPELINE.md, decision 0110): a channel or
// video link goes in, a REVERSE-ENGINEERED PIPELINE comes out — the bricks graph that makes that style, every setting with
// the measured evidence it comes from, what a human must supply (and the placeholder that stands in meanwhile), what
// cannot be made (why, and the alternatives faithful to that channel), the feasibility share from measured screen time,
// the cost and making time per minute (measured when a proof ran) and the proof itself (side by side, blind judge answer,
// defect list). Translate / adapt / bend / mix take a pipeline and return a new one. Pure schemas: no I/O.
import { z } from 'zod'
import { Evidence, FIELD_SOURCES, VIDEO_PARTS } from '../clone/common'
import { FEASIBILITY_VERDICTS, FeasibilityAlternative, SLOT_KINDS } from '../clone/feasibility'
import { AxisScore, Defect, FramePair } from '../clone/round'

export const REVERSE_SCHEMA = 'atelier.reverse-pipeline/1' as const

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the user asks: `copy` the style as it is; `translate` it into another language; `adapt` it (his topic, his
 *  instructions, same style); `bend` one axis (« more motion », « no presenter »); `mix` several references per axis. */
export const REVERSE_ACTIONS = ['copy', 'translate', 'adapt', 'bend', 'mix'] as const
export type ReverseAction = (typeof REVERSE_ACTIONS)[number]

/** The axes a mix or a bend can take from a reference (the Style Definition's top-level sections). */
export const PIPELINE_AXES = ['script', 'voice', 'presenter', 'motion', 'editing', 'sourcing', 'sound', 'captions', 'packaging'] as const
export type PipelineAxis = (typeof PIPELINE_AXES)[number]

export const ReverseLink = z.object({
  url: z.string().min(1),
  /** `video` = only this video; `channel` = latest + best performing videos. Absent: read from the URL. */
  kind: z.enum(['channel', 'video']).optional(),
  /** For a mix: the axes taken from this reference (empty = all). */
  axes: z.array(z.enum(PIPELINE_AXES)).default([])
})
export type ReverseLink = z.infer<typeof ReverseLink>

export const ReverseRequest = z.object({
  links: z.array(ReverseLink).min(1).max(6),
  action: z.enum(REVERSE_ACTIONS).default('copy'),
  /** The user's own words (« it's my channel », « only the hook style », « in French »…). Optional. */
  instructions: z.string().max(4000).default(''),
  /** Language of the videos to make (BCP-47); absent = the reference's, or the instructions say it. */
  language: z.string().min(2).optional(),
  /** Money the engine may spend to PROVE the pipeline (test renders, judges). Beyond it the engine stops and asks. */
  testBudgetUsd: z.number().positive().max(1000),
  /** What the user can supply now (absent = nothing: placeholders stand in). */
  supplies: z.object({ face: z.boolean(), voice: z.boolean(), footage: z.boolean() }).optional(),
  /** His own channel: his existing presenter and voice clones are used instead of look-alikes. */
  ownChannel: z.boolean().default(false)
})
export type ReverseRequest = z.infer<typeof ReverseRequest>

/** A transformation of an existing pipeline (translate / adapt / bend / mix). */
export const ReverseTransform = z.object({
  action: z.enum(['translate', 'adapt', 'bend', 'mix']),
  /** translate: the target language. */
  language: z.string().min(2).optional(),
  /** adapt / bend: the user's words; bend also names the axis and the setting changes. */
  instructions: z.string().max(4000).default(''),
  bend: z.array(z.object({ field: z.string().min(1), value: z.unknown() })).default([]),
  /** mix: the other pipeline and the axes taken from it. */
  mixWith: z.object({ pipelineId: z.string().min(1), axes: z.array(z.enum(PIPELINE_AXES)).min(1) }).optional(),
  /** Money allowed to re-prove the new pipeline (0 = no proof, the result says « not proven »). */
  testBudgetUsd: z.number().min(0).max(1000).default(0)
})
export type ReverseTransform = z.infer<typeof ReverseTransform>

// ── Output ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One setting of one brick, with where its value came from. A `default` source means nothing was measured: the brick's
 *  neutral behaviour, said so — never a base pipeline's look. */
export const PipelineSetting = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  source: z.enum(FIELD_SOURCES),
  /** Style Definition fields it is computed from. */
  fields: z.array(z.string().min(1)).min(1),
  evidence: z.array(Evidence).default([])
}).refine((s) => s.source !== 'measured' || s.evidence.length > 0, 'a measured setting carries its evidence')
export type PipelineSetting = z.infer<typeof PipelineSetting>

export const PipelineNode = z.object({
  /** Node id in the graph (the engine node type, or `<type>#n` when a type appears twice). */
  id: z.string().min(1),
  /** Engine technology, versioned (`director.plan@1`). */
  tech: z.string().min(1),
  role: z.string().min(1),
  /** `built`: made for this kind of style (reusable); `stand-in`: an impossible element stood in by this brick; `missing`: no
   *  engine brick makes it yet (a style P3 found not reproducible has no plan: its graph names what is missing). */
  status: z.enum(['ready', 'built', 'stand-in', 'missing']).default('ready'),
  settings: z.array(PipelineSetting)
})
export type PipelineNode = z.infer<typeof PipelineNode>

export const PipelineEdge = z.object({ from: z.string().min(1), to: z.string().min(1), carries: z.string().min(1) })

/** How one element of the style is distributed along the video (the curve, never only an average): share of screen time
 *  per part and over 10 equal windows. E.g. an avatar channel: presenter 0.7 in the hook, 0.2 at the end. */
export const Distribution = z.object({
  element: z.string().min(1),
  overall: z.number().min(0).max(1),
  byPart: z.array(z.object({ part: z.enum(VIDEO_PARTS), share: z.number().min(0).max(1) })),
  /** Ten equal windows of the video's length, start to end. */
  curve: z.array(z.number().min(0).max(1)).max(10),
  evidence: z.array(Evidence).min(1)
})
export type Distribution = z.infer<typeof Distribution>

export const HumanInput = z.object({
  slot: z.string().min(1),
  kind: z.enum(SLOT_KINDS),
  what: z.string().min(1),
  /** Share of screen time it fills (measured). */
  screenShare: z.number().min(0).max(1),
  /** The provisional stand-in used until the user supplies it (a same-type look-alike, a same-kind voice), clearly marked. */
  placeholder: z.object({ ref: z.string().min(1), description: z.string().min(1) }).nullable(),
  userSupplies: z.boolean()
})
export type HumanInput = z.infer<typeof HumanInput>

export const NotPossible = z.object({
  what: z.string().min(1),
  screenShare: z.number().min(0).max(1),
  reason: z.string().min(1),
  /** The technology that would close the gap, and what it would take. */
  technology: z.string().min(1),
  buildCostUsd: z.number().min(0).nullable(),
  importCostUsd: z.number().min(0).nullable()
})
export type NotPossible = z.infer<typeof NotPossible>

export const PipelineProof = z.object({
  /** The reference passage reproduced and our render (paths under the pipeline's folder). */
  passage: z.object({ videoId: z.string().min(1), fromS: z.number().min(0), toS: z.number().min(0) }),
  videoPath: z.string().min(1),
  /** The side-by-side film (reference | ours), when it was made. */
  sideBySideVideo: z.string().nullable(),
  pairs: z.array(FramePair),
  /** The blind judge's answer: it saw reference and ours mixed, not knowing which is which. */
  sameChannel: z.enum(['yes', 'no']),
  reason: z.string(),
  judge: z.string(),
  scores: z.array(AxisScore),
  defects: z.array(Defect),
  rounds: z.number().int().min(0),
  costUsd: z.number().min(0)
})
export type PipelineProof = z.infer<typeof PipelineProof>

export const REVERSE_STATES = ['proven', 'not-proven', 'not-reproducible', 'stopped-budget', 'failed'] as const

export const ReversePipeline = z.object({
  schema: z.literal(REVERSE_SCHEMA),
  id: z.string().min(1),
  createdAt: z.string().min(1),
  /** What it was made from: the request, or the pipeline it transforms. */
  request: ReverseRequest,
  derivedFrom: z.object({ pipelineId: z.string().min(1), transform: ReverseTransform }).nullable(),
  /** The videos read (whole) and why each was chosen. */
  corpus: z.array(z.object({ videoId: z.string().min(1), title: z.string(), durationS: z.number().min(0), why: z.string(), whole: z.boolean() })),
  state: z.enum(REVERSE_STATES),
  /** One plain sentence on what this pipeline is and the verdict (English; the UI translates by key later). */
  summary: z.string().min(1),
  feasibility: z.object({
    verdict: z.enum(FEASIBILITY_VERDICTS),
    /** Shares of the reference's MEASURED screen time made by bricks alone / by bricks + human inputs. */
    brickShare: z.number().min(0).max(1),
    reproducibleShare: z.number().min(0).max(1),
    alert: z.string().nullable()
  }),
  graph: z.object({ nodes: z.array(PipelineNode).min(1), edges: z.array(PipelineEdge) }),
  distributions: z.array(Distribution),
  humanInputs: z.array(HumanInput),
  notPossible: z.array(NotPossible),
  alternatives: z.array(FeasibilityAlternative),
  /** Measured on the proof's render when one ran, else the quote (`measured: false`). */
  cost: z.object({ usdPerMinute: z.number().min(0).nullable(), makeMinutesPerMinute: z.number().min(0).nullable(), measured: z.boolean() }),
  proof: PipelineProof.nullable(),
  /** Money spent to make and prove it. */
  spentUsd: z.number().min(0),
  /** The compiled recipe (`atelier.recette/2`) the agent team runs. */
  recipe: z.unknown().nullable(),
  /** Style Definition version it was compiled from. */
  definitionVersion: z.number().int().min(1)
})
export type ReversePipeline = z.infer<typeof ReversePipeline>

/** Where a reverse-engineering job stands. */
export const ReverseStatus = z.object({
  id: z.string().min(1),
  phase: z.string(),
  state: z.enum(['running', 'done', 'stopped', 'failed', 'idle']),
  /** Only money beyond the test budget stops the loop for the user. */
  stoppedBecause: z.string().nullable(),
  spentUsd: z.number().min(0),
  budgetUsd: z.number().min(0),
  recent: z.array(z.object({ phase: z.string(), decision: z.string(), why: z.string() }))
})
export type ReverseStatus = z.infer<typeof ReverseStatus>
