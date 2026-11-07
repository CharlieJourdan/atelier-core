// What happens with an agent's answer: its actions (remember, post, delegate, ask the user) and the task's new state —
// done, waiting for the sub-tasks it created (the parent is woken when they finish), or waiting for the user. Plus the
// dead letter: a task that used up its attempts flags its agent, closes its handoff and tells the principal's
// conversation and the user's inbox.
import type { OrchTask } from '../../shared/api/orchestra'
import type { ActionRights, AgentAction } from './prompt'
import { parseReply } from './prompt'
import type { RuntimeParts } from './parts'
import { roleInfo } from './roles'
import type { AgentRecord } from './tree'
import { truncate } from './util'

export interface Outcome {
  status: 'done' | 'waiting' | 'waiting_human' | 'lost'
  result: string
  children: number[]
  warnings: string[]
}

const depthOf = (task: OrchTask): number => (typeof task.payload.depth === 'number' ? task.payload.depth : 0)
/** Approvals of one gate the approval level may give in one task; past it, the question goes to Charlie (no endless loop). */
const MAX_AUTO_PER_GATE = 2

const humanOf = (task: OrchTask): Record<string, unknown>[] => (Array.isArray(task.payload.human) ? (task.payload.human as Record<string, unknown>[]) : [])

/**
 * A validation Charlie is not asked about: the channel's approval level does not gate it, or Charlie said « toujours
 * valider » for that gate (and series) of the channel (allow.ts). The channel is the task's, the agent's, or that of the
 * task's video (Atlas has no channel of his own but works on a channel's video: the level of that channel settles the
 * question, #110). Never when there is none (Atlas creating a channel always asks), and at most MAX_AUTO_PER_GATE times per
 * gate in a task.
 */
function autoApproval(p: RuntimeParts, agent: AgentRecord, task: OrchTask, a: Extract<AgentAction, { type: 'ask_human' }>): { rule: number | null } | null {
  const channelId = task.channelId ?? agent.channelId ?? channelOfVideo(p, task.videoId)
  if (a.kind !== 'validate' || !a.gate || channelId === null) return null
  if (humanOf(task).filter((h) => h.auto === true && h.gate === a.gate).length >= MAX_AUTO_PER_GATE) return null
  if (!p.goals.gates(channelId).includes(a.gate)) return { rule: null }
  const rule = p.allow.match(channelId, a.gate, a.series ?? null)
  return rule ? { rule: rule.id } : null
}

function channelOfVideo(p: RuntimeParts, videoId: number | null | undefined): number | null {
  if (videoId === null || videoId === undefined) return null
  const row = p.db.prepare('SELECT channel_id AS c FROM videos WHERE id = ?').get(videoId) as { c: number | null } | undefined
  return row?.c ?? null
}

/** Applies a finished turn's answer. */
export function applyReply(p: RuntimeParts, agent: AgentRecord, task: OrchTask, raw: string, rights: ActionRights = { delegate: true, ask: true }): Outcome {
  const parsed = parseReply(raw)
  const warnings = [...parsed.warnings]
  const done = parsed.actions.find((a): a is Extract<AgentAction, { type: 'done' }> => a.type === 'done')
  const result = (done?.result ?? parsed.text) || raw.trim() || '(no answer)'
  const children: number[] = []
  let asked = false
  let autoApproved: Record<string, unknown> | null = null
  let posted = false
  for (const a of parsed.actions) {
    if (a.type === 'remember') {
      p.memory.add(agent.id, { kind: a.kind ?? 'note', content: a.content, source: `task:${task.id}`, importance: a.importance ?? 3 })
    } else if (a.type === 'post') {
      const conv = p.messaging.conversationFor(a.room, task.channelId ?? agent.channelId, a.videoId ?? task.videoId)
      p.messaging.post(agent, conv, a.text, depthOf(task))
      posted = true
    } else if (a.type === 'delegate') {
      if (!rights.delegate) {
        warnings.push(`Cannot delegate to ${a.to ?? a.role}: team.delegate is not one of ${agent.name}'s technologies`)
        continue
      }
      const targets = delegationTargets(p, agent, a)
      if (targets.length === 0) {
        warnings.push(`Cannot delegate to ${a.to ?? a.role}: not one of ${agent.name}'s reports`)
        continue
      }
      for (const target of targets) children.push(delegate(p, agent, task, target, a))
    } else if (a.type === 'ask_human' && !rights.ask) {
      warnings.push(`Cannot ask Charlie: inbox.ask is not one of ${agent.name}'s technologies`)
    } else if (a.type === 'ask_human' && !asked && !autoApproved && autoApproval(p, agent, task, a)) {
      // the channel's approval level does not gate this step, or a « toujours » rule covers it: approved at once, Charlie
      // is not asked (goals.ts, allow.ts). No `choice` / `text`: it is not Charlie's yes (toolbox.approvedIn ignores it;
      // production.approve still needs him).
      const auto = autoApproval(p, agent, task, a) as { rule: number | null }
      // the level (or the rule) takes the question's first option, as « toujours valider » does: the agent acts on it
      const option = a.options?.[0]
      autoApproved = { question: a.question, gate: a.gate, auto: true, ...(option ? { option } : {}), ...(auto.rule !== null ? { rule: auto.rule } : {}) }
      if (auto.rule !== null) p.allow.use(auto.rule)
      const by = auto.rule !== null ? `Charlie's standing rule #${auto.rule}` : "the channel's approval level"
      p.events.add('auto-approved', `${agent.name}: ${a.gate} approved by ${by} (${truncate(a.question, 120)})`, agent.id, task.id)
    } else if (a.type === 'ask_human' && !asked) {
      asked = true
      p.inbox.add({
        taskId: task.id,
        agentId: agent.id,
        kind: a.kind,
        title: a.title ?? `${agent.name} : ${a.kind === 'validate' ? 'à valider' : a.kind === 'files' ? 'fichiers demandés' : 'question'}`,
        body: a.question,
        options: a.options ?? [],
        gate: a.gate ?? null,
        channelId: task.channelId ?? agent.channelId,
        series: a.series ?? null
      })
      const conv = p.messaging.conversationFor('channel', task.channelId ?? agent.channelId, task.videoId)
      p.messaging.system(conv, `${agent.name} attend ta réponse : ${truncate(a.question, 300)}`)
    }
  }
  for (const w of warnings) p.events.add('warning', `${agent.name}: ${w}`, agent.id, task.id)

  if (autoApproved && (asked || rights.waitHuman === true || children.length)) {
    // the turn also waits (Charlie, a tool, sub-tasks): the approval waits in its payload
    p.queue.patchPayload(task.id, { human: [...humanOf(task), autoApproved] })
  }
  if (asked || rights.waitHuman === true) {
    return { status: p.queue.waitHuman(task.id, p.owner, result) ? 'waiting_human' : 'lost', result, children, warnings }
  }
  if (autoApproved && !children.length) {
    // the same path as Charlie's answer: the task goes back to the queue and its next turn reads the approval
    if (!p.queue.waitHuman(task.id, p.owner, result)) return { status: 'lost', result, children, warnings }
    p.queue.resumeHuman(task.id, autoApproved)
    return { status: 'waiting_human', result, children, warnings }
  }
  if (children.length) {
    return { status: p.queue.waitChildren(task.id, p.owner, result) ? 'waiting' : 'lost', result, children, warnings }
  }
  if (!p.queue.complete(task.id, p.owner, result)) return { status: 'lost', result, children, warnings }
  afterDone(p, agent, task, result, posted)
  return { status: 'done', result, children, warnings }
}

/** Who a delegation goes to: a named agent below this one, or every direct report with a role. */
function delegationTargets(p: RuntimeParts, agent: AgentRecord, a: Extract<AgentAction, { type: 'delegate' }>): AgentRecord[] {
  if (a.to) {
    const t = p.tree.resolve(a.to)
    return t && t.id !== agent.id && p.tree.isAbove(agent.id, t.id) ? [t] : []
  }
  const role = a.role ?? ''
  return p.tree.reports(agent.id).filter((r) => r.role === role && !r.paused)
}

function delegate(p: RuntimeParts, from: AgentRecord, parent: OrchTask, to: AgentRecord, a: Extract<AgentAction, { type: 'delegate' }>): number {
  const child = p.queue.enqueue({
    kind: a.kind ?? roleInfo(to.role).defaultKind,
    title: a.title,
    assigneeId: to.id,
    payload: { brief: a.brief ?? '', delegatedBy: from.slug, depth: depthOf(parent) },
    priority: a.priority ?? parent.priority,
    createdBy: from.id,
    parentId: parent.id,
    channelId: to.channelId ?? parent.channelId,
    videoId: parent.videoId
  })
  const conv = p.messaging.conversationFor(parent.videoId !== null ? 'video' : 'channel', to.channelId ?? parent.channelId, parent.videoId)
  const handoffId = p.messaging.handoff(from, to, `${a.title}${a.brief ? ` — ${a.brief}` : ''}`, conv)
  p.queue.patchPayload(child.id, { handoffId })
  p.events.add('delegate', `${from.name} → ${to.name}: #${child.id} ${child.kind} "${child.title}"`, from.id, child.id)
  p.tree.refreshStatus(to.id)
  return child.id
}

/** A task finished: answer its handoff, post a chat reply or the digest, clear the agent's error flag. */
function afterDone(p: RuntimeParts, agent: AgentRecord, task: OrchTask, result: string, posted: boolean): void {
  if (typeof task.payload.handoffId === 'number') p.messaging.closeHandoff(task.payload.handoffId, true, result)
  if (task.kind === 'mention' && !posted && typeof task.payload.conversationId === 'number') {
    try {
      p.messaging.post(agent, task.payload.conversationId, result, depthOf(task))
    } catch {
      // the conversation is gone
    }
  }
  if (task.kind === 'digest' && !posted) {
    p.messaging.post(agent, p.messaging.conversationFor('principal', null, null), result, depthOf(task))
  }
  if (agent.errorFlag) p.tree.setError(agent.id, false)
}

/** A task used up its attempts. */
export function deadLetter(p: RuntimeParts, taskId: number, error: string): void {
  const task = p.queue.get(taskId)
  const agent = p.tree.get(task.assigneeId)
  p.tree.setError(agent.id, true)
  if (typeof task.payload.handoffId === 'number') p.messaging.closeHandoff(task.payload.handoffId, false, `Échec : ${truncate(error, 200)}`)
  const text = `La tâche #${task.id} « ${task.title} » de ${agent.name} a échoué ${task.attempts} fois et a été arrêtée : ${truncate(error, 300)}. Relance-la depuis l'écran des agents si besoin.`
  p.inbox.add({ taskId: task.id, agentId: agent.id, kind: 'alert', title: `Tâche arrêtée : ${truncate(task.title, 120)}`, body: text })
  try {
    p.messaging.system(p.messaging.conversationFor('principal', null, null), text)
  } catch {
    // the chat is closing
  }
}
