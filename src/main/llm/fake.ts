// Deterministic provider for tests and offline runs. Never touches the network.
import {
  collect,
  ProviderError,
  type CallOptions,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type StreamEvent
} from './types'

export interface FakeReply {
  text: string
  /** Text is streamed in chunks of this many characters (default: whole words). */
  chunkSize?: number
  error?: string
  costUsd?: number | null
  /** Atelier tools to call (in order, through `req.tools`) before replying, like an agent would. */
  toolCalls?: { name: string; args: unknown }[]
  /** Writes the reply from this call's tool results (like a model reading them), instead of `text`. */
  afterTools?: (results: { name: string; text: string; isError: boolean }[]) => string
}

export type FakeResponder = (req: CompletionRequest, callIndex: number) => FakeReply | string

export class FakeProvider implements Provider {
  readonly id: string
  readonly calls: CompletionRequest[] = []
  /** Results of the tool calls made, in order. */
  readonly toolResults: { name: string; text: string; isError: boolean }[] = []
  private readonly responder: FakeResponder

  constructor(responder: FakeResponder | (FakeReply | string)[] = (req) => `echo: ${req.prompt}`, id = 'fake') {
    this.id = id
    if (Array.isArray(responder)) {
      const replies = responder
      this.responder = (_req, i) => {
        const reply = replies[i]
        if (reply === undefined) throw new ProviderError(`FakeProvider has no reply #${i + 1}`, 'FAILED')
        return reply
      }
    } else {
      this.responder = responder
    }
  }

  acceptsTools(): boolean {
    return true
  }

  complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    return collect(this.stream(req, opts))
  }

  async *stream(req: CompletionRequest, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
    const index = this.calls.length
    this.calls.push(req)
    const raw = this.responder(req, index)
    const reply: FakeReply = typeof raw === 'string' ? { text: raw } : raw
    if (reply.error) throw new ProviderError(reply.error, 'FAILED')
    const results: { name: string; text: string; isError: boolean }[] = []
    for (const tc of reply.toolCalls ?? []) {
      if (!req.tools) throw new ProviderError(`FakeProvider: tool ${tc.name} called without tools`, 'FAILED')
      const r = await req.tools.call(tc.name, tc.args)
      results.push({ name: tc.name, ...r })
      this.toolResults.push({ name: tc.name, ...r })
    }
    if (reply.afterTools) reply.text = reply.afterTools(results)
    for (const chunk of chunks(reply.text, reply.chunkSize)) {
      // Yield to the event loop so abort signals and interleaving behave like a real stream.
      await Promise.resolve()
      if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED')
      yield { type: 'text', text: chunk }
    }
    if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED')
    yield {
      type: 'done',
      result: {
        text: reply.text,
        model: req.model,
        usage: {
          inputTokens: approxTokens((req.system ?? '') + req.prompt),
          outputTokens: approxTokens(reply.text),
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        },
        costUsd: reply.costUsd ?? null,
        stopReason: 'end_turn',
        sessionId: null
      }
    }
  }
}

function chunks(text: string, size?: number): string[] {
  if (!text) return []
  if (size && size > 0) {
    const out: string[] = []
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
    return out
  }
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

/** Rough token estimate (≈4 chars per token), good enough for a fake. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
