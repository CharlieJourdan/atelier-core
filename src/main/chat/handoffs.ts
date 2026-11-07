// The records of group turns (migration 009): which agents an owner message @mentioned and how each answered, and every
// handoff (`ask_agent`): who asked whom, the question, the answer or why it was refused. No model call here.
import type { Db } from '../db'

export type MentionState = 'queued' | 'answering' | 'answered' | 'redirected' | 'stopped' | 'failed'
export type HandoffState = 'asked' | 'answered' | 'refused'

export interface MentionRow {
  messageId: number
  agentId: string
  position: number
  state: MentionState
  replyMessageId: number | null
}

export interface HandoffRow {
  id: number
  conversationId: number
  ownerMessageId: number | null
  cardMessageId: number | null
  replyMessageId: number | null
  from: string
  to: string
  ask: string
  answer: string | null
  state: HandoffState
  reason: string | null
  createdAt: string
  answeredAt: string | null
}

interface HandoffDb {
  id: number
  conversation_id: number
  owner_message_id: number | null
  card_message_id: number | null
  reply_message_id: number | null
  from_agent: string
  to_agent: string
  ask: string
  answer: string | null
  state: HandoffState
  reason: string | null
  created_at: string
  answered_at: string | null
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`

export class HandoffStore {
  constructor(private readonly db: Db) {}

  /** Records the mentioned agents of an owner message, in the order of the text. */
  recordMentions(messageId: number, agentIds: readonly string[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO message_mentions (message_id, agent_id, position) VALUES (?, ?, ?)')
    agentIds.forEach((id, i) => insert.run(messageId, id, i))
  }

  setMention(messageId: number, agentId: string, state: MentionState, replyMessageId: number | null = null): void {
    this.db
      .prepare('UPDATE message_mentions SET state = ?, reply_message_id = COALESCE(?, reply_message_id) WHERE message_id = ? AND agent_id = ?')
      .run(state, replyMessageId, messageId, agentId)
  }

  mentions(messageId: number): MentionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM message_mentions WHERE message_id = ? ORDER BY position')
      .all(messageId) as { message_id: number; agent_id: string; position: number; state: MentionState; reply_message_id: number | null }[]
    return rows.map((r) => ({
      messageId: r.message_id,
      agentId: r.agent_id,
      position: r.position,
      state: r.state,
      replyMessageId: r.reply_message_id
    }))
  }

  create(input: { conversationId: number; ownerMessageId: number | null; from: string; to: string; ask: string; refused?: string }): HandoffRow {
    const r = this.db
      .prepare(
        `INSERT INTO handoffs (conversation_id, owner_message_id, from_agent, to_agent, ask, state, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.conversationId, input.ownerMessageId, input.from, input.to, input.ask, input.refused ? 'refused' : 'asked', input.refused ?? null)
    return this.get(Number(r.lastInsertRowid))
  }

  setCard(id: number, messageId: number): void {
    this.db.prepare('UPDATE handoffs SET card_message_id = ? WHERE id = ?').run(messageId, id)
  }

  answer(id: number, answer: string, replyMessageId: number | null): void {
    this.db
      .prepare(`UPDATE handoffs SET state = 'answered', answer = ?, reply_message_id = ?, answered_at = ${NOW} WHERE id = ? AND state = 'asked'`)
      .run(answer, replyMessageId, id)
  }

  refuse(id: number, reason: string): void {
    this.db.prepare(`UPDATE handoffs SET state = 'refused', reason = ?, answered_at = ${NOW} WHERE id = ? AND state = 'asked'`).run(reason, id)
  }

  get(id: number): HandoffRow {
    const r = this.db.prepare('SELECT * FROM handoffs WHERE id = ?').get(id) as unknown as HandoffDb | undefined
    if (!r) throw new Error(`Unknown handoff: ${id}`)
    return toRow(r)
  }

  /** Handoffs started by one owner message, oldest first. */
  forMessage(ownerMessageId: number): HandoffRow[] {
    const rows = this.db.prepare('SELECT * FROM handoffs WHERE owner_message_id = ? ORDER BY id').all(ownerMessageId) as unknown as HandoffDb[]
    return rows.map(toRow)
  }

  /** At startup nothing runs: a handoff still `asked` was cut off by a quit or a crash. */
  closeInterrupted(): number {
    const r = this.db
      .prepare(`UPDATE handoffs SET state = 'refused', reason = 'Interrompu : Atelier a été fermé', answered_at = ${NOW} WHERE state = 'asked'`)
      .run()
    this.db.prepare(`UPDATE message_mentions SET state = 'stopped' WHERE state IN ('queued', 'answering')`).run()
    return Number(r.changes)
  }
}

function toRow(r: HandoffDb): HandoffRow {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    ownerMessageId: r.owner_message_id,
    cardMessageId: r.card_message_id,
    replyMessageId: r.reply_message_id,
    from: r.from_agent,
    to: r.to_agent,
    ask: r.ask,
    answer: r.answer,
    state: r.state,
    reason: r.reason,
    createdAt: r.created_at,
    answeredAt: r.answered_at
  }
}
