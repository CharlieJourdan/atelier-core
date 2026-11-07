// The group engine (PLAN-V2 §5.2): what one message of Charlie sets off in a conversation.
//   - In a room, a video, a channel or the Supervisor chat, every @mentioned agent answers in turn, in the order of the
//     text, and the lead does not answer as well. Without a mention the lead answers (Supervisor / Producteur / Chef
//     d'équipe / Manager), in a private chat the agent does. Mentions are ignored in a private chat.
//   - The lead and a private-chat agent may hand a question to a colleague (`ask_agent`): a handoff card is posted, the
//     specialist answers in the conversation (6000 characters at most go back), the asker concludes. A specialist
//     never hands over again, and a message of Charlie allows `chat.maxHandoffs` handoffs (3) in all.
//   - Each turn checks the round's budget (`chat.roundBudgetUsd`) and the caps before it calls a model.
//   - Stop (`chat.stop`) aborts the turn in flight, its handoff, the mentions not reached yet and the queued messages.
// There is no agent-to-agent loop: turns only come from Charlie's message, a mention or a handoff.
import { mentionsIn, type MentionTarget } from '../../shared/chat-rich'
import type { MessageRow } from '../../shared/chat'
import { agentIndex } from '../../shared/chat-folders'
import type { ChangeTopic } from '../../shared/api'
import type { SettingsStore } from '../settings'
import type { HandoffStore, MentionState } from './handoffs'
import { MAX_ANSWER_CHARS, personaFor } from './persona'
import { runTurn, type Round, type TurnDeps, type TurnOutcome } from './turn'
import { findAgent } from './find-agent'

export { findAgent } from './find-agent'

export interface GroupDeps extends TurnDeps {
  settings: SettingsStore
  handoffs: HandoffStore
  notify: (topic: ChangeTopic) => void
}

export const ROUND_SETTINGS = {
  maxHandoffsKey: 'chat.maxHandoffs',
  defaultMaxHandoffs: 3,
  budgetKey: 'chat.roundBudgetUsd',
  defaultBudgetUsd: 2
} as const

const MENTION_STATE: Record<TurnOutcome, MentionState> = {
  answered: 'answered',
  silent: 'answered',
  redirected: 'redirected',
  failed: 'failed',
  budget: 'failed',
  stopped: 'stopped'
}

export class GroupEngine {
  constructor(private readonly deps: GroupDeps) {}

  /** Handoffs allowed per message of Charlie (0 to 10, default 3). */
  maxHandoffs(): number {
    const v = this.deps.settings.get<number>(ROUND_SETTINGS.maxHandoffsKey, ROUND_SETTINGS.defaultMaxHandoffs)
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10 ? v : ROUND_SETTINGS.defaultMaxHandoffs
  }

  /** What all the turns of one message may cost, in USD (default 2). */
  roundBudgetUsd(): number {
    const v = this.deps.settings.get<number>(ROUND_SETTINGS.budgetKey, ROUND_SETTINGS.defaultBudgetUsd)
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000 ? v : ROUND_SETTINGS.defaultBudgetUsd
  }

  /** The agents Charlie can @mention (enabled ones), as the composer lists them. */
  targets(): MentionTarget[] {
    return this.deps.agents
      .list()
      .filter((a) => a.enabled)
      .map((a) => ({ id: a.id, name: a.name, index: agentIndex(a.id) }))
  }

  /** Answers one owner message. Never throws (a closed database during shutdown aside). */
  async answer(conversationId: number, message: MessageRow, streamBase: string, signal: AbortSignal): Promise<void> {
    let streams = 0
    // Ended when the lead's turn ends: a handoff still running then (the lead's CLI died while it waited) is cut.
    const leadDone = new AbortController()
    const pending = new Set<Promise<unknown>>()
    const round: Round = {
      conversationId,
      ownerMessageId: message.id,
      signal: AbortSignal.any([signal, leadDone.signal]),
      handoffs: 0,
      maxHandoffs: this.maxHandoffs(),
      spentUsd: 0,
      inFlightUsd: 0,
      budgetUsd: this.roundBudgetUsd(),
      exhausted: false,
      nextStreamId: () => `${streamBase}-${++streams}`
    }
    const conversation = this.deps.store.get(conversationId)
    const persona = personaFor(conversation)
    const mentioned = conversation.kind === 'agent' ? [] : mentionsIn(message.body, this.targets())
    if (mentioned.length === 0) {
      const role = persona.role
      await runTurn(this.deps, round, {
        role,
        mode: conversation.kind === 'agent' ? 'dm' : 'lead',
        consultHook: (to, question) => {
          const p = this.consult(round, role, to, question)
          pending.add(p)
          void p.finally(() => pending.delete(p)).catch(() => undefined)
          return p
        }
      })
      leadDone.abort()
      await Promise.allSettled([...pending])
      return
    }
    const { handoffs } = this.deps
    handoffs.recordMentions(message.id, mentioned.map((m) => m.id))
    for (const m of mentioned) {
      if (signal.aborted || round.exhausted) {
        handoffs.setMention(message.id, m.id, 'stopped')
        continue
      }
      handoffs.setMention(message.id, m.id, 'answering')
      const r = await runTurn(this.deps, round, { role: m.id, mode: 'mention' })
      handoffs.setMention(message.id, m.id, MENTION_STATE[r.outcome], r.message?.id ?? null)
    }
    // The renderer waits for the first stream id it was given; a round stopped before any turn still closes it.
    if (streams === 0) this.deps.emit({ streamId: `${streamBase}-1`, conversationId, done: true, error: 'Stopped' })
  }

  /** ask_agent of `from` in this round: refuses or runs the specialist's turn, and returns its answer. */
  private async consult(round: Round, from: string, ref: string, question: string): Promise<string> {
    const { handoffs, agents } = this.deps
    const target = findAgent(agents.list(), ref)
    if (!target) {
      const team = agents.list().filter((a) => a.enabled && a.id !== from).map((a) => `${a.name} (${a.id})`).join(', ')
      throw new Error(`Unknown agent "${ref}". The team: ${team}`)
    }
    if (target.id === from) throw new Error('You cannot hand a question to yourself')
    if (!target.enabled) throw new Error(`${target.name} is turned off`)
    if (round.signal.aborted) throw new Error('Charlie stopped the conversation')
    if (round.exhausted) throw new Error('The budget of this message is used up: answer with what you have')
    const base = { conversationId: round.conversationId, ownerMessageId: round.ownerMessageId, from, to: target.id, ask: question }
    if (round.handoffs >= round.maxHandoffs) {
      const reason = `Limite de ${round.maxHandoffs} passages de main par message atteinte`
      const h = handoffs.create({ ...base, refused: reason })
      handoffs.setCard(h.id, this.card(round, h.id, target.id, question, 'refused', reason).id)
      throw new Error(`Handoff limit reached (${round.maxHandoffs} per message of Charlie): answer with what you have.`)
    }
    round.handoffs += 1
    const h = handoffs.create(base)
    handoffs.setCard(h.id, this.card(round, h.id, target.id, question, 'asked').id)
    const r = await runTurn(this.deps, round, { role: target.id, mode: 'consult', consult: { from, question } })
    if ((r.outcome === 'answered' || r.outcome === 'redirected') && r.message) {
      const answer = r.text.slice(0, MAX_ANSWER_CHARS)
      handoffs.answer(h.id, answer, r.message.id)
      this.deps.notify('chat')
      return answer
    }
    if (r.outcome === 'silent') {
      // The specialist only acted (a proposal card, a message): that is its answer.
      const answer = `${target.name} a agi sans réponse écrite (outils : ${(r.tools ?? []).join(', ') || 'aucun'}).`
      handoffs.answer(h.id, answer, null)
      this.deps.notify('chat')
      return answer
    }
    const reason = r.outcome === 'stopped' ? 'Arrêté par Charlie' : r.outcome === 'budget' ? 'Budget atteint' : 'Pas de réponse'
    handoffs.refuse(h.id, reason)
    this.deps.notify('chat')
    throw new Error(`${target.name} could not answer (${reason})`)
  }

  /** The handoff card, posted by the asker. */
  private card(round: Round, handoffId: number, to: string, ask: string, state: 'asked' | 'refused', reason?: string): MessageRow {
    const from = this.deps.handoffs.get(handoffId).from
    return this.deps.store.post(round.conversationId, {
      authorType: 'agent',
      authorId: from,
      body: '',
      card: { type: 'handoff', handoffId, from, to, ask, state, ...(reason ? { reason } : {}) }
    })
  }
}
