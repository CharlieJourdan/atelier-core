// The IPC contract between main and renderer, split into one file per module (core, app, settings, llm, spend,
// workflow, chat, group, views, agents) so parallel lots do not edit the same file. Every method callable over
// `atelier:call` is listed in `ApiContract` with its argument tuple and result type; main implements
// `ApiHandlers`, the renderer calls through `AtelierBridge`. A wrong method name, argument or result use fails
// typecheck on both sides. Importing `shared/api` still gives everything, as before the split.

import type { AgentsContract } from './agents'
import type { AppContract } from './app'
import type { ChatContract } from './chat'
import type { CloudContract } from './cloud'
import type { GroupContract } from './group'
import type { ViewId } from './core'
import type { LlmContract } from './llm'
import type { ProductionContract } from './production'
import type { SettingsContract } from './settings'
import type { SpendContract } from './spend'
import type { ViewsContract } from './views'
import type { WorkflowContract } from './workflow'
import type { RunsContract } from './runs'
import type { AnalysisContract } from './analysis'
import type { MoneyContract } from './money'
import type { ToolsContract } from './tools'
import type { TeamContract } from './team'
import type { HomeContract } from './home'
import type { IdeasContract } from './ideas'
import type { ExampleContract } from './example'
import type { OrchestraContract } from './orchestra'
import type { DiscordContract } from './discord'
import type { BrainContract } from './brain'
import type { EyesContract } from './eyes'
import type { UpdateContract } from './update'
import type { ChannelLifeContract } from './channel-life'
import type { GoogleContract } from './google'
import type { BricksContract } from './bricks'
import type { RecipesContract } from './recipes'
import type { EnginesContract } from './engines'
import type { BrickStylesContract } from './brick-styles'
import type { ChannelVoicesContract } from './channel-voices'
import type { ChannelPresentersContract } from './channel-presenters'
import type { ChannelSponsorContract } from './channel-sponsors'
import type { ChannelClipsContract } from './channel-clips'
import type { ProjectsContract } from './projects'
import type { AutopilotContract } from './autopilot'
import type { EstimatesContract } from './estimates'
import type { PipelineAgentContract } from './pipeline-agent'
import type { StyleContract } from './style-agent'
import type { CloneContract } from './clone'
import type { ReverseContract } from './reverse'
import type { OrdersContract } from './orders'
import type { PreviewsContract } from './previews'
import type { GraphContract } from './graph'
import { AGENTS_METHODS } from './agents'
import { APP_METHODS } from './app'
import { CHAT_METHODS } from './chat'
import { CLOUD_METHODS } from './cloud'
import { GROUP_METHODS } from './group'
import { LLM_METHODS } from './llm'
import { PRODUCTION_METHODS } from './production'
import { SETTINGS_METHODS } from './settings'
import { SPEND_METHODS } from './spend'
import { VIEWS_METHODS } from './views'
import { WORKFLOW_METHODS } from './workflow'
import { RUNS_METHODS } from './runs'
import { ANALYSIS_METHODS } from './analysis'
import { MONEY_METHODS } from './money'
import { TOOLS_METHODS } from './tools'
import { TEAM_METHODS } from './team'
import { HOME_METHODS } from './home'
import { IDEAS_METHODS } from './ideas'
import { EXAMPLE_METHODS } from './example'
import { ORCHESTRA_METHODS } from './orchestra'
import { DISCORD_METHODS } from './discord'
import { BRAIN_METHODS } from './brain'
import { EYES_METHODS } from './eyes'
import { UPDATE_METHODS } from './update'
import { CHANNEL_LIFE_METHODS } from './channel-life'
import { GOOGLE_METHODS } from './google'
import { BRICKS_METHODS } from './bricks'
import { RECIPES_METHODS } from './recipes'
import { ENGINES_METHODS } from './engines'
import { BRICK_STYLES_METHODS } from './brick-styles'
import { CHANNEL_VOICES_METHODS } from './channel-voices'
import { CHANNEL_PRESENTERS_METHODS } from './channel-presenters'
import { CHANNEL_SPONSOR_METHODS } from './channel-sponsors'
import { CHANNEL_CLIPS_METHODS } from './channel-clips'
import { PROJECTS_METHODS } from './projects'
import { AUTOPILOT_METHODS } from './autopilot'
import { ESTIMATES_METHODS } from './estimates'
import { PIPELINE_AGENT_METHODS } from './pipeline-agent'
import { STYLE_METHODS } from './style-agent'
import { CLONE_METHODS } from './clone'
import { REVERSE_METHODS } from './reverse'
import { ORDER_METHODS } from './orders'
import { PREVIEWS_METHODS } from './previews'
import { GRAPH_METHODS } from './graph'

export * from './core'
export * from './app'
export * from './llm'
export * from './spend'
export * from './production'
export * from './runs'
export * from './analysis'
export * from './money'
export * from './tools'
export * from './team'
export * from './home'
export * from './ideas'
export * from './example'
export * from './cloud'
export * from './orchestra'
export * from './discord'
export * from './brain'
export * from './eyes'
export * from './update'
export * from './channel-life'
export * from './google'
export * from './bricks'
export * from './recipes'
export * from './engines'
export * from './brick-styles'
export * from './channel-voices'
export * from './channel-presenters'
export * from './channel-sponsors'
export * from './channel-clips'
export * from './projects'
export * from './autopilot'
export * from './estimates'
export * from './pipeline-agent'
export * from './style-agent'
export * from './clone'
export * from './reverse'
export * from './orders'
export * from './previews'
export * from './graph'

export type ApiContract = AppContract &
  SettingsContract &
  LlmContract &
  WorkflowContract &
  ChatContract &
  GroupContract &
  SpendContract &
  ViewsContract &
  AgentsContract &
  ProductionContract &
  RunsContract &
  AnalysisContract &
  MoneyContract &
  ToolsContract &
  TeamContract &
  HomeContract &
  IdeasContract &
  ExampleContract &
  CloudContract &
  OrchestraContract &
  DiscordContract &
  BrainContract &
  EyesContract &
  UpdateContract &
  ChannelLifeContract &
  GoogleContract &
  BricksContract &
  RecipesContract &
  EnginesContract &
  BrickStylesContract &
  ChannelVoicesContract &
  ChannelPresentersContract &
  ChannelSponsorContract &
  ChannelClipsContract &
  ProjectsContract &
  AutopilotContract &
  EstimatesContract &
  PipelineAgentContract &
  StyleContract &
  CloneContract &
  ReverseContract &
  OrdersContract &
  PreviewsContract &
  GraphContract

export type ApiMethod = keyof ApiContract

/** Runtime list of the contract's methods (tests compare it with what main implements). */
export const API_METHODS = [
  ...APP_METHODS,
  ...SETTINGS_METHODS,
  ...LLM_METHODS,
  ...WORKFLOW_METHODS,
  ...CHAT_METHODS,
  ...GROUP_METHODS,
  ...SPEND_METHODS,
  ...VIEWS_METHODS,
  ...AGENTS_METHODS,
  ...PRODUCTION_METHODS,
  ...RUNS_METHODS,
  ...ANALYSIS_METHODS,
  ...MONEY_METHODS,
  ...TOOLS_METHODS,
  ...TEAM_METHODS,
  ...HOME_METHODS,
  ...IDEAS_METHODS,
  ...EXAMPLE_METHODS,
  ...CLOUD_METHODS,
  ...ORCHESTRA_METHODS,
  ...DISCORD_METHODS,
  ...BRAIN_METHODS,
  ...EYES_METHODS,
  ...UPDATE_METHODS,
  ...CHANNEL_LIFE_METHODS,
  ...GOOGLE_METHODS,
  ...BRICKS_METHODS,
  ...RECIPES_METHODS,
  ...ENGINES_METHODS,
  ...BRICK_STYLES_METHODS,
  ...CHANNEL_VOICES_METHODS,
  ...CHANNEL_PRESENTERS_METHODS,
  ...CHANNEL_SPONSOR_METHODS,
  ...CHANNEL_CLIPS_METHODS,
  ...PROJECTS_METHODS,
  ...AUTOPILOT_METHODS,
  ...ESTIMATES_METHODS,
  ...PIPELINE_AGENT_METHODS,
  ...STYLE_METHODS,
  ...CLONE_METHODS,
  ...REVERSE_METHODS,
  ...ORDER_METHODS,
  ...PREVIEWS_METHODS,
  ...GRAPH_METHODS
] as const satisfies readonly ApiMethod[]

/** Compile-time check: every contract method is in API_METHODS (fails here when one is missing). */
export const API_METHODS_COMPLETE: [Exclude<ApiMethod, (typeof API_METHODS)[number]>] extends [never] ? true : never = true

export type ApiArgs<M extends ApiMethod> = ApiContract[M]['args']
export type ApiResult<M extends ApiMethod> = ApiContract[M]['result']

export type ApiHandlers = {
  [M in ApiMethod]: (...args: ApiArgs<M>) => ApiResult<M> | Promise<ApiResult<M>>
}

/** What `atelier:call` resolves to over IPC; the preload unwraps it. */
/**
 * `message` is the calm French sentence for the screen; `detail` (when it differs) is the precise technical reason, scrubbed
 * of secrets, for callers that are not a person (brain route, headless server, brain-run, agents). The renderer shows `message` only.
 */
export type CallEnvelope<T> = { ok: true; value: T } | { ok: false; error: { message: string; code: string; detail?: string } }

// main → renderer events
export type ChangeTopic =
  | 'settings'
  | 'providers'
  | 'routes'
  | 'prices'
  | 'channels'
  | 'videos'
  | 'spend'
  | 'chat'
  | 'agents'
  // lot Z1
  | 'production'
  | 'credits'
  | 'analysis'
  | 'pipelines'
  | 'money'
  | 'tools'
  | 'team'
  | 'computers'
  | 'ideas'
  | 'example'
  | 'cloud'
  // agent runtime
  | 'orchestra'
  // Atlas on Discord
  | 'discord'
  // where the brain runs (this app or the team computer)
  | 'brain'
  // the app updating itself
  | 'update'
  // the owner's YouTube channels read through Google (src/main/google)
  | 'google'

export interface EventContract {
  'atelier:changed': { topic: ChangeTopic }
  'atelier:stream': {
    streamId: string
    conversationId: number
    delta?: string
    /** Agent writing this stream (group chats: each mentioned agent, each handoff has its own stream). */
    authorId?: string
    /** A tool the agent started (`running`) or finished, shown as a step above the streamed text. */
    tool?: { id: string; name: string; state: 'running' | 'done' | 'error' }
    /** Set on the last event: the saved reply (or the error text). */
    done?: boolean
    messageId?: number
    error?: string
  }
  'atelier:navigate': { view: ViewId }
}

export type EventName = keyof EventContract
export const EVENT_NAMES: readonly EventName[] = ['atelier:changed', 'atelier:stream', 'atelier:navigate']
export const CALL_CHANNEL = 'atelier:call'

export interface AtelierBridge {
  call<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>>
  on<E extends EventName>(event: E, listener: (payload: EventContract[E]) => void): () => void
}
