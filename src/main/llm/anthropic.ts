// Provider 2: the Anthropic API with a key from settings (decrypted in main only, at call time).
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import {
  collect,
  EFFORTS,
  emptyUsage,
  type Effort,
  ProviderError,
  type CallOptions,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type StreamEvent
} from './types'

/** The slice of the SDK client we use, so tests can pass a fake. */
export interface AnthropicClientLike {
  messages: {
    stream(
      body: AnthropicRequestBody,
      options?: { signal?: AbortSignal }
    ): AsyncIterable<unknown> & { finalMessage(): Promise<FinalMessageLike> }
  }
  models: { list(query?: { limit?: number }): PromiseLike<unknown> }
}

/**
 * The only request shape we ever send. Current API rules: no `thinking` block, no `budget_tokens`, no sampling
 * parameters (`temperature` / `top_p` / `top_k`), no forced `tool_choice`; effort goes in `output_config`.
 */
export interface AnthropicRequestBody {
  model: string
  max_tokens: number
  system?: string
  messages: { role: 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png'; data: string } })[] }[]
  output_config: { effort: Effort }
}

export interface FinalMessageLike {
  model: string
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

export interface AnthropicDeps {
  getKey: () => string | null
  createClient?: (apiKey: string) => AnthropicClientLike
}

const DEFAULT_MAX_TOKENS = 8192

/** Default effort per model; any other model gets the API's own default, `high`, sent explicitly. */
export const DEFAULT_EFFORT: Readonly<Record<string, Effort>> = {
  'claude-opus-5-5': 'medium',
  'claude-sonnet-5-5': 'high',
  'claude-haiku-5-5': 'low'
}

/** Builds the request body (pure: unit-tested without network). Requests always go through `messages.stream`,
 * which the API requires for large `max_tokens` (above 16000) and is harmless below. */
export function buildRequest(req: CompletionRequest): AnthropicRequestBody {
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new ProviderError(`Invalid max_tokens: ${String(req.maxTokens)}`, 'FAILED')
  }
  const effort = req.effort ?? DEFAULT_EFFORT[req.model] ?? 'high'
  if (!EFFORTS.includes(effort)) throw new ProviderError(`Unknown effort: ${String(effort)}`, 'FAILED')
  return {
    model: req.model,
    max_tokens: maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: [
      {
        role: 'user',
        // pictures to look at (avatar-qualite): image blocks first, then the text
        content:
          req.images && req.images.length > 0
            ? [
                ...req.images.map((f) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: /.png$/i.test(f) ? ('image/png' as const) : ('image/jpeg' as const), data: readFileSync(f).toString('base64') }
                })),
                { type: 'text' as const, text: req.prompt }
              ]
            : req.prompt
      }
    ],
    output_config: { effort }
  }
}

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic'
  private readonly createClient: (apiKey: string) => AnthropicClientLike

  constructor(private readonly deps: AnthropicDeps) {
    this.createClient =
      deps.createClient ?? ((apiKey) => new Anthropic({ apiKey, maxRetries: 2 }) as unknown as AnthropicClientLike)
  }

  private client(): AnthropicClientLike {
    const key = this.deps.getKey()
    if (!key) throw new ProviderError('No Anthropic API key set (Settings → Providers)', 'NO_KEY')
    return this.createClient(key)
  }

  /** Cheap connectivity check: lists one model (no tokens billed). */
  async ping(): Promise<void> {
    await this.client().models.list({ limit: 1 })
  }

  complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    return collect(this.stream(req, opts))
  }

  async *stream(req: CompletionRequest, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
    const client = this.client()
    if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED', undefined, null, false)
    let text = ''
    try {
      const stream = client.messages.stream(
        buildRequest(req),
        opts.signal ? { signal: opts.signal } : {}
      )
      for await (const ev of stream) {
        const delta = textDelta(ev)
        if (delta) {
          text += delta
          yield { type: 'text', text: delta }
        }
      }
      const final = await stream.finalMessage()
      const truncated = final.stop_reason === 'max_tokens' || final.stop_reason === 'model_context_window_exceeded'
      const usage = emptyUsage()
      usage.inputTokens = final.usage.input_tokens
      usage.outputTokens = final.usage.output_tokens
      usage.cacheReadTokens = final.usage.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens = final.usage.cache_creation_input_tokens ?? 0
      if (final.stop_reason === 'refusal') {
        throw new ProviderError('The model declined to answer this request (stop_reason: refusal).', 'REFUSED', usage)
      }
      yield {
        type: 'done',
        result: { text, model: final.model, usage, costUsd: null, stopReason: final.stop_reason, truncated, sessionId: null }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED')
      throw new ProviderError(`Anthropic API error: ${err instanceof Error ? err.message : String(err)}`, 'FAILED')
    }
  }
}

function textDelta(ev: unknown): string | null {
  if (typeof ev !== 'object' || ev === null) return null
  const e = ev as { type?: unknown; delta?: { type?: unknown; text?: unknown } }
  if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
    return e.delta.text
  }
  return null
}
