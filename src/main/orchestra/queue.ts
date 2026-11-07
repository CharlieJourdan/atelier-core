// The durable task queue (orch_tasks). Every transition is one guarded UPDATE, so a task is never leased twice and a
// finished task never runs again, whatever the interleaving (tests/unit/orchestra-queue-props.test.ts):
//   queued|failed ──lease (CAS on status + not_before)──▶ leased ──▶ running ──▶ done
//        ▲                                                  │  heartbeat renews lease_expires_at
//        │                                                  ├─▶ waiting (children | accounts | budget) ──▶ queued
//        │                                                  ├─▶ waiting_human ──answer──▶ queued
//        └──── failed (not_before = now + backoff) ◀────────┴─▶ dead (attempts used up: dead letter)
// A lease that expires without a heartbeat is the watchdog's (supervisor.ts); a lease left by a previous run of the app
// is recovered at start (`recover`). Attempts are counted when a lease is taken; waiting for accounts or budget gives
// the attempt back (it was not the task's fault).
import { ORCH_TERMINAL, type OrchTask, type OrchTaskFilter, type OrchTaskStatus } from '../../shared/api/orchestra'
import type { Db } from '../db'
import { transaction } from '../db'
import { iso, isRecord, parseJson, truncate, type Clock, type EventLog } from './util'

export interface NewTask {
  kind: string
  title: string
  assigneeId: number
  payload?: Record<string, unknown>
  priority?: number
  createdBy?: number | null
  parentId?: number | null
  dependsOn?: number[]
  channelId?: number | null
  videoId?: number | null
  maxAttempts?: number
  notBefore?: number | null
  routineId?: number | null
}

export interface QueueOptions {
  /** A lease lasts this long after the last heartbeat (default 10 min). */
  leaseTtlMs: number
  /** Backoff after the first failed attempt, doubled each time (default 30 s), capped (default 30 min). */
  backoffBaseMs: number
  backoffCapMs: number
}

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = { leaseTtlMs: 10 * 60_000, backoffBaseMs: 30_000, backoffCapMs: 30 * 60_000 }

interface TaskDb {
  id: number
  kind: string
  title: string
  payload: string
  priority: number
  assignee_id: number
  created_by: number | null
  parent_id: number | null
  depends_on: string
  channel_id: number | null
  video_id: number | null
  status: OrchTaskStatus
  wait_reason: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  attempts: number
  max_attempts: number
  not_before: string | null
  bumps: number
  account_id: number | null
  routine_id: number | null
  result: string | null
  error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

const KIND_RE = /^[a-z][a-z0-9_]{0,40}$/
const TERMINAL_SQL = ORCH_TERMINAL.map((s) => `'${s}'`).join(',')
/** A parent is woken by its children at most this many times; then it closes with what they returned. */
export const MAX_BUMPS = 4

export class TaskQueue {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog
  readonly opts: QueueOptions

  constructor(db: Db, now: Clock, events: EventLog, opts: Partial<QueueOptions> = {}) {
    this.db = db
    this.now = now
    this.events = events
    this.opts = { ...DEFAULT_QUEUE_OPTIONS, ...opts }
  }

  private nowIso(): string {
    return iso(this.now())
  }

  enqueue(t: NewTask): OrchTask {
    if (!KIND_RE.test(t.kind)) throw new Error(`Invalid task kind: ${String(t.kind)}`)
    const title = typeof t.title === 'string' ? t.title.trim() : ''
    if (!title) throw new Error('A task needs a title')
    const priority = t.priority ?? 5
    if (!Number.isInteger(priority) || priority < 0 || priority > 9) throw new Error('Priority is an integer from 0 to 9')
    const maxAttempts = t.maxAttempts ?? 3
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('maxAttempts is 1 to 20')
    const deps = (t.dependsOn ?? []).filter((d) => Number.isInteger(d))
    for (const d of deps) if (!this.find(d)) throw new Error(`Unknown dependency: task ${d}`)
    const now = this.nowIso()
    const r = this.db
      .prepare(
        `INSERT INTO orch_tasks (kind, title, payload, priority, assignee_id, created_by, parent_id, depends_on, channel_id, video_id,
                                 max_attempts, not_before, routine_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        t.kind,
        truncate(title, 300),
        JSON.stringify(t.payload ?? {}),
        priority,
        t.assigneeId,
        t.createdBy ?? null,
        t.parentId ?? null,
        JSON.stringify(deps),
        t.channelId ?? null,
        t.videoId ?? null,
        maxAttempts,
        t.notBefore ? iso(t.notBefore) : null,
        t.routineId ?? null,
        now,
        now
      )
    const task = this.get(Number(r.lastInsertRowid))
    this.events.add('enqueue', `#${task.id} ${task.kind} "${task.title}"`, task.assigneeId, task.id)
    return task
  }

  find(id: number): OrchTask | null {
    const r = this.db.prepare('SELECT * FROM orch_tasks WHERE id = ?').get(id) as unknown as TaskDb | undefined
    return r ? toTask(r) : null
  }

  get(id: number): OrchTask {
    const t = Number.isInteger(id) ? this.find(id) : null
    if (!t) throw new Error(`Unknown task: ${String(id)}`)
    return t
  }

  list(filter: OrchTaskFilter = {}): OrchTask[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (!isRecord(filter)) filter = {}
    if (Array.isArray(filter.status) && filter.status.length) {
      where.push(`status IN (${filter.status.map(() => '?').join(',')})`)
      args.push(...filter.status.map(String))
    }
    for (const [key, col] of [['assigneeId', 'assignee_id'], ['channelId', 'channel_id'], ['parentId', 'parent_id']] as const) {
      const v = filter[key]
      if (v !== undefined) {
        where.push(`${col} = ?`)
        args.push(Number(v))
      }
    }
    if (typeof filter.kind === 'string') {
      where.push('kind = ?')
      args.push(filter.kind)
    }
    const limit = Number.isInteger(filter.limit) && (filter.limit as number) > 0 ? Math.min(filter.limit as number, 1000) : 200
    const rows = this.db
      .prepare(`SELECT * FROM orch_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...args, limit) as unknown as TaskDb[]
    return rows.map(toTask)
  }

  /** Tasks that may start now, best first: queued or failed, past `not_before`, dependencies finished, agent not paused. */
  runnable(limit = 50): OrchTask[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM orch_tasks t JOIN orch_agents a ON a.id = t.assignee_id
         WHERE t.status IN ('queued','failed') AND (t.not_before IS NULL OR t.not_before <= ?) AND a.paused = 0 AND a.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM json_each(t.depends_on) d JOIN orch_tasks dt ON dt.id = d.value
                           WHERE dt.status NOT IN (${TERMINAL_SQL}))
         ORDER BY t.priority DESC, t.id LIMIT ?`
      )
      .all(this.nowIso(), limit) as unknown as TaskDb[]
    return rows.map(toTask)
  }

  /** Takes the lease (compare-and-set): null when someone else has it, it is not runnable, or not yet due. */
  lease(id: number, owner: string, accountId: number | null = null): OrchTask | null {
    const now = this.now()
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'leased', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, attempts = attempts + 1,
           account_id = COALESCE(?, account_id), wait_reason = NULL, started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ? AND status IN ('queued','failed') AND (not_before IS NULL OR not_before <= ?)`
      )
      .run(owner, iso(now + this.opts.leaseTtlMs), iso(now), accountId, iso(now), iso(now), id, iso(now))
    if (Number(r.changes) !== 1) return null
    const t = this.get(id)
    this.events.add('lease', `#${id} leased (attempt ${t.attempts}/${t.maxAttempts})`, t.assigneeId, id)
    return t
  }

  markRunning(id: number, owner: string, accountId: number | null): boolean {
    const r = this.db
      .prepare(`UPDATE orch_tasks SET status = 'running', account_id = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND status IN ('leased','running')`)
      .run(accountId, this.nowIso(), id, owner)
    return Number(r.changes) === 1
  }

  /** Renews the lease while the run shows signs of life. False when the lease was lost (expired and taken back). */
  heartbeat(id: number, owner: string): boolean {
    const now = this.now()
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET heartbeat_at = ?, lease_expires_at = ? WHERE id = ? AND lease_owner = ? AND status IN ('leased','running')`
      )
      .run(iso(now), iso(now + this.opts.leaseTtlMs), id, owner)
    return Number(r.changes) === 1
  }

  /** The run finished: done. False when the lease was lost meanwhile (the result is dropped). */
  complete(id: number, owner: string, result: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'done', result = ?, error = NULL, lease_owner = NULL, lease_expires_at = NULL, wait_reason = NULL,
           finished_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND status IN ('leased','running')`
      )
      .run(truncate(result, 20_000), this.nowIso(), this.nowIso(), id, owner)
    if (Number(r.changes) !== 1) return false
    this.events.add('done', `#${id} done`, this.get(id).assigneeId, id)
    return true
  }

  /**
   * A failed attempt: retried after the backoff (`failed`), or dead when the attempts are used up. `owner` null takes
   * any lease (the watchdog, recovery). Returns the new status, or null when the task was not leased by `owner`.
   */
  fail(id: number, owner: string | null, error: string, opts: { retryNow?: boolean } = {}): 'failed' | 'dead' | null {
    const t = this.find(id)
    if (!t || !['leased', 'running'].includes(t.status) || (owner !== null && t.leaseOwner !== owner)) return null
    const dead = t.attempts >= t.maxAttempts
    const delay = opts.retryNow ? 0 : Math.min(this.opts.backoffBaseMs * 2 ** Math.max(0, t.attempts - 1), this.opts.backoffCapMs)
    const now = this.now()
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = ?, error = ?, lease_owner = NULL, lease_expires_at = NULL, not_before = ?,
           finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('leased','running') AND lease_owner IS ?`
      )
      .run(dead ? 'dead' : 'failed', truncate(error, 4000), dead ? null : iso(now + delay), dead ? iso(now) : null, iso(now), id, t.leaseOwner)
    if (Number(r.changes) !== 1) return null
    this.events.add(
      dead ? 'dead' : 'retry',
      dead ? `#${id} dead after ${t.attempts} attempt(s): ${truncate(error, 200)}` : `#${id} failed (${truncate(error, 200)}), retry in ${Math.round(delay / 1000)}s`,
      t.assigneeId,
      id
    )
    return dead ? 'dead' : 'failed'
  }

  /** Parks a leased task without counting the attempt: waiting for accounts or budget until `until` (ms). */
  park(id: number, owner: string, reason: 'accounts' | 'budget', until: number | null): boolean {
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'waiting', wait_reason = ?, not_before = ?, attempts = MAX(0, attempts - 1), lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_owner = ? AND status IN ('leased','running')`
      )
      .run(reason, until === null ? null : iso(until), this.nowIso(), id, owner)
    return Number(r.changes) === 1
  }

  /** Charlie's red stop: a leased or running task goes back to the queue, the attempt in flight given back. */
  requeue(id: number, why: string): boolean {
    const t = this.find(id)
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'queued', wait_reason = NULL, attempts = MAX(0, attempts - 1), lease_owner = NULL,
           lease_expires_at = NULL, not_before = NULL, updated_at = ? WHERE id = ? AND status IN ('leased','running')`
      )
      .run(this.nowIso(), id)
    if (Number(r.changes) !== 1) return false
    this.events.add('requeue', `#${id} back in the queue: ${why}`, t?.assigneeId ?? null, id)
    return true
  }

  /** The run delegated sub-tasks: the task sleeps until they finish (then `bumpParents` wakes it). */
  waitChildren(id: number, owner: string, partial: string): boolean {
    return this.toWaiting(id, owner, 'waiting', 'children', partial)
  }

  /** The run asked the user something: the task sleeps until the inbox item is answered. */
  waitHuman(id: number, owner: string, partial: string): boolean {
    return this.toWaiting(id, owner, 'waiting_human', 'human', partial)
  }

  private toWaiting(id: number, owner: string, status: 'waiting' | 'waiting_human', reason: string, partial: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = ?, wait_reason = ?, result = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND lease_owner = ? AND status IN ('leased','running')`
      )
      .run(status, reason, truncate(partial, 20_000), this.nowIso(), id, owner)
    return Number(r.changes) === 1
  }

  /** A human answer: the task goes back to the queue with fresh attempts and the answer in its payload. */
  resumeHuman(id: number, answer: Record<string, unknown>): boolean {
    const t = this.get(id)
    if (t.status !== 'waiting_human') return false
    const payload = { ...t.payload, human: [...asArray(t.payload.human), answer] }
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'queued', wait_reason = NULL, payload = ?, attempts = 0, not_before = NULL, updated_at = ?
         WHERE id = ? AND status = 'waiting_human'`
      )
      .run(JSON.stringify(payload), this.nowIso(), id)
    if (Number(r.changes) === 1) this.events.add('resume', `#${id} resumed with the user's answer`, t.assigneeId, id)
    return Number(r.changes) === 1
  }

  patchPayload(id: number, patch: Record<string, unknown>): void {
    const t = this.get(id)
    this.db.prepare('UPDATE orch_tasks SET payload = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...t.payload, ...patch }), this.nowIso(), id)
  }

  /** Leases past their expiry (no heartbeat): the watchdog kills the run and retries the task. */
  expired(): OrchTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM orch_tasks WHERE status IN ('leased','running') AND lease_expires_at < ? ORDER BY id`)
      .all(this.nowIso()) as unknown as TaskDb[]
    return rows.map(toTask)
  }

  /** Leases of other owners (a previous run of the app): nothing runs them any more. */
  orphans(owner: string): OrchTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM orch_tasks WHERE status IN ('leased','running') AND lease_owner IS NOT ? ORDER BY id`)
      .all(owner) as unknown as TaskDb[]
    return rows.map(toTask)
  }

  children(id: number): OrchTask[] {
    return (this.db.prepare('SELECT * FROM orch_tasks WHERE parent_id = ? ORDER BY id').all(id) as unknown as TaskDb[]).map(toTask)
  }

  /**
   * Auto-bump: a parent waiting on sub-tasks that have all finished goes back to the queue (fresh attempts) with their
   * results in `payload.childResults`; after MAX_BUMPS wake-ups it is closed with them instead. Returns the bumped ids.
   */
  bumpParents(): number[] {
    const parents = this.db
      .prepare(
        `SELECT p.* FROM orch_tasks p WHERE p.status = 'waiting' AND p.wait_reason = 'children'
           AND NOT EXISTS (SELECT 1 FROM orch_tasks c WHERE c.parent_id = p.id AND c.status NOT IN (${TERMINAL_SQL}))`
      )
      .all() as unknown as TaskDb[]
    const bumped: number[] = []
    for (const row of parents) {
      const p = toTask(row)
      const results = this.children(p.id).map((c) => ({
        taskId: c.id,
        assigneeId: c.assigneeId,
        title: c.title,
        status: c.status,
        result: c.result ? truncate(c.result, 3000) : null,
        error: c.error ? truncate(c.error, 500) : null
      }))
      const now = this.nowIso()
      transaction(this.db, () => {
        if (p.bumps >= MAX_BUMPS) {
          const summary = results.map((r) => `#${r.taskId} ${r.status}: ${r.result ?? r.error ?? ''}`).join('\n')
          this.db
            .prepare(`UPDATE orch_tasks SET status = 'done', wait_reason = NULL, result = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting'`)
            .run(truncate(`${p.result ?? ''}\n${summary}`.trim(), 20_000), now, now, p.id)
          return
        }
        this.db
          .prepare(
            `UPDATE orch_tasks SET status = 'queued', wait_reason = NULL, attempts = 0, not_before = NULL, bumps = bumps + 1, payload = ?, updated_at = ?
             WHERE id = ? AND status = 'waiting'`
          )
          .run(JSON.stringify({ ...p.payload, childResults: results }), now, p.id)
      })
      this.events.add('bump', `#${p.id} woken: ${results.length} sub-task(s) finished`, p.assigneeId, p.id)
      bumped.push(p.id)
    }
    return bumped
  }

  /** Tasks parked for accounts or budget whose time has come go back to the queue. */
  wakeParked(): number {
    const r = this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'queued', wait_reason = NULL, updated_at = ?
         WHERE status = 'waiting' AND wait_reason IN ('accounts','budget') AND not_before IS NOT NULL AND not_before <= ?`
      )
      .run(this.nowIso(), this.nowIso())
    return Number(r.changes)
  }

  /** Cancels a task and its unfinished descendants. Returns the ids cancelled. */
  cancel(id: number): number[] {
    const out: number[] = []
    const visit = (tid: number, depth: number): void => {
      const t = this.get(tid)
      if (!ORCH_TERMINAL.includes(t.status)) {
        this.db
          .prepare(
            `UPDATE orch_tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?`
          )
          .run(this.nowIso(), this.nowIso(), tid)
        out.push(tid)
      }
      if (depth < 20) for (const c of this.children(tid)) visit(c.id, depth + 1)
    }
    visit(id, 0)
    if (out.length) this.events.add('cancel', `#${id} cancelled (${out.length} task(s))`, this.get(id).assigneeId, id)
    return out
  }

  /** A dead, failed or cancelled task goes back to the queue with fresh attempts. */
  retry(id: number): OrchTask {
    const t = this.get(id)
    if (!['dead', 'failed', 'cancelled'].includes(t.status)) throw new Error(`Task ${id} is ${t.status}: only a dead, failed or cancelled task can be retried`)
    this.db
      .prepare(
        `UPDATE orch_tasks SET status = 'queued', attempts = 0, error = NULL, not_before = NULL, finished_at = NULL, wait_reason = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(this.nowIso(), id)
    this.events.add('retry', `#${id} sent back to the queue by hand`, t.assigneeId, id)
    return this.get(id)
  }

  counts(): Partial<Record<OrchTaskStatus, number>> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM orch_tasks GROUP BY status').all() as { status: OrchTaskStatus; n: number }[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  /** Finished tasks since `sinceMs`, for the digest. */
  finishedSince(sinceMs: number): OrchTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM orch_tasks WHERE status IN ('done','dead') AND finished_at >= ? ORDER BY id`)
      .all(iso(sinceMs)) as unknown as TaskDb[]
    return rows.map(toTask)
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function toTask(r: TaskDb): OrchTask {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    payload: parseJson<Record<string, unknown>>(r.payload, {}),
    priority: r.priority,
    assigneeId: r.assignee_id,
    createdBy: r.created_by,
    parentId: r.parent_id,
    dependsOn: parseJson<number[]>(r.depends_on, []),
    channelId: r.channel_id,
    videoId: r.video_id,
    status: r.status,
    waitReason: r.wait_reason,
    leaseOwner: r.lease_owner,
    leaseExpiresAt: r.lease_expires_at,
    heartbeatAt: r.heartbeat_at,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    notBefore: r.not_before,
    bumps: r.bumps,
    accountId: r.account_id,
    routineId: r.routine_id,
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}
