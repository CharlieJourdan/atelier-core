// The supervisor loop. One `tick()` (every few seconds in the app, by hand in tests and the demo, clock injectable):
//   1. watchdog — a lease past its expiry (no heartbeat) or a run past `orchestra.maxRunMs`: the run is aborted, which
//      makes the provider kill the CLI's whole process tree (platform killTree: taskkill /T /F, or SIGKILL to the
//      group), and the task is retried after its backoff, or dead-lettered once its attempts are used up;
//   2. routines that are due enqueue their task (one open task per routine at a time); then the proactive work: the
//      heartbeat and the planner (`proactive`, wired by runtime.ts: heartbeat.ts, planner.ts);
//   3. auto-bump: parents whose sub-tasks all finished wake up; tasks parked for accounts or budget whose time came
//      go back to the queue; "work resumes" is announced when accounts come back;
//   4. scheduling — runnable tasks, best first, within the global limit (`orchestra.maxConcurrent`), one task per agent,
//      on an account picked for the task's tier with a free slot; when every account for the tier is limited the task
//      waits (`waiting`, reason `accounts`) and the principal's conversation says when work resumes;
//   5. agent statuses are refreshed (an agent with nothing to do sleeps: no call, no token).
// While Charlie paused the team (power.ts) a pass only runs the watchdog.
// At start, `recover()` takes back the leases a previous run of the app left (a crash, a quit mid-run): the task is
// retried at once (its CLI session is resumed when possible), or dead-lettered if it had no attempt left.
import { randomUUID } from 'node:crypto'
import type { OrchTask, OrchTickResult } from '../../shared/api/orchestra'
import { t } from '../../shared/fr'
import { sayNoAccount } from './account-health'
import { deadLetter } from './actions'
import { DEFAULTS, SETTINGS, intSetting, type RunHandle, type RuntimeParts } from './parts'
import type { Route } from './routing'
import type { TurnEngine } from './turn'
import { iso } from './util'

export function newOwnerId(): string {
  return `sup-${randomUUID().slice(0, 8)}`
}

export class Supervisor {
  private readonly p: RuntimeParts
  private readonly turn: TurnEngine
  readonly running = new Map<number, RunHandle>()
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking: Promise<OrchTickResult> | null = null
  private kickPending = false
  private closed = false
  /** Counts `stop()` calls: a pass that awaited the planner starts nothing when the team was stopped meanwhile. */
  private stops = 0
  /** While every account is limited: when work resumes (announced once). */
  private blockedUntil: number | null = null
  /** No subscription account works (logged out, none connected): said once, and once per message waiting. */
  private noAccount = false
  private readonly toldNoAccount = new Set<number>()
  /** Charlie paused the team (power.ts): the watchdog still runs; no routine fires, no turn starts. */
  paused: () => boolean = () => false
  /** The heartbeat and the planner (runtime.ts): returns the planned steps opened. Not while paused. */
  proactive: (() => Promise<number>) | null = null

  constructor(p: RuntimeParts, turn: TurnEngine) {
    this.p = p
    this.turn = turn
    turn.onAllLimited = (until) => this.announceBlocked(until)
    turn.onNoAccount = (task) => this.announceNoAccount(task)
  }

  maxConcurrent(): number {
    return intSetting(this.p.settings, SETTINGS.maxConcurrent, DEFAULTS.maxConcurrent, 1, 32)
  }

  /** Leases left by a previous run of the app. Returns how many tasks were taken back. */
  recover(): number {
    const p = this.p
    let n = 0
    for (const t of p.queue.orphans(p.owner)) {
      if (this.running.has(t.id)) continue
      const status = p.queue.fail(t.id, null, 'Interrupted: Atelier stopped while the task was running', { retryNow: true })
      if (status === 'dead') deadLetter(p, t.id, 'Interrupted by a restart with no attempt left')
      if (status) n++
    }
    if (n) p.events.add('recover', `${n} interrupted task(s) taken back after a restart`)
    p.tree.refreshAll()
    return n
  }

  /** One pass of the loop; concurrent calls share the pass in flight. */
  tick(): Promise<OrchTickResult> {
    if (this.ticking) return this.ticking
    this.ticking = Promise.resolve()
      .then(() => this.pass())
      .finally(() => {
        this.ticking = null
      })
    return this.ticking
  }

  private async pass(): Promise<OrchTickResult> {
    const p = this.p
    const result: OrchTickResult = { started: 0, expired: 0, recovered: 0, routines: 0, bumped: 0, waitingAccounts: 0, planned: 0 }
    if (this.closed) return result
    result.expired = this.watchdog()
    if (this.paused()) {
      p.tree.refreshAll()
      return result
    }
    result.routines = this.fireRoutines()
    if (this.proactive) {
      const stops = this.stops
      try {
        result.planned = await this.proactive()
      } catch (err: unknown) {
        // a planner bug must not stop the loop: it is said, and the next pass tries again
        p.events.add('error', `Planner: ${err instanceof Error ? err.message : String(err)}`)
      }
      // while it awaited (a quote), Charlie may have stopped, switched off or paused the team: then nothing starts
      if (this.closed || this.stops !== stops || this.paused()) {
        p.tree.refreshAll()
        return result
      }
    }
    result.bumped = p.queue.bumpParents().length
    p.queue.wakeParked()
    this.announceResumed()
    const s = this.schedule()
    result.started = s.started
    result.waitingAccounts = s.waiting
    p.tree.refreshAll()
    return result
  }

  // ---- 1. watchdog --------------------------------------------------------------------------------------

  private watchdog(): number {
    const p = this.p
    const now = p.now()
    const maxRunMs = intSetting(p.settings, SETTINGS.maxRunMs, DEFAULTS.maxRunMs, 1000, 24 * 3_600_000)
    const victims = new Map<number, string>()
    for (const t of p.queue.expired()) victims.set(t.id, `Watchdog: no heartbeat since ${t.heartbeatAt ?? t.startedAt ?? '?'} (lease expired ${t.leaseExpiresAt})`)
    for (const h of this.running.values()) {
      if (!victims.has(h.taskId) && now - h.startedAt > maxRunMs) victims.set(h.taskId, `Watchdog: run longer than ${Math.round(maxRunMs / 60_000)} min`)
    }
    let n = 0
    for (const [taskId, why] of victims) {
      const h = this.running.get(taskId)
      if (h) this.kill(h, why)
      const status = p.queue.fail(taskId, null, why)
      if (status === 'dead') deadLetter(p, taskId, why)
      if (status) n++
    }
    return n
  }

  /** Aborts a run: the provider kills the CLI's process tree. */
  kill(h: RunHandle, why: string): void {
    if (h.killed) return
    h.killed = true
    this.p.events.add('kill', `#${h.taskId} killed: ${why}`, h.agentId, h.taskId)
    h.controller.abort()
  }

  // ---- 2. routines --------------------------------------------------------------------------------------

  private fireRoutines(): number {
    const p = this.p
    let n = 0
    for (const r of p.routines.due()) {
      p.routines.markRun(r.id)
      const open = p.db
        .prepare(`SELECT 1 FROM orch_tasks WHERE routine_id = ? AND status NOT IN ('done','dead','cancelled')`)
        .get(r.id)
      if (open) {
        p.events.add('routine', `${r.name}: previous run still open, skipped`, r.agentId)
        continue
      }
      let agent
      try {
        agent = p.tree.get(r.agentId)
      } catch {
        continue
      }
      const brief = typeof r.payload.brief === 'string' ? r.payload.brief : ''
      p.queue.enqueue({
        kind: r.kind,
        title: typeof r.payload.title === 'string' ? r.payload.title : r.name,
        assigneeId: agent.id,
        payload: { brief, routine: r.name },
        priority: 4,
        channelId: agent.channelId,
        routineId: r.id
      })
      p.events.add('routine', `${r.name} fired for ${agent.name}`, agent.id)
      n++
    }
    return n
  }

  // ---- 3. accounts announcements ------------------------------------------------------------------------

  private announceBlocked(until: number): void {
    const p = this.p
    if (this.blockedUntil !== null && Math.abs(this.blockedUntil - until) < 60_000) return
    this.blockedUntil = until
    const at = new Date(until)
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    const text = `Tous les comptes sont à leur limite d'usage : le travail reprend vers ${hhmm} (${iso(until)}). Les tâches attendent, rien n'est perdu.`
    p.events.add('blocked', text)
    try {
      const principal = p.tree.principal()
      const conv = p.messaging.conversationFor('principal', null, null)
      if (principal) p.messaging.post(principal, conv, text, 99)
      else p.messaging.system(conv, text)
    } catch {
      // chat unavailable (closing)
    }
  }

  /**
   * No subscription account works: the chat answers at once with what to click (account-health.ts). A message to an
   * agent is answered in its own conversation (once per message); anything else is said once in the principal's.
   */
  announceNoAccount(task: OrchTask): void {
    const mention = task.kind === 'mention' && typeof task.payload.conversationId === 'number'
    if (mention ? this.toldNoAccount.has(task.id) : this.noAccount) return
    if (mention) this.toldNoAccount.add(task.id)
    this.noAccount = true
    sayNoAccount(this.p, mention ? task : null)
  }

  private announceResumed(): void {
    if (this.blockedUntil === null && !this.noAccount) return
    const p = this.p
    const free = p.accounts.usableSubscriptions().length > 0
    if (!free) return
    const text = this.noAccount && this.blockedUntil === null ? t('llmAccess.chat.back') : 'Un compte est de nouveau disponible : le travail reprend.'
    this.blockedUntil = null
    this.noAccount = false
    this.toldNoAccount.clear()
    p.events.add('resumed', text)
    try {
      const principal = p.tree.principal()
      const conv = p.messaging.conversationFor('principal', null, null)
      if (principal) p.messaging.post(principal, conv, text, 99)
    } catch {
      // chat unavailable
    }
  }

  // ---- 4. scheduling ------------------------------------------------------------------------------------

  private schedule(): { started: number; waiting: number } {
    const p = this.p
    let started = 0
    let waiting = 0
    const max = this.maxConcurrent()
    const busyAgents = new Set([...this.running.values()].map((h) => h.agentId))
    for (const task of p.queue.runnable(100)) {
      if (this.running.size >= max) break
      if (this.running.has(task.id) || busyAgents.has(task.assigneeId)) continue
      const agent = p.tree.get(task.assigneeId)
      const route = p.router.resolve(task.kind, agent.policy)
      const account = p.accounts.pick(route.tier)
      if (!account) {
        const avail = p.accounts.availability(route.tier)
        if (avail.allLimited) {
          // Leased then parked, so the wait is visible on the task (the attempt is given back).
          if (p.queue.lease(task.id, p.owner)) {
            const until = avail.resumesAt ?? p.now() + 3_600_000
            p.queue.park(task.id, p.owner, 'accounts', until)
            if (avail.resumesAt !== null) this.announceBlocked(until)
            else this.announceNoAccount(task)
            waiting++
          }
        }
        continue
      }
      const leased = p.queue.lease(task.id, p.owner, account.id)
      if (!leased) continue
      this.launch(leased, account.id, route)
      busyAgents.add(task.assigneeId)
      started++
    }
    return { started, waiting }
  }

  private launch(task: OrchTask, accountId: number, route: Route): void {
    const p = this.p
    p.accounts.acquire(accountId)
    const now = p.now()
    const h: RunHandle = {
      taskId: task.id,
      agentId: task.assigneeId,
      accountId,
      controller: new AbortController(),
      killed: false,
      startedAt: now,
      lastBeatAt: now,
      done: Promise.resolve()
    }
    this.running.set(task.id, h)
    h.done = this.turn
      .run(task, h, route)
      .catch((err: unknown) => {
        // A bug in the turn engine must not kill the loop: the attempt fails like any other error.
        const message = err instanceof Error ? err.message : String(err)
        p.events.add('error', `#${task.id} turn crashed: ${message}`, task.assigneeId, task.id)
        try {
          if (p.queue.fail(task.id, p.owner, `Runtime error: ${message}`) === 'dead') deadLetter(p, task.id, message)
        } catch {
          // database closed (quit)
        }
      })
      .finally(() => {
        p.accounts.release(h.accountId)
        if (this.running.get(task.id) === h) this.running.delete(task.id)
        try {
          p.tree.refreshStatus(task.assigneeId)
        } catch {
          // database closed (quit)
        }
        this.kick()
      })
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------

  /** Resolves when no run is in flight (tests, the demo, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()].map((h) => h.done))
  }

  start(intervalMs = 5000): void {
    if (this.timer || this.closed) return
    this.timer = setInterval(() => void this.tick().catch(() => undefined), intervalMs)
    this.timer.unref?.()
    this.kick()
  }

  get started(): boolean {
    return this.timer !== null
  }

  /** A tick soon (a new task, a finished run, an answer). Only while the loop runs: tests tick by hand. */
  kick(): void {
    if (!this.timer || this.kickPending || this.closed) return
    this.kickPending = true
    setImmediate(() => {
      this.kickPending = false
      void this.tick().catch(() => undefined)
    })
  }

  stop(): void {
    this.stops++
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Quit: stop the loop and kill every run (their leases are recovered at the next start). */
  close(): void {
    this.closed = true
    this.stop()
    for (const h of this.running.values()) {
      h.killed = true
      h.controller.abort()
    }
  }
}
