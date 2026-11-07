// One agent turn in a conversation: the lead (Supervisor, Producteur, Chef d'équipe, Manager), the agent of a private
// chat, an @mentioned agent, or a specialist answering a handoff. It runs with the agent's instructions, memory and
// Atelier tools (MCP bridge for Claude Code, in-process for the fake), goes through the ledger (reserve → call →
// settle; refunded only when nothing can have been billed), checks the round's budget first, streams its text and
// tool steps to the renderer, and applies the lane rule to agents Charlie addressed directly. Never throws.
import { readFileSync } from 'node:fs'
import type { EventContract } from '../../shared/api'
import type { Card, MessageRow } from '../../shared/chat'
import type { AtelierTool } from '../../shared/agents'
import { roleName } from '../../shared/roles'
import { chatBriefText } from '../agents/context'
import { reserveFor, runReserved, unpricedReserveUsd } from '../agents/call'
import { buildChatSystem } from '../agents/prompt'
import { agentDefault } from '../agents/roles'
import type { AgentRunner, OpenedTools } from '../agents/runner'
import type { AgentsStore } from '../agents/store'
import { PRODUCTION_TOOLS } from '../agents/tools-production'
import { BudgetExceededError, type Ledger } from '../ledger'
import { approxTokens } from '../llm/fake'
import type { RoutesStore } from '../llm/routes'
import { ProviderError, type Provider, type Usage } from '../llm/types'
import type { Db } from '../db'
import type { ProductionPort } from '../production/port'
import type { SettingsStore } from '../settings'
import type { WorkflowEngine } from '../workflow/engine'
import { groupLines, mayBeOffTopic, offTopic, personaFor, redirectText, type TeamMember } from './persona'
import { roleLabel, type ChatStore } from './store'
import { findAgent } from './find-agent'

export type StreamPayload = EventContract['atelier:stream']

export interface TurnDeps {
  db: Db
  store: ChatStore
  routes: RoutesStore
  ledger: Ledger
  getProvider: (id: string) => Provider
  emit: (payload: StreamPayload) => void
  agents: AgentsStore
  runner: AgentRunner
  workflow: WorkflowEngine
  settings: SettingsStore
  production?: ProductionPort | null
}

/** The turns started by one message of Charlie: shared limits and the Stop signal. */
export interface Round {
  conversationId: number
  ownerMessageId: number | null
  signal: AbortSignal
  /** Handoffs started so far, and the most allowed. */
  handoffs: number
  maxHandoffs: number
  /** Booked so far by this round's turns, reserved by the turns in flight, and the ceiling. */
  spentUsd: number
  inFlightUsd: number
  budgetUsd: number
  /** Set when a budget refusal ended the round: no more turns. */
  exhausted: boolean
  nextStreamId(): string
}

export type TurnMode = 'lead' | 'dm' | 'mention' | 'consult'

export interface TurnSpec {
  /** The agent answering (the persona's role for the lead). */
  role: string
  mode: TurnMode
  /** For a handoff turn: who asked and what. */
  consult?: { from: string; question: string }
  /** ask_agent for this turn (the lead and a private chat); absent: no handoffs. */
  consultHook?: (to: string, question: string) => Promise<string>
}

export type TurnOutcome = 'answered' | 'silent' | 'redirected' | 'failed' | 'stopped' | 'budget'

export interface TurnResult {
  message: MessageRow | null
  text: string
  outcome: TurnOutcome
  /** Tools the agent used (a `silent` turn only acted). */
  tools?: string[]
}

const HISTORY_MESSAGES = 30
const CONSULT_HISTORY = 14
const MAX_REPLY_TOKENS = 2048
const MAX_ATTACHMENT_CHARS = 20_000

function describeCard(card: Card): string {
  switch (card.type) {
    case 'approval':
      return `[approval card: ${card.title}, status ${card.status ?? 'unknown'}]`
    case 'budget':
      return `[budget card: ${card.message}]`
    case 'proposal':
      return `[proposal card: ${card.title}]`
    case 'task':
      return `[task card: ${card.title}, ${card.status}]`
    case 'qc':
      return `[QC card: ${card.passed ? 'passed' : 'failed'}, ${card.summary}]`
    case 'handoff':
      return `[handoff: ${roleLabel(card.from)} asked ${roleLabel(card.to)}: ${card.ask}]`
  }
}

function attachmentText(m: MessageRow): string[] {
  const out: string[] = []
  for (const a of m.attachments) {
    const textual = a.mime.startsWith('text/') || a.mime === 'application/json'
    if (!textual) {
      out.push(`[attachment: ${a.name} (${a.mime}, ${a.size} bytes)]`)
      continue
    }
    try {
      const text = readFileSync(a.path, 'utf8').slice(0, MAX_ATTACHMENT_CHARS)
      out.push(`[attachment ${a.name}]\n${text}\n[end of ${a.name}]`)
    } catch {
      out.push(`[attachment: ${a.name} (unreadable)]`)
    }
  }
  return out
}

/** The conversation so far as one prompt (the provider interface takes a single prompt). */
export function transcriptFor(messages: MessageRow[], role: string, tail?: string): string {
  const lines = messages.map((m) => {
    const who = m.authorType === 'owner' ? 'Charlie' : m.authorType === 'system' ? 'System' : roleLabel(m.authorId ?? role)
    const parts = [m.body, ...(m.card ? [describeCard(m.card)] : []), ...attachmentText(m)].filter(Boolean)
    return `${who}: ${parts.join('\n')}`
  })
  return `${lines.join('\n\n')}${tail ? `\n\n${tail}` : ''}\n\n${roleLabel(role)}:`
}

export async function runTurn(deps: TurnDeps, round: Round, spec: TurnSpec): Promise<TurnResult> {
  const { store, emit } = deps
  const { conversationId } = round
  const streamId = round.nextStreamId()
  const authorId = spec.role
  const done = (extra: Partial<StreamPayload> = {}): void => emit({ streamId, conversationId, authorId, done: true, ...extra })
  const fail = (text: string, card?: Card, outcome: TurnOutcome = 'failed'): TurnResult => {
    store.post(conversationId, { authorType: 'system', body: text, ...(card ? { card } : {}) })
    done({ error: text })
    return { message: null, text: '', outcome }
  }
  if (round.signal.aborted) {
    done({ error: 'Stopped' })
    return { message: null, text: '', outcome: 'stopped' }
  }
  // Announce the turn at once: the renderer shows who is writing (and keeps Stop) before the first token.
  emit({ streamId, conversationId, authorId })
  let opened: OpenedTools | null = null
  try {
    const conversation = store.get(conversationId)
    const persona = personaFor(conversation)
    const role = spec.role
    const route = deps.routes.resolve(role)
    const video = conversation.videoId !== null ? deps.workflow.getVideo(conversation.videoId) : null
    const channelId = conversation.channelId ?? video?.channelId ?? null
    const provider = deps.getProvider(route.providerId)
    const consult = spec.mode === 'consult' ? spec.consult : undefined
    const history = store.messages(conversationId, 0, consult ? CONSULT_HISTORY : HISTORY_MESSAGES)
    const prompt = transcriptFor(history, role, consult ? `${roleLabel(consult.from)} handed you this: ${consult.question}` : undefined)
    const agent = deps.agents.find(role)
    if (!agent) return fail(`Unknown agent: ${role}`)
    if (!agent.enabled) return fail(`${agent.name} is turned off. Turn it on in Settings > Agents.`)
    const wf = deps.workflow
    const channel = channelId !== null ? wf.channels.get(channelId) : null
    const direct = spec.mode === 'dm' || spec.mode === 'mention'
    opened = deps.runner.openTools(
      { kind: 'chat', role, conversationId, channelId, videoId: video?.id ?? null, taskId: null },
      agent,
      provider,
      { brief: () => chatBriefText(wf, video?.id ?? null), inputs: () => '' },
      null,
      {
        ...(spec.consultHook ? { consult: spec.consultHook } : {}),
        onTool: (step) => emit({ streamId, conversationId, authorId, tool: step })
      }
    )
    const offered = opened.run.specs.map((t) => t.name as AtelierTool)
    const team: TeamMember[] = deps.agents
      .list()
      .filter((a) => a.enabled && a.id !== role)
      .map((a) => ({ id: a.id, name: a.name, job: agentDefault(a.role)?.job ?? a.name }))
    const system = [
      buildChatSystem({
        // The prompt names only the tools this turn really has.
        agent: { ...agent, tools: offered },
        kind: conversation.kind,
        video,
        channel,
        channels: wf.channels.list(),
        memory: deps.agents.recall(role, channel?.id ?? null).map((m) => m.content),
        toolsAvailable: opened.available
      }),
      ...groupLines({
        persona,
        speaker: { id: role, name: agent.name },
        channelName: channel?.name ?? null,
        team,
        direct,
        canAsk: opened.available && offered.includes('ask_agent'),
        consultFrom: consult ? roleName(consult.from) : null,
        productionMissing: deps.production?.available !== true && agent.tools.some((t) => (PRODUCTION_TOOLS as readonly string[]).includes(t))
      })
    ].join('\n\n')
    const oneTurn: Usage = { inputTokens: approxTokens(system + prompt), outputTokens: MAX_REPLY_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const limits = opened.available ? deps.runner.toolRunLimits(oneTurn) : null
    const estimate = limits?.estimate ?? oneTurn
    // The round's own ceiling, before the caps: what this message of Charlie may cost in all.
    // An unpriced Claude Code model is reserved like the fallback model while a cap is set (as task runs are).
    const priced = priceOf(deps.ledger, route.model, estimate)
    const unpricedUsd = priced === 0 ? unpricedReserveUsd(deps.ledger, deps.settings, deps.routes, channelId, estimate) : 0
    const estimateUsd = priced || unpricedUsd
    if (round.exhausted || round.spentUsd + round.inFlightUsd + estimateUsd > round.budgetUsd) {
      round.exhausted = true
      return fail(
        `Budget du message atteint (${usd(round.spentUsd + round.inFlightUsd)} sur ${usd(round.budgetUsd)}, réglage « chat.roundBudgetUsd ») : ${agent.name} ne répond pas.`,
        undefined,
        'budget'
      )
    }
    const request = {
      model: route.model,
      system,
      prompt,
      maxTokens: MAX_REPLY_TOKENS,
      ...(route.effort ? { effort: route.effort } : {}),
      ...(opened.available ? { tools: opened.tools } : {}),
      ...(limits ? { maxTurns: limits.maxTurns } : {})
    }
    const who = { channelId, videoId: video?.id ?? null, taskId: null }
    const handle = reserveFor(deps.ledger, route, estimate, who, unpricedUsd)
    round.inFlightUsd += estimateUsd
    // The lane token is held back while the text could still be it.
    let held = ''
    let released = !direct
    const onText = (delta: string): void => {
      if (released) return emit({ streamId, conversationId, authorId, delta })
      held += delta
      if (!mayBeOffTopic(held)) {
        released = true
        emit({ streamId, conversationId, authorId, delta: held })
        held = ''
      }
    }
    let final
    try {
      // A failed call that was still billed counts in the round too.
      const out = await runReserved(deps.ledger, handle, provider, request, onText, round.signal, (usd) => (round.spentUsd += usd))
      final = out.result
      round.spentUsd += out.costUsd
    } finally {
      round.inFlightUsd -= estimateUsd
      // A turn may cost more than its reservation: past a cap, the tasks not started yet go on budget hold.
      try {
        deps.runner.holdIfCapReached(channelId, conversationId)
      } catch {
        // quitting (database closed): the next start sees the spend
      }
    }
    let body = final.text.trim()
    const tools = opened.run.uses
    if (!body && opened.run.callCount > 0) {
      // The agent only acted (a proposal card, a message): nothing more to say.
      done()
      return { message: null, text: '', outcome: 'silent', tools: tools.map((u) => u.name) }
    }
    if (!body) return fail('The model returned an empty reply.')
    let outcome: TurnOutcome = 'answered'
    const lane = direct ? offTopic(body) : null
    if (lane !== null) {
      const target = lane ? findAgent(team, lane) : null
      body = redirectText(agent.name, target)
      outcome = 'redirected'
    }
    const saved = store.post(conversationId, { authorType: 'agent', authorId, body, tools })
    if (final.truncated) {
      store.post(conversationId, {
        authorType: 'system',
        body: 'The reply hit the token limit and was cut short. Ask me to continue if you need the rest.'
      })
    }
    done({ messageId: saved.id })
    return { message: saved, text: body, outcome }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      round.exhausted = true
      return fail(
        err.message,
        { type: 'budget', scope: err.scope, capUsd: err.capUsd, spentUsd: err.spentUsd, requestedUsd: err.requestedUsd, message: err.message },
        'budget'
      )
    }
    if (err instanceof ProviderError && err.code === 'ABORTED') {
      done({ error: 'Stopped' })
      return { message: null, text: '', outcome: 'stopped' }
    }
    return fail(`Reply failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    opened?.close()
  }
}

/** The price of an estimate, 0 when the model has no price (an unpriced Claude Code model reports its own cost). */
function priceOf(ledger: Ledger, model: string, usage: Usage): number {
  try {
    return ledger.estimate(model, usage)
  } catch {
    return 0
  }
}

const usd = (n: number): string => `${n.toFixed(n < 1 ? 3 : 2)} $`
