// What an agent reads at each turn (docs/AGENT-RUNTIME.md §20), with a token budget per part:
//   system prompt = role (persona, instructions, manager, reports, protocol)  ≤ 1 500 tokens
//                 + technologies (one line each; the tools' schemas go through MCP)  ≤ 600
//                 + workspace memory (orch_context)  ≤ 500
//                 + channel memory (orch_context)  ≤ 900
//   task prompt   = the task (title, brief, results of sub-tasks, Charlie's answers, dependencies, message)
//                   + the channel's standing goals and approval level (goals.ts; every turn, resumed too)  ≤ 3 000
//                 + handover of the previous session (fresh turns)  ≤ 750
//                 + selected memories, top 8 by relevance (fresh turns)  ≤ 900
//                 + recent thread: the last 8 messages of the agent's room  ≤ 600
// A resumed CLI session gets only the task and the thread (the rest is already in the session); compaction (turn.ts)
// starts a fresh session before the context passes `compactAtTokens`. Secrets never get in: every part goes through
// `scrubSecrets` (API keys, tokens, passwords, bearer headers), and nothing reads the secrets store or a CLI's
// credential files. « Ce que l'agent sait » (orchestra.agentContext) shows exactly these sections.
import type { OrchAgentContext, OrchContextSection, OrchMemoryItem, OrchTask } from '../../shared/api/orchestra'
import type { ContextStore } from './layers'
import type { RuntimeParts } from './parts'
import { systemPrompt, taskPrompt, type ActionRights, type TurnContext } from './prompt'
import { technologiesOf, technologyLines } from './technologies'
import type { AgentRecord } from './tree'
import { estimateTokens, truncate } from './util'

export const BUDGETS: Readonly<Record<OrchContextSection['id'], number>> = {
  role: 1500,
  technologies: 600,
  workspace: 500,
  channel: 900,
  task: 3000,
  handover: 750,
  memories: 900,
  thread: 600
}
const THREAD_MESSAGES = 8

const REDACTED = '[secret retiré]'
/** Credential shapes, replaced whole. */
const SECRET_SHAPES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:atb|amc|enr|ghp|gho|xox[abps])[_-][A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi
]
/** « label: value » pairs: the label stays, the value goes. */
const SECRET_PAIRS = /\b(api[_ -]?key|cl[ée] api|access[_ -]?token|refresh[_ -]?token|token|password|mot de passe|secret)(\s*[:=]\s*)(?!\[secret)\S+/gi

/** Removes anything that looks like a credential (it is replaced by « [secret retiré] »). */
export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SECRET_SHAPES) out = out.replace(re, REDACTED)
  return out.replace(SECRET_PAIRS, (_m: string, label: string, sep: string) => `${label}${sep}${REDACTED}`)
}

/** Cuts a text to a token budget (4 characters per token). */
export function fit(text: string, budget: number): { text: string; truncated: boolean } {
  const clean = scrubSecrets(text)
  const max = budget * 4
  return clean.length <= max ? { text: clean, truncated: false } : { text: truncate(clean, max), truncated: true }
}

const indent = (text: string): string =>
  text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')

export interface Assembled {
  system: string
  prompt: string
  sections: OrchContextSection[]
}

export interface AssembleInput {
  parts: RuntimeParts
  context: ContextStore
  agent: AgentRecord
  /** The turn's context (prompt.ts); its memory, handover and resumed flag decide the fresh / resumed parts. */
  ctx: TurnContext
  /** The account's provider can offer the tools this turn (false: Codex, the API key, no MCP bridge). */
  toolsAvailable?: boolean
}

/** The recent messages of the agent's room, oldest first, each cut short. */
export function recentThread(parts: RuntimeParts, task: OrchTask, agent: AgentRecord): string {
  const room = agent.role === 'principal' && task.videoId === null ? 'principal' : task.videoId !== null ? 'video' : 'channel'
  let conv: number
  try {
    conv = parts.messaging.conversationFor(room, task.channelId ?? agent.channelId, task.videoId)
  } catch {
    return ''
  }
  const rows = parts.db
    .prepare(`SELECT * FROM (SELECT id, author_type, author_id, body FROM messages WHERE conversation_id = ? AND body != '' ORDER BY id DESC LIMIT ?) ORDER BY id`)
    .all(conv, THREAD_MESSAGES) as { author_type: string; author_id: string | null; body: string }[]
  const names = new Map(parts.tree.list().map((a) => [`orch:${a.slug}`, a.name]))
  return rows
    .map((r) => `${r.author_type === 'owner' ? 'Charlie' : r.author_type === 'system' ? 'Atelier' : (names.get(r.author_id ?? '') ?? r.author_id ?? 'agent')}: ${truncate(r.body.replace(/\s+/g, ' '), 300)}`)
    .join('\n')
}

function memoriesText(items: readonly OrchMemoryItem[]): string {
  return items.map((m) => `- [${m.kind}] ${truncate(m.content, 400)}`).join('\n')
}

/**
 * What a resumed session must re-learn (#110): its system prompt is not sent again, so a belief it formed earlier («
 * outils inaccessibles », « solde 0 ») would survive the fix of its cause. Every resumed turn starts with the state as it is
 * now, and says the earlier beliefs about it are void.
 */
export function stateNow(granted: readonly string[], toolsAvailable: boolean | undefined): string {
  const needsTools = granted.some((id) => id !== 'team.delegate' && id !== 'inbox.ask')
  const tools = !needsTools ? '' : toolsAvailable === false ? '- Your tools cannot be reached in this turn.' : '- Your tools are reachable in this turn (earlier « tools unavailable » messages are over: use them).'
  return [
    'STATE NOW (re-read at the start of this turn; it replaces anything you concluded earlier in this conversation about tools, balance or budget):',
    tools,
    '- A balance, a budget or an error you saw in an earlier turn may have changed: read it again with your tools before relying on it or reporting it.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function assemble(input: AssembleInput): Assembled {
  const { parts, context, agent, ctx } = input
  const granted = technologiesOf(agent)
  const rights: ActionRights = { delegate: granted.includes('team.delegate'), ask: granted.includes('inbox.ask') }
  const role = fit(systemPrompt(agent, ctx.reports, ctx.manager, ctx.channel?.name ?? null, rights), BUDGETS.role)
  const techLines = technologyLines(granted)
  const offline = input.toolsAvailable === false && granted.some((id) => id !== 'team.delegate' && id !== 'inbox.ask')
  const tech = fit(
    techLines.length
      ? `Your technologies (what you may use; call the tools by name):\n${techLines.join('\n')}${offline ? '\nThe tools cannot be reached on this account in this turn: work with what you have and say what you could not check.' : ''}`
      : 'You have no tools: you act only through the atelier action block.',
    BUDGETS.technologies
  )
  const ws = context.workspace()
  const workspace = fit(ws.text ? `Workspace memory (about Charlie and the business; every agent reads it):\n${indent(ws.text)}` : '', BUDGETS.workspace)
  const channelId = ctx.task.channelId ?? agent.channelId
  const cb = channelId !== null ? context.channel(channelId) : null
  const channel = fit(cb?.text ? `Channel memory (${ctx.channel?.name ?? `#${String(channelId)}`}; every agent of the channel reads it):\n${indent(cb.text)}` : '', BUDGETS.channel)
  const thread = fit(recentThread(parts, ctx.task, agent), BUDGETS.thread)
  // The task part is what prompt.ts writes without the memories and handover (counted on their own just below), with
  // the channel's goals: they change while a CLI session lives, so even a resumed turn reads them.
  const goals = parts.goals.block(channelId)
  const withGoals = (text: string): string => (goals ? `${text}

${goals}` : text)
  const taskOnly = fit(withGoals(taskPrompt({ ...ctx, memory: [], handover: '', thread: '' })), BUDGETS.task)
  const handover = fit(!ctx.resumed && ctx.handover ? ctx.handover : '', BUDGETS.handover)
  const memories = fit(!ctx.resumed ? memoriesText(ctx.memory) : '', BUDGETS.memories)
  const system = [role.text, tech.text, ...(ctx.resumed ? [] : [workspace.text, channel.text])].filter(Boolean).join('\n\n')
  const refresh = ctx.resumed ? stateNow(granted, input.toolsAvailable) : ''
  const body = withGoals(taskPrompt({ ...ctx, thread: thread.text }))
  const prompt = scrubSecrets(refresh ? `${refresh}\n\n${body}` : body)
  const section = (id: OrchContextSection['id'], part: { text: string; truncated: boolean }): OrchContextSection => ({
    id,
    text: part.text,
    tokens: estimateTokens(part.text),
    budget: BUDGETS[id],
    truncated: part.truncated
  })
  return {
    system,
    prompt,
    sections: [
      section('role', role),
      section('technologies', tech),
      section('workspace', workspace),
      section('channel', channel),
      section('task', taskOnly),
      section('handover', handover),
      section('memories', memories),
      section('thread', thread)
    ]
  }
}

/** « Ce que l'agent sait »: the sections of its next turn (a placeholder task when it has none waiting). */
export function contextView(a: Assembled, agentId: number, resumed: boolean, sessionTokens: number, compactAtTokens: number): OrchAgentContext {
  return {
    agentId,
    resumed,
    sections: a.sections,
    totalTokens: estimateTokens(a.system) + estimateTokens(a.prompt),
    sessionTokens,
    compactAtTokens
  }
}
