// Shared types of the analysis area (lot Z1): channel analysis, the `atelier.style/1` channel style (PLAN-V2-PRODUCTION
// §3), the pipeline library, the Builder and support requests. The zod schemas validate what crosses IPC or comes back
// from a model; the renderer only imports the types.
import { z } from 'zod'
import { BUDGET_MODE_IDS, COMPONENT_IDS, INPUT_IDS, type ComponentId, type Confidence, type GaugeMode, type GaugeResult, type InputId } from './gauge'

// ---------- atelier.style/1 ----------

const text = (max = 400) => z.string().max(max)
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const share = z.number().min(0).max(1)

export const StyleSheetSchema = z.strictObject({
  $schema: z.literal('atelier.style/1'),
  identity: z.strictObject({ name: text(120), niche: text(), language: z.string().min(2).max(10), audience: text() }),
  voice: z.strictObject({
    source: z.enum(['platform', 'own']),
    voiceId: z.string().min(1).max(80),
    speed: z.number().min(0.5).max(2),
    stability: share
  }),
  script: z.strictObject({
    structure: z.array(text(200)).max(20),
    hook: text(),
    tone: text(200),
    wpm: z.number().int().min(60).max(300),
    lengthMin: z.number().min(1).max(120),
    forbidden: z.array(text(80)).max(50),
    skills: z.array(z.enum(['hook', 'retention', 'rehooks', 'factcheck', 'cta'])).max(5)
  }),
  visuals: z.strictObject({
    mix: z.strictObject({ stock: share, ai_image: share, ai_video: share, animation: share, footage: share, avatar: share }),
    palette: z.array(hex).max(8),
    fonts: z.array(text(60)).max(4),
    grade: text(200)
  }),
  animation: z.strictObject({ kit: text(80), settings: text() }),
  captions: z.strictObject({
    preset: z.string().min(1).max(40),
    position: z.enum(['bottom', 'middle', 'top']),
    wordsPerLine: z.number().int().min(1).max(12),
    highlight: z.boolean()
  }),
  sound: z.strictObject({ mood: text(200), volume: share, duckDb: z.number().min(0).max(30) }),
  pace: z.strictObject({ cutsPerMinute: z.number().min(1).max(60), minShotS: z.number().min(0.5).max(10), maxShotS: z.number().min(1).max(30) }),
  thumbnail: z.strictObject({ layout: text(200), textRules: text(), colors: z.array(hex).max(6), face: z.boolean() }),
  packaging: z.strictObject({ titleRules: text(), descriptionTemplate: text(2000) }),
  budget: z.strictObject({ mode: z.enum(BUDGET_MODE_IDS), capCredits: z.number().min(0).max(1_000_000).nullable() })
})
export type StyleSheet = z.infer<typeof StyleSheetSchema>
export const STYLE_BLOCKS = ['identity', 'voice', 'script', 'visuals', 'animation', 'captions', 'sound', 'pace', 'thumbnail', 'packaging', 'budget'] as const
export type StyleBlock = (typeof STYLE_BLOCKS)[number]

/** The flat `$style.x` fields the template pipelines read (ENGINE-SPEC §15.8 subset), derived from a style sheet. */
export function styleFields(s: StyleSheet): Record<string, string | boolean> {
  return {
    language: s.identity.language,
    voice: s.voice.voiceId,
    pace: s.voice.speed > 1.1 ? 'fast' : s.voice.speed < 0.9 ? 'slow' : 'natural',
    captions: s.captions.preset,
    burn: true
  }
}

// ---------- analysis ----------

export interface ReferenceSummary {
  id: string
  name: string
  niche: string
  format: string
  subscribers: number
}

export interface ReferenceVideo {
  id: string
  title: string
  views: number
  durationS: number
  publishedDaysAgo: number
  outlier: boolean
}

export interface TimelineSegment {
  startS: number
  endS: number
  component: ComponentId
  note: string
}

export interface ScriptStyleCard {
  structure: string[]
  hook: string
  tone: string
  wpm: number
  lengthMin: number
  vocabulary: string
  shape: string
  skills: string[]
}

export interface FormatProfile {
  summary: string
  components: { component: ComponentId; share: number }[]
  cutsPerMinute: number
  onScreenText: string
  subtitles: string
  voice: { kind: 'synthetic' | 'human'; gender: string; energy: string; wpm: number }
  music: string
  thumbnail: string
  /** The three non-visual notes of the gauge, each with the analyst's reason. */
  notes: { voice: number; script: number; edit: number; voiceWhy: string; scriptWhy: string; editWhy: string }
  analystConfidence: Confidence
}

export const STEP_IDS = ['read', 'examples', 'video', 'script', 'synthesis'] as const
export type StepId = (typeof STEP_IDS)[number]
export interface AnalysisStep {
  id: StepId
  status: 'done' | 'waiting' | 'pending'
  /** The step's figure (videos read, examples chosen, shots found, …), shown through `analysis.step.<id>.done`. */
  n: number
}

/** What the Analyste may change, from one fenced ```atelier-adjust``` block (validated strictly). */
export const AdjustSchema = z
  .strictObject({
    answers: z.partialRecord(z.enum(INPUT_IDS), z.boolean()).optional(),
    replace: z.partialRecord(z.enum(COMPONENT_IDS), z.enum(COMPONENT_IDS)).optional(),
    mode: z.enum(BUDGET_MODE_IDS).optional(),
    maxCreditsPerVideo: z.number().int().min(0).max(1_000_000).optional(),
    minutes: z.number().min(1).max(120).optional(),
    script: z.strictObject({ length: z.enum(['court', 'moyen', 'long']).optional(), tone: z.string().min(1).max(80).optional() }).optional()
  })
  .refine((a) => Object.keys(a).length > 0, { message: 'empty adjustment' })
export type Adjust = z.infer<typeof AdjustSchema>

export interface AnalysisSummary {
  id: number
  referenceId: string
  channelName: string
  sourceLink: string
  status: 'choose_examples' | 'done'
  score: number | null
  example: boolean
  createdAt: string
}

export interface AnalysisMessage {
  id: number
  author: 'user' | 'analyst'
  body: string
  applied: Adjust | null
  createdAt: string
}

export interface CostPerMinute {
  minutes: number
  modes: Record<GaugeMode, { credits: number; perMinute: number }>
}

export interface AnalysisDetail extends AnalysisSummary {
  mode: GaugeMode
  reference: {
    id: string
    name: string
    niche: string
    format: string
    subscribers: number
    uploadsPerWeek: number
    recentVideos: ReferenceVideo[]
    proposedExamples: string[]
  }
  chosenExamples: string[]
  /** Each chosen example video with its timeline (what the colour band shows). */
  examples: { video: ReferenceVideo; segments: TimelineSegment[] }[]
  steps: AnalysisStep[]
  profile: FormatProfile | null
  scriptCard: ScriptStyleCard | null
  styleDraft: StyleSheet | null
  questions: InputId[]
  answers: Partial<Record<InputId, boolean>>
  replace: Partial<Record<ComponentId, ComponentId>>
  adjust: { maxCreditsPerVideo?: number; minutes?: number; scriptLength?: string; scriptTone?: string }
  gauge: GaugeResult | null
  cost: CostPerMinute | null
  proposedPipelineJson: string | null
  createdPipelineId: number | null
  messages: AnalysisMessage[]
}

export type StartAnalysisResult =
  | { kind: 'started'; analysis: AnalysisDetail }
  /** A real channel needs YouTube Data and video analysis through Atelier Cloud (feature `youtube-research`). */
  | { kind: 'unavailable'; link: string; references: ReferenceSummary[] }

export interface AnalysisChatResult {
  analysis: AnalysisDetail
  /** The adjustment the reply applied, or null. */
  applied: Adjust | null
  /** Set when the reply carried a block that failed validation (nothing was applied). */
  adjustRejected: boolean
}

// ---------- pipelines ----------

export const PIPELINE_ORIGINS = ['template', 'own', 'team', 'builder', 'analysis', 'import'] as const
export type PipelineOrigin = (typeof PIPELINE_ORIGINS)[number]

export interface TemplateInfo {
  id: string
  name: string
  description: string
  json: string
}

export interface LibraryPipelineRow {
  id: number
  name: string
  description: string
  origin: PipelineOrigin
  channelId: number | null
  channelName: string | null
  isDefault: boolean
  latestVersion: number
  example: boolean
  updatedAt: string
}

export interface PipelineVersionRow {
  number: number
  note: string
  createdAt: string
}

export interface LibraryPipelineDetail extends LibraryPipelineRow {
  versions: PipelineVersionRow[]
  json: string
}

/** A validation problem, translated in the renderer from its code (`analysis.val.<code>`). */
export interface PipelineProblem {
  code: string
  path: string
}

export type PipelineCheck = { ok: true; json: string; name: string } | { ok: false; problems: PipelineProblem[] }

export interface NodeCost {
  nodeId: string
  type: string
  where: string
  credits: number
  durationS: number
}

export interface PipelineCostReport {
  minutes: number
  modes: Record<GaugeMode, { credits: number; perMinute: number; durationS: number; nodes: NodeCost[] }>
}

export interface CatalogPort {
  name: string
  type: string
  required: boolean
}

export interface CatalogNode {
  type: string
  inputs: CatalogPort[]
  outputs: { name: string; type: string }[]
  executors: string[]
  defaultGate: string
  claudeRole: string | null
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

// ---------- styles ----------

export interface StyleVersionRow {
  version: number
  note: string
  createdAt: string
  example: boolean
}

export interface ChannelStyleDetail {
  channelId: number
  versions: StyleVersionRow[]
  current: StyleSheet | null
  currentVersion: number | null
  defaultPipelineId: number | null
}

// ---------- builder ----------

export interface BuilderMessage {
  id: number
  author: 'user' | 'builder'
  body: string
  outcome: 'none' | 'valid' | 'invalid'
  problems: PipelineProblem[]
  createdAt: string
}

export interface BuilderSummary {
  id: number
  title: string
  pipelineId: number | null
  analysisId: number | null
  valid: boolean
  example: boolean
  updatedAt: string
}

export interface BuilderDetail extends BuilderSummary {
  draftJson: string
  previousDraftJson: string | null
  problems: PipelineProblem[]
  cost: PipelineCostReport | null
  messages: BuilderMessage[]
}

// ---------- support ----------

export interface SupportInput {
  what: string
  links: string
  budget: string
  contact: string
  attachAnalysis: boolean
  analysisId: number | null
}

export interface SupportRequestRow extends SupportInput {
  id: number
  status: 'open' | 'closed'
  example: boolean
  createdAt: string
  closedAt: string | null
}
