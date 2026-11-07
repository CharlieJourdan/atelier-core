// A gate decided while no engine ran (the owner approved or sent back an engine-less run): the decision waits in the
// node row (`pending_decision`) and is applied once the relaunched engine reaches that gate.
import type { Run } from '../../../engine/scheduler'
import type { Db } from '../../db'

export function applyPendingDecision(db: Db, runId: number, nodeId: string, engine: Run): void {
  const n = db.prepare('SELECT pending_decision, change_note FROM video_run_nodes WHERE run_id = ? AND node_id = ?').get(runId, nodeId) as
    | { pending_decision: string | null; change_note: string | null }
    | undefined
  if (!n?.pending_decision) return
  db.prepare('UPDATE video_run_nodes SET pending_decision = NULL WHERE run_id = ? AND node_id = ?').run(runId, nodeId)
  const decision = n.pending_decision
  const note = n.change_note ?? ''
  queueMicrotask(() => {
    try {
      if (decision === 'approve') engine.approve(nodeId)
      else engine.requestChange(nodeId, note)
    } catch {
      // the gate was decided meanwhile
    }
  })
}
