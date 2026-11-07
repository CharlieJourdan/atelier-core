// Shared types of lot Z1's "runs" area: our production engine running inside the app (one row per run of a video,
// its nodes, what each node produced) and the local credits wallet. The Production screens code against these types
// through the IPC contract in `src/shared/api/runs.ts`. Every field is documented; times are ISO strings, credits are
// integers (1 credit = 0,01 €), durations are seconds.

/** Life of a run. `waiting` = a gate waits for the owner and nothing else runs; `interrupted` = the app quit (or
 *  crashed) while it ran: the UI offers "Reprendre" (`production.resume`). */
export const RUN_STATUSES = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Statuses during which an engine may be live (or must be resumed). */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting']

/** `usage_max` = the most videos for the credits (default); `qualite_max` = best quality (PLAN §1.11). */
export const RUN_BUDGET_MODES = ['usage_max', 'qualite_max'] as const
export type RunBudgetMode = (typeof RUN_BUDGET_MODES)[number]

/** `step` = pause at every gate of the pipeline ("Pas à pas"); `all` = only the owner gates (the package). */
export const RUN_GATE_MODES = ['step', 'all'] as const
export type RunGateMode = (typeof RUN_GATE_MODES)[number]

/** A node's state, as the engine reports it (ENGINE-SPEC R6.5). `cached` = reused from an earlier run, 0 credit. */
export const RUN_NODE_STATES = ['pending', 'queued', 'running', 'waiting_gate', 'done', 'error', 'cancelled', 'cached'] as const
export type RunNodeState = (typeof RUN_NODE_STATES)[number]

/** The owner's decision on a gated node. */
export type RunNodeGate = 'none' | 'waiting' | 'approved' | 'changes_requested'

/** Style overrides of one run (the template pipeline reads them through `$style.*`). All optional. */
export interface RunStyle {
  /** Platform voice id (`demo-claire`…, Atelier Cloud's catalogue). Default `demo-claire`. */
  voice?: string
  /** Several voices (docs/ENGINE-SPEC.md §19.5): character name (as in the script's `NAME:` lines) to voice id. The narrator
   *  and any character not listed use `voice`. */
  speakers?: Record<string, string>
  /** The channel voice on each voice engine (`voice:fish-s2` → that engine's voice id): a fallback engine speaks only with a
   *  clone of the channel voice (decision 0029). */
  voices?: Record<string, string>
  /** Demo only: the id of a system voice from `production.voices` to speak with (else one is picked for the language). */
  systemVoice?: string
  /** Captions preset: `classic`, `highlight` (default), `pill`, `bold-center`, `word-by-word`. */
  captions?: string
  /** Burn the captions into the picture (true) or ship them as a separate .srt only (false). */
  burn?: boolean
  /** Narration pace: `natural` (default) or `fit` (the voice is fitted to the target length). */
  pace?: string
  /** Language of the script and voice, two letters (default `fr`). */
  language?: string
}

/** What `production.start` takes. Either `videoId`, or `channelId` + `title` (a plain video row is created). */
export interface RunStartInput {
  /** A pipeline of the library (its latest version) instead of the engine's template. */
  pipelineId?: number
  videoId?: number
  channelId?: number
  /** Title of the new video when `channelId` is given (1..200 chars). */
  title?: string
  /** Topic or title given to the research node (1..2000 chars). */
  topic: string
  /** Target length in minutes, 0.5..30. */
  minutes: number
  budgetMode: RunBudgetMode
  gateMode: RunGateMode
  style?: RunStyle
  /** Per-node seed (a new seed regenerates that node and what depends on it). */
  seeds?: Record<string, number>
  /** The pipeline's other text inputs (input id → text): a person's script, the folder of gameplay clips… */
  inputs?: Record<string, string>
  /**
   * « Moteur réel » (production-16): the paid bricks go through Atelier Cloud's jobs (quote, hold, capture per job), which
   * picks the real engine or its demo per engine. Only from the owner's click (or an agent the owner approved); needs the
   * app signed in to a Cloud. Absent / false: a demo run, nothing reaches the Cloud's paid jobs.
   */
  real?: boolean
}

/** What `production.quote` takes: a topic (optional, lets cached nodes be found), length, style, optional video. */
export interface RunQuoteInput {
  /** A pipeline of the library (its latest version) instead of the engine's template. */
  pipelineId?: number
  videoId?: number
  /** The channel the video is for (without `videoId`): its style profile, when it has one, shapes the quote like the run. */
  channelId?: number
  topic?: string
  minutes: number
  style?: RunStyle
  /** Quote the run as « Moteur réel » would make it (Atelier Cloud's prices, its wallet). */
  real?: boolean
}

/** One node of a quote. */
export interface QuoteNode {
  nodeId: string
  /** Engine node type, e.g. `voice.tts@1`. */
  type: string
  /** French label (Recherche, Script, Voix…). */
  label: string
  /** Where it runs: `local` (this computer, free), `cloud`, `gpu`. */
  where: 'local' | 'cloud' | 'gpu'
  /** Credits it would cost (0 for local work and Claude Code). */
  credits: number
  /**
   * A node an LLM runs (script, director…): the team's backend (decision 0026). « mon abonnement » = 0, « crédits Atelier » = its
   * tokens in credits, « ma clé API » = 0 credits (billed on the user's key).
   */
  backend?: 'subscription' | 'credits' | 'api-key'
  /** Expected duration in seconds. */
  durationS: number
  /** Already made for this video: reused for free. */
  cached: boolean
  /** `review`/`owner`: the node stops for the owner's OK (`review` only in step mode). */
  gate: 'none' | 'review' | 'owner'
}

/** A quote in one budget mode. */
export interface QuoteMode {
  budgetMode: RunBudgetMode
  nodes: QuoteNode[]
  totalCredits: number
  /** `totalCredits` in euros (1 credit = 0,01 €). */
  totalEur: number
  /** Rough duration (sum of the nodes that will run; parallel branches overlap, so an upper bound). */
  durationS: number
  /** French warnings before anything is spent: an engine the run relies on has its key or access refused now (solidite). */
  warnings?: string[]
}

export interface RunQuote {
  pipelineId: string
  pipelineLabel: string
  pipelineVersion: number
  minutes: number
  /** True while Atelier Cloud is not connected: demo providers (template script, system voice, drawn pictures). */
  demo: boolean
  /** French sentence explaining the demo (empty when not demo). */
  demoReason: string
  /** False for a demo run: the quote is shown but nothing is held or debited ("rien n'est débité"). */
  debited: boolean
  modes: Record<RunBudgetMode, QuoteMode>
  /** The wallet now (to show "solde après"): Atelier Cloud's for a real quote. */
  balance: CreditsBalance
  /** The mode the run will use when it is known (a project's pipeline default). */
  budgetMode?: RunBudgetMode
  /** Whether « Moteur réel » can be turned on now, and why not (French, empty when it can). */
  real: { available: boolean; reason: string }
}

/** One engine a node's Atelier Cloud jobs ran on (real runs, production-16). */
export interface RunNodeEngine {
  /** The Cloud's engine id (`presenter:heygen-mcp`, `voice:ai33`… or its demo, `fake-avatar`…). */
  id: string
  /** A real provider answered (false: the Cloud's demo did). */
  real: boolean
  jobs: number
  /** Credits the Cloud took for its succeeded jobs (the real cost). */
  credits: number
}

/** One node of a run. */
export interface RunNode {
  nodeId: string
  /** Order in the pipeline (0-based, a topological order). */
  position: number
  type: string
  label: string
  state: RunNodeState
  /** 0..1 within the node. */
  progress: number
  /** The node's last progress sentence (French when the node writes French), or null. */
  step: string | null
  /** Credits quoted for this node at start (in the run's budget mode). */
  quoteCredits: number
  /** Credits really captured for this node (always 0 for a demo run). */
  credits: number
  /** The engines its Atelier Cloud jobs really used (empty for a demo run or a node that buys nothing). */
  engines: RunNodeEngine[]
  /** Fingerprint of the node's result (present once done or cached). */
  fingerprint: string | null
  /** French error when the node failed: `message` for the user, `detail` the engine's own text (may be English). */
  error: { code: string; message: string; detail: string | null } | null
  gate: RunNodeGate
  /** What gate the pipeline puts on this node. */
  gateKind: 'none' | 'review' | 'owner'
  /** The last change note sent at this node's gate. */
  changeNote: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** A run without its nodes (lists). */
export interface RunSummary {
  id: number
  videoId: number
  videoTitle: string
  channelId: number
  channelName: string
  pipelineId: string
  pipelineLabel: string
  pipelineVersion: number
  topic: string
  minutes: number
  budgetMode: RunBudgetMode
  gateMode: RunGateMode
  style: RunStyle
  status: RunStatus
  /** Made with demo providers: nothing debited, the package checklist says "ne pas publier". */
  demo: boolean
  /** « Moteur réel »: its paid bricks went through Atelier Cloud's jobs (each node's `engines` says real or demo). */
  cloud: boolean
  /** An engine is running this row right now in this app (false after a restart until resumed). */
  live: boolean
  quoteCredits: number
  spentCredits: number
  /** Global progress 0..1 (finished nodes count fully, running ones by their progress). */
  progress: number
  /** Ids of the nodes waiting at a gate. */
  waitingNodes: string[]
  /** The node running now (the "Shimmering text" line), or null. */
  current: { nodeId: string; label: string; step: string | null } | null
  /** French error of the run, or null. */
  error: string | null
  /** Ref of the final video for `production.file` (null until rendered). */
  videoFileRef: string | null
  /** Absolute folder of the upload package (null until packaged). */
  packageDir: string | null
  /** Final video duration in seconds, when known. */
  durationS: number | null
  /** How many times an engine was started for this row (start = 1, each retry/resume +1). */
  attempt: number
  /** Run this one was redone from ("Refaire pareil"), or null. */
  redoOf: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Example workspace row (show `<ExampleBadge/>`). */
  example: boolean
}

export interface RunDetail extends RunSummary {
  nodes: RunNode[]
  /** What changed the run's pipeline without anyone saying so (an option replacing a recipe's own value; solidite). */
  notes: string[]
}

export interface RunListFilter {
  videoId?: number
  channelId?: number
  status?: RunStatus | RunStatus[]
  /** Default 100, max 500. */
  limit?: number
}

/** A file produced by a node: `ref` is what `production.file(runId, ref)` accepts. */
export interface RunFileRef {
  ref: string
  name: string
  size: number
  mime: string
}

/** One word of the voice with its time in the audio (seconds). */
export interface RunWord {
  word: string
  start: number
  end: number
}

/** A shot of the director's edit plan. */
export interface RunPlanShot {
  id: string
  track: 'base' | 'overlay' | 'labels'
  start: number
  end: number
  /** `image.gen`, `stock.photo`, `stock.video`, `video.gen`, `label`, `hold`, `user.footage`. */
  kind: string
  /** Prompt, stock query or label text. */
  label: string
  /** Index of the beat (scene) it illustrates. */
  beat: number
  /** Genlist item that fills it, or null. */
  itemId: string | null
  /** Credits of its item (shared by every shot using that item: counted once in `totals`). */
  credits: number
}

/** Why `production.output` has nothing to show. */
export type RunOutputUnavailable = { kind: 'unavailable'; reason: 'example' | 'not_ready' | 'missing'; message: string }

/** What a review screen needs for one node, by kind. */
export type RunOutput =
  | RunOutputUnavailable
  | {
      kind: 'text'
      nodeId: string
      /** The brief (research) or the script. */
      text: string
      /** The version before the last change request, for a diff (null if none). */
      previous: string | null
      words: number
      /** Script outline (title, sections) when the node is the script. */
      outline: { title: string; sections: string[] } | null
      demo: boolean
    }
  | {
      kind: 'audio'
      nodeId: string
      file: RunFileRef
      durationS: number | null
      /** Voice id asked and the voice really used (system voice name in demo, `tone` without one). */
      voice: string | null
      voiceUsed: string | null
      words: RunWord[]
      demo: boolean
    }
  | {
      kind: 'editplan'
      nodeId: string
      durationS: number
      fps: number
      shots: RunPlanShot[]
      chapters: { title: string; start: number }[]
      /** Items to fetch/generate with their price. */
      items: { id: string; kind: string; prompt: string; units: number; credits: number; shotIds: string[] }[]
      totals: { credits: number; items: number; shots: number; byKind: Record<string, number> }
      captionsPreset: string
    }
  | {
      kind: 'images'
      nodeId: string
      images: { file: RunFileRef; itemId: string; beat: number | null; prompt: string; source: string; demo: boolean }[]
      demo: boolean
    }
  | {
      kind: 'captions'
      nodeId: string
      files: RunFileRef[]
      /** The .srt text (for a quick read). */
      srt: string
      preset: string | null
      burn: boolean
      cues: number
    }
  | { kind: 'music'; nodeId: string; file: RunFileRef; durationS: number | null; demo: boolean }
  | {
      kind: 'video'
      nodeId: string
      file: RunFileRef
      durationS: number | null
      width: number | null
      height: number | null
      demo: boolean
    }
  | {
      kind: 'package'
      nodeId: string
      title: string
      alternatives: string[]
      description: string
      chapters: { at: number; title: string }[]
      tags: string[]
      files: RunFileRef[]
      /** Folder with the files under their real names ("Ouvrir le dossier": `production.revealPackage`). */
      folder: string | null
      demo: boolean
    }
  | {
      kind: 'json'
      nodeId: string
      /** Output name → its value (large values may be cut) and files. */
      outputs: Record<string, { type: string; value: unknown; files: RunFileRef[] }>
    }

/** Bytes of one artefact file. */
export interface RunFile {
  name: string
  mime: string
  size: number
  bytes: Uint8Array
}

/** A finished video in the library. */
export interface LibraryItem {
  runId: number
  videoId: number
  title: string
  channelId: number
  channelName: string
  durationS: number | null
  minutes: number
  pipelineId: string
  pipelineLabel: string
  pipelineVersion: number
  budgetMode: RunBudgetMode
  totalCredits: number
  creditsByNode: { nodeId: string; label: string; credits: number }[]
  videoFileRef: string | null
  packageDir: string | null
  packageFiles: RunFileRef[]
  finishedAt: string | null
  demo: boolean
  example: boolean
}

/** A voice the engine can use on this computer. */
export interface RunVoice {
  id: string
  name: string
  /** Two-letter language. */
  language: string
  /** The operating system's own voice (demo voice of `voice.tts`). */
  system: boolean
}

export interface RunVoices {
  voices: RunVoice[]
  /** False when the system list could not be read: `voices` is then a short static fallback. */
  listed: boolean
  /** French note shown under the list. */
  note: string
}

/** Réglages › Moteur. */
export interface EngineStatus {
  ffmpeg: { found: boolean; path: string | null; version: string | null }
  ffprobe: { found: boolean; path: string | null }
  systemVoice: boolean
  platform: string
  /** The app's data folder and the production folder inside it. */
  dataDir: string
  productionDir: string
  resourcesDir: string
  resourcesFound: boolean
  /** Runs with a live engine now. */
  activeRuns: number
  activeRunIds: number[]
  /** False until lot P5: runs use the demo providers. */
  cloudConnected: boolean
  note: string
}

// ---------------------------------------------------------------------------------------------- credits (wallet)

export type CreditEntryKind = 'grant' | 'hold' | 'capture' | 'release' | 'adjust'
/** `local` = granted here (admin/tests); `simulated_purchase` = a pack "bought" without money; `example` = example workspace. */
export type CreditSource = 'local' | 'simulated_purchase' | 'example'

export interface CreditsBalance {
  /** Spendable now: total − held. */
  available: number
  /** Reserved by open holds (runs in progress). */
  held: number
  /** Owned: grants + adjustments − captures. */
  total: number
  /** Part of `total` granted by simulated purchases (never real money). */
  simulated: number
  /** Example-workspace credits: NOT in `total`/`available`, never spendable (shown apart). */
  example: number
}

export interface CreditEntry {
  id: number
  kind: CreditEntryKind
  /** Credits moved (positive; an `adjust` may be negative). */
  amount: number
  runId: number | null
  /** For capture/release: the hold they settle. */
  holdId: number | null
  source: CreditSource
  note: string | null
  createdAt: string
  example: boolean
}

export interface CreditPack {
  id: string
  credits: number
  priceEur: number
  label: string
}

export interface PurchaseResult {
  /** Always true in v2: no money moves. */
  simulated: true
  entry: CreditEntry
  balance: CreditsBalance
}
