// Task holds of the runner: a task refused by a cap (budget card), one that cannot start (error), and the hold after
// a settle: a run may cost more than its reservation, so once the month's spend reaches a cap, the tasks not started
// yet go on hold (that channel's, or every channel's for the global cap). Raising the cap releases them
// (AgentRunner.resumeHolds).
import type { ChangeTopic } from '../../shared/api'
import type { ChatStore } from '../chat/store'
import type { Db } from '../db'
import type { BudgetExceededError, Ledger } from '../ledger'
import { PRODUCTION_HOLD } from '../workflow/tasks'
import type { TaskRow } from '../../shared/workflow'

export const BUDGET_HOLD = 'budget'
/** Held because the month's settled spend reached a cap (not one task's refusal): lifts once there is room again. */
export const CAP_HOLD = 'cap'

export interface HoldDeps {
  db: Db
  ledger: Ledger
  chat: ChatStore
  notify: (topic: ChangeTopic) => void
}

/** Holds the tasks not started yet when a cap is reached, with one budget card in `conversationId`. Returns how many. */
export function holdIfCapReached(deps: HoldDeps, channelId: number | null, conversationId: number | null): number {
  if (deps.ledger.isClosed) return 0
  const err = deps.ledger.capReached(channelId)
  if (!err) return 0
  const scoped = err.scope === 'channel' && channelId !== null
  const r = deps.db
    .prepare(
      `UPDATE tasks SET hold_reason = ?, updated_at = ?
       WHERE status IN ('ready','blocked') AND hold_reason IS NULL AND assignee_type = 'agent'
         AND video_id IN (SELECT v.id FROM videos v WHERE v.status NOT IN ('cancelled','published')${scoped ? ' AND v.channel_id = ?' : ''})`
    )
    .run(CAP_HOLD, new Date().toISOString(), ...(scoped ? [channelId] : []))
  const held = Number(r.changes)
  if (held > 0) {
    if (conversationId !== null) {
      deps.chat.post(conversationId, {
        authorType: 'system',
        body: `${err.message}. ${held} task(s) not started yet are on hold until the cap is raised.`,
        card: { type: 'budget', scope: err.scope, capUsd: err.capUsd, spentUsd: err.spentUsd, requestedUsd: 0, message: err.message }
      })
    }
    deps.notify('videos')
  }
  return held
}

/**
 * Lifts the cap holds of channels whose spend is under their caps again (a cap raised or removed, a new month).
 * Returns how many tasks were released.
 */
export function releaseCapHolds(deps: HoldDeps): number {
  const channels = deps.db
    .prepare(
      `SELECT DISTINCT v.channel_id AS id FROM tasks t JOIN videos v ON v.id = t.video_id WHERE t.hold_reason = ?`
    )
    .all(CAP_HOLD) as { id: number }[]
  let released = 0
  for (const { id } of channels) {
    if (deps.ledger.capReached(id)) continue
    const r = deps.db
      .prepare(
        `UPDATE tasks SET hold_reason = NULL, updated_at = ?
         WHERE hold_reason = ? AND video_id IN (SELECT id FROM videos WHERE channel_id = ?)`
      )
      .run(new Date().toISOString(), CAP_HOLD, id)
    released += Number(r.changes)
  }
  if (released > 0) deps.notify('videos')
  return released
}

/** ready → on hold. False when the task is no longer ready or already held. */
export function setHold(db: Db, taskId: number, reason: string): boolean {
  const r = db
    .prepare(`UPDATE tasks SET hold_reason = ?, updated_at = ? WHERE id = ? AND status = 'ready' AND hold_reason IS NULL`)
    .run(reason, new Date().toISOString(), taskId)
  return Number(r.changes) > 0
}

/** A media deliverable its module cannot make now (no production engine): on hold, said once; the owner uploads. */
export function holdUnavailable(deps: HoldDeps, ready: TaskRow, conversationId: number, title: string, message: string): void {
  if (!setHold(deps.db, ready.id, PRODUCTION_HOLD)) return
  deps.chat.post(conversationId, {
    authorType: 'system',
    body: `${title} : ${message}`,
    card: { type: 'task', taskId: ready.id, title, status: 'ready', assignee: ready.assignee }
  })
}

/** A task refused by a cap: on hold, with a budget card whose "Try again" resumes it. */
export function holdForBudget(deps: HoldDeps, taskId: number, conversationId: number, title: string, err: BudgetExceededError): void {
  if (!setHold(deps.db, taskId, BUDGET_HOLD)) return
  deps.chat.post(conversationId, {
    authorType: 'system',
    body: `${title} is on hold: ${err.message}`,
    card: {
      type: 'budget',
      scope: err.scope,
      capUsd: err.capUsd,
      spentUsd: err.spentUsd,
      requestedUsd: err.requestedUsd,
      message: err.message,
      taskId
    }
  })
}
