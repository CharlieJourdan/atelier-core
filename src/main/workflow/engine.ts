// The workflow engine: videos, the deliverable graph, versions, approvals and tasks. Pure TypeScript over the
// database; no model calls here (the runner of lot 5 drives it through claimTask / submitVersion / failTask).
import {
  DELIVERABLE_GRAPH,
  type ApprovalRow,
  type ChannelPatch,
  type ChannelRow,
  type DeliverableRow,
  type PendingApproval,
  type TaskFilter,
  type TaskRow,
  type VersionInput,
  type VersionRow,
  type VideoDetail,
  type VideoFilter,
  type VideoInput,
  type VideoPatch,
  type VideoRow
} from '../../shared/workflow'
import { nowIso, transaction, type Db } from '../db'
import type { ChannelsStore } from './channels'
import { AwaitingApprovalEvents, type AwaitingApprovalListener, type WorkflowListener } from './events'
import { PRODUCTION_HOLD, WorkflowTasks } from './tasks'
import { checkNote, checkVideoFields } from './validate'
import {
  approvalRow,
  deliverableRow,
  versionRow,
  videoRow,
  type ApprovalDb,
  type DeliverableDb,
  type VersionDb,
  type VideoDb
} from './rows'

export const DEFAULT_MAX_ATTEMPTS = 3

export interface DecisionInput {
  /** 'owner' for a human decision. Owner-gated deliverables refuse any other value. Never defaulted. */
  by: string
  note?: string
  /** If given, must be the current version (guards against deciding on a stale one). */
  versionId?: number
}

export type { AwaitingApprovalListener, WorkflowListener } from './events'

export class WorkflowEngine {
  listener: WorkflowListener | null = null
  private readonly awaiting = new AwaitingApprovalEvents()
  private readonly tasks: WorkflowTasks

  /** Called after a deliverable enters `waiting_approval` (once the transaction committed). Returns an unsubscribe. */
  onAwaitingApproval(listener: AwaitingApprovalListener): () => void {
    return this.awaiting.add(listener)
  }

  private notifyListener(fn: (l: WorkflowListener) => void): void {
    if (!this.listener) return
    try {
      fn(this.listener)
    } catch {
      // Observers must not break the workflow.
    }
  }

  private emitAwaiting(deliverableId: number): void {
    const d = this.getDeliverable(deliverableId)
    if (d.status !== 'waiting_approval') return
    this.notifyListener((l) => l.waitingApproval?.(d))
    this.awaiting.emit(d, this.getVideo(d.videoId))
  }

  constructor(
    private readonly db: Db,
    readonly channels: ChannelsStore
  ) {
    this.tasks = new WorkflowTasks(db)
  }

  // ---- channels -----------------------------------------------------------------------------------------

  /** Updates a channel; new owner gates apply to deliverables not yet submitted or approved. */
  updateChannel(id: number, patch: ChannelPatch): ChannelRow {
    return transaction(this.db, () => {
      const row = this.channels.update(id, patch)
      if (patch.ownerGates !== undefined) {
        for (const def of DELIVERABLE_GRAPH) {
          const gate = row.ownerGates.includes(def.type)
          this.db
            .prepare(
              `UPDATE deliverables SET owner_gate = ?, needs_approval = ?, updated_at = ?
               WHERE type = ? AND status IN ('pending','in_progress','revision_requested')
                 AND video_id IN (SELECT id FROM videos WHERE channel_id = ?)`
            )
            .run(gate ? 1 : 0, def.needsApproval || gate ? 1 : 0, nowIso(), def.type, id)
          // Already under review: the gate flag follows the channel too (needs_approval is already 1).
          this.db
            .prepare(
              `UPDATE deliverables SET owner_gate = ? WHERE type = ? AND status = 'waiting_approval'
                 AND video_id IN (SELECT id FROM videos WHERE channel_id = ?)`
            )
            .run(gate ? 1 : 0, def.type, id)
        }
      }
      return row
    })
  }

  // ---- videos -------------------------------------------------------------------------------------------

  /** Creates the video with its 9 deliverables, the edges and one task per deliverable. */
  createVideo(channelId: number, input: VideoInput = {}): VideoDetail {
    return transaction(this.db, () => {
      const channel = this.channels.get(channelId)
      if (channel.archived) throw new Error(`Channel ${channelId} is archived`)
      checkVideoFields(input)
      this.checkGoal(input.goalId, channelId)
      const res = this.db
        .prepare('INSERT INTO videos (channel_id, goal_id, title, brief, deadline) VALUES (?, ?, ?, ?, ?)')
        .run(channelId, input.goalId ?? null, input.title ?? '', input.brief ?? '', input.deadline ?? null)
      const videoId = Number(res.lastInsertRowid)
      const ids = new Map<string, number>()
      for (const def of DELIVERABLE_GRAPH) {
        const gate = channel.ownerGates.includes(def.type)
        const r = this.db
          .prepare('INSERT INTO deliverables (video_id, type, needs_approval, owner_gate) VALUES (?, ?, ?, ?)')
          .run(videoId, def.type, def.needsApproval || gate ? 1 : 0, gate ? 1 : 0)
        ids.set(def.type, Number(r.lastInsertRowid))
      }
      for (const def of DELIVERABLE_GRAPH) {
        const id = ids.get(def.type) as number
        for (const dep of def.dependsOn) {
          this.db
            .prepare('INSERT INTO deliverable_edges (deliverable_id, depends_on_id) VALUES (?, ?)')
            .run(id, ids.get(dep) as number)
        }
        this.db
          .prepare(
            `INSERT INTO tasks (video_id, deliverable_id, title, assignee_type, assignee, max_attempts)
             VALUES (?, ?, ?, 'agent', ?, ?)`
          )
          .run(videoId, id, def.title, def.role, DEFAULT_MAX_ATTEMPTS)
      }
      this.tasks.refresh(videoId)
      return this.detail(videoId)
    })
  }

  listVideos(filter: VideoFilter = {}): VideoRow[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.channelId !== undefined) {
      where.push('channel_id = ?')
      args.push(filter.channelId)
    }
    if (filter.status !== undefined) {
      where.push('status = ?')
      args.push(filter.status)
    }
    const sql = `SELECT * FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`
    return (this.db.prepare(sql).all(...args) as unknown as VideoDb[]).map(videoRow)
  }

  getVideo(id: number): VideoRow {
    const r = this.db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoDb | undefined
    if (!r) throw new Error(`Video ${id} not found`)
    return videoRow(r)
  }

  detail(videoId: number): VideoDetail {
    return {
      video: this.getVideo(videoId),
      deliverables: this.listDeliverables(videoId),
      tasks: this.listTasks({ videoId })
    }
  }

  updateVideo(id: number, patch: VideoPatch): VideoRow {
    const current = this.getVideo(id)
    checkVideoFields(patch)
    this.checkGoal(patch.goalId, current.channelId)
    const sets: string[] = []
    const args: (string | number | null)[] = []
    const add = (col: string, value: string | number | null | undefined): void => {
      if (value === undefined) return
      sets.push(`${col} = ?`)
      args.push(value)
    }
    add('title', patch.title)
    add('brief', patch.brief)
    add('goal_id', patch.goalId)
    add('deadline', patch.deadline)
    if (sets.length) {
      this.db.prepare(`UPDATE videos SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, nowIso(), id)
    }
    return this.getVideo(id)
  }

  cancelVideo(id: number): VideoRow {
    return transaction(this.db, () => {
      const v = this.getVideo(id)
      if (v.status === 'published') throw new Error('A published video cannot be cancelled')
      const now = nowIso()
      this.db
        .prepare(
          `UPDATE tasks SET status = 'cancelled', finished_at = ?, updated_at = ?
           WHERE video_id = ? AND status NOT IN ('done','cancelled')`
        )
        .run(now, now, id)
      this.db.prepare(`UPDATE videos SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id)
      return this.getVideo(id)
    })
  }

  /** Records that the owner published the video by hand (Atelier never uploads). Needs every gate passed. */
  markPublished(id: number): VideoRow {
    const v = this.getVideo(id)
    if (v.status !== 'ready') throw new Error(`Video ${id} is not ready (status: ${v.status})`)
    this.db.prepare(`UPDATE videos SET status = 'published', updated_at = ? WHERE id = ?`).run(nowIso(), id)
    return this.getVideo(id)
  }

  // ---- deliverables and versions ------------------------------------------------------------------------

  listDeliverables(videoId: number): DeliverableRow[] {
    const rows = this.db.prepare('SELECT * FROM deliverables WHERE video_id = ? ORDER BY id').all(videoId)
    return (rows as unknown as DeliverableDb[]).map(deliverableRow)
  }

  getDeliverable(id: number): DeliverableRow {
    const r = this.db.prepare('SELECT * FROM deliverables WHERE id = ?').get(id) as DeliverableDb | undefined
    if (!r) throw new Error(`Deliverable ${id} not found`)
    return deliverableRow(r)
  }

  listVersions(deliverableId: number): VersionRow[] {
    this.getDeliverable(deliverableId)
    const rows = this.db.prepare('SELECT * FROM versions WHERE deliverable_id = ? ORDER BY number').all(deliverableId)
    return (rows as unknown as VersionDb[]).map(versionRow)
  }

  listApprovals(deliverableId: number): ApprovalRow[] {
    this.getDeliverable(deliverableId)
    const rows = this.db.prepare('SELECT * FROM approvals WHERE deliverable_id = ? ORDER BY id').all(deliverableId)
    return (rows as unknown as ApprovalDb[]).map(approvalRow)
  }

  /** Everything waiting for a human decision, oldest first. */
  pendingApprovals(): PendingApproval[] {
    const rows = this.db
      .prepare(
        `SELECT d.* FROM deliverables d JOIN videos v ON v.id = d.video_id
         WHERE d.status = 'waiting_approval' AND v.status NOT IN ('cancelled','published') ORDER BY d.updated_at, d.id`
      )
      .all() as unknown as DeliverableDb[]
    return rows.map((r) => ({
      deliverable: deliverableRow(r),
      video: this.getVideo(r.video_id),
      version: r.current_version_id === null ? null : this.getVersion(r.current_version_id)
    }))
  }

  /**
   * Saves a new version of a deliverable. It must be unblocked (every dependency approved) and not already
   * under review. Depending on the type and the channel it ends `done`, `approved` (auto-approve) or
   * `waiting_approval`.
   */
  submitVersion(deliverableId: number, input: VersionInput): VersionRow {
    const version = this.saveVersion(deliverableId, input)
    this.emitAwaiting(deliverableId)
    return version
  }

  private saveVersion(deliverableId: number, input: VersionInput): VersionRow {
    return transaction(this.db, () => {
      const d = this.getDeliverable(deliverableId)
      const video = this.getVideo(d.videoId)
      this.assertOpen(video)
      if (!['pending', 'in_progress', 'revision_requested'].includes(d.status)) {
        throw new Error(`Deliverable ${d.type} is ${d.status}: request a revision before submitting a new version`)
      }
      if (!this.tasks.dependenciesSatisfied(d.id)) throw new Error(`Deliverable ${d.type} is blocked by unapproved dependencies`)
      const hasContent = typeof input.content === 'string' && input.content !== ''
      const hasFile = typeof input.filePath === 'string' && input.filePath !== ''
      if (!hasContent && !hasFile) throw new Error('A version needs content or a file path')
      const cost = input.costUsd ?? 0
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw new Error('costUsd must be a non-negative number')
      if (input.taskId !== undefined && input.taskId !== null) {
        const owner = this.getTask(input.taskId)
        if (owner.deliverableId !== d.id) throw new Error(`Task ${input.taskId} does not belong to deliverable ${d.type}`)
      }

      const task = this.tasks.forDeliverable(d.id)
      const next = this.db
        .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM versions WHERE deliverable_id = ?')
        .get(d.id) as { n: number }
      const res = this.db
        .prepare(
          `INSERT INTO versions (deliverable_id, number, content, file_path, mime, cost_usd, author, task_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          d.id,
          next.n,
          hasContent ? (input.content as string) : null,
          hasFile ? (input.filePath as string) : null,
          input.mime ?? null,
          cost,
          input.author ?? null,
          input.taskId ?? task?.id ?? null
        )
      const versionId = Number(res.lastInsertRowid)
      const now = nowIso()

      const channel = this.channels.get(video.channelId)
      const ownerGate = channel.ownerGates.includes(d.type)
      const needsApproval = d.needsApproval || ownerGate
      let status: 'done' | 'approved' | 'waiting_approval' = 'done'
      if (needsApproval) status = !ownerGate && channel.autoApprove.includes(d.type) ? 'approved' : 'waiting_approval'
      this.db
        .prepare('UPDATE deliverables SET owner_gate = ?, needs_approval = ? WHERE id = ?')
        .run(ownerGate ? 1 : 0, needsApproval ? 1 : 0, d.id)
      this.db
        .prepare(
          'UPDATE deliverables SET status = ?, current_version_id = ?, approved_version_id = ?, updated_at = ? WHERE id = ?'
        )
        .run(status, versionId, status === 'approved' ? versionId : null, now, d.id)
      if (status === 'approved') {
        this.db
          .prepare(
            `INSERT INTO approvals (deliverable_id, version_id, decision, decided_by, note)
             VALUES (?, ?, 'auto_approved', 'auto', 'Channel auto-approve')`
          )
          .run(d.id, versionId)
      }
      if (task) {
        const taskStatus = status === 'waiting_approval' ? 'waiting_approval' : 'done'
        this.db
          // A version arrived (an owner upload): the "waiting for the production engine" hold no longer applies.
          .prepare(
            `UPDATE tasks SET status = ?, finished_at = ?, last_error = NULL, updated_at = ?,
               hold_reason = CASE WHEN hold_reason = '${PRODUCTION_HOLD}' THEN NULL ELSE hold_reason END
             WHERE id = ?`
          )
          .run(taskStatus, taskStatus === 'done' ? now : null, now, task.id)
      }
      this.tasks.refresh(d.videoId)
      return this.getVersion(versionId)
    })
  }

  // ---- approvals ----------------------------------------------------------------------------------------

  approve(deliverableId: number, input: DecisionInput): DeliverableRow {
    const d = this.approveTx(deliverableId, input)
    this.notifyListener((l) => l.decided?.(d, 'approved', input.by, input.note ?? ''))
    return d
  }

  private approveTx(deliverableId: number, input: DecisionInput): DeliverableRow {
    return transaction(this.db, () => {
      const d = this.getDeliverable(deliverableId)
      this.assertOpen(this.getVideo(d.videoId))
      const by = input.by
      if (d.status !== 'waiting_approval') throw new Error(`Deliverable ${d.type} is ${d.status}, not waiting for approval`)
      if (d.ownerGate && by !== 'owner') throw new Error(`Deliverable ${d.type} is owner-gated: only the owner can approve it`)
      this.assertCurrent(d, input.versionId)
      const now = nowIso()
      this.db
        .prepare(
          `INSERT INTO approvals (deliverable_id, version_id, decision, decided_by, note) VALUES (?, ?, 'approved', ?, ?)`
        )
        .run(d.id, d.currentVersionId, by, checkNote(input.note))
      this.db
        .prepare(
          `UPDATE deliverables SET status = 'approved', approved_version_id = current_version_id, updated_at = ? WHERE id = ?`
        )
        .run(now, d.id)
      this.db
        .prepare(
          `UPDATE tasks SET status = 'done', finished_at = ?, updated_at = ? WHERE deliverable_id = ? AND status = 'waiting_approval'`
        )
        .run(now, now, d.id)
      this.tasks.refresh(d.videoId)
      return this.getDeliverable(d.id)
    })
  }

  /**
   * Sends a deliverable back with a note. The producer's task is re-opened (fresh attempts) and every
   * deliverable that depends on it, directly or not, is reset to pending with blocked tasks, so nothing
   * downstream keeps running on a superseded input. The next submitted version is number n+1. From the
   * MAX_AUTO_REVISIONS-th request on, the producer's task is held until the owner presses "Try again".
   */
  requestRevision(deliverableId: number, input: DecisionInput): DeliverableRow {
    const d = this.requestRevisionTx(deliverableId, input)
    this.notifyListener((l) => l.decided?.(d, 'revision_requested', input.by, (input.note ?? '').trim()))
    return d
  }

  private requestRevisionTx(deliverableId: number, input: DecisionInput): DeliverableRow {
    return transaction(this.db, () => {
      const d = this.getDeliverable(deliverableId)
      this.assertOpen(this.getVideo(d.videoId))
      const note = checkNote(input.note).trim()
      if (!note) throw new Error('A revision request needs a note')
      if (!['waiting_approval', 'approved', 'done'].includes(d.status)) {
        throw new Error(`Deliverable ${d.type} is ${d.status}: nothing to revise`)
      }
      const by = input.by
      if (d.ownerGate && by !== 'owner') throw new Error(`Deliverable ${d.type} is owner-gated: only the owner can send it back`)
      this.assertCurrent(d, input.versionId)
      const now = nowIso()
      this.db
        .prepare(
          `INSERT INTO approvals (deliverable_id, version_id, decision, decided_by, note)
           VALUES (?, ?, 'revision_requested', ?, ?)`
        )
        .run(d.id, d.currentVersionId, by, note)
      this.db
        .prepare(`UPDATE deliverables SET status = 'revision_requested', approved_version_id = NULL, updated_at = ? WHERE id = ?`)
        .run(now, d.id)
      this.tasks.reset([d.id])
      const downstream = this.db
        .prepare(
          `WITH RECURSIVE down(id) AS (
             SELECT deliverable_id FROM deliverable_edges WHERE depends_on_id = ?
             UNION
             SELECT e.deliverable_id FROM deliverable_edges e JOIN down ON e.depends_on_id = down.id
           ) SELECT id FROM down`
        )
        .all(d.id) as unknown as { id: number }[]
      const ids = downstream.map((r) => r.id)
      if (ids.length) {
        this.db
          .prepare(
            `UPDATE deliverables SET status = 'pending', approved_version_id = NULL, updated_at = ?
             WHERE id IN (${ids.map(() => '?').join(',')})`
          )
          .run(now, ...ids)
        this.tasks.reset(ids)
      }
      this.tasks.holdAfterRevisions(d.id)
      this.tasks.refresh(d.videoId)
      return this.getDeliverable(d.id)
    })
  }

  // ---- tasks --------------------------------------------------------------------------------------------

  listTasks(filter: TaskFilter = {}): TaskRow[] {
    return this.tasks.list(filter)
  }

  getTask(id: number): TaskRow {
    return this.tasks.get(id)
  }

  /** Tasks the runner may start: ready, oldest first. */
  readyTasks(): TaskRow[] {
    return this.tasks.list({ status: 'ready' })
  }

  /** ready → running, one more attempt. */
  claimTask(id: number): TaskRow {
    return this.tasks.claim(id)
  }

  /** running → ready (retry) while attempts remain, else failed. */
  failTask(id: number, error: string): TaskRow {
    return this.tasks.fail(id, error)
  }

  /** failed → ready with fresh attempts (the owner decided to try again). */
  retryTask(id: number): TaskRow {
    return this.tasks.retry(id)
  }

  // ---- internals ----------------------------------------------------------------------------------------

  private getVersion(id: number): VersionRow {
    return versionRow(this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as unknown as VersionDb)
  }

  private checkGoal(goalId: number | null | undefined, channelId: number): void {
    if (goalId === undefined || goalId === null) return
    const g = this.db.prepare('SELECT channel_id FROM goals WHERE id = ?').get(goalId) as { channel_id: number | null } | undefined
    if (!g) throw new Error(`Goal ${goalId} not found`)
    if (g.channel_id !== null && g.channel_id !== channelId) throw new Error(`Goal ${goalId} belongs to another channel`)
  }

  private assertOpen(video: VideoRow): void {
    if (video.status === 'cancelled' || video.status === 'published') throw new Error(`Video ${video.id} is ${video.status}`)
  }

  private assertCurrent(d: DeliverableRow, versionId: number | undefined): void {
    if (d.currentVersionId === null) throw new Error(`Deliverable ${d.type} has no version`)
    if (versionId !== undefined && versionId !== d.currentVersionId) {
      throw new Error(`Version ${versionId} is not the current version of ${d.type}`)
    }
  }

}
