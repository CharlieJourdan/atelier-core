// What an agent reads at each turn, and the action block it answers with. The protocol is plain text so that it works
// on every provider of the pool (Claude Code CLI, Codex CLI, the API) without tool plumbing: the agent writes its
// answer, then one fenced block
//   ```atelier
//   {"actions": [ {"type": "delegate", "to": "researcher-1", "kind": "research", "title": "…", "brief": "…"},
//                 {"type": "post", "room": "channel", "text": "… @Recherchiste_Histoire …"},
//                 {"type": "remember", "content": "…", "kind": "fact", "importance": 4},
//                 {"type": "ask_human", "kind": "validate", "question": "…", "options": ["OK", "Changer"]},
//                 {"type": "done", "result": "…"} ]}
//   ```
// Without a block the answer text is the result. A broken block is reported to the agent's log, never a crash.
import { GOAL_GATES, type GoalGate } from '../../shared/api/autopilot'
import type { OrchInboxKind, OrchMemoryItem, OrchTask } from '../../shared/api/orchestra'
import type { AgentRecord } from './tree'
import { isRecord, truncate } from './util'

export type AgentAction =
  | { type: 'delegate'; to?: string; role?: string; kind?: string; title: string; brief?: string; priority?: number }
  | { type: 'post'; room: 'channel' | 'video' | 'principal'; text: string; videoId?: number }
  | { type: 'remember'; content: string; kind?: string; importance?: number }
  | { type: 'ask_human'; kind: Exclude<OrchInboxKind, 'alert'>; question: string; title?: string; options?: string[]; gate?: GoalGate; series?: string }
  | { type: 'done'; result?: string }

export interface ParsedReply {
  /** The answer without the action block. */
  text: string
  actions: AgentAction[]
  warnings: string[]
}

export interface TurnContext {
  agent: AgentRecord
  task: OrchTask
  manager: AgentRecord | null
  reports: AgentRecord[]
  channel: { name: string; niche: string; standards: string } | null
  memory: OrchMemoryItem[]
  handover: string
  /** Resuming a CLI session: the persona, memory and handover are already in it. */
  resumed: boolean
  /** Names of finished dependencies with their results. */
  dependencies: { title: string; status: string; result: string | null }[]
  /** Text of a conversation message that woke the agent (mentions). */
  message: { from: string; text: string } | null
  /** Extra text the runtime computed (the digest numbers). */
  facts: string | null
  /** The last messages of the agent's room (« recent thread »), already cut to its budget. */
  thread?: string
}

const BLOCK_RE = /```atelier[^\n]*\n([\s\S]*?)```/g

/** What the agent may do with the action block (technologies `team.delegate` and `inbox.ask`). */
export interface ActionRights {
  delegate: boolean
  ask: boolean
  /** A tool of this turn already asked Charlie (bricks.propose): the task waits for his answer. */
  waitHuman?: boolean
}

export function systemPrompt(
  agent: AgentRecord,
  reports: AgentRecord[],
  manager: AgentRecord | null,
  channelName: string | null,
  rights: ActionRights = { delegate: true, ask: true }
): string {
  const lines = [
    `You are ${agent.name}, an agent of Atelier's AI team (role: ${agent.role}${channelName ? `, channel: ${channelName}` : ', whole workspace'}).`,
    agent.instructions,
    '',
    manager ? `You report to ${manager.name} (${manager.slug}).` : 'You report to Charlie, the owner.',
    reports.length && rights.delegate
      ? `Your direct reports (delegate to them by slug):\n${reports.map((r) => `- ${r.slug}: ${r.name} (${r.role})`).join('\n')}`
      : 'You have no reports: do the work yourself.',
    '',
    'Rules: work like a reliable employee. Be concise. Never claim something was done that was not. Never upload, post or',
    'send anything outside Atelier: Charlie publishes and sends by hand.',
    'End every answer with ONE fenced block named atelier holding {"actions": [...]}. Actions:',
    ...(rights.delegate
      ? ['- {"type":"delegate","to":"<report slug>","kind":"<task kind>","title":"…","brief":"…"} (or "role" instead of "to": every report with that role)']
      : []),
    '- {"type":"post","room":"channel"|"video"|"principal","text":"…"} (write @Name to wake a colleague)',
    '- {"type":"remember","content":"…","kind":"fact"|"preference"|"style"|"lesson","importance":1-5}',
    ...(rights.ask
      ? [
          '- {"type":"ask_human","kind":"validate"|"input"|"files","question":"…","options":["…"],"gate":"topic"|"script"|"voice"|"thumbnail"|"video"|"kit","series":"…"}',
          '  (for a validation of a video step, say its "gate": the approval level of the channel and Charlie’s « toujours » rules decide whether he is asked or it is approved at once;',
          '  "series": the name of the series the video belongs to, if any; put your recommended choice first in "options")'
        ]
      : []),
    '- {"type":"done","result":"…"} (the result your manager receives)',
    ...(rights.delegate ? ["If you delegate, you are woken with your reports' results when they finish: then consolidate and finish with done."] : [])
  ]
  return lines.join('\n')
}

export function taskPrompt(c: TurnContext): string {
  const t = c.task
  const out: string[] = [`TASK #${t.id} · kind: ${t.kind} · priority ${t.priority}`, `Title: ${t.title}`]
  const brief = typeof t.payload.brief === 'string' ? t.payload.brief : ''
  if (brief) out.push(`Brief: ${truncate(brief, 4000)}`)
  if (!c.resumed && c.channel) {
    out.push('', `Channel: ${c.channel.name}${c.channel.niche ? ` (niche: ${c.channel.niche})` : ''}`)
    if (c.channel.standards) out.push(`Channel standards: ${truncate(c.channel.standards, 1500)}`)
  }
  if (c.facts) out.push('', c.facts)
  if (c.message) out.push('', `Message from ${c.message.from} in the conversation:`, truncate(c.message.text, 3000), 'Answer it (your answer is posted in the conversation).')
  if (c.dependencies.length) {
    out.push('', 'Earlier tasks this one depends on:')
    for (const d of c.dependencies) out.push(`- ${d.title} [${d.status}]: ${truncate(d.result ?? '', 1500)}`)
  }
  const children = Array.isArray(t.payload.childResults) ? (t.payload.childResults as Record<string, unknown>[]) : []
  if (children.length) {
    out.push('', 'Your reports finished the work you handed them:')
    for (const r of children) out.push(`- #${String(r.taskId)} ${String(r.title)} [${String(r.status)}]: ${truncate(String(r.result ?? r.error ?? ''), 2500)}`)
    out.push('Consolidate their work and finish with done (or delegate again if something is missing).')
  }
  const all = Array.isArray(t.payload.human) ? (t.payload.human as Record<string, unknown>[]) : []
  const auto = all.filter((h) => h.auto === true)
  const human = all.filter((h) => h.auto !== true)
  const byLevel = auto.filter((h) => h.rule === undefined)
  const byRule = auto.filter((h) => h.rule !== undefined)
  if (byLevel.length) {
    out.push('', 'Approved by the approval level of the channel (Charlie was not asked). This is the decision: act on the option taken, do not ask again:')
    for (const h of byLevel) out.push(`- ${String(h.gate)}: ${truncate(String(h.question ?? ''), 300)}${h.option ? ` → option taken: « ${truncate(String(h.option), 120)} »` : ''}`)
  }
  if (byRule.length) {
    out.push('', 'Approved by Charlie’s standing « toujours valider » rule (he was not asked this time):')
    for (const h of byRule) out.push(`- ${String(h.gate)}: ${truncate(String(h.question ?? ''), 300)}${h.option ? ` → option taken: « ${truncate(String(h.option), 120)} »` : ''}`)
  }
  if (human.length) {
    out.push('', 'Charlie answered your question:')
    for (const h of human) {
      const parts = [h.choice ? `choice: ${String(h.choice)}` : '', h.text ? String(h.text) : '', Array.isArray(h.files) ? `files: ${h.files.join(', ')}` : '']
      out.push(`- ${parts.filter(Boolean).join(' · ')}`)
    }
  }
  if (!c.resumed && c.handover) out.push('', 'Handover from your previous session:', truncate(c.handover, 3000))
  if (!c.resumed && c.memory.length) {
    out.push('', 'What you remember (most relevant first):')
    for (const m of c.memory) out.push(`- [${m.kind}] ${truncate(m.content, 400)}`)
  }
  if (c.thread) out.push('', 'Recent messages in your conversation (newest last):', c.thread)
  out.push('', 'Do the task now, then end with the atelier action block.')
  return out.join('\n')
}

/** Splits the answer and its last action block; keeps only well-formed actions. */
export function parseReply(raw: string): ParsedReply {
  const warnings: string[] = []
  const blocks = [...raw.matchAll(BLOCK_RE)]
  const text = raw.replace(BLOCK_RE, '').trim()
  const last = blocks.at(-1)
  if (!last) return { text, actions: [], warnings }
  let parsed: unknown
  try {
    parsed = JSON.parse((last[1] ?? '').trim())
  } catch {
    warnings.push('The action block is not valid JSON: ignored')
    return { text, actions: [], warnings }
  }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.actions) ? parsed.actions : null
  if (!list) {
    warnings.push('The action block has no "actions" list: ignored')
    return { text, actions: [], warnings }
  }
  const actions: AgentAction[] = []
  for (const a of list.slice(0, 30)) {
    const action = toAction(a)
    if (action) actions.push(action)
    else warnings.push(`Ignored action: ${truncate(JSON.stringify(a) ?? 'null', 120)}`)
  }
  return { text, actions, warnings }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function toAction(a: unknown): AgentAction | null {
  if (!isRecord(a)) return null
  switch (a.type) {
    case 'delegate': {
      const title = str(a.title)
      const to = str(a.to)
      const role = str(a.role)
      if (!title || (!to && !role)) return null
      const priority = typeof a.priority === 'number' && Number.isInteger(a.priority) && a.priority >= 0 && a.priority <= 9 ? a.priority : undefined
      const kind = str(a.kind)
      const brief = str(a.brief)
      return { type: 'delegate', title, ...(to ? { to } : {}), ...(role ? { role } : {}), ...(kind ? { kind } : {}), ...(brief ? { brief } : {}), ...(priority !== undefined ? { priority } : {}) }
    }
    case 'post': {
      const text = str(a.text)
      const room = a.room === 'video' || a.room === 'principal' ? a.room : 'channel'
      if (!text) return null
      return { type: 'post', room, text, ...(typeof a.videoId === 'number' && Number.isInteger(a.videoId) ? { videoId: a.videoId } : {}) }
    }
    case 'remember': {
      const content = str(a.content)
      if (!content) return null
      const kind = str(a.kind)
      return { type: 'remember', content, ...(kind ? { kind } : {}), ...(typeof a.importance === 'number' ? { importance: a.importance } : {}) }
    }
    case 'ask_human': {
      const question = str(a.question)
      if (!question) return null
      const kind = a.kind === 'validate' || a.kind === 'files' ? a.kind : 'input'
      const options = Array.isArray(a.options) ? a.options.filter((o): o is string => typeof o === 'string') : undefined
      const title = str(a.title)
      const gate = (GOAL_GATES as readonly unknown[]).includes(a.gate) ? (a.gate as GoalGate) : undefined
      const series = str(a.series)
      return { type: 'ask_human', kind, question, ...(title ? { title } : {}), ...(options?.length ? { options } : {}), ...(gate ? { gate } : {}), ...(series ? { series } : {}) }
    }
    case 'done': {
      const result = str(a.result)
      return { type: 'done', ...(result ? { result } : {}) }
    }
    default:
      return null
  }
}
