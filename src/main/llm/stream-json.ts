// Line parser for `claude -p --output-format stream-json --verbose [--include-partial-messages]`.
// Each stdout line is one JSON event. We turn them into text deltas and one final result.
import { emptyUsage, type CompletionResult, type Usage } from './types'

export type ParsedEvent =
  | { type: 'init'; sessionId: string | null; model: string | null }
  | { type: 'text'; text: string }
  | { type: 'result'; result: CompletionResult; isError: boolean; errorMessage: string | null }

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export class StreamJsonParser {
  private buffer = ''
  private model: string | null = null
  private sessionId: string | null = null
  private stopReason: string | null = null
  /** True once any partial delta was seen in this run: from then on, full assistant messages are duplicates. */
  private sawDelta = false
  private text = ''
  /** True once the model answered anything (a message started, an assistant turn): from then on it was billed. */
  reachedModel = false
  /** Lines that were not valid JSON (kept for diagnostics, never thrown). */
  readonly badLines: string[] = []

  /** Feeds a chunk of stdout; returns the events completed by it. */
  push(chunk: string): ParsedEvent[] {
    this.buffer += chunk
    const out: ParsedEvent[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      out.push(...this.parseLine(line))
    }
    return out
  }

  /** Flushes a trailing line without newline. */
  end(): ParsedEvent[] {
    const rest = this.buffer
    this.buffer = ''
    return this.parseLine(rest)
  }

  get textSoFar(): string {
    return this.text
  }

  private parseLine(rawLine: string): ParsedEvent[] {
    const line = rawLine.trim()
    if (!line) return []
    let ev: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isObject(parsed)) throw new Error('not an object')
      ev = parsed
    } catch {
      this.badLines.push(line)
      return []
    }
    // Events from Task subagents carry their parent's tool_use id; only the top-level conversation counts.
    if (typeof ev.parent_tool_use_id === 'string') return []
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          this.sessionId = str(ev.session_id) ?? this.sessionId
          this.model = str(ev.model) ?? this.model
          return [{ type: 'init', sessionId: this.sessionId, model: this.model }]
        }
        return []
      case 'stream_event':
        if (isObject(ev.event) && ev.event.type === 'message_start') this.reachedModel = true
        return this.onStreamEvent(ev.event)
      case 'assistant':
        this.reachedModel = true
        return this.onAssistant(ev.message)
      case 'result':
        return [this.onResult(ev)]
      default:
        return []
    }
  }

  private onStreamEvent(event: unknown): ParsedEvent[] {
    if (!isObject(event)) return []
    if (event.type === 'message_start') {
      const message = event.message
      if (isObject(message)) this.model = str(message.model) ?? this.model
      return []
    }
    if (event.type === 'content_block_delta' && isObject(event.delta) && event.delta.type === 'text_delta') {
      const text = str(event.delta.text)
      if (!text) return []
      this.sawDelta = true
      return [this.emitText(text)]
    }
    if (event.type === 'message_delta' && isObject(event.delta)) {
      this.stopReason = str(event.delta.stop_reason) ?? this.stopReason
    }
    return []
  }

  private onAssistant(message: unknown): ParsedEvent[] {
    if (!isObject(message)) return []
    this.model = str(message.model) ?? this.model
    this.stopReason = str(message.stop_reason) ?? this.stopReason
    // With --include-partial-messages the text was already streamed as deltas.
    if (this.sawDelta) return []
    const content = Array.isArray(message.content) ? message.content : []
    const out: ParsedEvent[] = []
    for (const block of content) {
      if (isObject(block) && block.type === 'text') {
        const text = str(block.text)
        if (text) out.push(this.emitText(text))
      }
    }
    return out
  }

  private onResult(ev: Record<string, unknown>): ParsedEvent {
    const isError = ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype !== 'success')
    const resultText = str(ev.result)
    this.sessionId = str(ev.session_id) ?? this.sessionId
    const result: CompletionResult = {
      text: resultText ?? this.text,
      model: this.model ?? '',
      usage: toUsage(ev.usage),
      costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null,
      stopReason: this.stopReason ?? str(ev.stop_reason),
      sessionId: this.sessionId
    }
    return {
      type: 'result',
      result,
      isError,
      errorMessage: isError ? (resultText ?? str(ev.subtype) ?? 'Claude Code reported an error') : null
    }
  }

  private emitText(text: string): ParsedEvent {
    this.text += text
    return { type: 'text', text }
  }
}

function toUsage(raw: unknown): Usage {
  const usage = emptyUsage()
  if (!isObject(raw)) return usage
  const u = raw as RawUsage
  usage.inputTokens = num(u.input_tokens)
  usage.outputTokens = num(u.output_tokens)
  usage.cacheReadTokens = num(u.cache_read_input_tokens)
  usage.cacheWriteTokens = num(u.cache_creation_input_tokens)
  return usage
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
