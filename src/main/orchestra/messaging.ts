// Inter-agent messaging through the existing chat (src/main/chat): agents post in the channel group conversation (the
// channel's `channel` conversation), in a video's conversation, or in the Supervisor conversation for the principal; a
// message that @mentions runtime agents wakes them with a `mention` task; a delegation is recorded as a handoff of the
// existing handoff store and shown with its card (answered when the sub-task finishes). Loops are bounded: a mention
// started by a mention carries `depth`, and nothing is enqueued beyond MAX_MENTION_DEPTH or for an agent that already
// has MAX_PENDING_MENTIONS mentions waiting.
import { mentionsIn, type MentionTarget } from '../../shared/chat-rich'
import type { MessageRow } from '../../shared/chat'
import type { ChatStore } from '../chat/store'
import type { HandoffStore } from '../chat/handoffs'
import type { Db } from '../db'
import type { AgentRecord, AgentTree } from './tree'
import { truncate, type EventLog } from './util'

export const AUTHOR_PREFIX = 'orch:'
export const MAX_MENTION_DEPTH = 2
export const MAX_PENDING_MENTIONS = 3

export const authorId = (a: AgentRecord): string => `${AUTHOR_PREFIX}${a.slug}`

export interface MentionWake {
  agent: AgentRecord
  conversationId: number
  messageId: number
  from: string
  text: string
  depth: number
  channelId: number | null
  videoId: number | null
}

export class Messaging {
  private readonly db: Db
  private readonly chat: ChatStore
  private readonly handoffs: HandoffStore
  private readonly tree: AgentTree
  private readonly events: EventLog
  /** Set by the runtime: enqueues the mention task. */
  onMention: ((w: MentionWake) => void) | null = null
  /** Depth of the message being posted by an agent turn (mentions it makes are one deeper). */
  private postingDepth: number | null = null

  constructor(db: Db, chat: ChatStore, handoffs: HandoffStore, tree: AgentTree, events: EventLog) {
    this.db = db
    this.chat = chat
    this.handoffs = handoffs
    this.tree = tree
    this.events = events
  }

  targets(): MentionTarget[] {
    return this.tree.list().map((a, i) => ({ id: String(a.id), name: a.name, index: i }))
  }

  /** The conversation for a room: the channel group chat, a video's chat, or the Supervisor chat. */
  conversationFor(room: 'channel' | 'video' | 'principal', channelId: number | null, videoId: number | null): number {
    if (room === 'video' && videoId !== null && this.db.prepare('SELECT 1 FROM videos WHERE id = ?').get(videoId)) {
      return this.chat.open({ kind: 'video', videoId }).id
    }
    if (room !== 'principal' && channelId !== null && this.db.prepare('SELECT 1 FROM channels WHERE id = ? AND archived_at IS NULL').get(channelId)) {
      return this.chat.open({ kind: 'channel', channelId }).id
    }
    return this.chat.open({ kind: 'supervisor' }).id
  }

  /** Posts as an agent. Mentions in the text wake their agents (one level deeper than `depth`). */
  post(agent: AgentRecord, conversationId: number, text: string, depth: number): MessageRow {
    this.postingDepth = depth
    try {
      const msg = this.chat.post(conversationId, { authorType: 'agent', authorId: authorId(agent), body: truncate(text, 20_000) })
      this.events.add('post', `${agent.name} → conversation ${conversationId}: ${truncate(text, 120)}`, agent.id)
      return msg
    } finally {
      this.postingDepth = null
    }
  }

  /** Posts as the owner (Charlie): the chat's onPosted hook sees the @mentions and wakes the agents. */
  postOwner(conversationId: number, text: string): MessageRow {
    return this.chat.post(conversationId, { authorType: 'owner', body: truncate(text, 20_000) })
  }

  /** Posts a system line (alerts, "work resumes at …"). */
  system(conversationId: number, text: string): void {
    this.chat.post(conversationId, { authorType: 'system', body: truncate(text, 4000) })
  }

  /** ChatStore.onPosted: any message (the owner's or an agent's) that @mentions runtime agents wakes them. */
  observe(conversationId: number, message: MessageRow): void {
    if (message.authorType === 'system' || !this.onMention) return
    const mentioned = mentionsIn(message.body, this.targets())
    if (mentioned.length === 0) return
    const depth = message.authorType === 'owner' ? 0 : (this.postingDepth ?? MAX_MENTION_DEPTH) + 1
    const conv = this.chat.get(conversationId)
    const author = message.authorType === 'owner' ? 'Charlie' : this.authorName(message.authorId)
    for (const t of mentioned) {
      const agent = this.tree.get(Number(t.id))
      if (message.authorId === authorId(agent)) continue
      if (depth > MAX_MENTION_DEPTH) {
        this.events.add('mention', `mention of ${agent.name} not followed (depth ${depth})`, agent.id)
        continue
      }
      const pending = this.db
        .prepare(`SELECT COUNT(*) AS n FROM orch_tasks WHERE assignee_id = ? AND kind = 'mention' AND status IN ('queued','failed','leased','running')`)
        .get(agent.id) as { n: number }
      if (pending.n >= MAX_PENDING_MENTIONS) {
        this.events.add('mention', `mention of ${agent.name} dropped (${pending.n} already waiting)`, agent.id)
        continue
      }
      this.onMention({
        agent,
        conversationId,
        messageId: message.id,
        from: author,
        text: message.body,
        depth,
        channelId: conv.channelId ?? agent.channelId,
        videoId: conv.videoId ?? null
      })
    }
  }

  private authorName(id: string | null): string {
    if (id?.startsWith(AUTHOR_PREFIX)) return this.tree.bySlug(id.slice(AUTHOR_PREFIX.length))?.name ?? id
    return id ?? 'an agent'
  }

  /** A delegation as a handoff card of the existing chat (from → to, the ask); returns the handoff id. */
  handoff(from: AgentRecord, to: AgentRecord, ask: string, conversationId: number): number {
    const h = this.handoffs.create({ conversationId, ownerMessageId: null, from: authorId(from), to: authorId(to), ask: truncate(ask, 2000) })
    const card = this.chat.post(conversationId, {
      authorType: 'agent',
      authorId: authorId(from),
      body: '',
      card: { type: 'handoff', handoffId: h.id, from: authorId(from), to: authorId(to), ask: truncate(ask, 2000), state: 'asked' }
    })
    this.handoffs.setCard(h.id, card.id)
    return h.id
  }

  closeHandoff(handoffId: number, ok: boolean, text: string): void {
    try {
      if (ok) this.handoffs.answer(handoffId, truncate(text, 6000), null)
      else this.handoffs.refuse(handoffId, truncate(text, 300))
    } catch {
      // the conversation was deleted meanwhile
    }
  }
}
