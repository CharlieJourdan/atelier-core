// One Discord thread per question (docs/AGENT-RUNTIME.md §27). When the bridge posts a question in #à-valider it opens a
// public thread on it: the conversation about that question stays there, like a thread with a coworker. While the question
// is open, a message in its thread answers it (the same path as a reply to the message); once it is settled, a message
// there goes to the agent who asked, exactly like the app does (`orchestra.say`), and the agent's next reply in that room
// is posted back in the thread. A thread is followed while its question is open and three days after the last message.
import { t } from '../../shared/fr'
import type { Ctx, Decision, PendingItem } from './approvals'
import { refKey } from './approvals'
import { excerpt } from './format'
import { DiscordError, type DiscordRest } from './rest'
import type { PendingRef, PostedRef, StateStore } from './state'
import { maxSnowflake, snowflakeCompare, type DiscordMessage } from './types'

const FOLLOW_MS = 3 * 24 * 3600 * 1000
/** Discord's « missing permissions » error code. */
const MISSING_PERMISSIONS = 50013

export interface ThreadHost {
  rest: DiscordRest
  store: StateStore
  ctx: Ctx
  now: () => number
  /** Posts in a channel or thread; `important` pings the allowed people (when the notification level lets it). */
  post(channelId: string, text: string, opts?: { important?: boolean }): Promise<DiscordMessage | null>
  decide(channelId: string, messageId: string, ref: PostedRef, decision: Decision): Promise<void>
  /** Chat message ids that came from Discord (not mirrored back). */
  fromDiscord: Set<number>
}

export class QuestionThreads {
  /** The last problem opening a thread (shown with the bridge's error). */
  error: string | null = null

  constructor(private readonly h: ThreadHost) {}

  /** Opens the thread of a question just posted; returns its id (null when Discord refused). */
  async open(channelId: string, message: DiscordMessage, item: PendingItem): Promise<string | null> {
    const { h } = this
    try {
      const thread = await h.rest.startThread(channelId, message.id, excerpt(item.threadName.replace(/\s+/g, ' '), 90) || 'Question')
      const agent = item.agentId !== null ? h.ctx.orchestra.agents().find((a) => a.id === item.agentId) : undefined
      const hello = await h.post(thread.id, agent ? t('discord.thread.hello', { agent: agent.name }) : t('discord.thread.helloApp'))
      h.store.get().threads[thread.id] = { ref: item.ref, agentId: item.agentId, cursor: hello?.id ?? message.id, until: h.now() + FOLLOW_MS }
      this.error = null
      return thread.id
    } catch (err) {
      this.error = err instanceof DiscordError && (err.status === 403 || err.code === MISSING_PERMISSIONS) ? t('discord.err.threads') : err instanceof Error ? err.message : String(err)
      return null
    }
  }

  /** Reads what was written in the followed threads. */
  async pull(): Promise<void> {
    const { h } = this
    const st = h.store.get()
    for (const [threadId, th] of Object.entries(st.threads)) {
      const open = this.postedFor(th.ref) !== null
      if (!open && !th.reply && h.now() > th.until) {
        delete st.threads[threadId]
        continue
      }
      let batch: DiscordMessage[]
      try {
        batch = await h.rest.messages(threadId, { after: th.cursor, limit: 50 })
      } catch (err) {
        // deleted in Discord: let it go (the question itself still works from its message)
        if (err instanceof DiscordError && err.status === 404) {
          delete st.threads[threadId]
          continue
        }
        throw err
      }
      batch.sort((a, b) => snowflakeCompare(a.id, b.id))
      for (const m of batch) {
        th.cursor = maxSnowflake(th.cursor, m.id)
        if (m.author.bot === true || m.author.id === st.botUserId || !st.allowedUserIds.includes(m.author.id)) continue
        const text = [m.content.trim(), ...(m.attachments ?? []).map((a) => a.url)].filter(Boolean).join('\n')
        if (!text) {
          st.contentIntentMissing = true
          continue
        }
        th.until = h.now() + FOLLOW_MS
        await this.handle(threadId, m, text)
      }
    }
  }

  private async handle(threadId: string, m: DiscordMessage, text: string): Promise<void> {
    const { h } = this
    const st = h.store.get()
    const th = st.threads[threadId]
    if (!th) return
    const posted = this.postedFor(th.ref)
    if (posted) return h.decide(threadId, posted[0], posted[1], { kind: 'text', text })
    const agent = th.agentId !== null ? h.ctx.orchestra.agents().find((a) => a.id === th.agentId) : undefined
    if (!agent) {
      await h.post(threadId, t('discord.thread.closed'))
      return
    }
    try {
      const sent = h.ctx.orchestra.say({ agentId: agent.id, text })
      h.fromDiscord.add(sent.messageId)
      th.reply = { conversationId: sent.conversationId, afterId: sent.messageId }
      await h.rest.addReaction(threadId, m.id, '👀').catch(() => undefined)
    } catch (err) {
      await h.post(threadId, `⚠ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** The agent's reply to a message written in a thread goes back to that thread. */
  async replies(): Promise<void> {
    const { h } = this
    const st = h.store.get()
    for (const [threadId, th] of Object.entries(st.threads)) {
      if (!th.reply) continue
      const agent = th.agentId !== null ? h.ctx.orchestra.agents().find((a) => a.id === th.agentId) : undefined
      if (!agent) {
        th.reply = undefined
        continue
      }
      let messages
      try {
        messages = h.ctx.chat.store.messages(th.reply.conversationId, th.reply.afterId, 50)
      } catch {
        th.reply = undefined
        continue
      }
      for (const msg of messages) {
        th.reply.afterId = msg.id
        if (msg.authorType !== 'agent' || msg.authorId !== `orch:${agent.slug}` || !msg.body.trim()) continue
        await h.post(threadId, `**${agent.name}**\n${msg.body.trim()}`, { important: true })
        th.reply = undefined
        break
      }
    }
  }

  /** The message in #à-valider still waiting for this decision, if any. */
  private postedFor(ref: PendingRef): [string, PostedRef] | null {
    const key = refKey(ref)
    const found = Object.entries(this.h.store.get().posted).find(([, r]) => refKey(r) === key)
    return found ?? null
  }
}
