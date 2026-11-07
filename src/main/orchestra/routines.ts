// Routines: cron-like schedules per agent (a competitor scan every morning, ideas every Monday, the principal's daily
// digest) that enqueue a task when due. Five fields, minute hour day-of-month month day-of-week, each `*`, a number,
// a range `a-b`, a step `*/n` or `a-b/n`, or a comma list; day-of-week 0 or 7 = Sunday; when both day fields are set,
// either may match (classic cron). Times are the machine's local time (UTC in tests). A routine missed while the app
// was closed fires once at the next tick, then follows its schedule again.
import type { OrchRoutine } from '../../shared/api/orchestra'
import type { Db } from '../db'
import { iso, parseJson, type Clock, type EventLog } from './util'

interface Field {
  min: number
  max: number
}
const FIELDS: readonly Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 }
]

export class Cron {
  readonly expr: string
  private readonly sets: Set<number>[]
  private readonly domStar: boolean
  private readonly dowStar: boolean

  private constructor(expr: string, sets: Set<number>[], domStar: boolean, dowStar: boolean) {
    this.expr = expr
    this.sets = sets
    this.domStar = domStar
    this.dowStar = dowStar
  }

  static parse(expr: string): Cron {
    if (typeof expr !== 'string') throw new Error('A schedule is a cron text')
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) throw new Error(`A schedule has 5 fields (minute hour day month weekday): "${expr}"`)
    const sets = parts.map((p, i) => parseField(p, FIELDS[i] as Field, expr))
    const dow = sets[4] as Set<number>
    if (dow.has(7)) dow.add(0)
    return new Cron(parts.join(' '), sets, parts[2] === '*', parts[4] === '*')
  }

  private dayMatches(d: Date, utc: boolean): boolean {
    const dom = (this.sets[2] as Set<number>).has(utc ? d.getUTCDate() : d.getDate())
    const dow = (this.sets[4] as Set<number>).has(utc ? d.getUTCDay() : d.getDay())
    if (this.domStar && this.dowStar) return true
    if (this.domStar) return dow
    if (this.dowStar) return dom
    return dom || dow
  }

  /** The first matching minute strictly after `afterMs`. */
  next(afterMs: number, utc = false): number {
    const d = new Date(afterMs)
    if (utc) d.setUTCSeconds(0, 0)
    else d.setSeconds(0, 0)
    if (utc) d.setUTCMinutes(d.getUTCMinutes() + 1)
    else d.setMinutes(d.getMinutes() + 1)
    const [minutes, hours, , months] = this.sets as [Set<number>, Set<number>, Set<number>, Set<number>]
    for (let guard = 0; guard < 200_000; guard++) {
      const month = (utc ? d.getUTCMonth() : d.getMonth()) + 1
      if (!months.has(month)) {
        if (utc) d.setUTCMonth(d.getUTCMonth() + 1, 1)
        else d.setMonth(d.getMonth() + 1, 1)
        if (utc) d.setUTCHours(0, 0, 0, 0)
        else d.setHours(0, 0, 0, 0)
        continue
      }
      if (!this.dayMatches(d, utc)) {
        if (utc) d.setUTCDate(d.getUTCDate() + 1)
        else d.setDate(d.getDate() + 1)
        if (utc) d.setUTCHours(0, 0, 0, 0)
        else d.setHours(0, 0, 0, 0)
        continue
      }
      if (!hours.has(utc ? d.getUTCHours() : d.getHours())) {
        if (utc) d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0)
        else d.setHours(d.getHours() + 1, 0, 0, 0)
        continue
      }
      if (!minutes.has(utc ? d.getUTCMinutes() : d.getMinutes())) {
        if (utc) d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0)
        else d.setMinutes(d.getMinutes() + 1, 0, 0)
        continue
      }
      return d.getTime()
    }
    throw new Error(`The schedule "${this.expr}" never matches`)
  }
}

function parseField(text: string, f: Field, expr: string): Set<number> {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`Invalid schedule field "${part}" in "${expr}"`)
    const lo = m[1] === '*' ? f.min : Number(m[2])
    const hi = m[1] === '*' ? f.max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? f.max : lo
    const stepN = m[4] !== undefined ? Number(m[4]) : 1
    if (lo < f.min || hi > f.max || lo > hi || stepN < 1) throw new Error(`Out of range "${part}" in "${expr}"`)
    for (let v = lo; v <= hi; v += stepN) out.add(v)
  }
  return out
}

interface RoutineDb {
  id: number
  agent_id: number
  name: string
  kind: string
  payload: string
  cron: string
  enabled: number
  next_run_at: string | null
  last_run_at: string | null
}

export interface RoutineRecord extends OrchRoutine {
  payload: Record<string, unknown>
}

export class RoutineStore {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog
  private readonly utc: boolean

  constructor(db: Db, now: Clock, events: EventLog, utc = false) {
    this.db = db
    this.now = now
    this.events = events
    this.utc = utc
  }

  /** Creates the routine unless the agent already has one with that name. */
  ensure(agentId: number, r: { name: string; kind: string; cron: string; payload?: Record<string, unknown>; enabled?: boolean }): RoutineRecord {
    const cron = Cron.parse(r.cron)
    const existing = this.db.prepare('SELECT * FROM orch_routines WHERE agent_id = ? AND name = ?').get(agentId, r.name) as unknown as RoutineDb | undefined
    if (existing) return toRecord(existing)
    const res = this.db
      .prepare('INSERT INTO orch_routines (agent_id, name, kind, payload, cron, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(agentId, r.name, r.kind, JSON.stringify(r.payload ?? {}), cron.expr, r.enabled === false ? 0 : 1, iso(cron.next(this.now(), this.utc)), iso(this.now()))
    return this.get(Number(res.lastInsertRowid))
  }

  get(id: number): RoutineRecord {
    const r = Number.isInteger(id) ? (this.db.prepare('SELECT * FROM orch_routines WHERE id = ?').get(id) as unknown as RoutineDb | undefined) : undefined
    if (!r) throw new Error(`Unknown routine: ${String(id)}`)
    return toRecord(r)
  }

  list(agentId?: number): RoutineRecord[] {
    const rows = (agentId === undefined
      ? this.db.prepare('SELECT * FROM orch_routines ORDER BY id').all()
      : this.db.prepare('SELECT * FROM orch_routines WHERE agent_id = ? ORDER BY id').all(agentId)) as unknown as RoutineDb[]
    return rows.map(toRecord)
  }

  toggle(id: number, enabled: boolean): RoutineRecord {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false')
    const r = this.get(id)
    // Turned back on: the next run is computed from now (no burst of missed runs).
    const next = enabled ? iso(Cron.parse(r.cron).next(this.now(), this.utc)) : r.nextRunAt
    this.db.prepare('UPDATE orch_routines SET enabled = ?, next_run_at = ? WHERE id = ?').run(enabled ? 1 : 0, next, id)
    this.events.add('routine', `${r.name} ${enabled ? 'on' : 'off'}`, r.agentId)
    return this.get(id)
  }

  /** Enabled routines whose time has come. */
  due(): RoutineRecord[] {
    const rows = this.db
      // an archived agent (its channel was removed) has no routine running
      .prepare(
        `SELECT * FROM orch_routines WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
           AND agent_id NOT IN (SELECT id FROM orch_agents WHERE archived_at IS NOT NULL) ORDER BY next_run_at, id`
      )
      .all(iso(this.now())) as unknown as RoutineDb[]
    return rows.map(toRecord)
  }

  /** The routine fired: remember when, and schedule the next run strictly after now. */
  markRun(id: number): void {
    const r = this.get(id)
    this.db
      .prepare('UPDATE orch_routines SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(iso(this.now()), iso(Cron.parse(r.cron).next(this.now(), this.utc)), id)
  }
}

function toRecord(r: RoutineDb): RoutineRecord {
  const payload = parseJson<Record<string, unknown>>(r.payload, {})
  return {
    id: r.id,
    agentId: r.agent_id,
    name: r.name,
    kind: r.kind,
    cron: r.cron,
    enabled: r.enabled === 1,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    payload
  }
}
