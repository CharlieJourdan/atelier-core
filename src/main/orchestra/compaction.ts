// Context budget (docs/AGENT-RUNTIME.md § Compaction). When an agent's working session passes its threshold (estimated
// tokens: every turn of a resumed CLI session replays the whole conversation), a cheap model (the `compaction` kind,
// fast tier) turns the session's episodes into memory items and a short handover; the session is closed and a fresh one
// starts, seeded with that handover and the top-k relevant memory items (the next turn sends them, without --resume).
// If the cheap call fails (no account, a limit, bad JSON), the handover is cut from the last episodes: compaction never
// blocks the agent.
import type { Episode, SessionRecord } from './memory'
import type { AgentRecord } from './tree'
import { isRecord, truncate } from './util'

export interface CompactionResult {
  memories: { kind: string; content: string; importance: number }[]
  handover: string
}

export const COMPACTION_MARK = 'COMPACTION REQUEST'

export function compactionSystem(agent: AgentRecord): string {
  return `You compact the working memory of ${agent.name}, an agent of Atelier's AI team. Keep what it will need later; drop chatter.`
}

export function compactionPrompt(agent: AgentRecord, session: SessionRecord, episodes: Episode[]): string {
  const lines = [
    COMPACTION_MARK,
    `Agent: ${agent.name} (${agent.role}). Session #${session.id}, ${session.turns} turn(s), about ${session.contextTokens} tokens.`,
    'Return ONLY a JSON object: {"memories": [{"kind": "fact"|"preference"|"style"|"lesson", "content": "…", "importance": 1-5}],',
    '"handover": "a short note (10 lines at most) of what is in progress, decided, and next"}.'
  ]
  if (session.handover) lines.push('', 'Previous handover:', truncate(session.handover, 1500))
  lines.push('', 'Turns:')
  for (const e of episodes) {
    lines.push(`--- task ${e.taskId ?? '-'} (${e.createdAt})`, `asked: ${truncate(e.prompt, 700)}`, `answered: ${truncate(e.reply, 1100)}`)
  }
  return lines.join('\n')
}

/** Reads the cheap model's answer; null when it is not the expected JSON. */
export function parseCompaction(text: string): CompactionResult | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let v: unknown
  try {
    v = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(v) || typeof v.handover !== 'string') return null
  const memories = (Array.isArray(v.memories) ? v.memories : [])
    .filter(isRecord)
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .slice(0, 20)
    .map((m) => ({
      kind: typeof m.kind === 'string' ? m.kind : 'note',
      content: String(m.content).trim(),
      importance: typeof m.importance === 'number' ? m.importance : 3
    }))
  return { memories, handover: v.handover.trim() }
}

/** Without a model: the last answers, cut short. */
export function fallbackHandover(episodes: Episode[]): string {
  const last = episodes.slice(-3)
  if (last.length === 0) return ''
  return ['(automatic summary: the compaction model was not available)', ...last.map((e) => `- task ${e.taskId ?? '-'}: ${truncate(e.reply.replace(/\s+/g, ' '), 400)}`)].join('\n')
}
