// The runner: starts agents on ready tasks and turns their output into versions.
//   ready ──claim──▶ running ──▶ waiting_approval | done        (submitVersion)
//                       └──▶ ready (retry, after a delay) │ failed (attempts used up)
//   ready ──budget cap refused──▶ ready + hold_reason (on hold, budget card in the video chat) ──resume──▶ ready
// Limits: at most `agents.maxParallel` runs, `agents.maxParallelPerChannel` per channel. A run whose task is reset
// or cancelled while it works (an upstream revision, a cancelled video) is aborted, and its output discarded.
// A tool run reserves several turns (`agents.toolRunEstimateMultiplier`) and gets a turn limit (`agents.maxTurns`);
// if its real cost still reaches a cap, the channel's next tasks go on budget hold (all channels for the global cap).
import type { AgentRow, AtelierTool } from '../../shared/agents'
import type { ChangeTopic } from '../../shared/api'
import type { TaskRow } from '../../shared/workflow'
import type { ChatStore } from '../chat/store'
import type { Db } from '../db'
import { BudgetExceededError, type Ledger } from '../ledger'
import { approxTokens } from '../llm/fake'
import type { RoutesStore } from '../llm/routes'
import { ProviderError, type AgentTools, type Provider, type Usage } from '../llm/types'
import type { SettingsStore } from '../settings'
import type { WorkflowEngine } from '../workflow/engine'
import { ATELIER_TOOLS } from '../../shared/agents'
import type { BridgeServer } from './bridge'
import type { ExtraTools, MediaHooks } from './media'
import { PRODUCTION_HOLD, REVISIONS_HOLD } from '../workflow/tasks'
import { BUDGET_HOLD, CAP_HOLD, holdForBudget, holdIfCapReached, holdUnavailable, releaseCapHolds, setHold } from './holds'
import { reserveFor, runReserved, toolRunEstimate, toolRunMaxTurns, unpricedReserveUsd } from './call'
import { briefText, inputsText, taskContext, titleOf } from './context'
import { buildTaskPrompt, isTextDeliverable } from './prompt'
import type { ProposalsStore } from './proposals'
import type { AgentsStore } from './store'
import { ToolRun, type RunHooks, type RunMaterial, type RunScope } from './tools'
import type { ProductionPort } from '../production/port'

export { BUDGET_HOLD } from './holds'
export const ERROR_HOLD = 'error'
export { PRODUCTION_HOLD } from '../workflow/tasks'
const OUTPUT_TOKENS: Record<string, number> = { script: 8192, research: 6144 }
const DEFAULT_OUTPUT_TOKENS = 4096

export interface McpLaunch {
  server: BridgeServer
  /** Command and args that start the MCP server entry (Electron's binary + out/main/mcp.js). */
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface RunnerDeps {
  db: Db
  workflow: WorkflowEngine
  ledger: Ledger
  routes: RoutesStore
  agents: AgentsStore
  chat: ChatStore
  proposals: ProposalsStore
  settings: SettingsStore
  getProvider: (id: string) => Provider
  notify: (topic: ChangeTopic) => void
  /** The MCP relay; without it Claude Code agents run without tools (their final text is the deliverable). */
  mcp?: McpLaunch | null
  now?: () => number
  /** Delay before a failed attempt is retried (default 20 s). */
  retryDelayMs?: number
  /** A media module that produces file deliverables (the production engine); absent: they wait for an upload. */
  media?: MediaHooks | null
  /** Production runs for the Supervisor's and the Opérateur production's tools (lot 13). */
  production?: ProductionPort | null
}

export interface OpenedTools {
  run: ToolRun
  tools: AgentTools
  /** True when the provider will really let the model call them. */
  available: boolean
  close(): void
}

interface Running {
  channelId: number
  done: Promise<void>
  /** Aborts this run's model call (task reset or cancelled, Atelier quitting). */
  abort: AbortController
  /** The attempt this run claimed; null until claimed. */
  attempt: number | null
}

export class AgentRunner {
  private readonly running = new Map<number, Running>()
  private readonly abort = new AbortController()
  private timer: ReturnType<typeof setInterval> | null = null
  private kickPending = false
  private closed = false

  constructor(private readonly deps: RunnerDeps) {}

  /** Starts the background loop (the app does; unit tests call tick() themselves). */
  start(intervalMs = 3000): void {
    if (this.timer || this.closed) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.kick()
  }

  /** Schedules a tick soon (after an approval, a confirmed proposal, a finished run). */
  kick(): void {
    if (!this.timer || this.kickPending || this.closed) return
    this.kickPending = true
    setImmediate(() => {
      this.kickPending = false
      void this.tick()
    })
  }

  close(): void {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.abort.abort()
    for (const r of this.running.values()) r.abort.abort()
  }

  /** Resolves when no run is in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()].map((r) => r.done))
  }

  get inFlight(): number[] {
    return [...this.running.keys()]
  }

  /** Starts every eligible ready task within the limits. Returns the ids started. Never throws. */
  tick(): number[] {
    try {
      this.abortSuperseded()
      releaseCapHolds(this.deps)
      return this.startReady()
    } catch (err) {
      // A closed database during shutdown, bad data: the loop must survive (next tick tries again).
      if (!this.closed) console.error('Agent runner tick failed:', err)
      return []
    }
  }

  private startReady(): number[] {
    if (this.closed || this.deps.settings.get<boolean>('agents.runnerEnabled', true) === false) return []
    const maxAll = limit(this.deps.settings.get<number>('agents.maxParallel', 3), 3)
    const maxChannel = limit(this.deps.settings.get<number>('agents.maxParallelPerChannel', 2), 2)
    const started: number[] = []
    for (const task of this.deps.workflow.readyTasks()) {
      if (this.running.size >= maxAll) break
      if (!this.eligible(task)) continue
      const channelId = this.deps.workflow.getVideo(task.videoId as number).channelId
      const inChannel = [...this.running.values()].filter((r) => r.channelId === channelId).length
      if (inChannel >= maxChannel) continue
      const entry: Running = { channelId, done: Promise.resolve(), abort: new AbortController(), attempt: null }
      this.running.set(task.id, entry)
      entry.done = this.runTask(task, channelId, entry).finally(() => {
        this.running.delete(task.id)
        this.kick()
      })
      started.push(task.id)
    }
    return started
  }

  /**
   * Aborts runs whose task moved on without them (a revision upstream reset it, the video was cancelled): their
   * output would be discarded, so they must stop spending now. Returns the task ids aborted.
   */
  abortSuperseded(): number[] {
    const aborted: number[] = []
    for (const [id, r] of this.running) {
      if (r.attempt === null || r.abort.signal.aborted) continue
      const t = safeTask(this.deps.workflow, id)
      if (t?.status === 'running' && t.attempts === r.attempt) continue
      r.abort.abort()
      aborted.push(id)
    }
    return aborted
  }

  /**
   * After a settle: when the month's spend has reached a cap, every agent task of that channel (of every channel
   * for the global cap) that has not started yet goes on budget hold, with one budget card in this conversation.
   * Raising the cap releases them (resumeHolds). Returns how many tasks were held.
   */
  holdIfCapReached(channelId: number | null, conversationId: number | null): number {
    return holdIfCapReached(this.deps, channelId, conversationId)
  }

  /**
   * At startup nothing runs yet, so a task still `running` was cut off by a crash or a quit: put it back to ready
   * and give the attempt back (quitting Atelier is not the agent's failure). Returns how many.
   */
  recoverInterrupted(): number {
    // A task whose media job (a render) is still in flight stays running: the job submits its version.
    const keep = (this.deps.media?.activeTaskIds() ?? []).filter((id) => Number.isInteger(id))
    const r = this.deps.db
      .prepare(
        `UPDATE tasks SET status = 'ready', attempts = MAX(attempts - 1, 0), started_at = NULL, updated_at = ?
         WHERE status = 'running'${keep.length ? ` AND id NOT IN (${keep.join(',')})` : ''}`
      )
      .run(new Date().toISOString())
    return Number(r.changes)
  }

  /** Takes a task off hold; the next tick may start it. */
  resume(taskId: number): TaskRow {
    const task = this.deps.workflow.getTask(taskId)
    if (task.holdReason === null) throw new Error(`Task ${taskId} is not on hold`)
    // "Try again" cannot help while the production engine is missing: refuse instead of holding it again.
    if (task.holdReason === PRODUCTION_HOLD && task.deliverableId !== null) {
      const unavailable = this.deps.media?.unavailable?.(this.deps.workflow.getDeliverable(task.deliverableId)) ?? null
      if (unavailable !== null) throw new Error(unavailable)
    }
    // "Try again" after the revision limit: later revisions are counted from here.
    const after = task.holdReason === REVISIONS_HOLD ? `, revisions_resumed_after = (SELECT COALESCE(MAX(id), 0) FROM approvals)` : ''
    this.deps.db.prepare(`UPDATE tasks SET hold_reason = NULL${after}, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), taskId)
    this.deps.notify('videos')
    this.kick()
    return this.deps.workflow.getTask(taskId)
  }

  /** Releases every hold of one kind (a cap was raised: budget; a route or price changed: error). Returns how many. */
  resumeHolds(reason: string = BUDGET_HOLD): number {
    // A raised cap also lifts the holds put on a whole channel when its spend reached the cap.
    const reasons = reason === BUDGET_HOLD ? [BUDGET_HOLD, CAP_HOLD] : [reason]
    const r = this.deps.db
      .prepare(`UPDATE tasks SET hold_reason = NULL, updated_at = ? WHERE hold_reason IN (${reasons.map(() => '?').join(',')})`)
      .run(new Date().toISOString(), ...reasons)
    if (Number(r.changes) > 0) {
      this.deps.notify('videos')
      this.kick()
    }
    return Number(r.changes)
  }

  /** Reservation and turn limit of a tool run (task or chat turn) whose one-turn estimate is `oneTurn`. */
  toolRunLimits(oneTurn: Usage): { estimate: Usage; maxTurns: number } {
    return { estimate: toolRunEstimate(this.deps.settings, oneTurn), maxTurns: toolRunMaxTurns(this.deps.settings) }
  }

  /** Atelier tools for a run (tasks and chat turns), registered on the MCP bridge when the provider needs it. */
  openTools(scope: RunScope, agent: AgentRow, provider: Provider, material: RunMaterial, extra: ExtraTools | null = null, hooks: RunHooks = {}): OpenedTools {
    const run = new ToolRun(this.deps, scope, agent, material, extra, hooks)
    const tools: AgentTools = { specs: run.specs, webSearch: agent.webSearch, call: (n, a) => run.call(n, a) }
    let revoke = (): void => undefined
    const mcp = this.deps.mcp
    if (mcp?.server.listening && provider.id === 'claude-code' && run.specs.length > 0) {
      const reg = mcp.server.register({ specs: run.specs, call: (n, a) => run.call(n, a) })
      revoke = reg.revoke
      tools.mcp = {
        command: mcp.command,
        args: mcp.args,
        env: { ...mcp.env, ELECTRON_RUN_AS_NODE: '1', ATELIER_BRIDGE: mcp.server.address, ATELIER_BRIDGE_TOKEN: reg.token }
      }
    }
    return { run, tools, available: provider.acceptsTools?.(tools) === true, close: revoke }
  }

  // ---- one task -----------------------------------------------------------------------------------------

  private eligible(task: TaskRow): boolean {
    if (this.running.has(task.id) || task.assigneeType !== 'agent' || task.holdReason !== null) return false
    if (task.deliverableId === null || task.videoId === null || task.attempts >= task.maxAttempts) return false
    const d = this.deps.workflow.getDeliverable(task.deliverableId)
    // Narration, thumbnail and edit are files: the owner uploads them, unless a media module makes them.
    if (!isTextDeliverable(d.type) && !this.deps.media?.handles(d)) return false
    const agent = this.deps.agents.find(task.assignee)
    if (!agent?.enabled) return false
    // A failed attempt waits a little before the next one.
    if (task.lastError && task.attempts > 0) {
      const since = this.now() - Date.parse(task.updatedAt)
      if (since < (this.deps.retryDelayMs ?? 20_000)) return false
    }
    return true
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private async runTask(ready: TaskRow, channelId: number, entry: Running): Promise<void> {
    const { workflow, chat, ledger } = this.deps
    const conversationId = chat.open({ kind: 'video', videoId: ready.videoId as number }).id
    const say = (body: string): void => void chat.post(conversationId, { authorType: 'system', body })
    let opened: OpenedTools | null = null
    try {
      const agent = this.deps.agents.get(ready.assignee)
      const ctx = taskContext(workflow, this.deps.agents, agent, ready)
      const title = ctx.deliverable.title
      const route = this.deps.routes.resolve(agent.role)
      const provider = this.deps.getProvider(route.providerId)
      const scope: RunScope = {
        kind: 'task',
        role: agent.role,
        conversationId,
        channelId,
        videoId: ctx.video.id,
        taskId: ready.id
      }
      const row = workflow.getDeliverable(ready.deliverableId as number)
      const media = !isTextDeliverable(row.type) && this.deps.media?.handles(row) ? this.deps.media : null
      const unavailable = media?.unavailable?.(row) ?? null
      // Covered, but not makeable now (no production engine yet): hold it with one message, no model call.
      if (unavailable !== null) return holdUnavailable(this.deps, ready, conversationId, title, unavailable)
      const direct = media?.direct(row) ?? null
      // A media deliverable the module covers without a model.
      if (direct !== null) return this.submitDirect(ready, conversationId, title, agent.role, direct)
      const extra = media ? media.tools(scope, row) : null
      opened = this.openTools(scope, agent, provider, { brief: () => briefText(ctx), inputs: () => inputsText(ctx) }, extra)
      if (media && (!extra || !opened.available)) {
        throw new Error(`${title} needs a model provider that can call tools (Claude Code): change the video_producer route`)
      }
      // The prompt names only the tools this run really has (the media tools are described by the module).
      const atelierTools = opened.run.specs.map((t) => t.name).filter((n): n is AtelierTool => (ATELIER_TOOLS as readonly string[]).includes(n))
      const offered = { ...ctx.agent, tools: atelierTools }
      const { system, prompt } = buildTaskPrompt({
        ...ctx,
        agent: offered,
        toolsAvailable: opened.available,
        media: extra ? { lines: extra.promptLines, deliver: extra.deliver, finish: extra.finish } : null
      })
      const maxTokens = OUTPUT_TOKENS[ctx.deliverable.type] ?? DEFAULT_OUTPUT_TOKENS
      const oneTurn = { inputTokens: approxTokens(system + prompt), outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: 0 }
      // A tool run loops over several turns: reserve for several, and cap the turns.
      const estimate = opened.available ? toolRunEstimate(this.deps.settings, oneTurn) : oneTurn

      let handle
      try {
        const unpricedUsd = unpricedReserveUsd(ledger, this.deps.settings, this.deps.routes, channelId, estimate)
        handle = reserveFor(ledger, route, estimate, { channelId, videoId: ctx.video.id, taskId: ready.id }, unpricedUsd)
      } catch (err) {
        if (err instanceof BudgetExceededError) return holdForBudget(this.deps, ready.id, conversationId, title, err)
        throw err
      }

      let task: TaskRow
      try {
        task = workflow.claimTask(ready.id)
      } catch {
        ledger.release(handle) // someone else moved it (revision, cancel): nothing to do
        return
      }
      entry.attempt = task.attempts
      try {
        if (task.attempts === 1) {
          chat.post(conversationId, {
            authorType: 'agent',
            authorId: agent.role,
            body: `Starting the ${title.toLowerCase()}.`,
            card: { type: 'task', taskId: task.id, title, status: 'running', assignee: agent.role }
          })
        } else {
          say(`${title}: attempt ${task.attempts} of ${task.maxAttempts}.`)
        }
      } catch (err) {
        ledger.release(handle) // the call never ran
        throw err
      }

      let output
      try {
        output = await runReserved(
          ledger,
          handle,
          provider,
          {
            model: route.model,
            system,
            prompt,
            maxTokens,
            ...(route.effort ? { effort: route.effort } : {}),
            ...(opened.available ? { tools: opened.tools, maxTurns: toolRunMaxTurns(this.deps.settings) } : {})
          },
          undefined,
          AbortSignal.any([this.abort.signal, entry.abort.signal])
        )
      } catch (err) {
        if (!this.closed) this.holdIfCapReached(channelId, conversationId)
        // The turn broke after a media job was queued (paid): the job still delivers the version.
        if (media?.afterRun(task.id).kind === 'handed_off') return
        if (err instanceof ProviderError && err.code === 'ABORTED') {
          if (this.closed) return this.fail(task, conversationId, title, 'Stopped (Atelier closed)')
          return say(`${title}: the run was stopped because its task changed (a revision or a cancelled video).`)
        }
        if (err instanceof ProviderError && err.code === 'TURN_LIMIT') return this.failAndHold(task, conversationId, title, errText(err))
        return this.fail(task, conversationId, title, errText(err))
      }
      this.holdIfCapReached(channelId, conversationId)

      if (media) {
        // The agent's turn only starts the render; the job submits the version when the video is downloaded.
        const outcome = media.afterRun(task.id)
        if (outcome.kind === 'handed_off') return
        if (outcome.kind === 'budget') return this.holdAfterRun(task, conversationId, title, outcome.error)
        return this.fail(task, conversationId, title, outcome.message)
      }

      const content = (opened.run.draft ?? output.result.text).trim()
      if (!content) return this.fail(task, conversationId, title, 'The model returned an empty deliverable')
      if (output.result.truncated && opened.run.draft === null) {
        return this.fail(task, conversationId, title, 'The deliverable hit the token limit and was cut short')
      }
      this.submit(task, conversationId, title, agent.role, content, output.costUsd)
    } catch (err) {
      // Unexpected (bad data, closed database): record it on the task when it is ours to fail.
      const current = safeTask(workflow, ready.id)
      if (current?.status === 'running') this.fail(current, conversationId, titleOfTask(workflow, ready), errText(err))
      else if (!this.closed && setHold(this.deps.db, ready.id, ERROR_HOLD)) {
        // Not started (no agent, an unpriced model…): hold it instead of retrying every tick. The card's "Try
        // again" resumes it; changing a route or a price resumes every such hold.
        const title = titleOfTask(workflow, ready)
        chat.post(conversationId, {
          authorType: 'system',
          body: `${title} could not start and is on hold: ${errText(err)}`,
          card: { type: 'task', taskId: ready.id, title, status: 'ready', assignee: ready.assignee }
        })
      }
    } finally {
      opened?.close()
      this.deps.notify('videos')
    }
  }

  private submit(task: TaskRow, conversationId: number, title: string, role: string, content: string, costUsd: number): void {
    const { workflow, chat } = this.deps
    const current = safeTask(workflow, task.id)
    if (current?.status !== 'running' || current.attempts !== task.attempts) {
      chat.post(conversationId, {
        authorType: 'system',
        body: `${title}: this version was discarded because its inputs changed (or the video was cancelled) while it was written.`
      })
      return
    }
    let version
    try {
      version = workflow.submitVersion(task.deliverableId as number, {
        content,
        mime: 'text/markdown',
        author: role,
        taskId: task.id,
        costUsd
      })
    } catch (err) {
      this.fail(task, conversationId, title, `Could not save the version: ${errText(err)}`)
      return
    }
    const d = workflow.getDeliverable(task.deliverableId as number)
    // Waiting for approval: the workflow listener posts the approval card.
    if (d.status !== 'waiting_approval') {
      chat.post(conversationId, {
        authorType: 'agent',
        authorId: role,
        body: `${title} v${version.number} is done${d.status === 'approved' ? ' (auto-approved)' : ''}.\n\n${excerpt(content)}`
      })
    }
  }

  private fail(task: TaskRow, conversationId: number, title: string, error: string): void {
    const { workflow, chat } = this.deps
    let after: TaskRow
    try {
      after = workflow.failTask(task.id, error.slice(0, 2000))
    } catch {
      return // reset or cancelled meanwhile: nothing to record
    }
    chat.post(conversationId, {
      authorType: 'system',
      body:
        after.status === 'failed'
          ? `${title} failed after ${after.attempts} attempts: ${error}. Use "Retry" on the task when the problem is fixed.`
          : `${title} attempt ${after.attempts} failed: ${error}. Retrying shortly.`
    })
  }

  /**
   * A failure that would repeat (the run hit its turn limit): the attempt counts, then the task waits for the owner
   * instead of paying for the same run again. The task card's "Try again" resumes it.
   */
  private failAndHold(task: TaskRow, conversationId: number, title: string, error: string): void {
    let after: TaskRow
    try {
      after = this.deps.workflow.failTask(task.id, error.slice(0, 2000))
    } catch {
      return
    }
    const held = after.status === 'ready' && setHold(this.deps.db, task.id, ERROR_HOLD)
    this.deps.chat.post(conversationId, {
      authorType: 'system',
      body: held
        ? `${title} stopped: ${error}. It is on hold so the same run is not paid again; raise "agents.maxTurns" or simplify the brief, then press "Try again".`
        : `${title} failed after ${after.attempts} attempts: ${error}.`,
      card: { type: 'task', taskId: task.id, title, status: after.status, assignee: task.assignee }
    })
  }

  /** A version the media module gives without a model call: claim, submit at no cost. */
  private submitDirect(ready: TaskRow, conversationId: number, title: string, role: string, content: string): void {
    let task: TaskRow
    try {
      task = this.deps.workflow.claimTask(ready.id)
    } catch {
      return // someone else moved it
    }
    this.submit(task, conversationId, title, role, content, 0)
  }

  /** The agent's turn ran, but its media job was refused by a budget cap: count the attempt, then hold the task. */
  private holdAfterRun(task: TaskRow, conversationId: number, title: string, err: BudgetExceededError): void {
    let after: TaskRow
    try {
      after = this.deps.workflow.failTask(task.id, err.message.slice(0, 2000))
    } catch {
      return
    }
    if (after.status === 'ready') return holdForBudget(this.deps, after.id, conversationId, title, err)
    this.deps.chat.post(conversationId, { authorType: 'system', body: `${title} failed after ${after.attempts} attempts: ${err.message}` })
  }

}

function limit(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 16 ? v : fallback
}

function safeTask(workflow: WorkflowEngine, id: number): TaskRow | null {
  try {
    return workflow.getTask(id)
  } catch {
    return null
  }
}

function titleOfTask(workflow: WorkflowEngine, task: TaskRow): string {
  try {
    return titleOf(workflow.getDeliverable(task.deliverableId as number).type)
  } catch {
    return task.title || 'Task'
  }
}

function excerpt(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
