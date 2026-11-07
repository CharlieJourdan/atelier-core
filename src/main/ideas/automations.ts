// Automations of the Production section (lot Z1): « lancer le pipeline sur une chaîne » rules. A firing picks the topic
// (the channel's next idea, or a fixed topic), creates a plain video row and asks the production runs service to start
// our engine on it (`starter`, wired by the core). The clock is injectable; `tick(now)` fires what is due.
import {
  CADENCES,
  type AutomationInput,
  type AutomationPatch,
  type AutomationRow,
  type AutomationRunRow,
  type Cadence
} from '../../shared/api/ideas'
import { nowIso, transaction, type Db } from '../db'
import { positiveId, type IdeasStore } from './store'

export interface AutomationStartInput {
  videoId: number
  channelId: number
  topic: string
  minutes: number
  budgetMode: 'usage_max' | 'qualite_max'
  gateMode: 'step' | 'all'
}

/** Starts a run of our engine on a video (the production runs service); returns the run id. */
export type AutomationStarter = (input: AutomationStartInput) => Promise<{ runId: number }>

interface AutomationDbRow {
  id: number
  name: string
  channel_id: number
  channel_name: string
  cadence: Cadence
  weekday: number | null
  hour: number
  topic_from: 'ideas' | 'fixed'
  topic: string
  minutes: number
  budget_mode: 'usage_max' | 'qualite_max'
  gate_mode: 'step' | 'all'
  enabled: number
  last_run_at: string | null
  next_run_at: string | null
  example: number
}

interface RunDbRow {
  id: number
  automation_id: number
  video_id: number | null
  run_id: number | null
  status: 'started' | 'skipped' | 'failed'
  message: string
  example: number
  created_at: string
}

const SELECT = 'SELECT a.*, c.name AS channel_name FROM automations a JOIN channels c ON c.id = a.channel_id'

function toRow(r: AutomationDbRow): AutomationRow {
  return {
    id: r.id,
    name: r.name,
    channelId: r.channel_id,
    channelName: r.channel_name,
    cadence: r.cadence,
    weekday: r.weekday,
    hour: r.hour,
    topicFrom: r.topic_from,
    topic: r.topic,
    minutes: r.minutes,
    budgetMode: r.budget_mode,
    gateMode: r.gate_mode,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    example: r.example === 1
  }
}

function toRunRow(r: RunDbRow): AutomationRunRow {
  return {
    id: r.id,
    automationId: r.automation_id,
    videoId: r.video_id,
    runId: r.run_id,
    status: r.status,
    message: r.message,
    example: r.example === 1,
    createdAt: r.created_at
  }
}

/**
 * Next firing strictly after `after`, in local time: daily at `hour`:00, weekly on `weekday` at `hour`:00.
 * Manual automations never fire by themselves (null).
 */
export function nextRunAt(cadence: Cadence, hour: number, weekday: number | null, after: Date): Date | null {
  if (cadence === 'manual') return null
  const d = new Date(after.getFullYear(), after.getMonth(), after.getDate(), hour, 0, 0, 0)
  if (cadence === 'daily') {
    if (d.getTime() <= after.getTime()) d.setDate(d.getDate() + 1)
    return d
  }
  const target = weekday ?? 1
  let add = (target - d.getDay() + 7) % 7
  if (add === 0 && d.getTime() <= after.getTime()) add = 7
  d.setDate(d.getDate() + add)
  return d
}

function check(input: AutomationInput): AutomationInput {
  if (!input || typeof input !== 'object') throw new Error('Automatisation invalide.')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 120) throw new Error('Le nom de l’automatisation doit faire 1 à 120 caractères.')
  positiveId(input.channelId, 'chaîne')
  if (!(CADENCES as readonly string[]).includes(input.cadence)) throw new Error('Cadence inconnue.')
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw new Error('L’heure doit être entre 0 et 23.')
  if (input.cadence === 'weekly' && (input.weekday === null || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)) {
    throw new Error('Choisis le jour de la semaine.')
  }
  if (input.topicFrom !== 'ideas' && input.topicFrom !== 'fixed') throw new Error('Source du sujet inconnue.')
  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  if (input.topicFrom === 'fixed' && !topic) throw new Error('Écris le sujet de la vidéo.')
  if (typeof input.minutes !== 'number' || !(input.minutes > 0) || input.minutes > 30) throw new Error('La durée doit être entre 0,5 et 30 minutes.')
  if (input.budgetMode !== 'usage_max' && input.budgetMode !== 'qualite_max') throw new Error('Mode de budget inconnu.')
  if (input.gateMode !== 'step' && input.gateMode !== 'all') throw new Error('Mode de validation inconnu.')
  if (typeof input.enabled !== 'boolean') throw new Error('« Activée » doit être vrai ou faux.')
  return { ...input, name, topic, weekday: input.cadence === 'weekly' ? input.weekday : null }
}

export class AutomationsService {
  /** Set by the core once the production runs service exists. */
  starter: AutomationStarter | null = null

  constructor(
    private readonly db: Db,
    private readonly ideas: IdeasStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): AutomationRow[] {
    return (this.db.prepare(`${SELECT} ORDER BY a.enabled DESC, a.next_run_at IS NULL, a.next_run_at, a.id`).all() as unknown as AutomationDbRow[]).map(toRow)
  }

  get(id: number): AutomationRow {
    const r = this.db.prepare(`${SELECT} WHERE a.id = ?`).get(positiveId(id, 'automatisation')) as AutomationDbRow | undefined
    if (!r) throw new Error('Automatisation introuvable.')
    return toRow(r)
  }

  private next(a: Pick<AutomationInput, 'cadence' | 'hour' | 'weekday' | 'enabled'>): string | null {
    if (!a.enabled) return null
    return nextRunAt(a.cadence, a.hour, a.weekday, this.now())?.toISOString() ?? null
  }

  create(raw: AutomationInput): AutomationRow {
    const a = check(raw)
    if (!this.db.prepare('SELECT id FROM channels WHERE id = ? AND archived_at IS NULL').get(a.channelId)) throw new Error('Chaîne introuvable ou archivée.')
    const r = this.db
      .prepare(
        `INSERT INTO automations (name, channel_id, cadence, weekday, hour, topic_from, topic, minutes, budget_mode, gate_mode, enabled, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(a.name, a.channelId, a.cadence, a.weekday, a.hour, a.topicFrom, a.topic, a.minutes, a.budgetMode, a.gateMode, a.enabled ? 1 : 0, this.next(a))
    return this.get(Number(r.lastInsertRowid))
  }

  update(id: number, patch: AutomationPatch): AutomationRow {
    const cur = this.get(id)
    if (!patch || typeof patch !== 'object') throw new Error('Modification invalide.')
    const { id: _i, channelName: _c, lastRunAt: _l, nextRunAt: _n, example: _e, ...base } = cur
    const a = check({ ...base, ...patch })
    this.db
      .prepare(
        `UPDATE automations SET name = ?, channel_id = ?, cadence = ?, weekday = ?, hour = ?, topic_from = ?, topic = ?, minutes = ?,
           budget_mode = ?, gate_mode = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(a.name, a.channelId, a.cadence, a.weekday, a.hour, a.topicFrom, a.topic, a.minutes, a.budgetMode, a.gateMode, a.enabled ? 1 : 0, this.next(a), nowIso(), cur.id)
    return this.get(cur.id)
  }

  delete(id: number): void {
    const r = this.db.prepare('DELETE FROM automations WHERE id = ?').run(positiveId(id, 'automatisation'))
    if (r.changes === 0) throw new Error('Automatisation introuvable.')
  }

  history(id?: number): AutomationRunRow[] {
    const rows =
      id === undefined
        ? this.db.prepare('SELECT * FROM automation_runs ORDER BY created_at DESC, id DESC LIMIT 100').all()
        : this.db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(positiveId(id, 'automatisation'))
    return (rows as unknown as RunDbRow[]).map(toRunRow)
  }

  private record(automationId: number, status: AutomationRunRow['status'], message: string, videoId: number | null = null, runId: number | null = null): AutomationRunRow {
    const r = this.db
      .prepare('INSERT INTO automation_runs (automation_id, video_id, run_id, status, message) VALUES (?, ?, ?, ?, ?)')
      .run(automationId, videoId, runId, status, message)
    return toRunRow(this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as RunDbRow)
  }

  /** Fires one automation: topic → plain video row → engine run. Always records what happened. */
  async fire(id: number): Promise<AutomationRunRow> {
    const a = this.get(id)
    const now = this.now()
    this.db
      .prepare('UPDATE automations SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(now.toISOString(), a.enabled ? (nextRunAt(a.cadence, a.hour, a.weekday, now)?.toISOString() ?? null) : null, now.toISOString(), a.id)
    let topic = a.topic
    let ideaId: number | null = null
    if (a.topicFrom === 'ideas') {
      const idea = this.ideas.nextForAutomation(a.channelId)
      if (!idea) return this.record(a.id, 'skipped', 'Aucune idée disponible pour cette chaîne : ajoute ou garde une idée.')
      topic = idea.title
      ideaId = idea.id
    }
    if (!this.starter) return this.record(a.id, 'failed', 'Le moteur de production n’est pas disponible.')
    const videoId = transaction(this.db, () => {
      const v = this.db.prepare("INSERT INTO videos (channel_id, title, brief, status) VALUES (?, ?, ?, 'idea')").run(a.channelId, topic, `Automatisation « ${a.name} »`)
      const vid = Number(v.lastInsertRowid)
      if (ideaId !== null) this.db.prepare("UPDATE ideas SET status = 'used', video_id = ?, updated_at = ? WHERE id = ?").run(vid, nowIso(), ideaId)
      return vid
    })
    try {
      const { runId } = await this.starter({ videoId, channelId: a.channelId, topic, minutes: a.minutes, budgetMode: a.budgetMode, gateMode: a.gateMode })
      return this.record(a.id, 'started', `Vidéo « ${topic} » lancée.`, videoId, runId)
    } catch (err) {
      return this.record(a.id, 'failed', err instanceof Error ? err.message : String(err), videoId)
    }
  }

  /** Fires every enabled automation whose time has come (called every minute by the app). */
  async tick(): Promise<AutomationRunRow[]> {
    const due = this.db
      .prepare('SELECT id FROM automations WHERE enabled = 1 AND example = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, id')
      .all(this.now().toISOString()) as { id: number }[]
    const out: AutomationRunRow[] = []
    for (const { id } of due) out.push(await this.fire(id))
    return out
  }
}
