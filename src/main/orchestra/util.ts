// Small shared pieces of the agent runtime: the injectable clock, JSON helpers and the event timeline (orch_events).
import type { OrchEvent } from '../../shared/api/orchestra'
import type { Db } from '../db'

/** Milliseconds since the epoch. Tests and the demo drive time by hand. */
export type Clock = () => number

export const iso = (ms: number): string => new Date(ms).toISOString()

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Rough token estimate (≈ 4 characters per token), the same rule as the fake provider. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const KEEP_EVENTS = 5000

/** The runtime's timeline: every lease, run, kill, retry, failover, compaction… in one table. */
export class EventLog {
  private readonly db: Db
  private readonly now: Clock
  /** Called for every event (the demo prints the timeline as it happens). */
  listener: ((e: OrchEvent) => void) | null = null
  private added = 0

  constructor(db: Db, now: Clock) {
    this.db = db
    this.now = now
  }

  add(type: string, text: string, agentId: number | null = null, taskId: number | null = null): void {
    const at = iso(this.now())
    const r = this.db
      .prepare('INSERT INTO orch_events (at, agent_id, task_id, type, text) VALUES (?, ?, ?, ?, ?)')
      .run(at, agentId, taskId, type, truncate(text, 2000))
    this.listener?.({ id: Number(r.lastInsertRowid), at, agentId, taskId, type, text })
    if (++this.added % 500 === 0) {
      this.db.prepare('DELETE FROM orch_events WHERE id <= (SELECT MAX(id) FROM orch_events) - ?').run(KEEP_EVENTS)
    }
  }

  list(afterId = 0, limit = 200): OrchEvent[] {
    const n = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 200
    const rows = this.db
      .prepare('SELECT * FROM orch_events WHERE id > ? ORDER BY id LIMIT ?')
      .all(Number.isInteger(afterId) ? afterId : 0, n) as unknown as {
      id: number
      at: string
      agent_id: number | null
      task_id: number | null
      type: string
      text: string
    }[]
    return rows.map((r) => ({ id: r.id, at: r.at, agentId: r.agent_id, taskId: r.task_id, type: r.type, text: r.text }))
  }
}
