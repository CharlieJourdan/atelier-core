// The engine's `NodeStateStore` on SQLite (lot Z1): node run records, gate approvals, change notes and replaced
// outputs survive an app restart, so a resumed run finds the owner's decisions (ENGINE-SPEC R10.5). Synchronous like
// `node:sqlite`. Tables `production_node_records` and `production_gate_decisions` (migration 012).
import type { NodeRunRecord, NodeStateStore } from '../../../engine/state'
import type { NodeState } from '../../../engine/types'
import type { Db } from '../../db'

interface RecordRow {
  engine_run_id: string
  node_id: string
  state: string
  fingerprint: string | null
  attempts: number
  error_json: string | null
  updated_at: number
}

const toRecord = (r: RecordRow): NodeRunRecord => ({
  runId: r.engine_run_id,
  nodeId: r.node_id,
  state: r.state as NodeState,
  ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}),
  attempts: r.attempts,
  ...(r.error_json ? { error: JSON.parse(r.error_json) as NodeRunRecord['error'] } : {}),
  updatedAt: r.updated_at
})

export class SqliteNodeStateStore implements NodeStateStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** After the app quit the database is closed: engines still settling their cancellation read and write nothing. */
  private closed = false

  close(): void {
    this.closed = true
  }

  get(runId: string, nodeId: string): NodeRunRecord | undefined {
    if (this.closed) return undefined
    const r = this.db
      .prepare('SELECT * FROM production_node_records WHERE engine_run_id = ? AND node_id = ?')
      .get(runId, nodeId) as RecordRow | undefined
    return r ? toRecord(r) : undefined
  }

  put(record: NodeRunRecord): void {
    if (this.closed) return
    this.db
      .prepare(
        `INSERT INTO production_node_records (engine_run_id, node_id, state, fingerprint, attempts, error_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (engine_run_id, node_id) DO UPDATE SET state = excluded.state, fingerprint = excluded.fingerprint,
           attempts = excluded.attempts, error_json = excluded.error_json, updated_at = excluded.updated_at`
      )
      .run(
        record.runId,
        record.nodeId,
        record.state,
        record.fingerprint ?? null,
        record.attempts,
        record.error ? JSON.stringify(record.error) : null,
        Math.round(record.updatedAt)
      )
  }

  list(runId: string): NodeRunRecord[] {
    if (this.closed) return []
    return (this.db.prepare('SELECT * FROM production_node_records WHERE engine_run_id = ? ORDER BY node_id').all(runId) as unknown as RecordRow[]).map(toRecord)
  }

  isApproved(scope: string, nodeId: string, fingerprint: string): boolean {
    if (this.closed) return false
    return (
      this.db
        .prepare("SELECT 1 FROM production_gate_decisions WHERE scope = ? AND node_id = ? AND kind = 'approved' AND fingerprint = ?")
        .get(scope, nodeId, fingerprint) !== undefined
    )
  }

  setApproved(scope: string, nodeId: string, fingerprint: string): void {
    if (this.closed) return
    if (this.isApproved(scope, nodeId, fingerprint)) return
    this.insert(scope, nodeId, 'approved', fingerprint, null, null)
  }

  override(scope: string, nodeId: string, fromFp: string): string | undefined {
    if (this.closed) return undefined
    const r = this.db
      .prepare("SELECT to_fingerprint FROM production_gate_decisions WHERE scope = ? AND node_id = ? AND kind = 'override' AND fingerprint = ? ORDER BY id DESC LIMIT 1")
      .get(scope, nodeId, fromFp) as { to_fingerprint: string } | undefined
    return r?.to_fingerprint
  }

  setOverride(scope: string, nodeId: string, fromFp: string, toFp: string): void {
    if (this.closed) return
    this.insert(scope, nodeId, 'override', fromFp, toFp, null)
  }

  notes(scope: string, nodeId: string): string[] {
    if (this.closed) return []
    return (
      this.db.prepare("SELECT note FROM production_gate_decisions WHERE scope = ? AND node_id = ? AND kind = 'note' ORDER BY id").all(scope, nodeId) as {
        note: string
      }[]
    ).map((r) => r.note)
  }

  addNote(scope: string, nodeId: string, note: string): void {
    if (this.closed) return
    this.insert(scope, nodeId, 'note', null, null, note)
  }

  /** Forgets the node records of engine runs (used when a run row is deleted; decisions stay with the video). */
  forgetRuns(engineRunPrefix: string): void {
    this.db.prepare('DELETE FROM production_node_records WHERE engine_run_id LIKE ?').run(`${engineRunPrefix}%`)
  }

  private insert(scope: string, nodeId: string, kind: string, fp: string | null, toFp: string | null, note: string | null): void {
    this.db
      .prepare('INSERT INTO production_gate_decisions (scope, node_id, kind, fingerprint, to_fingerprint, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(scope, nodeId, kind, fp, toFp, note, this.now().toISOString())
  }
}
