// Agent types shared by main and renderer: role definitions as stored in `agents`, agent memory and proposals.
import type { Tier } from './roles'

/** Tools of the Atelier MCP server (Claude Code sees them as `mcp__atelier__<name>`). */
export const ATELIER_TOOLS = [
  'get_brief',
  'get_inputs',
  'save_version',
  'post_message',
  'propose_action',
  'remember',
  'create_video',
  // lot 13: group chat and production
  'ask_agent',
  'list_videos',
  'list_runs',
  'run_status',
  'estimate',
  'analyse_channel',
  'run_pipeline',
  'retry_node',
  'cancel_run'
] as const
export type AtelierTool = (typeof ATELIER_TOOLS)[number]

/**
 * When an agent acts. `on_task`: the runner starts it for ready tasks of its deliverables; `on_message`: it
 * answers in its chat. The timed cadences are stored for the routines loop (not run yet).
 */
export const CADENCES = ['on_task', 'on_message', 'hourly', 'daily', 'weekly'] as const
export type Cadence = (typeof CADENCES)[number]

export interface AgentRow {
  /** Same as the role for built-in agents. */
  id: string
  role: string
  name: string
  instructions: string
  /** True when the instructions differ from the built-in default. */
  customized: boolean
  tools: AtelierTool[]
  /** Built-in WebSearch of Claude Code (research roles only). */
  webSearch: boolean
  /** Tier used for routing (from the `routes` table, which is authoritative). */
  tier: Tier
  cadence: Cadence
  enabled: boolean
  updatedAt: string
}

export interface AgentPatch {
  instructions?: string
  enabled?: boolean
  cadence?: Cadence
}

export interface MemoryRow {
  id: number
  agentId: string
  channelId: number | null
  content: string
  createdAt: string
}

/** `create_video` (v1) and the production actions (lot 13), each confirmed by Charlie on its card. */
export const PROPOSAL_KINDS = ['create_video', 'analyse_channel', 'run_pipeline', 'retry_node', 'cancel_run', 'other'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired'

export interface CreateVideoPayload {
  channelId: number
  title: string
  brief: string
}

export interface ProposalRow {
  id: number
  conversationId: number | null
  messageId: number | null
  kind: ProposalKind
  title: string
  detail: string
  payload: Record<string, unknown>
  status: ProposalStatus
  /** Set once accepted: e.g. the id of the created video. */
  resultVideoId: number | null
  decidedAt: string | null
  createdAt: string
}

export function isCadence(v: unknown): v is Cadence {
  return typeof v === 'string' && (CADENCES as readonly string[]).includes(v)
}
