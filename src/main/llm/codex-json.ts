// Line parser for `codex exec --json` (OpenAI Codex CLI, checked against codex-cli 0.164 `--help`; the event shapes
// below follow the documented JSONL stream and are covered by a synthetic fixture: VERIFY against a real recording
// once a Codex account is connected). Each stdout line is one JSON event:
//   {"type":"thread.started","thread_id":"…"}                         → the session id (for `codex exec resume <id>`)
//   {"type":"item.completed","item":{"type":"agent_message","text":"…"}} → the answer text (the last one wins)
//   {"type":"turn.completed","usage":{"input_tokens":…,"cached_input_tokens":…,"output_tokens":…}}
//   {"type":"turn.failed","error":{"message":"…"}} / {"type":"error","message":"…"} → a failure (usage limits too)
// Older builds wrote `{"id":"0","msg":{"type":"agent_message","message":"…"}}`; those shapes are read as well.
import { emptyUsage, type Usage } from './types'

export type CodexEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done' }
  | { type: 'error'; message: string }

export class CodexJsonParser {
  private buffer = ''
  sessionId: string | null = null
  /** Text of the last agent message (the final answer). */
  lastMessage = ''
  usage: Usage = emptyUsage()
  /** True once a turn started or an item came back: the model was reached (it may have been billed). */
  reachedModel = false
  completed = false
  error: string | null = null
  readonly badLines: string[] = []

  push(chunk: string): CodexEvent[] {
    this.buffer += chunk
    const out: CodexEvent[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      out.push(...this.parseLine(line))
    }
    return out
  }

  end(): CodexEvent[] {
    const rest = this.buffer
    this.buffer = ''
    return this.parseLine(rest)
  }

  private parseLine(raw: string): CodexEvent[] {
    const line = raw.trim()
    if (!line) return []
    let ev: Record<string, unknown>
    try {
      const v: unknown = JSON.parse(line)
      if (!isObject(v)) throw new Error('not an object')
      ev = v
    } catch {
      this.badLines.push(line.slice(0, 500))
      return []
    }
    // Legacy envelope: {"id": "...", "msg": {...}}
    if (isObject(ev.msg) && typeof ev.type !== 'string') return this.legacy(ev.msg)
    switch (ev.type) {
      case 'thread.started':
      case 'session.created': {
        const id = str(ev.thread_id) ?? str(ev.session_id)
        if (!id) return []
        this.sessionId = id
        return [{ type: 'session', sessionId: id }]
      }
      case 'turn.started':
        this.reachedModel = true
        return []
      case 'item.completed': {
        this.reachedModel = true
        const item = ev.item
        if (!isObject(item)) return []
        const kind = str(item.type) ?? str(item.item_type)
        if (kind !== 'agent_message' && kind !== 'assistant_message') return []
        const text = str(item.text) ?? ''
        if (!text) return []
        this.lastMessage = text
        return [{ type: 'text', text }]
      }
      case 'turn.completed': {
        this.completed = true
        this.usage = toUsage(ev.usage)
        return [{ type: 'usage', usage: this.usage }, { type: 'done' }]
      }
      case 'turn.failed': {
        const message = (isObject(ev.error) ? str(ev.error.message) : null) ?? 'Codex turn failed'
        this.error = message
        return [{ type: 'error', message }]
      }
      case 'error': {
        const message = str(ev.message) ?? (isObject(ev.error) ? str(ev.error.message) : null) ?? 'Codex error'
        this.error = message
        return [{ type: 'error', message }]
      }
      default:
        return []
    }
  }

  private legacy(msg: Record<string, unknown>): CodexEvent[] {
    switch (msg.type) {
      case 'session_configured': {
        const id = str(msg.session_id)
        if (!id) return []
        this.sessionId = id
        return [{ type: 'session', sessionId: id }]
      }
      case 'agent_message': {
        this.reachedModel = true
        const text = str(msg.message) ?? ''
        if (!text) return []
        this.lastMessage = text
        return [{ type: 'text', text }]
      }
      case 'token_count': {
        this.reachedModel = true
        this.usage = toUsage(isObject(msg.info) && isObject(msg.info.total_token_usage) ? msg.info.total_token_usage : msg)
        return [{ type: 'usage', usage: this.usage }]
      }
      case 'task_complete':
        this.completed = true
        if (!this.lastMessage) this.lastMessage = str(msg.last_agent_message) ?? ''
        return [{ type: 'done' }]
      case 'error': {
        const message = str(msg.message) ?? 'Codex error'
        this.error = message
        return [{ type: 'error', message }]
      }
      default:
        return []
    }
  }
}

function toUsage(raw: unknown): Usage {
  const u = emptyUsage()
  if (!isObject(raw)) return u
  const cached = num(raw.cached_input_tokens)
  // Codex reports the cached part inside input_tokens: keep them apart like the Anthropic usage does.
  u.inputTokens = Math.max(0, num(raw.input_tokens) - cached)
  u.cacheReadTokens = cached
  u.outputTokens = num(raw.output_tokens)
  return u
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}
