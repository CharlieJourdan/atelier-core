// Who answers in a conversation (PLAN-V2 §5.2): the agent in its private chat, the
// Supervisor in the Supervisor chat, the Producteur in a video chat, the Chef d'équipe in a department room and the
// Manager in a channel chat. The three leads run on the Supervisor's route, instructions and tools, plus a scope line.
// Also the prompt lines of a group turn: the scope, the team roster, the lane rule, the handoff framing. Pure.
import type { ConversationRow } from '../../shared/chat'
import { mentionSlug, type Department } from '../../shared/chat-rich'
import { roleName } from '../../shared/roles'

export type PersonaKind = 'supervisor' | 'producer' | 'team_lead' | 'manager' | 'agent'

export interface Persona {
  kind: PersonaKind
  /** Role whose route, instructions, memory and tools answer. */
  role: string
  /** French name shown to Charlie. */
  name: string
  channelId: number | null
  videoId: number | null
  department: Department | null
}

const DEPARTMENT_EN: Record<Department, string> = { direction: 'strategy', production: 'production', operations: 'operations' }
const LEAD_NAME: Record<Exclude<PersonaKind, 'agent' | 'supervisor'>, string> = {
  producer: 'Producteur',
  team_lead: 'Chef d’équipe',
  manager: 'Manager de la chaîne'
}

export function personaFor(c: ConversationRow): Persona {
  const base = { channelId: c.channelId, videoId: c.videoId, department: c.department }
  switch (c.kind) {
    case 'agent':
      return { ...base, kind: 'agent', role: c.agentId ?? 'supervisor', name: roleName(c.agentId ?? 'supervisor') }
    case 'video':
      return { ...base, kind: 'producer', role: 'supervisor', name: LEAD_NAME.producer }
    case 'room':
      return { ...base, kind: 'team_lead', role: 'supervisor', name: LEAD_NAME.team_lead }
    case 'channel':
      return { ...base, kind: 'manager', role: 'supervisor', name: LEAD_NAME.manager }
    case 'supervisor':
      return { ...base, kind: 'supervisor', role: 'supervisor', name: roleName('supervisor') }
  }
}

export interface TeamMember {
  id: string
  name: string
  job: string
}

export interface GroupPromptInput {
  persona: Persona
  /** The agent speaking in this turn (the persona's role for the lead). */
  speaker: { id: string; name: string }
  channelName: string | null
  /** Enabled agents Charlie can mention or the speaker can ask (the speaker excluded). */
  team: TeamMember[]
  /** True when Charlie addressed this agent directly (private chat, @mention): the lane rule applies. */
  direct: boolean
  /** True when the turn may use ask_agent. */
  canAsk: boolean
  /** The agent that handed this question over (a handoff turn). */
  consultFrom: string | null
  /** The production tools are in this agent's role but our engine is not wired yet. */
  productionMissing: boolean
}

export const OFF_TOPIC = 'OFF_TOPIC'
export const MAX_ANSWER_CHARS = 6000

/** Extra lines of the system prompt of a group-chat turn. */
export function groupLines(input: GroupPromptInput): string[] {
  const { persona, speaker } = input
  const lines: string[] = []
  const channel = input.channelName ? ` of the channel "${input.channelName}"` : ''
  if (speaker.id === persona.role && persona.kind !== 'agent' && persona.kind !== 'supervisor') {
    const scope =
      persona.kind === 'producer'
        ? `You answer as the Producer of this video${channel}: keep to this video, its steps and its team.`
        : persona.kind === 'team_lead'
          ? `You answer as the team lead of the ${DEPARTMENT_EN[persona.department ?? 'production']} room${channel}: keep to that team's work on this channel.`
          : `You answer as the Manager${channel}: keep to this channel, its videos, goals and spend.`
    lines.push(`${scope} Your name here is "${persona.name}".`)
  } else if (persona.kind !== 'agent') {
    lines.push(`This is a group conversation${channel} with Charlie and several agents; others may speak before or after you.`)
  }
  if (input.team.length && (input.canAsk || input.direct)) {
    lines.push(
      ['The team (name — id — job):', ...input.team.map((m) => `- ${m.name} — ${m.id} — ${m.job}`)].join('\n')
    )
  }
  if (input.canAsk) {
    lines.push(
      'When a question belongs to a specialist, call ask_agent with their name and a precise question: their answer ' +
        'comes back to you, then you conclude for Charlie with the next step. Do not hand over what you can answer yourself.'
    )
  }
  if (input.direct) {
    lines.push(
      `Stay in your lane. If the request is outside your job (trivia, homework, coding, or another team member's work), ` +
        `reply with exactly ${OFF_TOPIC}, or ${OFF_TOPIC}:<id> with the id of the team member who does that job, and nothing else.`
    )
  }
  if (input.consultFrom) {
    lines.push(
      `${input.consultFrom} handed you a question during a conversation with Charlie. Answer it precisely and briefly ` +
        `(under ${MAX_ANSWER_CHARS} characters): ${input.consultFrom} will pass your answer on.`
    )
  }
  if (input.productionMissing) {
    lines.push(
      'Production runs (our own engine) are not connected yet: you cannot read runs, quote, start a pipeline or analyse ' +
        'a channel. Say so plainly if Charlie asks; never pretend a run exists.'
    )
  }
  return lines
}

/**
 * The lane rule's answer: any reply that starts with `OFF_TOPIC`. Returns what follows it (the suggested agent, by id or
 * name, '' when none), or null when the text is a normal answer.
 */
export function offTopic(text: string): string | null {
  const t = text.trim()
  if (!t.startsWith(OFF_TOPIC)) return null
  const rest = t.slice(OFF_TOPIC.length).split('\n')[0] ?? ''
  return rest
    .replace(/^[\s:;,.—–-]+/, '')
    .replace(/[\s.!]+$/, '')
    .trim()
}

/** How much text is held back after the token, at most, while it streams (the agent name that may follow). */
const HOLD_AFTER_TOKEN = 80

/** True while a streamed prefix could still be a lane answer: the text is held back until it cannot. */
export function mayBeOffTopic(prefix: string): boolean {
  const p = prefix.trimStart()
  if (p.length <= OFF_TOPIC.length) return OFF_TOPIC.startsWith(p)
  return p.startsWith(OFF_TOPIC) && p.length <= OFF_TOPIC.length + HOLD_AFTER_TOKEN
}

/** The redirect posted in place of an off-topic answer (French, shown to Charlie). */
export function redirectText(speaker: string, target: TeamMember | null): string {
  return target
    ? `Ce n’est pas mon métier (${speaker}). Pour ça, demande à @${mentionSlug(target.name)}.`
    : `Ce n’est pas mon métier (${speaker}). Pose la question au Superviseur, il saura qui s’en charge.`
}
