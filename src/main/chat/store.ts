// Conversations and messages in SQLite. No model calls here (see reply.ts); no Electron import.
import type { ChangeTopic } from '../../shared/api'
import {
  CARD_TYPES,
  CONVERSATION_KINDS,
  type Attachment,
  type AuthorType,
  type Card,
  type ConversationInput,
  type ConversationRow,
  type MessageRow,
  type ToolUse
} from '../../shared/chat'
import { DEPARTMENTS, type Department, type HandoffCard, type RoomInfo } from '../../shared/chat-rich'
import { t, type MessageKey } from '../../shared/fr'
import { ROLES } from '../../shared/roles'
import { DELIVERABLE_GRAPH, type DeliverableStatus } from '../../shared/workflow'
import type { Db } from '../db'

interface ConversationDbRow {
  id: number
  kind: ConversationRow['kind']
  title: string
  video_id: number | null
  agent_id: string | null
  channel_id: number | null
  department: Department | null
  updated_at: string
  unread: number
  last_body: string | null
  last_author: AuthorType | null
  last_at: string | null
}

interface MessageDbRow {
  id: number
  conversation_id: number
  author_type: AuthorType
  author_id: string | null
  body: string
  card: string | null
  attachments: string | null
  tools: string | null
  created_at: string
}

export interface NewMessage {
  authorType: AuthorType
  authorId?: string | null
  body: string
  card?: Card | null
  attachments?: Attachment[]
  /** Tools the agent used for this message. */
  tools?: ToolUse[]
}

export const SUPERVISOR_TITLE = 'Supervisor'
const PREVIEW_CHARS = 140

const CONVERSATION_SELECT = `
  SELECT c.id, c.kind,
    CASE WHEN c.kind = 'video' THEN COALESCE(NULLIF(v.title, ''), 'Video ' || c.video_id) ELSE c.title END AS title,
    c.video_id, c.agent_id, c.channel_id, c.department, c.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.author_type != 'owner'
       AND m.id > COALESCE(c.last_read_message_id, 0)) AS unread,
    lm.body AS last_body, lm.author_type AS last_author, lm.created_at AS last_at
  FROM conversations c
  LEFT JOIN videos v ON v.id = c.video_id
  LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)`

export class ChatStore {
  /** Told of every message posted (the agent runtime wakes the agents a message @mentions). Never throws into post. */
  onPosted: ((conversationId: number, message: MessageRow) => void) | null = null

  constructor(
    private readonly db: Db,
    private readonly notify: (topic: ChangeTopic) => void = () => undefined
  ) {}

  // ---- conversations ------------------------------------------------------------------------------------

  /** Newest activity first. The Supervisor conversation always exists. */
  list(): ConversationRow[] {
    this.open({ kind: 'supervisor' })
    const rows = this.db
      .prepare(`${CONVERSATION_SELECT} ORDER BY c.updated_at DESC, c.id DESC`)
      .all() as unknown as ConversationDbRow[]
    return rows.map(toConversation)
  }

  get(id: number): ConversationRow {
    const row = this.db.prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).get(id) as unknown as ConversationDbRow | undefined
    if (!row) throw new Error(`Unknown conversation: ${id}`)
    return toConversation(row)
  }

  /**
   * Finds the conversation or creates it: one Supervisor, one per video, one per agent role, one channel Manager per
   * channel, one room per channel and department.
   */
  open(input: ConversationInput): ConversationRow {
    if (!input || !(CONVERSATION_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error(`Unknown conversation kind: ${String(input?.kind)}`)
    }
    let existing: { id: number } | undefined
    let title = SUPERVISOR_TITLE
    let videoId: number | null = null
    let agentId: string | null = null
    let channelId: number | null = null
    let department: Department | null = null
    if (input.kind === 'supervisor') {
      existing = this.db.prepare(`SELECT id FROM conversations WHERE kind = 'supervisor'`).get() as typeof existing
    } else if (input.kind === 'video') {
      if (!Number.isInteger(input.videoId)) throw new Error('A video conversation needs a videoId')
      const video = this.db.prepare('SELECT id, title, channel_id FROM videos WHERE id = ?').get(input.videoId as number) as
        | { id: number; title: string; channel_id: number }
        | undefined
      if (!video) throw new Error(`Unknown video: ${input.videoId}`)
      videoId = video.id
      title = video.title
      channelId = video.channel_id
      existing = this.db
        .prepare(`SELECT id FROM conversations WHERE kind = 'video' AND video_id = ?`)
        .get(videoId) as typeof existing
    } else if (input.kind === 'channel' || input.kind === 'room') {
      const channel = this.channelOf(input.channelId)
      channelId = channel.id
      if (input.kind === 'channel') {
        title = managerTitle(channel.name)
        existing = this.db
          .prepare(`SELECT id FROM conversations WHERE kind = 'channel' AND channel_id = ?`)
          .get(channelId) as typeof existing
      } else {
        if (!(DEPARTMENTS as readonly string[]).includes(input.department as string)) {
          throw new Error(`Unknown department: ${String(input.department)}`)
        }
        department = input.department as Department
        title = roomTitle(department, channel.name)
        existing = this.db
          .prepare(`SELECT id FROM conversations WHERE kind = 'room' AND channel_id = ? AND department = ?`)
          .get(channelId, department) as typeof existing
      }
    } else {
      if (!ROLES.some((r) => r.role === input.agentId)) throw new Error(`Unknown agent: ${String(input.agentId)}`)
      agentId = input.agentId as string
      title = roleLabel(agentId)
      existing = this.db
        .prepare(`SELECT id FROM conversations WHERE kind = 'agent' AND agent_id = ?`)
        .get(agentId) as typeof existing
    }
    if (existing) return this.get(existing.id)
    const res = this.db
      .prepare('INSERT INTO conversations (kind, title, video_id, agent_id, channel_id, department) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.kind, title, videoId, agentId, channelId, department)
    this.notify('chat')
    return this.get(Number(res.lastInsertRowid))
  }

  /**
   * The channel Manager and the department rooms of every active channel, for the conversation list. A room is listed
   * when its department has an enabled agent (or when it already exists); it is created when first opened.
   */
  rooms(): RoomInfo[] {
    const channels = this.db.prepare('SELECT id, name FROM channels WHERE archived_at IS NULL ORDER BY id').all() as {
      id: number
      name: string
    }[]
    const enabled = new Set((this.db.prepare('SELECT role FROM agents WHERE enabled = 1').all() as { role: string }[]).map((r) => r.role))
    const staffed = new Set(ROLES.filter((r) => r.role !== 'supervisor' && enabled.has(r.role)).map((r) => DEPARTMENT_OF[r.group]))
    const rows = this.db
      .prepare(`${CONVERSATION_SELECT} WHERE c.kind IN ('channel', 'room')`)
      .all() as unknown as ConversationDbRow[]
    const out: RoomInfo[] = []
    for (const ch of channels) {
      const manager = rows.find((r) => r.kind === 'channel' && r.channel_id === ch.id)
      out.push({
        key: `manager:${ch.id}`,
        channelId: ch.id,
        kind: 'manager',
        title: manager?.title ?? managerTitle(ch.name),
        conversationId: manager?.id ?? null,
        unread: manager?.unread ?? 0
      })
      for (const department of DEPARTMENTS) {
        const room = rows.find((r) => r.kind === 'room' && r.channel_id === ch.id && r.department === department)
        if (!room && !staffed.has(department)) continue
        out.push({
          key: `room:${ch.id}:${department}`,
          channelId: ch.id,
          kind: 'room',
          department,
          title: room?.title ?? roomTitle(department, ch.name),
          conversationId: room?.id ?? null,
          unread: room?.unread ?? 0
        })
      }
    }
    return out
  }

  private channelOf(id: unknown): { id: number; name: string } {
    if (!Number.isInteger(id)) throw new Error('This conversation needs a channelId')
    const row = this.db.prepare('SELECT id, name, archived_at FROM channels WHERE id = ?').get(id as number) as
      | { id: number; name: string; archived_at: string | null }
      | undefined
    if (!row) throw new Error(`Unknown channel: ${String(id)}`)
    if (row.archived_at) throw new Error(`Channel ${row.name} is archived`)
    return row
  }

  markRead(conversationId: number): void {
    this.get(conversationId)
    this.db
      .prepare(
        `UPDATE conversations SET last_read_message_id =
           (SELECT MAX(id) FROM messages WHERE conversation_id = ?) WHERE id = ?`
      )
      .run(conversationId, conversationId)
    this.notify('chat')
  }

  // ---- messages -----------------------------------------------------------------------------------------

  post(conversationId: number, msg: NewMessage): MessageRow {
    this.get(conversationId)
    if (msg.card && !(CARD_TYPES as readonly string[]).includes(msg.card.type)) {
      throw new Error(`Unknown card type: ${String((msg.card as { type?: unknown }).type)}`)
    }
    const res = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, author_type, author_id, body, card, attachments, tools)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conversationId,
        msg.authorType,
        msg.authorId ?? null,
        msg.body,
        msg.card ? JSON.stringify(msg.card) : null,
        msg.attachments?.length ? JSON.stringify(msg.attachments) : null,
        msg.tools?.length ? JSON.stringify(msg.tools) : null
      )
    const id = Number(res.lastInsertRowid)
    this.db
      .prepare(`UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(conversationId)
    // The owner's own messages never count as unread.
    if (msg.authorType === 'owner') {
      this.db.prepare('UPDATE conversations SET last_read_message_id = ? WHERE id = ?').run(id, conversationId)
    }
    this.notify('chat')
    const row = this.message(id)
    try {
      this.onPosted?.(conversationId, row)
    } catch {
      // a listener's failure never undoes a posted message
    }
    return row
  }

  message(id: number): MessageRow {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageDbRow | undefined
    if (!row) throw new Error(`Unknown message: ${id}`)
    return this.enrich([row])[0] as MessageRow
  }

  /** Oldest first. `afterId` returns only newer messages; `limit` keeps the newest N. */
  messages(conversationId: number, afterId = 0, limit = 500): MessageRow[] {
    this.get(conversationId)
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT ?)
         ORDER BY id`
      )
      .all(conversationId, afterId, limit) as unknown as MessageDbRow[]
    return this.enrich(rows)
  }

  /** Cards carry live state: the stored card only knows the moment it was posted. */
  private enrich(rows: MessageDbRow[]): MessageRow[] {
    const deliverable = this.db.prepare('SELECT status, current_version_id FROM deliverables WHERE id = ?')
    const task = this.db.prepare('SELECT status, hold_reason, last_error FROM tasks WHERE id = ?')
    const proposal = this.db.prepare('SELECT status FROM proposals WHERE id = ?')
    const handoff = this.db.prepare('SELECT state, answer, reason FROM handoffs WHERE id = ?')
    return rows.map((r) => {
      const card = r.card ? (JSON.parse(r.card) as Card) : null
      if (card?.type === 'task' || (card?.type === 'budget' && card.taskId !== undefined)) {
        const t = task.get(card.type === 'task' ? card.taskId : (card.taskId as number)) as
          | { status: string; hold_reason: string | null; last_error: string | null }
          | undefined
        if (t && card.type === 'task') {
          card.status = t.status
          card.holdReason = t.hold_reason
          card.lastError = t.last_error
        } else if (card.type === 'budget') {
          card.held = t?.hold_reason === 'budget' && t.status === 'ready'
        }
      }
      if (card?.type === 'proposal' && card.proposalId !== null) {
        const p = proposal.get(card.proposalId) as { status: 'pending' | 'accepted' | 'rejected' | 'expired' } | undefined
        if (p) card.status = p.status
      }
      if (card?.type === 'handoff' && card.handoffId !== undefined) {
        const h = handoff.get(card.handoffId) as
          | { state: HandoffCard['state']; answer: string | null; reason: string | null }
          | undefined
        if (h) {
          card.state = h.state
          if (h.answer) card.answerExcerpt = excerptOf(h.answer, 280)
          if (h.reason) card.reason = h.reason
        }
      }
      if (card?.type === 'approval') {
        const d = deliverable.get(card.deliverableId) as
          | { status: DeliverableStatus; current_version_id: number | null }
          | undefined
        if (d) {
          card.status = d.status
          card.stale = card.versionId !== null && d.current_version_id !== card.versionId
        }
      }
      return {
        id: r.id,
        conversationId: r.conversation_id,
        authorType: r.author_type,
        authorId: r.author_id,
        body: r.body,
        card,
        attachments: r.attachments ? (JSON.parse(r.attachments) as Attachment[]) : [],
        tools: r.tools ? (JSON.parse(r.tools) as ToolUse[]) : [],
        createdAt: r.created_at
      }
    })
  }

  // ---- workflow announcements ---------------------------------------------------------------------------

  /** Posts the approval card for a deliverable's current version into its video's conversation. */
  announceApproval(deliverableId: number): MessageRow | null {
    const d = this.db
      .prepare('SELECT id, video_id, type, owner_gate, current_version_id FROM deliverables WHERE id = ?')
      .get(deliverableId) as
      | { id: number; video_id: number; type: string; owner_gate: number; current_version_id: number | null }
      | undefined
    if (!d || d.current_version_id === null) return null
    const def = DELIVERABLE_GRAPH.find((g) => g.type === d.type)
    if (!def) return null
    const v = this.db.prepare('SELECT number, content, file_path FROM versions WHERE id = ?').get(d.current_version_id) as {
      number: number
      content: string | null
      file_path: string | null
    }
    const conv = this.open({ kind: 'video', videoId: d.video_id })
    return this.post(conv.id, {
      authorType: 'agent',
      authorId: def.role,
      body: `${def.title} v${v.number} is ready for your review.`,
      card: {
        type: 'approval',
        deliverableId: d.id,
        versionId: d.current_version_id,
        deliverableType: def.type,
        title: `${def.title} v${v.number}`,
        excerpt: excerptOf(v.content ?? v.file_path ?? ''),
        ownerGate: d.owner_gate === 1
      }
    })
  }

  /** A short system line in the video conversation recording a decision. */
  announceDecision(deliverableId: number, text: string): MessageRow | null {
    const d = this.db.prepare('SELECT video_id FROM deliverables WHERE id = ?').get(deliverableId) as
      | { video_id: number }
      | undefined
    if (!d) return null
    const conv = this.open({ kind: 'video', videoId: d.video_id })
    return this.post(conv.id, { authorType: 'system', body: text })
  }
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

const DEPARTMENT_OF: Record<string, Department> = { steering: 'direction', production: 'production', operations: 'operations' }

const managerTitle = (channel: string): string => `${t('chat.kind.manager')} · ${channel}`
const roomTitle = (department: Department, channel: string): string =>
  `${t('chat.room')} ${t(`chat.dept.${department}` as MessageKey)} · ${channel}`

function excerptOf(text: string, max = 400): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function toConversation(r: ConversationDbRow): ConversationRow {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    videoId: r.video_id,
    agentId: r.agent_id,
    channelId: r.channel_id,
    department: r.department,
    unread: r.unread,
    lastMessage:
      r.last_body !== null && r.last_author !== null && r.last_at !== null
        ? { body: r.last_body.slice(0, PREVIEW_CHARS), authorType: r.last_author, createdAt: r.last_at }
        : null,
    updatedAt: r.updated_at
  }
}
