// Human in the loop (orch_inbox): an agent asks the user to validate something (a script, a topic list), to give an
// input, or to drop files; its task waits (`waiting_human`) until the item is answered, then resumes with the answer.
// Alerts (a dead task, every account limited) are inbox items too, without a task to resume.
import { GOAL_GATES, type GoalGate } from '../../shared/api/autopilot'
import { ORCH_INBOX_KINDS, type OrchInboxAnswer, type OrchInboxItem, type OrchInboxKind } from '../../shared/api/orchestra'
import type { Db } from '../db'
import { iso, isRecord, parseJson, truncate, type Clock, type EventLog } from './util'

interface InboxDb {
  id: number
  task_id: number | null
  agent_id: number | null
  kind: OrchInboxKind
  title: string
  body: string
  options: string
  status: OrchInboxItem['status']
  answer: string | null
  created_at: string
  answered_at: string | null
  gate: string | null
  channel_id: number | null
  series: string | null
}

export class Inbox {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog

  constructor(db: Db, now: Clock, events: EventLog) {
    this.db = db
    this.now = now
    this.events = events
  }

  /**
   * `gate` and `series` (a validation of a video step) let « Toujours valider » make a rule from it; the channel is the
   * one given, else the asking agent's.
   */
  add(item: {
    taskId: number | null
    agentId: number | null
    kind: OrchInboxKind
    title: string
    body?: string
    options?: string[]
    gate?: GoalGate | null
    channelId?: number | null
    series?: string | null
  }): OrchInboxItem {
    const kind: OrchInboxKind = (ORCH_INBOX_KINDS as readonly string[]).includes(item.kind) ? item.kind : 'input'
    const options = (item.options ?? []).filter((o) => typeof o === 'string' && o.trim()).map((o) => truncate(o.trim(), 100)).slice(0, 8)
    const gate = (GOAL_GATES as readonly unknown[]).includes(item.gate) ? (item.gate as GoalGate) : null
    const series = typeof item.series === 'string' && item.series.trim() ? truncate(item.series.trim(), 120) : null
    const channelId = item.channelId ?? (item.agentId === null ? null : this.agentChannel(item.agentId))
    const r = this.db
      .prepare('INSERT INTO orch_inbox (task_id, agent_id, kind, title, body, options, created_at, gate, channel_id, series) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.taskId, item.agentId, kind, truncate(item.title.trim() || 'Question', 200), truncate(item.body ?? '', 8000), JSON.stringify(options), iso(this.now()), gate, channelId, series)
    const added = this.get(Number(r.lastInsertRowid))
    this.events.add('inbox', `${kind}: ${added.title}`, item.agentId, item.taskId)
    return added
  }

  private agentChannel(agentId: number): number | null {
    const r = this.db.prepare('SELECT channel_id FROM orch_agents WHERE id = ?').get(agentId) as { channel_id: number | null } | undefined
    return r?.channel_id ?? null
  }

  get(id: number): OrchInboxItem {
    const r = Number.isInteger(id) ? (this.db.prepare('SELECT * FROM orch_inbox WHERE id = ?').get(id) as unknown as InboxDb | undefined) : undefined
    if (!r) throw new Error(`Unknown inbox item: ${String(id)}`)
    return toItem(r)
  }

  list(includeClosed = false): OrchInboxItem[] {
    const rows = (includeClosed
      ? this.db.prepare('SELECT * FROM orch_inbox ORDER BY id DESC LIMIT 500').all()
      : this.db.prepare(`SELECT * FROM orch_inbox WHERE status = 'open' ORDER BY id DESC`).all()) as unknown as InboxDb[]
    return rows.map(toItem)
  }

  openCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM orch_inbox WHERE status = 'open'`).get() as { n: number }).n
  }

  /** Records the answer; the caller resumes the task. An alert is simply dismissed. */
  answer(id: number, answer: OrchInboxAnswer): OrchInboxItem {
    const item = this.get(id)
    if (item.status !== 'open') throw new Error('Cet élément a déjà reçu une réponse.')
    if (!isRecord(answer)) throw new Error('Réponse invalide : un objet { texte, choix, fichiers } est attendu.')
    const clean: OrchInboxAnswer = {}
    if (answer.text !== undefined) {
      if (typeof answer.text !== 'string') throw new Error('La réponse écrite doit être un texte.')
      // a script sent from « Importer le script » is a long answer (agents-production): up to 60 000 characters
      clean.text = truncate(answer.text.trim(), 60_000)
    }
    if (answer.choice !== undefined) {
      if (typeof answer.choice !== 'string' || (item.options.length > 0 && !item.options.includes(answer.choice))) throw new Error('Choisis l’une des options.')
      clean.choice = answer.choice
    }
    if (answer.files !== undefined) {
      if (!Array.isArray(answer.files) || !answer.files.every((f) => typeof f === 'string' && f.length > 0 && f.length < 1000)) throw new Error('Les fichiers doivent être une liste de chemins.')
      clean.files = answer.files.slice(0, 50)
    }
    if (item.kind !== 'alert' && !clean.text && !clean.choice && !clean.files?.length) throw new Error('La réponse est vide.')
    const status = item.kind === 'alert' ? 'dismissed' : 'answered'
    this.db.prepare('UPDATE orch_inbox SET status = ?, answer = ?, answered_at = ? WHERE id = ?').run(status, JSON.stringify(clean), iso(this.now()), id)
    this.events.add('answer', `${item.title}: ${clean.choice ?? clean.text ?? `${clean.files?.length ?? 0} file(s)`}`, item.agentId, item.taskId)
    return this.get(id)
  }

  /** The open item of a task, if any (cancelling a task dismisses it). */
  dismissForTask(taskId: number): void {
    this.db.prepare(`UPDATE orch_inbox SET status = 'dismissed', answered_at = ? WHERE task_id = ? AND status = 'open'`).run(iso(this.now()), taskId)
  }
}

function toItem(r: InboxDb): OrchInboxItem {
  return {
    id: r.id,
    taskId: r.task_id,
    agentId: r.agent_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    options: parseJson<string[]>(r.options, []),
    status: r.status,
    answer: parseJson<OrchInboxAnswer | null>(r.answer, null),
    createdAt: r.created_at,
    answeredAt: r.answered_at,
    gate: (GOAL_GATES as readonly unknown[]).includes(r.gate) ? (r.gate as GoalGate) : null,
    channelId: r.channel_id,
    series: r.series
  }
}
