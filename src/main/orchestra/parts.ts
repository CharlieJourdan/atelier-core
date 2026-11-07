// The pieces of the runtime that the turn engine, the supervisor and the API share (built by runtime.ts).
import type { Tier } from '../../shared/roles'
import type { Db } from '../db'
import type { Ledger } from '../ledger'
import type { McpLaunch } from '../agents/runner'
import type { SettingsStore } from '../settings'
import type { AccountPool } from './accounts'
import type { AllowRules } from './allow'
import type { GoalsStore } from './goals'
import type { Inbox } from './inbox'
import type { ContextStore } from './layers'
import type { MemoryStore } from './memory'
import type { Messaging } from './messaging'
import type { TaskQueue } from './queue'
import type { RoutineStore } from './routines'
import type { Router } from './routing'
import type { OrchestraServices } from './services'
import type { AgentRecord, AgentTree } from './tree'
import type { Clock, EventLog } from './util'
import type { VideoOrders } from './orders'

export interface RuntimeParts {
  db: Db
  now: Clock
  events: EventLog
  tree: AgentTree
  queue: TaskQueue
  memory: MemoryStore
  accounts: AccountPool
  router: Router
  routines: RoutineStore
  inbox: Inbox
  messaging: Messaging
  ledger: Ledger
  settings: SettingsStore
  tierModels: () => Record<Tier, string>
  /** The stable working folder of an agent (its CLI sessions live there). */
  agentDir: (agent: AgentRecord) => string
  /** This process's lease owner id. */
  owner: string
  /** Each channel's standing goals and approval level (goals.ts). */
  goals: GoalsStore
  /** Charlie's « toujours valider » rules, read by the same gate check (allow.ts). */
  allow: AllowRules
  /** The workspace and channel memory blocks (layers.ts). */
  context: ContextStore
  /** What the technologies reach in the rest of the app (services.ts). */
  services: OrchestraServices
  /** Team files (scripts, briefs, reports): `<data>/files`. */
  teamDir: string
  /** eyes.look's frames: `<data>/eyes`. */
  eyesDir: string
  /** The agents' MCP bridge (Claude Code turns get their technologies through it); null without it. */
  mcp: () => McpLaunch | null
  /** Charlie's video orders (orders/index.ts); null where production is not wired. */
  orders: VideoOrders | null
}

/** One run in flight: what the watchdog needs to kill it. */
export interface RunHandle {
  taskId: number
  agentId: number
  accountId: number
  controller: AbortController
  /** Set by the watchdog before it aborts: the run's own error handling then stays out of the way. */
  killed: boolean
  startedAt: number
  lastBeatAt: number
  done: Promise<void>
}

export const SETTINGS = {
  enabled: 'orchestra.enabled',
  /** While Charlie paused the team: when work resumes (ISO), else null (power.ts). */
  pausedUntil: 'orchestra.pausedUntil',
  maxConcurrent: 'orchestra.maxConcurrent',
  compactAtTokens: 'orchestra.compactAtTokens',
  resume: 'orchestra.resumeSessions',
  maxRunMs: 'orchestra.maxRunMs'
} as const

export const DEFAULTS = {
  maxConcurrent: 3,
  compactAtTokens: 60_000,
  maxRunMs: 45 * 60_000
} as const

export function intSetting(settings: SettingsStore, key: string, fallback: number, min: number, max: number): number {
  const v = settings.get<number>(key, fallback)
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback
}
