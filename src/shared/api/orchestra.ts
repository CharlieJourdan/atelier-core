// IPC contract, module "orchestra": the agent runtime (src/main/orchestra, docs/AGENT-RUNTIME.md). A tree of agents
// (principal → one lead per channel → specialists, plus agents created on demand) working a durable task queue under
// a supervisor loop with a watchdog, per-agent memory and sessions, model routing per task kind, and a pool of
// provider accounts (several Claude Code / Codex CLI logins, the Anthropic API key, the Atelier relay).
// Every method added here must also be listed in ORCHESTRA_METHODS (tests/unit/orchestra-api.test.ts counts them).
import type { Tier } from '../roles'
import type { GoalGate } from './autopilot'
import type { Effort } from './core'
import type { AgentLook } from '../mascot'

export const ORCH_AGENT_STATUSES = ['working', 'idle', 'sleeping', 'waiting', 'paused', 'error'] as const
export type OrchAgentStatus = (typeof ORCH_AGENT_STATUSES)[number]

/**
 * queued → leased → running → done; running → waiting (sub-tasks, accounts limited, budget) | waiting_human (an answer
 * from the user); a failed attempt → failed (retried after `notBefore`) → … → dead (attempts used up: dead letter).
 */
export const ORCH_TASK_STATUSES = ['queued', 'leased', 'running', 'waiting', 'waiting_human', 'done', 'failed', 'dead', 'cancelled'] as const
export type OrchTaskStatus = (typeof ORCH_TASK_STATUSES)[number]
/** Statuses a task never leaves. */
export const ORCH_TERMINAL: readonly OrchTaskStatus[] = ['done', 'dead', 'cancelled']

export const ORCH_ACCOUNT_KINDS = ['claude-code', 'codex', 'anthropic', 'relay'] as const
export type OrchAccountKind = (typeof ORCH_ACCOUNT_KINDS)[number]

export const ORCH_MEMORY_KINDS = ['fact', 'preference', 'style', 'note', 'lesson'] as const
export type OrchMemoryKind = (typeof ORCH_MEMORY_KINDS)[number]

export const ORCH_INBOX_KINDS = ['validate', 'input', 'files', 'alert'] as const
export type OrchInboxKind = (typeof ORCH_INBOX_KINDS)[number]

/** How an agent's calls are routed. Unset fields fall back to the workspace table, then the built-in one. */
export interface OrchModelPolicy {
  tier?: Tier
  effort?: Effort
  /** A model id that replaces the tier's model for this agent. */
  model?: string
  /** Per task kind overrides for this agent. */
  kinds?: Record<string, { tier?: Tier; effort?: Effort }>
  /** Context budget: compaction starts when the working session passes this many estimated tokens. */
  compactAtTokens?: number
}

export interface OrchAgent {
  id: number
  /** Stable handle used in delegations and @mentions (`principal`, `lead-2`, `researcher-2`…). */
  slug: string
  role: string
  name: string
  parentId: number | null
  channelId: number | null
  status: OrchAgentStatus
  instructions: string
  policy: OrchModelPolicy
  /** Monthly cap of this agent's calls in USD; null = no cap of its own (the ledger caps still apply). */
  budgetUsdMonth: number | null
  spentUsdMonth: number
  custom: boolean
  paused: boolean
  /** The task it works on now (leased or running), if any. */
  currentTaskId: number | null
  /** Runnable tasks waiting for it. */
  queued: number
  lastActiveAt: string | null
  /** The technologies (tool ids) this agent may call: its own list, else the defaults of its role. */
  technologies: string[]
  /** True when the list was edited (it no longer follows the role's defaults). */
  technologiesCustom: boolean
  /** The model tier of its usual work (its policy, else the routing of its role's default kind). */
  tier: Tier
  /** Its mascot's colour and accessory; null = the defaults of its role (decision 0057). */
  look: AgentLook | null
}

export interface OrchTreeNode {
  agent: OrchAgent
  children: OrchTreeNode[]
}

export interface OrchAgentInput {
  name: string
  /** A built-in role id, or any custom role name. */
  role: string
  parentId: number
  instructions?: string
  channelId?: number | null
  policy?: OrchModelPolicy
  budgetUsdMonth?: number | null
}

export interface OrchAgentPatch {
  name?: string
  instructions?: string
  paused?: boolean
  policy?: OrchModelPolicy
  budgetUsdMonth?: number | null
  /** Technology ids this agent may call; null goes back to the defaults of its role. */
  technologies?: string[] | null
  /** Mascot colour and held accessory; null goes back to the defaults of its role. */
  look?: AgentLook | null
}

export interface OrchTask {
  id: number
  kind: string
  title: string
  payload: Record<string, unknown>
  /** 0..9, higher first. */
  priority: number
  assigneeId: number
  createdBy: number | null
  parentId: number | null
  dependsOn: number[]
  channelId: number | null
  videoId: number | null
  status: OrchTaskStatus
  /** Why it waits: `children`, `accounts`, `budget`, `human`. */
  waitReason: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  attempts: number
  maxAttempts: number
  notBefore: string | null
  /** How many times sub-tasks woke it up. */
  bumps: number
  accountId: number | null
  routineId: number | null
  result: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface OrchTaskFilter {
  status?: OrchTaskStatus[]
  assigneeId?: number
  channelId?: number
  parentId?: number
  kind?: string
  limit?: number
}

export interface OrchEnqueueInput {
  assigneeId: number
  kind: string
  title: string
  brief?: string
  priority?: number
  channelId?: number | null
  videoId?: number | null
  maxAttempts?: number
}

export interface OrchAccount {
  id: number
  kind: OrchAccountKind
  label: string
  /** Claude Code: `CLAUDE_CONFIG_DIR`; Codex: `CODEX_HOME`; null = the CLI's default login. */
  configDir: string | null
  enabled: boolean
  /** Lower first. */
  priority: number
  maxConcurrent: number
  tiers: Tier[]
  /** Set while a usage / rate limit is in force. */
  limitedUntil: string | null
  limitNote: string | null
  running: number
  calls: number
  failures: number
  lastUsedAt: string | null
  spentUsdMonth: number
  /** « Ajouter mon compte »: `login` = the terminal is open for the user to sign in, `ready` after a good check. */
  state: OrchAccountState
  /** What the last health check said (never a token: the CLI's answer or its error, cut short). */
  checkNote: string | null
  checkedAt: string | null
  /** Its login stopped working while in use (expired OAuth session, CLI logged out): « À reconnecter », skipped until checked again. */
  reconnect: boolean
}

export const ORCH_ACCOUNT_STATES = ['ready', 'login', 'checking', 'failed'] as const
export type OrchAccountState = (typeof ORCH_ACCOUNT_STATES)[number]

/** « Ajouter mon compte Claude Code / Codex »: a dedicated config folder, a terminal where the user logs in himself. */
export interface OrchCliAccountInput {
  kind: 'claude-code' | 'codex'
  label?: string
}

export interface OrchAccountLogin {
  account: OrchAccount
  /** The account's own folder (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). */
  configDir: string
  /** The command the terminal runs (to type by hand on a team computer reached over its remote screen). */
  command: string
  /** A terminal window was opened on this computer. */
  launched: boolean
  note: string
}

/** One technology of the catalogue: a tool an agent may call through the agents' MCP server. */
export interface OrchTechnology {
  /** Stable id, e.g. `eyes.look` (the UI's label key is `tech.<id>`). */
  id: string
  /** The MCP tool name (`eyes_look`). */
  tool: string
  group: 'eyes' | 'research' | 'script' | 'production' | 'packaging' | 'qc' | 'team' | 'memory'
  /** What the model reads about it (English). */
  description: string
  /** It may spend Atelier credits (a quote and the usual holds always apply). */
  spends: boolean
  /** Roles that get it by default. */
  roles: string[]
}

/** A shared memory block: the workspace's (one) or a channel's. */
export interface OrchContextBlock {
  scope: 'workspace' | 'channel'
  channelId: number | null
  text: string
  /** `onboarding`, `channel`, `analysis`, `user`, `agent:<slug>`. */
  source: string
  updatedAt: string | null
  archived: boolean
}

export interface OrchContextBlockInput {
  scope: 'workspace' | 'channel'
  channelId?: number | null
  text: string
}

/** One part of what an agent reads at a turn (« Ce que l'agent sait »). */
export interface OrchContextSection {
  id: 'role' | 'technologies' | 'workspace' | 'channel' | 'memories' | 'task' | 'thread' | 'handover'
  text: string
  /** Estimated tokens (4 characters per token). */
  tokens: number
  /** Its token budget; the text is cut to it. */
  budget: number
  truncated: boolean
}

export interface OrchAgentContext {
  agentId: number
  /** The next turn resumes the CLI session (only the task is sent; the rest is already in the session). */
  resumed: boolean
  sections: OrchContextSection[]
  totalTokens: number
  /** The working session's estimated size and the size at which it is compacted. */
  sessionTokens: number
  compactAtTokens: number
}

export interface OrchAccountInput {
  id?: number
  kind: OrchAccountKind
  label: string
  configDir?: string | null
  enabled?: boolean
  priority?: number
  maxConcurrent?: number
  tiers?: Tier[]
  /** Per tier model ids for this account (Codex: its own model names). */
  models?: Partial<Record<Tier, string>>
}

export interface OrchRoutine {
  id: number
  agentId: number
  name: string
  kind: string
  /** Five fields: minute hour day-of-month month day-of-week (`*`, lists, ranges, steps). */
  cron: string
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
}

export interface OrchMemoryItem {
  id: number
  agentId: number
  kind: OrchMemoryKind
  content: string
  /** Where it came from: `task:<id>`, `compaction:<session>`, `user`. */
  source: string
  importance: number
  uses: number
  createdAt: string
}

export interface OrchInboxItem {
  id: number
  taskId: number | null
  agentId: number | null
  kind: OrchInboxKind
  title: string
  body: string
  options: string[]
  status: 'open' | 'answered' | 'dismissed'
  answer: OrchInboxAnswer | null
  createdAt: string
  answeredAt: string | null
  /** The gate of a video this validation is about (approval levels; « Toujours valider » makes a rule for it). */
  gate: GoalGate | null
  /** The channel it concerns (the asking agent's or task's). */
  channelId: number | null
  /** The series it belongs to, when the agent named one (a rule may be limited to it). */
  series: string | null
}

export interface OrchInboxAnswer {
  text?: string
  choice?: string
  /** Paths of files the user dropped. */
  files?: string[]
}

/** Charlie writes to an agent from the app (Accueil, Messages): see Orchestra.say. */
export interface OrchSayInput {
  agentId: number
  text: string
  /** A video's conversation instead of the agent's usual room. */
  videoId?: number | null
}

export interface OrchSayResult {
  conversationId: number
  messageId: number
}

export interface OrchEvent {
  id: number
  at: string
  agentId: number | null
  taskId: number | null
  type: string
  text: string
}

export interface OrchStatus {
  /** The loop runs in the background (setting `orchestra.enabled`). */
  enabled: boolean
  running: number
  maxConcurrent: number
  tasks: Partial<Record<OrchTaskStatus, number>>
  agents: number
  accountsReady: number
  accountsLimited: number
  /** Earliest time a limited account comes back, when every account is limited. */
  resumesAt: string | null
  openInbox: number
}

export interface OrchTickResult {
  started: number
  expired: number
  recovered: number
  routines: number
  bumped: number
  waitingAccounts: number
  /** Planned steps opened by the planner (docs/AGENT-RUNTIME.md §26). */
  planned?: number
}

export interface OrchestraContract {
  'orchestra.status': { args: []; result: OrchStatus }
  'orchestra.tree': { args: []; result: OrchTreeNode[] }
  'orchestra.agents': { args: []; result: OrchAgent[] }
  /** Seeds the hierarchy (principal, one lead per channel, its specialists, the default routines); idempotent. */
  'orchestra.seed': { args: []; result: OrchTreeNode[] }
  'orchestra.createAgent': { args: [input: OrchAgentInput]; result: OrchAgent }
  'orchestra.updateAgent': { args: [id: number, patch: OrchAgentPatch]; result: OrchAgent }
  'orchestra.tasks': { args: [filter?: OrchTaskFilter]; result: OrchTask[] }
  'orchestra.enqueue': { args: [input: OrchEnqueueInput]; result: OrchTask }
  /** A dead, failed or cancelled task goes back to the queue with fresh attempts. */
  'orchestra.retryTask': { args: [id: number]; result: OrchTask }
  /** Cancels a task and its open sub-tasks (a run in flight is killed). */
  'orchestra.cancelTask': { args: [id: number]; result: OrchTask }
  'orchestra.accounts': { args: []; result: OrchAccount[] }
  'orchestra.saveAccount': { args: [input: OrchAccountInput]; result: OrchAccount }
  'orchestra.clearLimit': { args: [id: number]; result: OrchAccount }
  'orchestra.routines': { args: [agentId?: number]; result: OrchRoutine[] }
  'orchestra.toggleRoutine': { args: [id: number, enabled: boolean]; result: OrchRoutine }
  'orchestra.memory': { args: [agentId: number]; result: OrchMemoryItem[] }
  'orchestra.deleteMemory': { args: [id: number]; result: void }
  'orchestra.inbox': { args: [includeClosed?: boolean]; result: OrchInboxItem[] }
  /** Answers a human-in-the-loop item; its task resumes. */
  'orchestra.answer': { args: [id: number, answer: OrchInboxAnswer]; result: OrchInboxItem }
  'orchestra.events': { args: [afterId?: number, limit?: number]; result: OrchEvent[] }
  /** Posts Charlie's message in the agent's room with an @mention: the agent wakes and answers there. */
  'orchestra.say': { args: [input: OrchSayInput]; result: OrchSayResult }
  /** One supervisor tick (tests, the demo, a "run now" button); `wait` resolves after the runs it started. */
  'orchestra.tick': { args: [opts?: { wait?: boolean }]; result: OrchTickResult }
  /** The catalogue of technologies (tools) and the roles that get each by default. */
  'orchestra.technologies': { args: []; result: OrchTechnology[] }
  /** « Ce que l'agent sait »: the context its next turn would read (read-only; secrets are never in it). */
  'orchestra.agentContext': { args: [agentId: number, taskId?: number]; result: OrchAgentContext }
  /** « Mémoire de l'espace » (scope workspace) or « Mémoire de la chaîne » (scope channel + channelId). */
  'orchestra.contextBlock': { args: [scope: 'workspace' | 'channel', channelId?: number]; result: OrchContextBlock }
  'orchestra.saveContextBlock': { args: [input: OrchContextBlockInput]; result: OrchContextBlock }
  /** « Ajouter mon compte Claude Code / Codex »: its folder, a terminal running the CLI for the user to log in. */
  'orchestra.addCliAccount': { args: [input: OrchCliAccountInput]; result: OrchAccountLogin }
  /** Opens the login terminal of an account again. */
  'orchestra.openLogin': { args: [accountId: number]; result: OrchAccountLogin }
  /** The health check: one tiny Haiku prompt through the account's CLI (it uses the user's subscription). */
  'orchestra.checkAccount': { args: [accountId: number]; result: OrchAccount }
}

export const ORCHESTRA_METHODS = [
  'orchestra.status',
  'orchestra.tree',
  'orchestra.agents',
  'orchestra.seed',
  'orchestra.createAgent',
  'orchestra.updateAgent',
  'orchestra.tasks',
  'orchestra.enqueue',
  'orchestra.retryTask',
  'orchestra.cancelTask',
  'orchestra.accounts',
  'orchestra.saveAccount',
  'orchestra.clearLimit',
  'orchestra.routines',
  'orchestra.toggleRoutine',
  'orchestra.memory',
  'orchestra.deleteMemory',
  'orchestra.inbox',
  'orchestra.answer',
  'orchestra.events',
  'orchestra.tick',
  'orchestra.say',
  'orchestra.technologies',
  'orchestra.agentContext',
  'orchestra.contextBlock',
  'orchestra.saveContextBlock',
  'orchestra.addCliAccount',
  'orchestra.openLogin',
  'orchestra.checkAccount'
] as const satisfies readonly (keyof OrchestraContract)[]
