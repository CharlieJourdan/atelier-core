// What an agent remembers (docs/AGENT-RUNTIME.md § Memory):
//   (a) long-term memory items (orch_memory): facts, preferences, style notes, lessons, each with a source and an
//       importance 1–5; recalled top-k by a keyword + importance + recency score (no embeddings);
//   (b) the episodic log of its turns (orch_episodes): what it was asked and answered, per session;
//   (c) its working session (orch_sessions): the Claude Code / Codex session id it can resume, the estimated context
//       it has accumulated, and the handover it was seeded with after the last compaction.
import { ORCH_MEMORY_KINDS, type OrchMemoryItem, type OrchMemoryKind } from '../../shared/api/orchestra'
import type { Db } from '../db'
import { iso, truncate, type Clock, type EventLog } from './util'

export interface SessionRecord {
  id: number
  agentId: number
  cliSessionId: string | null
  accountId: number | null
  contextTokens: number
  turns: number
  handover: string
  lastTurnAt: string | null
  startedAt: string
}

export interface Episode {
  id: number
  taskId: number | null
  prompt: string
  reply: string
  tokens: number
  createdAt: string
}

interface MemoryDb {
  id: number
  agent_id: number
  kind: OrchMemoryKind
  content: string
  source: string
  importance: number
  uses: number
  last_used_at: string | null
  created_at: string
}

/** Items kept per agent; the least useful go first. */
export const MAX_MEMORY_ITEMS = 300
const MAX_ITEM_CHARS = 1000
const EPISODE_CHARS = 6000

const STOP = new Set(
  'the and for with that this from your you are was were have has had not but all any can our their will would into about what when which who how les des une pour avec dans sur pas est sont que qui aux par plus vous nous elle ils'.split(' ')
)

export function keywords(text: string): Set<string> {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
  return new Set((words ?? []).filter((w) => !STOP.has(w)))
}

export class MemoryStore {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog

  constructor(db: Db, now: Clock, events: EventLog) {
    this.db = db
    this.now = now
    this.events = events
  }

  // ---- long-term items ----------------------------------------------------------------------------------

  add(agentId: number, item: { kind?: string; content: string; source: string; importance?: number }): OrchMemoryItem {
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) throw new Error('A memory item needs text')
    const kind: OrchMemoryKind = (ORCH_MEMORY_KINDS as readonly string[]).includes(item.kind ?? '') ? (item.kind as OrchMemoryKind) : 'note'
    const importance = Math.min(5, Math.max(1, Math.round(Number(item.importance ?? 3)) || 3))
    const text = truncate(content, MAX_ITEM_CHARS)
    const same = this.db.prepare('SELECT * FROM orch_memory WHERE agent_id = ? AND content = ?').get(agentId, text) as unknown as MemoryDb | undefined
    if (same) {
      // Remembered again: it matters more.
      this.db.prepare('UPDATE orch_memory SET importance = MAX(importance, ?) WHERE id = ?').run(importance, same.id)
      return this.item(same.id)
    }
    const r = this.db
      .prepare('INSERT INTO orch_memory (agent_id, kind, content, source, importance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(agentId, kind, text, truncate(item.source, 100), importance, iso(this.now()))
    this.db
      .prepare(
        `DELETE FROM orch_memory WHERE agent_id = ? AND id NOT IN (
           SELECT id FROM orch_memory WHERE agent_id = ? ORDER BY importance DESC, uses DESC, id DESC LIMIT ?)`
      )
      .run(agentId, agentId, MAX_MEMORY_ITEMS)
    return this.item(Number(r.lastInsertRowid))
  }

  item(id: number): OrchMemoryItem {
    const r = this.db.prepare('SELECT * FROM orch_memory WHERE id = ?').get(id) as unknown as MemoryDb | undefined
    if (!r) throw new Error(`Unknown memory item: ${id}`)
    return toItem(r)
  }

  list(agentId: number): OrchMemoryItem[] {
    return (this.db.prepare('SELECT * FROM orch_memory WHERE agent_id = ? ORDER BY importance DESC, id DESC').all(agentId) as unknown as MemoryDb[]).map(toItem)
  }

  delete(id: number): void {
    if (!Number.isInteger(id)) throw new Error('id must be an integer')
    const r = this.db.prepare('DELETE FROM orch_memory WHERE id = ?').run(id)
    if (Number(r.changes) === 0) throw new Error(`Unknown memory item: ${id}`)
  }

  /**
   * The k items most relevant to `query`: 3 points per shared keyword, plus the importance, plus up to 2 for recency
   * (last 30 days). Recalled items count a use.
   */
  recall(agentId: number, query: string, k = 8, mark = true): OrchMemoryItem[] {
    const q = keywords(query)
    const now = this.now()
    const scored = this.list(agentId).map((m) => {
      const words = keywords(m.content)
      let overlap = 0
      for (const w of q) if (words.has(w)) overlap++
      const ageDays = (now - Date.parse(m.createdAt)) / 86_400_000
      const recency = Math.max(0, 2 - (2 * Math.max(0, ageDays)) / 30)
      return { m, score: overlap * 3 + m.importance + recency }
    })
    scored.sort((a, b) => b.score - a.score || b.m.id - a.m.id)
    const top = scored.slice(0, Math.max(0, k)).map((s) => s.m)
    if (!mark) return top
    const use = this.db.prepare('UPDATE orch_memory SET uses = uses + 1, last_used_at = ? WHERE id = ?')
    for (const m of top) use.run(iso(now), m.id)
    return top
  }

  // ---- episodes -----------------------------------------------------------------------------------------

  logEpisode(e: { agentId: number; sessionId: number; taskId: number | null; accountId: number | null; prompt: string; reply: string; tokens: number; costUsd: number }): void {
    this.db
      .prepare(
        `INSERT INTO orch_episodes (agent_id, session_id, task_id, account_id, prompt, reply, tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.agentId, e.sessionId, e.taskId, e.accountId, truncate(e.prompt, EPISODE_CHARS), truncate(e.reply, EPISODE_CHARS), e.tokens, e.costUsd, iso(this.now()))
  }

  episodes(sessionId: number, limit = 50): Episode[] {
    const rows = this.db
      .prepare('SELECT * FROM (SELECT * FROM orch_episodes WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id')
      .all(sessionId, limit) as unknown as { id: number; task_id: number | null; prompt: string; reply: string; tokens: number; created_at: string }[]
    return rows.map((r) => ({ id: r.id, taskId: r.task_id, prompt: r.prompt, reply: r.reply, tokens: r.tokens, createdAt: r.created_at }))
  }

  // ---- working session ----------------------------------------------------------------------------------

  /** The agent's active session (opened on first use). */
  session(agentId: number): SessionRecord {
    const row = this.db.prepare(`SELECT * FROM orch_sessions WHERE agent_id = ? AND status = 'active'`).get(agentId) as unknown as SessionDb | undefined
    if (row) return toSession(row)
    const r = this.db.prepare('INSERT INTO orch_sessions (agent_id, started_at) VALUES (?, ?)').run(agentId, iso(this.now()))
    return this.sessionById(Number(r.lastInsertRowid))
  }

  sessionById(id: number): SessionRecord {
    const row = this.db.prepare('SELECT * FROM orch_sessions WHERE id = ?').get(id) as unknown as SessionDb | undefined
    if (!row) throw new Error(`Unknown session: ${id}`)
    return toSession(row)
  }

  /**
   * After a turn: the CLI session id to resume next time, and the context estimate. A resumed turn adds to the context
   * (the CLI replays the whole conversation); a fresh turn starts it again from what it sent and received.
   */
  recordTurn(sessionId: number, turn: { cliSessionId: string | null; accountId: number | null; tokens: number; fresh: boolean }): SessionRecord {
    const tokens = Math.max(0, Math.round(turn.tokens))
    this.db
      .prepare(
        `UPDATE orch_sessions SET cli_session_id = ?, account_id = ?, context_tokens = CASE WHEN ? THEN ? ELSE context_tokens + ? END,
           turns = turns + 1, last_turn_at = ? WHERE id = ?`
      )
      .run(turn.cliSessionId, turn.accountId, turn.fresh ? 1 : 0, tokens, tokens, iso(this.now()), sessionId)
    return this.sessionById(sessionId)
  }

  /** The CLI session cannot be resumed (another account, a reset): the next turn starts a fresh one in this session. */
  forgetCliSession(sessionId: number): void {
    this.db.prepare('UPDATE orch_sessions SET cli_session_id = NULL, context_tokens = 0 WHERE id = ?').run(sessionId)
  }

  /** Closes the active session and opens a fresh one seeded with `handover` (compaction, or a reset by hand). */
  reset(agentId: number, reason: string, handover: string): SessionRecord {
    const now = iso(this.now())
    this.db
      .prepare(`UPDATE orch_sessions SET status = 'closed', closed_at = ?, close_reason = ? WHERE agent_id = ? AND status = 'active'`)
      .run(now, truncate(reason, 200), agentId)
    const r = this.db
      .prepare('INSERT INTO orch_sessions (agent_id, handover, context_tokens, started_at) VALUES (?, ?, ?, ?)')
      .run(agentId, truncate(handover, 4000), 0, now)
    this.events.add('session', `fresh session (${reason})`, agentId)
    return this.sessionById(Number(r.lastInsertRowid))
  }

  closedSessions(agentId: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM orch_sessions WHERE agent_id = ? AND status = 'closed'`).get(agentId) as { n: number }).n
  }
}

interface SessionDb {
  id: number
  agent_id: number
  cli_session_id: string | null
  account_id: number | null
  context_tokens: number
  turns: number
  handover: string
  last_turn_at: string | null
  started_at: string
}

function toSession(r: SessionDb): SessionRecord {
  return {
    id: r.id,
    agentId: r.agent_id,
    cliSessionId: r.cli_session_id,
    accountId: r.account_id,
    contextTokens: r.context_tokens,
    turns: r.turns,
    handover: r.handover,
    lastTurnAt: r.last_turn_at,
    startedAt: r.started_at
  }
}

function toItem(r: MemoryDb): OrchMemoryItem {
  return {
    id: r.id,
    agentId: r.agent_id,
    kind: r.kind,
    content: r.content,
    source: r.source,
    importance: r.importance,
    uses: r.uses,
    createdAt: r.created_at
  }
}
