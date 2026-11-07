// Engine events → `video_run_nodes` / `video_runs` rows (lot Z1). Pure DB writes, synchronous; the service decides
// what to do next (pending gate decisions, money, notifications).
import type { EngineEvent } from '../../../engine/types'
import type { Db } from '../../db'
import { errorMessage } from './labels'

export interface Applied {
  /** The run row no longer exists (deleted with its video or the example workspace). */
  gone: boolean
  /** A node reached its gate. */
  gate?: string
}

export function applyEvent(db: Db, runId: number, e: EngineEvent, now: string): Applied {
  const upd = (sql: string, ...args: (string | number | null)[]): number =>
    Number(db.prepare(`UPDATE video_run_nodes SET ${sql} WHERE run_id = ? AND node_id = ?`).run(...args, runId, 'nodeId' in e ? e.nodeId : '').changes)
  let changes = 1
  switch (e.kind) {
    case 'state':
      if (e.state === 'pending') changes = upd(
          "state = 'pending', progress = 0, step = NULL, error_code = NULL, error_message = NULL, error_detail = NULL, gate = CASE WHEN gate = 'waiting' THEN 'none' ELSE gate END"
        )
      else if (e.state === 'waiting_gate') changes = upd("state = 'waiting_gate', gate = 'waiting'")
      else if (e.state === 'done' || e.state === 'cached') changes = upd('state = ?, progress = 1', e.state)
      else changes = upd('state = ?', e.state)
      break
    case 'start':
      changes = upd('started_at = ?, finished_at = NULL, progress = 0, step = NULL', now)
      break
    case 'progress':
      changes = upd('progress = ?, step = COALESCE(?, step)', e.frac, e.text ?? null)
      break
    case 'cached':
      changes = upd('fingerprint = ?, progress = 1, step = NULL, finished_at = COALESCE(finished_at, ?)', e.fingerprint, now)
      break
    case 'gate':
      changes = upd("gate = 'waiting', fingerprint = ?", e.fingerprint)
      return { gone: changes === 0, gate: e.nodeId }
    case 'retry':
      if (e.code === 'change_requested') {
        changes = upd("previous_fingerprint = fingerprint, fingerprint = NULL, gate = 'changes_requested', progress = 0, step = NULL, finished_at = NULL")
      } else {
        changes = upd('progress = 0, step = ?', `Nouvel essai (${e.attempt})…`)
      }
      break
    case 'done':
      changes = upd(
        "fingerprint = ?, progress = 1, finished_at = ?, pending_decision = NULL, gate =CASE WHEN gate IN ('waiting','changes_requested') THEN 'approved' ELSE gate END",
        e.fingerprint,
        now
      )
      break
    case 'error':
      changes = upd('error_code = ?, error_message = ?, error_detail = ?, finished_at = ?', e.code, errorMessage(e.code, e.message), e.message.slice(0, 2000), now)
      break
    case 'cancelled':
      changes = upd("finished_at = ?, gate = CASE WHEN gate = 'waiting' THEN 'none' ELSE gate END", now)
      break
    case 'artefact':
    case 'log':
    case 'run':
      return { gone: db.prepare('SELECT 1 FROM video_runs WHERE id = ?').get(runId) === undefined }
  }
  if (changes === 0) return { gone: db.prepare('SELECT 1 FROM video_runs WHERE id = ?').get(runId) === undefined }
  return { gone: false }
}

/** While an engine is live: `waiting` when a gate waits and nothing else is queued or running, else `running`. */
export function refreshLiveStatus(db: Db, runId: number): void {
  const r = db
    .prepare(
      `SELECT SUM(CASE WHEN gate = 'waiting' THEN 1 ELSE 0 END) AS waiting,
              SUM(CASE WHEN state IN ('queued','running') THEN 1 ELSE 0 END) AS busy
       FROM video_run_nodes WHERE run_id = ?`
    )
    .get(runId) as { waiting: number | null; busy: number | null }
  const status = (r.waiting ?? 0) > 0 && (r.busy ?? 0) === 0 ? 'waiting' : 'running'
  db.prepare("UPDATE video_runs SET status = ? WHERE id = ? AND status IN ('queued','running','waiting') AND status <> ?").run(status, runId, status)
}

/**
 * A node failed for good while the only things left are gates waiting for a human (QA B3): the film cannot be finished, so
 * asking for a validation would be asking about a doomed video. The ids of the failed nodes, or null.
 */
export function doomedByError(db: Db, runId: number): string[] | null {
  const rows = db.prepare('SELECT node_id, state, gate FROM video_run_nodes WHERE run_id = ?').all(runId) as { node_id: string; state: string; gate: string }[]
  const failed = rows.filter((n) => n.state === 'error')
  const busy = rows.some((n) => n.state === 'queued' || n.state === 'running')
  const waiting = rows.some((n) => n.gate === 'waiting')
  return failed.length > 0 && !busy && waiting ? failed.map((n) => n.node_id) : null
}
