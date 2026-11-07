// The demo brain of the team chat. The main agent's thread is answered by the shared store (`send`); every other
// thread is answered here: the agent who is addressed (or the one who owns the conversation) types for a moment, hands
// work over when it fits, and answers like a colleague would. In a group chat a second agent chimes in.
import { t } from '../../../shared/fr'
import { hash } from '@/proto/data-team-agents'
import { FEEDBACK_REPLY, FOLLOW_UPS, FOLLOW_UPS_BY_ROLE, REPLIES, SYSTEM_ID, feedbackKind } from '@/proto/data-team-chat'
import type { ProtoMessage } from '@/proto/types'
import { firstMentioned, mentionables, postedAt, type ThreadInfo } from './chat-model'
import { leadOf, type TeamAgent } from './model'
import { localId, teamActions } from './store'

export interface Attachment {
  name: string
  sizeMb: number
}

export function post(threadId: string, authorId: string, text: string, card?: ProtoMessage['card']): void {
  const id = localId('lm')
  postedAt.set(id, Date.now())
  teamActions.post({ id, threadId, authorId, text, minutesAgo: 0, ...(card ? { card } : {}) })
}

function replyText(agent: TeamAgent, text: string): string {
  const pool = REPLIES[agent.role] ?? REPLIES['channel-manager'] ?? []
  return pool[hash(text) % Math.max(1, pool.length)] ?? t('msg.reply.fallback')
}

function later(ms: number, fn: () => void): void {
  setTimeout(fn, ms)
}

/** Who answers a message: the agent who is @mentioned, else the owner of the conversation. */
export function responderFor(thread: ThreadInfo, text: string, agents: readonly TeamAgent[]): TeamAgent | undefined {
  const mentioned = firstMentioned(text, mentionables(thread, agents))
  if (mentioned && mentioned.role !== 'principal') return mentioned
  if (thread.kind === 'agent-dm') return agents.find((a) => a.id === thread.agentId)
  const lead = thread.channelId ? leadOf(agents, thread.channelId) : undefined
  if (thread.kind === 'video') {
    const kind = feedbackKind(text)
    if (kind) {
      const wanted = FEEDBACK_REPLY[kind].role
      const hit = agents.find((a) => a.channelId === thread.channelId && a.role === wanted)
      if (hit) return hit
    }
  }
  return lead ?? agents.find((a) => thread.participantIds.includes(a.id))
}

/** Posts the user's message in a thread the shared store does not answer, then plays the colleagues' answers. */
export function sendLocal(thread: ThreadInfo, text: string, agents: readonly TeamAgent[], attachment?: Attachment): void {
  post(thread.id, 'user', text)
  if (attachment) post(thread.id, 'user', '', { type: 'task', title: attachment.name, detail: t('msg.attachment.detail', { size: attachment.sizeMb }) })
  const responder = responderFor(thread, text, agents)
  if (!responder) return
  const kind = thread.kind === 'video' ? feedbackKind(text) : null
  const lead = thread.channelId ? leadOf(agents, thread.channelId) : undefined
  teamActions.setTyping(thread.id, responder.id, true)
  later(1_000 + (hash(text) % 500), () => {
    teamActions.setTyping(thread.id, responder.id, false)
    if (kind && lead && lead.id !== responder.id) post(thread.id, SYSTEM_ID, `${lead.name} ${FEEDBACK_REPLY[kind].handoff}`)
    post(thread.id, responder.id, kind ? FEEDBACK_REPLY[kind].text : replyText(responder, text))
    if (thread.kind !== 'channel-group') return
    const others = agents.filter((a) => thread.participantIds.includes(a.id) && a.id !== responder.id && a.role !== 'principal')
    const second = others[hash(text + responder.id) % Math.max(1, others.length)]
    if (!second || hash(text) % 3 === 0) return
    teamActions.setTyping(thread.id, second.id, true)
    later(1_300, () => {
      teamActions.setTyping(thread.id, second.id, false)
      const pool = FOLLOW_UPS_BY_ROLE[second.role] ?? FOLLOW_UPS
      post(thread.id, second.id, `@${responder.name} ${pool[hash(text) % Math.max(1, pool.length)] ?? ''}`)
    })
  })
}
