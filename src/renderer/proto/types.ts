// Types of the proto data layer (2026-10-24). The new screens (dashboard, planning, production overview, team, brain,
// onboarding) read this model; it is filled with demo data today and is shaped so a real backend can fill it later
// (one channel → videos → pipeline; one agent tree per workspace). Pure types, no React.
import type { GoalGate } from '../../shared/api/autopilot'
import type { AgentLook } from '../../shared/mascot'

export type ChannelId = string
export type ChannelColor = 1 | 2 | 3 | 4 | 5 | 6

export type AutomationMode = 'auto' | 'validate' | 'human'

/** Who does each big step of a video for a channel (set in onboarding, editable per channel). */
export interface AutomationLevels {
  idea: AutomationMode
  script: AutomationMode
  production: AutomationMode
  packaging: AutomationMode
  publishing: AutomationMode
}

export interface ChannelProduct {
  kind: 'course' | 'ebook' | 'app' | 'merch' | 'sponsor' | 'affiliate'
  name: string
  url?: string
}

export interface ProtoChannel {
  id: ChannelId
  name: string
  handle: string
  color: ChannelColor
  initials: string
  niche: string
  language: 'fr' | 'en' | 'es' | 'de' | 'pt'
  format: 'long' | 'short' | 'mixed'
  /** YouTube Analytics connected through Google: real views / revenue on the dashboard. */
  connected: boolean
  subscribers: number
  views28d: number
  revenue28d: number
  /** Week-over-week change of views, in %. */
  trend: number
  cadence: string
  automation: AutomationLevels
  pipelineIds: string[]
  /** A translated channel replicates this one in another language. */
  translatedFrom?: ChannelId
  products: ChannelProduct[]
  createdDaysAgo: number
}

export type StageId =
  | 'idea'
  | 'script'
  | 'director'
  | 'assets'
  | 'voice'
  | 'edit'
  | 'packaging'
  | 'ready'
  | 'scheduled'
  | 'published'

export const STAGES: readonly StageId[] = [
  'idea',
  'script',
  'director',
  'assets',
  'voice',
  'edit',
  'packaging',
  'ready',
  'scheduled',
  'published'
]

export type VideoStatus = 'running' | 'waiting' | 'blocked' | 'done' | 'queued'

export interface WaitingFor {
  kind: 'validate' | 'input'
  label: string
}

export interface ProtoVideo {
  id: string
  channelId: ChannelId | null
  title: string
  brief: string
  format: 'long' | 'short'
  pipelineId: string
  stage: StageId
  /** 0–100, whole video. */
  progress: number
  status: VideoStatus
  waitingFor?: WaitingFor
  /** Render deadline, in days from today (negative = past). */
  dueInDays: number
  /** Publication slot, in days from today, or null when not scheduled yet. */
  publishInDays: number | null
  /** "HH:MM", local time of the slot. */
  publishTime: string
  durationSec: number
  creditsSpent: number
  creditsEstimate: number
  /** Agent currently carrying the video. */
  agentId: string
  /** Hue for the generated thumbnail placeholder. */
  thumbHue: number
  /** Real mode: no slot, so no render deadline either (the planning shows none). */
  noRenderDeadline?: true
  /** Real mode: the newest production run of the video and the state of each of its nodes. */
  liveRun?: {
    runId: number
    /** The video's id in the app's database (the publication kit on the platform is keyed by it). */
    videoId: number
    demo: boolean
    nodes: { nodeId: string; state: 'pending' | 'queued' | 'running' | 'waiting_gate' | 'done' | 'error' | 'cancelled' | 'cached'; progress: number }[]
  }
}

export type NodeKind =
  | 'idea'
  | 'script'
  | 'director'
  | 'avatar'
  | 'stock'
  | 'image-gen'
  | 'video-gen'
  | 'motion'
  | 'voice'
  | 'music'
  | 'gameplay'
  | 'card'
  | 'captions'
  | 'edit'
  | 'thumbnail'
  | 'qc'
  | 'publish'
  | 'translate'
  | 'human-input'
  | 'code'

/** Who runs a node: an agent (Claude Code / Codex), a paid API (credits), the user, or code built for the pipeline. */
export type NodeRunner = 'agent' | 'api' | 'human' | 'code'

export interface PipelineNode {
  id: string
  kind: NodeKind
  label: string
  runner: NodeRunner
  /** Provider / tool behind the node, shown in the advanced view. */
  provider: string
  detail: string
  credits: number
  minutes: number
  /** Grid position for the graph (column, row). */
  col: number
  row: number
  /** Whether the user validates this step before the next one (the pipeline default; a video may override). */
  gate?: boolean
  /** Share of the video this node covers, for asset nodes (e.g. 40 % stock, 35 % AI images). */
  share?: number
}

export type PipelineKind =
  | 'documentary'
  | 'avatar'
  | 'reddit'
  | 'top10'
  | 'commentary'
  | 'ai-story'
  | 'sms-story'
  | 'translated'

export interface ProtoPipeline {
  id: string
  name: string
  description: string
  kind: PipelineKind
  format: 'long' | 'short'
  nodes: PipelineNode[]
  edges: [string, string][]
  /** 0–100: how faithfully Atelier can replicate the reference style. */
  replicability: number
  /** Average credits for one video. */
  creditsPerVideo: number
  /** Average wall time for one video (team PC), in minutes. */
  minutesPerVideo: number
  /** Same, with cloud rendering. */
  minutesCloud: number
  basedOn?: string
  channelIds: ChannelId[]
  /** Shipped with Atelier (templates everyone starts from). */
  preset: boolean
  version: number
  /** Agent runtime share: how much runs on the user's Claude Code / Codex vs paid APIs (0–100). */
  subscriptionShare: number
  /** Real mode: the library pipeline this drawing became (it runs on the production engine). */
  libraryId?: number
}

export type AgentRole =
  | 'principal'
  | 'channel-manager'
  | 'researcher'
  | 'scriptwriter'
  | 'director'
  | 'packaging'
  | 'production-supervisor'
  | 'editor'
  | 'competitor-analyst'
  | 'voice'
  | 'qc-eye'
  | 'publisher'
  | 'pipeline-architect'
  | 'sponsor-manager'
  | 'custom'

export type AgentStatus = 'working' | 'idle' | 'sleeping' | 'waiting'
export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'codex'

export interface ProtoAgent {
  id: string
  name: string
  role: AgentRole
  channelId: ChannelId | null
  parentId: string | null
  status: AgentStatus
  task?: string
  model: ModelTier
  /** 0–100: share of its budget used today. */
  load: number
  memoryItems: number
  tasksDone7d: number
  /** Index into the agent colour pairs (primitives.AGENT_COLORS). */
  colorIndex: number
  /** The owner's choices for its mascot (colour, held accessory); absent = the defaults of its role. */
  look?: AgentLook
  /** Real mode: the agent's id in the runtime (orchestra). */
  liveId?: number
  /** Real mode: the agent's instructions in the runtime. */
  instructions?: string
  /** Real mode: monthly spend and cap of the agent, in USD. */
  spentUsdMonth?: number
}

export type ThreadKind = 'principal' | 'channel-group' | 'agent-dm' | 'video'

export interface ProtoThread {
  id: string
  /** Real mode: the chat conversation behind the thread. */
  liveConversationId?: number
  kind: ThreadKind
  title: string
  channelId?: ChannelId
  videoId?: string
  agentId?: string
  participantIds: string[]
  unread: number
}

export interface MessageCard {
  type: 'video' | 'approval' | 'task' | 'report' | 'handoff'
  title: string
  detail?: string
  videoId?: string
}

export interface ProtoMessage {
  id: string
  threadId: string
  /** An agent id, or 'user'. */
  authorId: string
  text: string
  minutesAgo: number
  card?: MessageCard
}

export type InboxKind =
  | 'validate-idea'
  | 'validate-script'
  | 'validate-director'
  | 'validate-thumbnail'
  | 'approve-publish'
  | 'upload-input'

/** Real mode: where an inbox item comes from, and what answering it calls. */
export type LiveInboxRef =
  | {
      source: 'orchestra'
      id: number
      kind: 'validate' | 'input' | 'files' | 'alert'
      body: string
      options: string[]
      taskId: number | null
      /** A validation of a video step of a channel: « Toujours valider pour ce type » can make a rule from it. */
      gate?: GoalGate | null
      series?: string | null
      channelLiveId?: number | null
    }
  | { source: 'gate'; runId: number; nodeId: string; nodeLabel: string; pipelineLabel: string; demo: boolean }

/** The user's answer to an inbox item (real mode). */
export interface InboxAnswer {
  choice?: string
  text?: string
  files?: string[]
  /** Gates: send back with a note instead of approving. */
  changes?: boolean
  /** « Toujours valider » for this gate of the channel (`series`: for its series only). */
  always?: 'type' | 'series'
}

export interface InboxItem {
  id: string
  live?: LiveInboxRef
  kind: InboxKind
  videoId: string | null
  channelId: ChannelId | null
  title: string
  detail: string
  agentId: string
  minutesAgo: number
}

export interface EngineAccount {
  id: string
  provider: 'claude-code' | 'codex' | 'atelier'
  label: string
  owner: string
  plan: string
  /** Use of the rolling 5-hour window, in %. */
  usage5h: number
  /** Use of the weekly limit, in %. */
  usageWeek: number
  status: 'ok' | 'limited' | 'off'
}

export interface TeamComputer {
  name: string
  provider: string
  specs: string
  region: string
  cpu: number
  ram: number
  diskUsedGb: number
  diskTotalGb: number
  uptimeDays: number
  jobs: { label: string; progress: number }[]
}

export interface Workspace {
  name: string
  plan: string
  credits: number
  creditsMonthly: number
  autoTopUp: boolean
  seats: number
  members: { name: string; role: 'owner' | 'admin' | 'editor'; initials: string }[]
  /** Real mode: signed in to Atelier Cloud (names, plan and credits are the account's) or offline. Absent in the demo. */
  cloud?: 'signed-in' | 'offline'
  /** Real mode, signed in: the account's address. */
  email?: string
}
