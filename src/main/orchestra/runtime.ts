// The agent runtime, assembled (docs/AGENT-RUNTIME.md): the tree, the queue, memory and sessions, routing, the account
// pool, routines, the inbox and messaging around one supervisor loop. core.ts builds it next to the other services and
// the `orchestra.*` IPC handlers (src/main/api/orchestra.ts) call it. The loop only runs in the background while the
// setting `orchestra.enabled` is on; `tick()` runs one pass by hand (tests, the demo, a "run now" button).
import path from 'node:path'
import type { ChangeTopic } from '../../shared/api'
import type {
  OrchAccount,
  OrchAccountInput,
  OrchAccountLogin,
  OrchAgentContext,
  OrchCliAccountInput,
  OrchContextBlock,
  OrchContextBlockInput,
  OrchTechnology,
  OrchAgent,
  OrchAgentInput,
  OrchAgentPatch,
  OrchEnqueueInput,
  OrchEvent,
  OrchInboxAnswer,
  OrchInboxItem,
  OrchMemoryItem,
  OrchRoutine,
  OrchSayInput,
  OrchSayResult,
  OrchStatus,
  OrchTask,
  OrchTaskFilter,
  OrchTickResult,
  OrchTreeNode
} from '../../shared/api/orchestra'
import { mentionSlug } from '../../shared/chat-rich'
import type { HandoffStore } from '../chat/handoffs'
import type { ChatStore } from '../chat/store'
import type { Db } from '../db'
import type { Ledger } from '../ledger'
import type { RoutesStore } from '../llm/routes'
import type { SettingsStore } from '../settings'
import type { BlueprintApplyResult, BlueprintPlan } from '../../shared/blueprint'
import { applyBlueprint, ensureRoutines, planApply, recordWritten } from '../blueprint/apply'
import type { SeedDefaults } from '../blueprint/map'
import type { McpLaunch } from '../agents/runner'
import { systemTerminal, type TerminalLauncher } from '../platform/terminal'
import type { StyleProfile } from '../../shared/style-profile'
import { AccountPool, type ProviderFactory } from './accounts'
import { assemble, contextView } from './assemble'
import { accountsBack, reviveAuthDead } from './account-health'
import { addCliAccount, checkAccount, reopenLogin, type ConnectDeps } from './connect'
import { ContextStore } from './layers'
import { GoalsStore } from './goals'
import { AllowRules } from './allow'
import { heartbeat } from './heartbeat'
import { Planner } from './planner'
import { UnavailableProduction, type ProductionPort } from '../production/port'
import { goalsAnswered, goalsOnChannel } from './goals-flow'
import { PowerSwitch } from './power'
import { productionNews } from './production-news'
import { ordersOf } from './orders/runtime'
import type { RunFinished } from '../production/runs/video-status'
import type { OrchestraServices } from './services'
import { catalogue } from './technologies'
import { Inbox } from './inbox'
import { MemoryStore } from './memory'
import { Messaging } from './messaging'
import { DEFAULTS, SETTINGS, type RuntimeParts } from './parts'
import { TaskQueue, type QueueOptions } from './queue'
import { SEED_ROUTINES, roleInfo } from './roles'
import { RoutineStore } from './routines'
import { Router } from './routing'
import { Supervisor, newOwnerId } from './supervisor'
import { AgentTree, type AgentRecord } from './tree'
import { TurnEngine } from './turn'
import { EventLog, isRecord, type Clock } from './util'

export interface OrchestraDeps {
  db: Db
  ledger: Ledger
  settings: SettingsStore
  routes: RoutesStore
  chat: ChatStore
  handoffs: HandoffStore
  /** Builds the provider of an account (core: Claude Code / Codex CLI per config folder, the API, the relay). */
  providerFactory: ProviderFactory
  /** Agents' working folders live under `<dataDir>/agents/<slug>` (their CLI sessions are stored per folder). */
  dataDir: string
  now?: Clock
  /** Routines in UTC (tests); the app uses local time. */
  cronUtc?: boolean
  queue?: Partial<QueueOptions>
  notify?: (topic: ChangeTopic) => void
  /** The published blueprint (version + what a new agent of each role starts from); null when there is none. */
  blueprint?: () => { version: number; defaults: SeedDefaults } | null
  /** What the agents' technologies reach in the app (channels, eyes, runs, ffmpeg, the Cloud); see services.ts. */
  services?: OrchestraServices
  /** The production port the planner quotes through (the app's; absent = not wired: no production step opens). */
  production?: ProductionPort
  /** The agents' MCP bridge (Claude Code turns get their technologies through it). */
  mcp?: () => McpLaunch | null
  /** Opens the login terminal of « Ajouter mon compte » (tests pass a fake). */
  terminal?: TerminalLauncher
  platform?: NodeJS.Platform
}

export class Orchestra {
  readonly parts: RuntimeParts
  readonly supervisor: Supervisor
  readonly turn: TurnEngine
  /** The switch: off, on, paused until a time, the red stop (power.ts). */
  readonly power: PowerSwitch
  /** Turns the channels' confirmed goals into work, hourly (planner.ts); the heartbeat follows up stale threads. */
  readonly planner: Planner
  private readonly notify: (topic: ChangeTopic) => void
  private readonly blueprint: NonNullable<OrchestraDeps['blueprint']>
  private readonly connect: ConnectDeps

  constructor(deps: OrchestraDeps) {
    const now = deps.now ?? Date.now
    this.blueprint = deps.blueprint ?? (() => null)
    const events = new EventLog(deps.db, now)
    const tree = new AgentTree(deps.db, now, events)
    const messaging = new Messaging(deps.db, deps.chat, deps.handoffs, tree, events)
    this.notify = deps.notify ?? (() => undefined)
    this.parts = {
      db: deps.db,
      now,
      events,
      tree,
      queue: new TaskQueue(deps.db, now, events, deps.queue),
      memory: new MemoryStore(deps.db, now, events),
      accounts: new AccountPool(deps.db, now, events, deps.settings, deps.providerFactory),
      router: new Router(deps.settings),
      routines: new RoutineStore(deps.db, now, events, deps.cronUtc === true),
      inbox: new Inbox(deps.db, now, events),
      messaging,
      ledger: deps.ledger,
      settings: deps.settings,
      tierModels: () => deps.routes.tierModels(),
      agentDir: (a) => path.join(deps.dataDir, 'agents', a.slug),
      owner: newOwnerId(),
      context: new ContextStore(deps.db, now, events),
      goals: new GoalsStore(deps.db, now, events),
      allow: new AllowRules(deps.db, now, events),
      services: deps.services ?? {},
      teamDir: path.join(deps.dataDir, 'files'),
      eyesDir: path.join(deps.dataDir, 'eyes'),
      mcp: deps.mcp ?? (() => null),
      orders: null
    }
    this.parts.orders = ordersOf(this.parts, () => this.notify('orchestra'))
    tree.tierOf = (a) => this.parts.router.resolve(roleInfo(a.role).defaultKind, a.policy).tier
    const platform = deps.platform ?? process.platform
    this.connect = {
      parts: this.parts,
      terminal: deps.terminal ?? systemTerminal({ platform, env: process.env }),
      platform,
      accountsDir: path.join(deps.dataDir, 'accounts')
    }
    this.parts.accounts.ensureDefault()
    this.turn = new TurnEngine(this.parts)
    this.supervisor = new Supervisor(this.parts, this.turn)
    this.power = new PowerSwitch(this.parts, this.supervisor)
    this.planner = new Planner(this.parts, deps.production ?? new UnavailableProduction(), deps.cronUtc === true)
    this.supervisor.proactive = async () => {
      heartbeat(this.parts)
      this.parts.orders?.tick()
      return this.planner.maybe()
    }
    messaging.onMention = (w) => {
      const task = this.parts.queue.enqueue({
        kind: 'mention',
        title: `Message de ${w.from}`,
        assigneeId: w.agent.id,
        payload: { message: { from: w.from, text: w.text }, conversationId: w.conversationId, messageId: w.messageId, depth: w.depth },
        priority: 6,
        channelId: w.channelId,
        videoId: w.videoId
      })
      events.add('wake', `${w.agent.name} woken by ${w.from} (#${task.id})`, w.agent.id, task.id)
      tree.refreshStatus(w.agent.id)
      // no subscription works (beta rule, decision 0038): the chat answers now with what to click, never silence
      if (this.parts.accounts.usableSubscriptions().length === 0) this.supervisor.announceNoAccount(task)
      this.supervisor.kick()
    }
    const previous = deps.chat.onPosted
    deps.chat.onPosted = (conversationId, message) => {
      previous?.(conversationId, message)
      messaging.observe(conversationId, message)
    }
    events.listener = () => this.notify('orchestra')
  }

  /**
   * Takes back interrupted runs; starts the background loop when the team is switched on and a Claude account is
   * connected (power.ts: a pause set before the restart still holds).
   */
  start(intervalMs = 5000): void {
    this.supervisor.recover()
    reviveAuthDead(this.parts)
    this.power.apply(intervalMs)
  }

  close(): void {
    this.supervisor.close()
  }

  // ---- tree ---------------------------------------------------------------------------------------------

  /**
   * Seeds the hierarchy and its default routines (idempotent). With a published blueprint, NEW agents start from its
   * instructions, tier and routines (its scheduled routines replace the built-in ones of that role); agents that exist
   * are left alone: `blueprintApply` is how the user brings them to a version.
   */
  seed(): OrchTreeNode[] {
    const { tree, routines, settings } = this.parts
    const bp = this.blueprint()
    const created: AgentRecord[] = []
    tree.seed({
      ...(bp ? { defaults: bp.defaults } : {}),
      onCreate: (a) => {
        created.push(a)
        if (bp?.defaults.has(a.role)) recordWritten(settings, bp.version, a)
      }
    })
    for (const r of SEED_ROUTINES) {
      if ((bp?.defaults.get(r.role)?.routines.length ?? 0) > 0) continue
      for (const a of tree.list().filter((x) => x.role === r.role)) {
        routines.ensure(a.id, { name: r.name, kind: r.kind, cron: r.cron, payload: { title: r.title } })
      }
    }
    for (const a of created) {
      const d = bp?.defaults.get(a.role)
      if (d) ensureRoutines(routines, a.id, d)
    }
    // The memory layers: the workspace block the first time, each channel's block when its team appears.
    this.parts.context.ensureWorkspace()
    for (const ch of this.parts.db.prepare('SELECT id FROM channels WHERE archived_at IS NULL').all() as { id: number }[]) this.parts.context.ensureChannel(ch.id)
    tree.refreshAll()
    this.notify('orchestra')
    return tree.tree()
  }

  tree(): OrchTreeNode[] {
    return this.parts.tree.tree()
  }

  /** What « Appliquer la version N » would change on the existing agents (nothing without a published blueprint). */
  blueprintPlan(): BlueprintPlan {
    const bp = this.blueprint()
    return planApply(this.parts, bp?.version ?? null, bp?.defaults ?? null)
  }

  /** Brings the picked agents to the published version (the user confirmed the list of changes). */
  blueprintApply(agentIds: readonly number[]): BlueprintApplyResult {
    const bp = this.blueprint()
    if (!bp) throw new Error('No blueprint is published for this workspace')
    const result = applyBlueprint(this.parts, bp.version, bp.defaults, agentIds)
    this.parts.tree.refreshAll()
    this.notify('orchestra')
    return result
  }

  agents(): OrchAgent[] {
    return this.parts.tree.list().map((a) => this.parts.tree.toApi(a))
  }

  createAgent(input: OrchAgentInput): OrchAgent {
    const a = this.parts.tree.create(input)
    this.notify('orchestra')
    return this.parts.tree.toApi(a)
  }

  updateAgent(id: number, patch: OrchAgentPatch): OrchAgent {
    const a = this.parts.tree.update(id, patch)
    if (patch.paused === false) this.supervisor.kick()
    this.notify('orchestra')
    return this.parts.tree.toApi(a)
  }

  /**
   * Charlie writes to an agent from the app: the message goes to the agent's room (the Supervisor chat for the principal,
   * the video's chat, or the channel group) with an @mention of the agent, so the usual mention path wakes it and its
   * answer comes back in the same conversation.
   */
  say(input: OrchSayInput): OrchSayResult {
    if (!isRecord(input) || typeof input.text !== 'string' || input.text.trim() === '') throw new Error('A message needs an agent and a text')
    const agent = this.parts.tree.get(input.agentId)
    const videoId = typeof input.videoId === 'number' ? input.videoId : null
    const room = agent.role === 'principal' && videoId === null ? 'principal' : videoId !== null ? 'video' : 'channel'
    const conversationId = this.parts.messaging.conversationFor(room, agent.channelId, videoId)
    const message = this.parts.messaging.postOwner(conversationId, `@${mentionSlug(agent.name)} ${input.text.trim()}`)
    this.notify('chat')
    return { conversationId, messageId: message.id }
  }

  // ---- channels, memory layers, technologies ------------------------------------------------------------

  /**
   * A channel was added (the app's « Nouvelle chaîne », the onboarding, Atlas) or imported (linked to an existing YouTube
   * channel): its memory block, its team, then its goals proposed once (goals-flow.ts).
   */
  channelAdded(channelId: number, trigger: 'create' | 'import' = 'create'): void {
    this.parts.context.ensureChannel(channelId)
    this.seed()
    goalsOnChannel(this.parts, channelId, trigger)
    this.notify('orchestra')
  }

  /**
   * A channel was removed (archived) or restored: its memory block and its agents go with it. Their open tasks are
   * cancelled on removal (nothing runs for a channel that is gone); memory and history stay for a restore.
   */
  channelArchived(channelId: number, archived: boolean): void {
    const { tree, context, queue } = this.parts
    context.setArchived(channelId, archived)
    if (archived) {
      for (const a of tree.list().filter((x) => x.channelId === channelId)) {
        for (const t of queue.list({ assigneeId: a.id, status: ['queued', 'failed', 'waiting', 'waiting_human', 'leased', 'running'] })) this.cancelTask(t.id)
      }
    }
    tree.setChannelArchived(channelId, archived)
    if (!archived) this.seed()
    this.notify('orchestra')
  }

  /** A new style profile of a channel (the eyes): its summary goes into the channel memory. */
  profileBuilt(channelId: number, profile: StyleProfile, version: number | null): void {
    this.parts.context.noteProfile(channelId, profile, version)
    this.notify('orchestra')
  }

  /** A production run ended: the team hears of it (production-news.ts: the inbox, the channel's room, Atlas, the planner). */
  runFinished(e: RunFinished): void {
    productionNews(this.parts, e)
    this.parts.orders?.runFinished(e)
    this.notify('orchestra')
  }

  technologies(): OrchTechnology[] {
    return catalogue()
  }

  contextBlock(scope: 'workspace' | 'channel', channelId?: number): OrchContextBlock {
    if (scope === 'workspace') return this.parts.context.workspace()
    if (scope !== 'channel' || typeof channelId !== 'number' || !Number.isInteger(channelId)) throw new Error('A channel memory needs a channel id')
    return this.parts.context.channel(channelId)
  }

  saveContextBlock(input: OrchContextBlockInput): OrchContextBlock {
    if (!isRecord(input)) throw new Error('A memory block needs a scope and a text')
    const block = this.parts.context.save(input.scope, input.scope === 'channel' ? (input.channelId ?? null) : null, input.text, 'user')
    this.notify('orchestra')
    return block
  }

  /** « Ce que l'agent sait »: what its next turn would read (its open task, else a placeholder), secrets removed. */
  agentContext(agentId: number, taskId?: number): OrchAgentContext {
    const p = this.parts
    const agent = p.tree.get(agentId)
    const open = p.queue.list({ assigneeId: agent.id, status: ['running', 'leased', 'queued', 'failed', 'waiting_human', 'waiting'], limit: 1 })[0]
    const at = new Date(p.now()).toISOString()
    const task: OrchTask = taskId !== undefined ? p.queue.get(taskId) : (open ?? { ...placeholderTask(agent.id, agent.channelId), createdAt: at, updatedAt: at })
    const session = p.memory.session(agent.id)
    const account = p.accounts.list().find((a) => a.enabled) ?? null
    const resumed = p.settings.get<boolean>(SETTINGS.resume, true) !== false && session.cliSessionId !== null && account !== null && session.accountId === account.id
    const ctx = this.turn.contextFor(agent, task, session, resumed, false)
    const asm = assemble({ parts: p, context: p.context, agent, ctx })
    const threshold = agent.policy.compactAtTokens ?? (p.settings.get<number>(SETTINGS.compactAtTokens, DEFAULTS.compactAtTokens) || DEFAULTS.compactAtTokens)
    return contextView(asm, agent.id, resumed, session.contextTokens, threshold)
  }

  // ---- tasks --------------------------------------------------------------------------------------------

  tasks(filter?: OrchTaskFilter): OrchTask[] {
    return this.parts.queue.list(filter ?? {})
  }

  /** Charlie (or a test) gives a task to an agent: it wakes up. */
  enqueue(input: OrchEnqueueInput): OrchTask {
    if (!isRecord(input)) throw new Error('A task needs an assignee, a kind and a title')
    const agent = this.parts.tree.get(input.assigneeId)
    const task = this.parts.queue.enqueue({
      kind: input.kind || roleInfo(agent.role).defaultKind,
      title: input.title,
      assigneeId: agent.id,
      payload: { brief: typeof input.brief === 'string' ? input.brief : '' },
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      channelId: input.channelId === undefined ? agent.channelId : input.channelId,
      videoId: input.videoId ?? null,
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {})
    })
    this.parts.tree.refreshStatus(agent.id)
    this.supervisor.kick()
    this.notify('orchestra')
    return task
  }

  retryTask(id: number): OrchTask {
    const t = this.parts.queue.retry(id)
    this.parts.tree.setError(t.assigneeId, false)
    this.supervisor.kick()
    this.notify('orchestra')
    return t
  }

  cancelTask(id: number): OrchTask {
    const { queue, inbox, messaging } = this.parts
    for (const tid of queue.cancel(id)) {
      const h = this.supervisor.running.get(tid)
      if (h) this.supervisor.kill(h, 'cancelled')
      inbox.dismissForTask(tid)
      const t = queue.get(tid)
      if (typeof t.payload.handoffId === 'number') messaging.closeHandoff(t.payload.handoffId, false, 'Annulée')
      this.parts.tree.refreshStatus(t.assigneeId)
    }
    this.notify('orchestra')
    return queue.get(id)
  }

  // ---- accounts -----------------------------------------------------------------------------------------

  accounts(): OrchAccount[] {
    const pool = this.parts.accounts
    return pool.list().map((a) => pool.toApi(a))
  }

  saveAccount(input: OrchAccountInput): OrchAccount {
    const a = this.parts.accounts.save(input)
    this.supervisor.kick()
    this.notify('orchestra')
    return this.parts.accounts.toApi(a)
  }

  /** « Ajouter mon compte Claude Code / Codex »: its own folder, then a terminal where the user signs in himself. */
  async addCliAccount(input: OrchCliAccountInput): Promise<OrchAccountLogin> {
    const r = await addCliAccount(this.connect, input)
    this.notify('orchestra')
    return r
  }

  async openLogin(id: number): Promise<OrchAccountLogin> {
    return reopenLogin(this.connect, id)
  }

  /** One tiny Haiku prompt through the account's CLI (the user's subscription): ready, or what is wrong. */
  async checkAccount(id: number): Promise<OrchAccount> {
    const a = await checkAccount(this.connect, id)
    if (a.state === 'ready') {
      // what waited for an account goes now, and what a dead login stopped comes back (account-health.ts)
      accountsBack(this.parts)
      // switched on but waiting for Claude: the loop starts now
      this.power.apply()
      this.supervisor.kick()
    }
    this.notify('orchestra')
    return a
  }

  clearLimit(id: number): OrchAccount {
    const a = this.parts.accounts.clearLimit(id)
    // Tasks that waited for accounts may go now.
    this.parts.db
      .prepare(`UPDATE orch_tasks SET not_before = ? WHERE status = 'waiting' AND wait_reason = 'accounts'`)
      .run(new Date(this.parts.now()).toISOString())
    this.parts.queue.wakeParked()
    this.supervisor.kick()
    this.notify('orchestra')
    return this.parts.accounts.toApi(a)
  }

  // ---- routines, memory, inbox, events ------------------------------------------------------------------

  routines(agentId?: number): OrchRoutine[] {
    return this.parts.routines.list(agentId).map(({ payload: _payload, ...r }) => r)
  }

  toggleRoutine(id: number, enabled: boolean): OrchRoutine {
    const { payload: _payload, ...r } = this.parts.routines.toggle(id, enabled)
    this.notify('orchestra')
    return r
  }

  memory(agentId: number): OrchMemoryItem[] {
    this.parts.tree.get(agentId)
    return this.parts.memory.list(agentId)
  }

  deleteMemory(id: number): void {
    this.parts.memory.delete(id)
    this.notify('orchestra')
  }

  inbox(includeClosed = false): OrchInboxItem[] {
    return this.parts.inbox.list(includeClosed === true)
  }

  /** Records the answer and resumes the task that asked. */
  answer(id: number, answer: OrchInboxAnswer): OrchInboxItem {
    const item = this.parts.inbox.answer(id, answer)
    // a custom brick's proposal: validated, or sent back with the note (the agent's task resumes below and revises it)
    if (item.answer) this.parts.services.bricks?.decide(item.id, item.answer)
    // the « Objectifs proposés » item of a channel
    if (item.answer) goalsAnswered(this.parts, item)
    if (item.kind !== 'alert' && item.taskId !== null && item.answer) {
      const t = this.parts.queue.find(item.taskId)
      if (t?.status === 'waiting_human') {
        this.parts.queue.resumeHuman(t.id, { question: item.body, ...item.answer })
        this.parts.tree.refreshStatus(t.assigneeId)
        this.supervisor.kick()
      }
    }
    this.notify('orchestra')
    return item
  }

  events(afterId?: number, limit?: number): OrchEvent[] {
    return this.parts.events.list(afterId ?? 0, limit ?? 200)
  }

  status(): OrchStatus {
    const { queue, accounts, tree, inbox, settings } = this.parts
    const all = accounts.list().filter((a) => a.enabled)
    const limited = all.filter((a) => accounts.isLimited(a))
    const resumesAt = all.length > 0 && limited.length === all.length ? Math.min(...limited.map((a) => Date.parse(a.limitedUntil as string))) : null
    return {
      enabled: settings.get<boolean>(SETTINGS.enabled, false) === true,
      running: this.supervisor.running.size,
      maxConcurrent: this.supervisor.maxConcurrent() || DEFAULTS.maxConcurrent,
      tasks: queue.counts(),
      agents: tree.list().length,
      accountsReady: all.length - limited.length,
      accountsLimited: limited.length,
      resumesAt: resumesAt === null ? null : new Date(resumesAt).toISOString(),
      openInbox: inbox.openCount()
    }
  }

  /** One supervisor pass; with `wait`, also waits for the runs it started (and what they woke) to finish. */
  async tick(opts: { wait?: boolean } = {}): Promise<OrchTickResult> {
    const r = await this.supervisor.tick()
    if (isRecord(opts) && opts.wait === true) await this.supervisor.idle()
    this.notify('orchestra')
    return r
  }
}

/** The task « Ce que l'agent sait » shows when the agent has nothing waiting. */
function placeholderTask(agentId: number, channelId: number | null): Omit<OrchTask, 'createdAt' | 'updatedAt'> {
  return {
    id: 0,
    kind: 'task',
    title: '(prochaine tâche)',
    payload: {},
    priority: 5,
    assigneeId: agentId,
    createdBy: null,
    parentId: null,
    dependsOn: [],
    channelId,
    videoId: null,
    status: 'queued',
    waitReason: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    attempts: 0,
    maxAttempts: 3,
    notBefore: null,
    bumps: 0,
    accountId: null,
    routineId: null,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null
  }
}
