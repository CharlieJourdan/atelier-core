// Who called which method of a team computer, when, and how it ended (docs/BRAIN-HEADLESS.md §7). Never the arguments,
// never the answer: a method name (checked against the IPC name pattern before it gets here) and an outcome. Kept
// apart from the admin audit log, which records rarer, heavier actions; rows older than `keepDays` are pruned.
import { DAY_MS, iso, type Clock } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'

export const RELAY_OUTCOMES = ['ok', 'error', 'offline', 'timeout', 'too_large', 'busy'] as const
export type RelayOutcome = (typeof RELAY_OUTCOMES)[number]

export interface RelayCall {
  id: number
  at: string
  teamId: string
  accountId: string
  machineId: string | null
  method: string
  outcome: RelayOutcome
  ms: number
}

export class RelayAudit {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly keepDays: number
  private writes = 0
  constructor(db: CloudDb, clock: Clock, keepDays = 90) {
    this.db = db
    this.clock = clock
    this.keepDays = keepDays
  }

  record(c: Omit<RelayCall, 'id' | 'at'>): void {
    const now = this.clock.now()
    this.db
      .prepare('INSERT INTO relay_calls (at, team_id, account_id, machine_id, method, outcome, ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(iso(now), c.teamId, c.accountId, c.machineId, c.method, c.outcome, Math.max(0, Math.round(c.ms)))
    if (++this.writes % 500 === 0) this.db.prepare('DELETE FROM relay_calls WHERE at < ?').run(iso(now - this.keepDays * DAY_MS))
  }

  list(o: { teamId?: string; limit?: number } = {}): RelayCall[] {
    const limit = Math.min(Math.max(o.limit ?? 100, 1), 1000)
    const rows = (
      o.teamId
        ? this.db.prepare('SELECT * FROM relay_calls WHERE team_id = ? ORDER BY id DESC LIMIT ?').all(o.teamId, limit)
        : this.db.prepare('SELECT * FROM relay_calls ORDER BY id DESC LIMIT ?').all(limit)
    ) as { id: number; at: string; team_id: string; account_id: string; machine_id: string | null; method: string; outcome: RelayOutcome; ms: number }[]
    return rows.map((r) => ({ id: r.id, at: r.at, teamId: r.team_id, accountId: r.account_id, machineId: r.machine_id, method: r.method, outcome: r.outcome, ms: r.ms }))
  }
}
