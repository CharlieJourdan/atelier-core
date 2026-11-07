// The seam between the proto store and the main process: the store never imports IPC (it also runs in the web demo
// and in unit renders); the desktop app registers a driver at start-up and the store's actions use it in real mode.
import type { BlueprintApplyResult, BlueprintPlan, BlueprintStatus } from '../../../shared/blueprint'
import type { DrawingNote, PipelineDrawing } from '../../../shared/pipeline-drawing'
import type { IdeaInput, IdeaPatch, IdeaRow } from '../../../shared/api/ideas'
import type { OrchAgentPatch, OrchInboxItem, OrchMemoryItem, OrchRoutine, OrchStatus, OrchTask } from '../../../shared/api/orchestra'
import type { RevenueInput, RevenueRow } from '../../../shared/money'
import type { Idea } from '../data-brain'
import type { ProtoState } from '../store'
import type { LiveMoney } from './mapping-money'
import type { LiveVoices } from './mapping-voices'
import type { CloneVoiceRequest, CloudVoice } from '../../../shared/api/cloud'
import type { EngineAccount, InboxAnswer, InboxItem, ProtoAgent, ProtoChannel, ProtoMessage, ProtoPipeline, ProtoThread, ProtoVideo } from '../types'

export interface LiveSnapshot {
  status: OrchStatus
  channels: ProtoChannel[]
  agents: ProtoAgent[]
  videos: ProtoVideo[]
  /** The engine's pipelines (rebuilt from runs or a quote). */
  pipelines: ProtoPipeline[]
  inbox: InboxItem[]
  accounts: EngineAccount[]
  threads: ProtoThread[]
  messages: ProtoMessage[]
  /** Cerveau: the ideas board (absent when the ideas could not be read: the previous board stays). */
  ideas?: Idea[]
  /** Monétisation: the measured P&L, the spend ledger, the revenues entered (absent when they could not be read). */
  money?: LiveMoney
  /** Production > Briques and Nouvelle video: the Cloud's voices (absent when they could not be read: the previous list stays). */
  voices?: LiveVoices
  /** The published blueprint (absent when it could not be read: the previous one stays). */
  blueprint?: BlueprintStatus
}

/** Cerveau, real mode: the ideas of the database. */
export interface LiveBrainDriver {
  createIdea: (input: IdeaInput) => Promise<IdeaRow>
  updateIdea: (id: number, patch: IdeaPatch) => Promise<IdeaRow>
  deleteIdea: (id: number) => Promise<void>
  /** Asks the ideas agent for `count` ideas for a channel (a model call). */
  generateIdeas: (channelId: number, count: number) => Promise<IdeaRow[]>
  /** Creates the video of an idea and marks the idea used. */
  ideaToVideo: (id: number) => Promise<IdeaRow>
}

/** Monétisation, real mode: the revenues entered and the typed subscription prices. */
export interface LiveMoneyDriver {
  saveRevenue: (input: RevenueInput) => Promise<RevenueRow>
  deleteRevenue: (id: number) => Promise<void>
  /** Saves the typed monthly price of each AI account (`acc-live-<id>` → euros). */
  setSubscriptions: (prices: Record<string, number>) => Promise<void>
}

/** Voices, real mode: cloning a new voice from a recording (the list comes back with the next snapshot). */
export interface LiveVoicesDriver {
  clone: (request: CloneVoiceRequest) => Promise<CloudVoice>
}

export interface LiveDriver {
  load: (principalName: string) => Promise<LiveSnapshot>
  answer: (item: InboxItem, answer: InboxAnswer) => Promise<void>
  say: (state: ProtoState, threadId: string, text: string) => Promise<void>
  createAgent: (state: ProtoState, agent: Omit<ProtoAgent, 'id'>, instructions?: string) => Promise<void>
  updateAgent: (liveId: number, patch: OrchAgentPatch) => Promise<void>
  memory: (liveId: number) => Promise<OrchMemoryItem[]>
  deleteMemory: (id: number) => Promise<void>
  routines: (liveId: number) => Promise<OrchRoutine[]>
  toggleRoutine: (id: number, on: boolean) => Promise<void>
  tasks: (liveId: number) => Promise<OrchTask[]>
  inboxItem: (id: number) => Promise<OrchInboxItem | undefined>
  status: () => Promise<OrchStatus>
  tick: () => Promise<void>
  /** Sets (or clears) the publication slot of a database video: its deadline. */
  schedule: (videoId: number, deadline: string | null) => Promise<void>
  /**
   * Starts a real production run (and the video), then sets its slot when one was chosen. With a drawing, the drawing
   * is first saved as an executable library pipeline (or its next version) and the run uses it.
   */
  startRun: (input: LiveRunInput) => Promise<LiveRunResult>
  /** Cerveau's ideas board (absent in drivers that do not serve it). */
  brain?: LiveBrainDriver
  /** Monétisation's revenues and subscriptions (absent in drivers that do not serve it). */
  money?: LiveMoneyDriver
  /** Cloning a voice (absent in drivers that do not serve it). */
  voices?: LiveVoicesDriver
  /** The published blueprint on the team (absent in drivers that do not serve it). */
  blueprint?: LiveBlueprintDriver
}

/** Équipe, real mode: bring the existing agents to the published version, once the user confirmed the list. */
export interface LiveBlueprintDriver {
  plan: () => Promise<BlueprintPlan>
  apply: (version: number, agentIds: number[]) => Promise<BlueprintApplyResult>
  /** Asks the Cloud now; answers the new status. */
  refresh: () => Promise<BlueprintStatus>
}

export interface LiveRunInput {
  channelId: number
  title: string
  topic: string
  minutes: number
  /** Stop at each gate (« step ») or only at the owner's gates (« all »). */
  gateMode: 'step' | 'all'
  deadline: string | null
  /** The editor's drawing to run (absent: the engine's own pipeline). */
  drawing?: PipelineDrawing
  /** The library pipeline this drawing already became. */
  libraryId?: number
  /** A library pipeline to run as it is (the onboarding's test video); ignored when a drawing is given. */
  pipelineId?: number
  /** The pipeline's other text inputs (a person's script, the folder of gameplay clips, the channel's name). */
  inputs?: Record<string, string>
  /** The voice settings of this video: the narrator's voice id and each character's (docs/ENGINE-SPEC.md 19.5). */
  style?: { voice?: string; speakers?: Record<string, string> }
}

export interface LiveRunResult {
  /** The library pipeline the drawing became (to remember on the drawing). */
  libraryId: number | null
  /** What the engine left out of the drawing or added to it. */
  notes: DrawingNote[]
  /** The run that was started. */
  runId?: number
}

let driver: LiveDriver | null = null

export function setLiveDriver(d: LiveDriver | null): void {
  driver = d
}

export function liveDriver(): LiveDriver | null {
  return driver
}
