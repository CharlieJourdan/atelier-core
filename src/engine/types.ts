// Shared vocabulary of Atelier's production engine (docs/ENGINE-SPEC.md §2, §3, §6, §8). The engine is pure TypeScript:
// it may not import Electron nor anything under src/main (lint rule `atelier/engine-boundary`), so the same code runs in
// the app, the local worker, Atelier Cloud and the RunPod images.
import type { ErrorCode } from './errors'

/** Versioned node type, `name@major` (spec §2), e.g. `voice.tts@1`. */
export type NodeTypeId = `${string}@${number}`

/** Where a node runs (spec §1): this computer (free), Atelier Cloud (credits), a RunPod GPU (credits). */
export const EXECUTORS = ['local', 'cloud', 'gpu'] as const
export type Executor = (typeof EXECUTORS)[number]

/** Human validation of a node (spec §11). */
export const GATES = ['none', 'review', 'owner'] as const
export type Gate = (typeof GATES)[number]

/** The two budget modes (spec §12). */
export const BUDGET_MODES = ['qualite_max', 'usage_max'] as const
export type BudgetMode = (typeof BUDGET_MODES)[number]

/** Which gates stop a run (spec R11.4): step by step = every gate; all at once = `owner` gates only. */
export type GateMode = 'step' | 'all'

/** Base artefact types (spec §3). A `[]` suffix is a list of that type, a different type from its element. */
export const ARTEFACT_TYPES = [
  'text.brief',
  'text.script',
  'audio.voice',
  'json.words',
  'json.beats',
  'json.editplan',
  'json.genlist',
  'media.clip[]',
  'media.image[]',
  'media.graphic[]',
  'audio.music',
  'audio.sfx',
  'subs.track',
  'video.final',
  'image.thumbnail[]',
  'json.metadata',
  'json.qc',
  'package.youtube',
  // lot P4, from ENGINE-SPEC §15.5: a user's text as given, the script's beat plan, the music cue sheet
  'text.input',
  'json.outline',
  'json.soundplan',
  // production-4: the support videos of an idea, the fact-check report
  'json.support',
  'json.factcheck',
  // production-6: what the LLM director decides (never a time), and the editable timeline of the plan
  'json.directives',
  'json.timeline'
] as const
export type ArtefactType = (typeof ARTEFACT_TYPES)[number]

/** Coarse kinds of the inputs a user gives a pipeline (spec §3, last line). */
export const INPUT_KINDS = ['text', 'video', 'audio', 'image', 'file'] as const
export type InputKind = (typeof INPUT_KINDS)[number]

/** The pipeline format id (spec §5). */
export const PIPELINE_SCHEMA = 'atelier.pipeline/1'

/** Any JSON value (what a structured artefact or a param holds). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Units a node estimates its work in (spec §2, R9.1); Atelier Cloud turns them into credits. */
export const ESTIMATE_UNITS = ['chars', 'images', 'gpu_s', 'video_s', 'avatar_s', 'searches', 'watch_min', 'calls', 'tokens'] as const
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number]

/** A node's pure estimate of one run (spec §2): provider units and an expected duration. */
export interface Estimate {
  units: { unit: EstimateUnit; qty: number }[]
  provider?: string
  durationS: number
}

/** What a node reports it really used (spec R9.3, R9.6), in the same units as its estimate. */
export interface Cost {
  units: { unit: EstimateUnit; qty: number }[]
  provider?: string
}

/** Life of a node in a run (spec R6.5). */
export const NODE_STATES = ['pending', 'queued', 'running', 'waiting_gate', 'done', 'error', 'cancelled', 'cached'] as const
export type NodeState = (typeof NODE_STATES)[number]

/** Typed progress events of one node (spec §8). `retry`, `cached`, `gate` and `cancelled` complete the spec's list. */
export type NodeEvent =
  | { kind: 'start'; nodeId: string; at: number }
  | { kind: 'progress'; nodeId: string; frac: number; text?: string }
  | { kind: 'artefact'; nodeId: string; output: string; fingerprint: string }
  | { kind: 'log'; nodeId: string; level: 'info' | 'warn'; text: string }
  | { kind: 'retry'; nodeId: string; attempt: number; delayMs: number; code: ErrorCode }
  | { kind: 'done'; nodeId: string; fingerprint: string; cost?: Cost }
  | { kind: 'error'; nodeId: string; permanent: boolean; message: string; code: ErrorCode }
  | { kind: 'cancelled'; nodeId: string }
  | { kind: 'cached'; nodeId: string; fingerprint: string }
  | { kind: 'gate'; nodeId: string; gate: Exclude<Gate, 'none'>; fingerprint: string }

/** Run-level events: a node changed state, or the run itself settled. */
export type RunEvent =
  | NodeEvent
  | { kind: 'state'; nodeId: string; state: NodeState }
  | { kind: 'run'; status: RunStatus }

/** An event as delivered to listeners: numbered in emission order within its run. */
export type EngineEvent = RunEvent & { seq: number; runId: string }

/** How a run ended (or why it stopped progressing). */
export type RunStatus = 'done' | 'error' | 'cancelled'
