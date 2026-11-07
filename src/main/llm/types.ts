// One interface for every model provider.
import { EFFORTS, type Effort } from '../../shared/api'

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export { EFFORTS, type Effort }

export interface CompletionRequest {
  model: string
  prompt: string
  system?: string
  maxTokens?: number
  /** Reasoning effort (Anthropic API `output_config.effort`); when absent the provider picks a default per model. */
  effort?: Effort
  /** Atelier tools for an agent run. Providers that cannot offer tools ignore it (the final text still counts). */
  tools?: AgentTools
  /** Pictures to look at (absolute paths of JPEG or PNG files, avatar-qualite's illustration check). Claude Code reads them with
   *  its Read tool, allowed on their folders only; the Anthropic API gets them as image blocks; providers without eyes ignore them. */
  images?: string[]
  /** Most agentic turns a tool run may take (Claude Code `--max-turns`); ignored without tools. */
  maxTurns?: number
  /**
   * A CLI session kept on disk (agent runtime): the CLI runs in `cwd` (sessions are stored per folder), keeps its
   * session, and resumes `resumeId` when given. Absent: the plain completion path (no session persistence).
   */
  session?: CliSession
}

export interface CliSession {
  /** Stable working folder of the agent. */
  cwd: string
  /** Session id to continue (Claude Code `--resume`, Codex `exec resume`); null or absent starts a fresh session. */
  resumeId?: string | null
  /** Passes the request's effort to the CLI (`--effort`). */
  effortFlag?: boolean
}

export interface ToolCallResult {
  /** Text returned to the model. */
  text: string
  isError: boolean
  /** Pictures returned with the text (base64), shown to the model as MCP image content (eyes.look's frames). */
  images?: { mimeType: 'image/jpeg' | 'image/png'; data: string }[]
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>
}

export interface AgentTools {
  /** Atelier tools offered in this run (without the `mcp__atelier__` prefix). */
  specs: ToolSpec[]
  /** Claude Code's built-in WebSearch (research roles). */
  webSearch: boolean
  /** How the Claude Code CLI starts the Atelier MCP server for this run; absent when the bridge is not running. */
  mcp?: { command: string; args: string[]; env: Record<string, string> }
  /** Runs a tool in-process (FakeProvider uses it; the MCP bridge calls the same handlers). */
  call(name: string, args: unknown): Promise<ToolCallResult>
}

export interface CompletionResult {
  text: string
  model: string
  usage: Usage
  /** Cost reported by the provider itself (Claude Code reports it); null when the caller must price it. */
  costUsd: number | null
  stopReason: string | null
  /** True when the reply was cut short (token limit / context window), so the text is incomplete. */
  truncated?: boolean
  sessionId: string | null
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'done'; result: CompletionResult }

export interface CallOptions {
  signal?: AbortSignal
}

export interface Provider {
  readonly id: string
  complete(req: CompletionRequest, opts?: CallOptions): Promise<CompletionResult>
  stream(req: CompletionRequest, opts?: CallOptions): AsyncIterable<StreamEvent>
  /** True when this provider lets the model call these tools; absent/false means `req.tools` is ignored. */
  acceptsTools?(tools: AgentTools): boolean
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'NO_KEY' | 'ABORTED' | 'FAILED' | 'BAD_OUTPUT' | 'REFUSED' | 'TURN_LIMIT' | 'LOCKED',
    /** Usage already billed when the call failed after completing (a refusal, a CLI error result). */
    readonly usage?: Usage,
    readonly costUsd: number | null = null,
    /**
     * Whether the call reached the model: false = never (nothing can have been billed), true = it did (billed even
     * without a result), null = unknown (the caller decides from what it saw).
     */
    readonly reached: boolean | null = null
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** Drains a stream and returns its final result. Shared `complete` implementation. */
export async function collect(events: AsyncIterable<StreamEvent>): Promise<CompletionResult> {
  for await (const ev of events) {
    if (ev.type === 'done') return ev.result
  }
  throw new ProviderError('Stream ended without a final result', 'BAD_OUTPUT')
}
