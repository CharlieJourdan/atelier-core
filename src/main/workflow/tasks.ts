// The tasks of the workflow: queries, the runner's transitions (claim / fail / retry), the reset after a revision
// and the readiness refresh (blocked ⇄ ready by dependencies, and the video status). Used by the engine only.
import type { TaskFilter, TaskRow, VideoRow } from '../../shared/workflow'
import { nowIso, transaction, type Db } from '../db'
import { taskRow, videoRow, type DeliverableDb, type TaskDb, type VideoDb } from './rows'

export const SATISFIED = "('approved','done')"
/** Revision requests on one deliverable after which its task waits for the owner instead of rewriting by itself. */
export const MAX_AUTO_REVISIONS = 3
export const REVISIONS_HOLD = 'revisions'
/** A media deliverable whose module cannot make it yet (no production engine): it waits for the owner's upload. */
export const PRODUCTION_HOLD = 'production'

export class WorkflowTasks {
  constructor(private readonly db: Db) {}

  list(filter: TaskFilter = {}): TaskRow[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.videoId !== undefined) {
      where.push('video_id = ?')
      args.push(filter.videoId)
    }
    if (filter.status !== undefined) {
      where.push('status = ?')
      args.push(filter.status)
    }
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`
    return (this.db.prepare(sql).all(...args) as unknown as TaskDb[]).map(taskRow)
  }

  get(id: number): TaskRow {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskDb | undefined
    if (!r) throw new Error(`Task ${id} not found`)
    return taskRow(r)
  }

  forDeliverable(deliverableId: number): TaskRow | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE deliverable_id = ? ORDER BY id DESC LIMIT 1').get(deliverableId) as
      | TaskDb
      | undefined
    return r ? taskRow(r) : null
  }

  /** ready → running, one more attempt. */
  claim(id: number): TaskRow {
    return transaction(this.db, () => {
      const t = this.get(id)
      if (t.status !== 'ready') throw new Error(`Task ${id} is ${t.status}, not ready`)
      if (t.attempts >= t.maxAttempts) throw new Error(`Task ${id} used all ${t.maxAttempts} attempts`)
      const now = nowIso()
      this.db
        .prepare(`UPDATE tasks SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, id)
      if (t.deliverableId !== null) {
        this.db
          .prepare(
            `UPDATE deliverables SET status = 'in_progress', updated_at = ?
             WHERE id = ? AND status IN ('pending','revision_requested')`
          )
          .run(now, t.deliverableId)
      }
      if (t.videoId !== null) this.refresh(t.videoId)
      return this.get(id)
    })
  }

  /** running → ready (retry) while attempts remain, else failed. */
  fail(id: number, error: string): TaskRow {
    return transaction(this.db, () => {
      const t = this.get(id)
      if (t.status !== 'running') throw new Error(`Task ${id} is ${t.status}, not running`)
      const exhausted = t.attempts >= t.maxAttempts
      const now = nowIso()
      this.db
        .prepare('UPDATE tasks SET status = ?, last_error = ?, finished_at = ?, updated_at = ? WHERE id = ?')
        .run(exhausted ? 'failed' : 'ready', error, exhausted ? now : null, now, id)
      return this.get(id)
    })
  }

  /** failed → ready with fresh attempts (the owner decided to try again). */
  retry(id: number): TaskRow {
    return transaction(this.db, () => {
      const t = this.get(id)
      if (t.status !== 'failed') throw new Error(`Task ${id} is ${t.status}, not failed`)
      this.db
        .prepare(`UPDATE tasks SET status = 'blocked', attempts = 0, last_error = NULL, hold_reason = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`)
        .run(nowIso(), id)
      if (t.videoId !== null) this.refresh(t.videoId)
      return this.get(id)
    })
  }

  /**
   * Back to blocked with fresh attempts and no cap/budget/error hold (a revision upstream or of their own
   * deliverable). A `revisions` hold stays: only the owner's "Try again" lifts it.
   */
  reset(deliverableIds: number[]): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = 'blocked', attempts = 0, last_error = NULL,
           hold_reason = CASE WHEN hold_reason = '${REVISIONS_HOLD}' THEN hold_reason ELSE NULL END, started_at = NULL, finished_at = NULL, updated_at = ?
         WHERE deliverable_id IN (${deliverableIds.map(() => '?').join(',')}) AND status <> 'cancelled'`
      )
      .run(nowIso(), ...deliverableIds)
  }

  /**
   * After MAX_AUTO_REVISIONS revision requests on a deliverable its task is held: each rewrite is paid, so the next
   * one waits for the owner's "Try again". Returns true when the task was put on hold.
   */
  holdAfterRevisions(deliverableId: number): boolean {
    const n = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM approvals WHERE deliverable_id = ? AND decision = 'revision_requested'
           AND id > COALESCE((SELECT revisions_resumed_after FROM tasks WHERE deliverable_id = ?), 0)`
      )
      .get(deliverableId, deliverableId) as { n: number }
    if (n.n < MAX_AUTO_REVISIONS) return false
    const r = this.db
      .prepare(`UPDATE tasks SET hold_reason = ?, updated_at = ? WHERE deliverable_id = ? AND status IN ('blocked','ready') AND assignee_type = 'agent'`)
      .run(REVISIONS_HOLD, nowIso(), deliverableId)
    return Number(r.changes) > 0
  }

  dependenciesSatisfied(deliverableId: number): boolean {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM deliverable_edges e JOIN deliverables p ON p.id = e.depends_on_id
         WHERE e.deliverable_id = ? AND p.status NOT IN ${SATISFIED}`
      )
      .get(deliverableId) as { n: number }
    return r.n === 0
  }

  /** Recomputes task readiness (blocked ⇄ ready by dependencies) and the video status. */
  refresh(videoId: number): void {
    const open = `SELECT d.id FROM deliverables d
      WHERE d.status IN ('pending','in_progress','revision_requested') AND NOT EXISTS (
        SELECT 1 FROM deliverable_edges e JOIN deliverables p ON p.id = e.depends_on_id
        WHERE e.deliverable_id = d.id AND p.status NOT IN ${SATISFIED})`
    const now = nowIso()
    this.db
      .prepare(`UPDATE tasks SET status = 'ready', updated_at = ? WHERE video_id = ? AND status = 'blocked' AND deliverable_id IN (${open})`)
      .run(now, videoId)
    this.db
      .prepare(`UPDATE tasks SET status = 'blocked', updated_at = ? WHERE video_id = ? AND status = 'ready' AND deliverable_id NOT IN (${open})`)
      .run(now, videoId)

    const row = this.db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId) as VideoDb | undefined
    if (!row) throw new Error(`Video ${videoId} not found`)
    const video = videoRow(row)
    if (video.status === 'cancelled' || video.status === 'published') return
    const ds = this.db.prepare('SELECT type, status FROM deliverables WHERE video_id = ?').all(videoId) as unknown as Pick<
      DeliverableDb,
      'type' | 'status'
    >[]
    const publish = ds.find((d) => d.type === 'publish_package')
    let status: VideoRow['status']
    if (publish && ['approved', 'done'].includes(publish.status)) status = 'ready'
    else if (ds.some((d) => d.status === 'waiting_approval')) status = 'waiting_approval'
    else if (ds.some((d) => d.status !== 'pending')) status = 'in_progress'
    else status = 'idea'
    if (status !== video.status) {
      this.db.prepare('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?').run(status, now, videoId)
    }
  }
}
