// Types shared by main and the renderer for the agent that prepares and edits pipelines (production-12, decisions 0024 and
// 0032, docs/specs/production-model.md §10, §13): the proposal (two or three variants with price and fit, the questions the
// references leave open), the pipeline's conversation with the agent, the change it proposes (a diff with Δ cost and Δ fit,
// saved as a new version only when the owner accepts) and the channels a pipeline serves with their inputs. Numbers are
// credits; the renderer never imports the engine.
import type { EstimateRange, FitDimensionId } from './estimates'
import type { RecipeDocument } from './recipes'

/** What the agent prepares a pipeline for (R13.1): an existing channel, a channel to launch from its references, a concept. */
export type AgentTarget =
  | { kind: 'channel'; channelId: number }
  | { kind: 'niche'; channelId: number }
  | { kind: 'concept'; text: string; language?: string | null }

export const VARIANT_KIND_IDS = ['faithful', 'cheap', 'premium'] as const
export type VariantKindId = (typeof VARIANT_KIND_IDS)[number]

/** One edit operation as the agent and the UI write it (`src/engine/technologies/edit-ops.ts`, 14 kinds). */
export type EditOpView = { op: string } & Record<string, unknown>

export interface VariantView {
  kind: VariantKindId
  doc: RecipeDocument
  /** The base plus these operations is the variant: the profile's, the variant's, the answers', the agent's. */
  ops: EditOpView[]
  perMinute: EstimateRange | null
  perVideo: EstimateRange | null
  fit: number | null
  /** The agent's one-line reason (empty without the agent). */
  why: string
}

export interface QuestionView {
  id: 'script' | 'sponsor' | 'captions' | 'presenter' | 'promoPlace' | 'promoMode'
  choices: string[]
  default: string
  answer: string | null
}

/** What the agent drafted on top of the code's variants (kept when the questions are answered, no new model call). */
export interface AgentDraft {
  summary: string
  why: Partial<Record<VariantKindId, string>>
  ops: Partial<Record<VariantKindId, EditOpView[]>>
}

export interface ProposalView {
  target: AgentTarget
  base: string
  /** Videos measured by the eyes the proposal reads (the channel's own, or its references'). */
  measured: number
  /** An analysis came from the Cloud's demonstration provider. */
  demo: boolean
  /** Dimensions nothing measured (the proposal guessed them). */
  unmeasured: FitDimensionId[]
  variants: VariantView[]
  recommended: VariantKindId
  questions: QuestionView[]
  /** The agent's draft (null: the code's proposal only); `agentNote` says why it is missing. */
  draft: AgentDraft | null
  agentNote: string | null
  model: string | null
  pricesAvailable: boolean
  creditEur: number
}

export interface ProposeOptions {
  answers?: Record<string, string>
  /** Ask the agent (one model call, Opus by default); false: the code's proposal only (free, instant). */
  agent?: boolean
  /** A draft the agent made earlier for the same target, applied again (answering a question needs no new call). */
  draft?: AgentDraft | null
}

export interface PipelineChangeView {
  kind: string
  brick?: string
  key?: string
  before: unknown
  after: unknown
}

export interface ChangeView {
  id: number
  status: 'pending' | 'accepted' | 'rejected' | 'replaced'
  author: 'agent' | 'team'
  note: string
  ops: EditOpView[]
  changes: PipelineChangeView[]
  perMinute: { before: EstimateRange; after: EstimateRange } | null
  fit: { before: number | null; after: number | null }
  /** The pipeline version the change was made on, and the one its acceptance saved. */
  baseVersion: number
  savedVersion: number | null
  createdAt: string
}

export interface ThreadMessageView {
  id: number
  role: 'user' | 'agent' | 'system'
  text: string
  changeId: number | null
  /** Typed problems of a refused batch (`code`, operation index, message). */
  errors: { op: number; code: string; message: string }[]
  createdAt: string
}

export interface ThreadView {
  recipeId: number
  version: number
  messages: ThreadMessageView[]
  pending: ChangeView | null
  changes: ChangeView[]
  creditEur: number
}

export interface ChannelInputView {
  input: string
  source: 'project' | 'channel' | 'fixed'
  /** For a channel input: what the channel has for it (null: nothing yet, to fill). */
  value: string | null
}

export interface AssignView {
  recipeId: number
  videoType: string
  channels: { channelId: number; name: string; inputs: ChannelInputView[] }[]
}
