// Node run state behind an interface (docs/ENGINE-SPEC.md R10.5): in memory now, the `node_runs` table in lot P7.
// Synchronous on purpose: the app's SQLite (`node:sqlite`, DatabaseSync) is synchronous too.
// Gate decisions are kept per *scope* (a video: every run of it shares them) and per node fingerprint, so an
// approved result is not asked again when it is reused, and a replaced output survives a restart.
import type { NodeState } from './types'

export interface NodeRunRecord {
  runId: string
  nodeId: string
  state: NodeState
  fingerprint?: string
  attempts: number
  error?: { code: string; message: string; permanent: boolean }
  updatedAt: number
}

export interface NodeStateStore {
  get(runId: string, nodeId: string): NodeRunRecord | undefined
  put(record: NodeRunRecord): void
  list(runId: string): NodeRunRecord[]
  /** The user approved this node's result with this fingerprint (R11.3). */
  isApproved(scope: string, nodeId: string, fingerprint: string): boolean
  setApproved(scope: string, nodeId: string, fingerprint: string): void
  /** The user's own version replacing the run `fromFp` of a node: the fingerprint of the stored replacement. */
  override(scope: string, nodeId: string, fromFp: string): string | undefined
  setOverride(scope: string, nodeId: string, fromFp: string, toFp: string): void
  /** Change requests made at a node's gate, oldest first; they enter its fingerprint. */
  notes(scope: string, nodeId: string): string[]
  addNote(scope: string, nodeId: string, note: string): void
}

const k = (...parts: string[]): string => JSON.stringify(parts)

export class MemoryNodeStateStore implements NodeStateStore {
  private readonly records = new Map<string, NodeRunRecord>()
  private readonly approved = new Set<string>()
  private readonly overrides = new Map<string, string>()
  private readonly notesBy = new Map<string, string[]>()

  get(runId: string, nodeId: string): NodeRunRecord | undefined {
    const r = this.records.get(k(runId, nodeId))
    return r ? { ...r } : undefined
  }

  put(record: NodeRunRecord): void {
    this.records.set(k(record.runId, record.nodeId), { ...record })
  }

  list(runId: string): NodeRunRecord[] {
    return [...this.records.values()].filter((r) => r.runId === runId).map((r) => ({ ...r }))
  }

  isApproved(scope: string, nodeId: string, fingerprint: string): boolean {
    return this.approved.has(k(scope, nodeId, fingerprint))
  }

  setApproved(scope: string, nodeId: string, fingerprint: string): void {
    this.approved.add(k(scope, nodeId, fingerprint))
  }

  override(scope: string, nodeId: string, fromFp: string): string | undefined {
    return this.overrides.get(k(scope, nodeId, fromFp))
  }

  setOverride(scope: string, nodeId: string, fromFp: string, toFp: string): void {
    this.overrides.set(k(scope, nodeId, fromFp), toFp)
  }

  notes(scope: string, nodeId: string): string[] {
    return [...(this.notesBy.get(k(scope, nodeId)) ?? [])]
  }

  addNote(scope: string, nodeId: string, note: string): void {
    const key = k(scope, nodeId)
    this.notesBy.set(key, [...(this.notesBy.get(key) ?? []), note])
  }
}
