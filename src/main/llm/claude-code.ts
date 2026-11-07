// Provider 1: the Claude Code CLI on Charlie's subscription. Spawns
// `claude -p --output-format stream-json --verbose --include-partial-messages`, writes the prompt to stdin and
// parses stdout line by line. Abort kills the whole process tree.
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { ENV_TOKEN } from '../mcp/protocol'
import { findOnPath, killTree, killTreeSync } from '../platform/process'
import { StreamJsonParser, type ParsedEvent } from './stream-json'
import {
  collect,
  ProviderError,
  type AgentTools,
  type CallOptions,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type StreamEvent
} from './types'

export interface SpawnedProcess {
  pid?: number | undefined
  stdin: Writable | null
  stdout: Readable | null
  stderr: Readable | null
  exitCode: number | null
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

export interface SpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  shell: boolean
  detached: boolean
  windowsHide: boolean
  stdio: ['pipe', 'pipe', 'pipe']
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => SpawnedProcess

export interface ClaudeCodeDeps {
  platform?: NodeJS.Platform
  /** Returns the path of the `claude` binary, or null when it is not installed. */
  findBinary?: () => string | null
  spawn?: SpawnFn
  killTree?: (pid: number) => void
  /** Kills a tree and returns once it is gone (quit). */
  killTreeSync?: (pid: number) => void
  env?: NodeJS.ProcessEnv
  removeDir?: (dir: string) => void
  /** How long to wait for the CLI to exit before (re)killing it during cleanup. */
  exitWaitMs?: number
}

const removeTempDir = (dir: string): void =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const MODEL_RE = /^[A-Za-z0-9._:[\]-]{1,100}$/
const SESSION_RE = /^[A-Za-z0-9-]{1,100}$/
const STDERR_CAP = 8 * 1024

export class ClaudeCodeProvider implements Provider {
  readonly id = 'claude-code'
  private readonly platform: NodeJS.Platform
  private readonly findBinary: () => string | null
  private readonly spawn: SpawnFn
  private readonly kill: (pid: number) => void
  private readonly env: NodeJS.ProcessEnv
  private readonly removeDir: (dir: string) => void
  private readonly exitWaitMs: number
  private readonly killSync: (pid: number) => void
  /** Pids of the CLI processes still running (killed synchronously at quit). */
  private readonly live = new Set<number>()

  constructor(deps: ClaudeCodeDeps = {}) {
    this.removeDir = deps.removeDir ?? removeTempDir
    this.exitWaitMs = deps.exitWaitMs ?? 5000
    this.platform = deps.platform ?? process.platform
    this.findBinary = deps.findBinary ?? (() => findOnPath('claude'))
    this.spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn)
    this.kill = deps.killTree ?? ((pid) => killTree(pid, this.platform))
    this.killSync = deps.killTreeSync ?? ((pid) => killTreeSync(pid, this.platform))
    this.env = deps.env ?? process.env
  }

  /** Tools reach the CLI only through the Atelier MCP server, so the bridge must be running. */
  acceptsTools(tools: AgentTools): boolean {
    return tools.mcp !== undefined
  }

  /** Atelier quits: kills every CLI still running and returns once they are gone. Returns how many. */
  killAll(): number {
    const pids = [...this.live]
    this.live.clear()
    for (const pid of pids) this.killSync(pid)
    return pids.length
  }

  binaryPath(): string | null {
    return this.findBinary()
  }

  complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    return collect(this.stream(req, opts))
  }

  async *stream(req: CompletionRequest, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
    const bin = this.findBinary()
    if (!bin) {
      const where = this.platform === 'win32' ? 'claude.exe / claude.cmd' : "claude, e.g. ~/.local/bin/claude; Atelier reads your login shell's PATH"
      throw new ProviderError(`Claude Code CLI not found on PATH (${where})`, 'NOT_FOUND')
    }
    if (!MODEL_RE.test(req.model)) throw new ProviderError(`Invalid model id: ${req.model}`, 'FAILED')
    if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED', undefined, null, false)

    const session = req.session
    if (session?.resumeId && !SESSION_RE.test(session.resumeId)) throw new ProviderError(`Invalid session id: ${session.resumeId}`, 'FAILED')
    const workDir = mkdtempSync(path.join(tmpdir(), 'atelier-cc-'))
    // Until the try/finally below owns the folder, anything that throws must remove it first.
    const guard = <T>(fn: () => T): T => {
      try {
        return fn()
      } catch (err) {
        try {
          this.removeDir(workDir)
        } catch {
          // a leftover empty temp folder must never hide the real error
        }
        throw err
      }
    }
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
    // Plain completions keep nothing on disk; an agent session (runtime) is kept, and resumed when asked.
    if (!session) args.push('--no-session-persistence')
    else if (session.resumeId) args.push('--resume', session.resumeId)
    args.push('--model', req.model)
    if (session?.effortFlag && req.effort) args.push('--effort', req.effort)
    // Charlie's own settings (hooks, permissions, plugins) are never loaded for Atelier runs.
    args.push('--setting-sources', '')
    args.push(...guard(() => agentArgs(req, workDir)))
    if (req.system) {
      const file = path.join(workDir, 'system.md')
      guard(() => writeFileSync(file, req.system as string, 'utf8'))
      args.push('--system-prompt-file', file)
    }

    // npm installs a `claude.cmd` shim on Windows; Node only runs .cmd/.bat through a shell.
    const viaShell = this.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const command = viaShell ? quoteForCmd(bin) : bin
    const finalArgs = viaShell ? args.map(quoteForCmd) : args

    const env = { ...this.env }
    // Claude Code must use Charlie's subscription login, never a stray API key from the environment.
    delete env.ANTHROPIC_API_KEY
    // The MCP token lives only in the CLI's environment; mcp.json refers to it as ${ATELIER_BRIDGE_TOKEN}.
    Object.assign(env, mcpSecretEnv(req))

    // Claude Code stores sessions per working folder: an agent session runs in the agent's own folder.
    if (session) guard(() => mkdirSync(session.cwd, { recursive: true }))
    const child = guard(() =>
      this.spawn(command, finalArgs, {
        cwd: session ? session.cwd : workDir,
        env,
        shell: viaShell,
        detached: this.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )

    const pid = child.pid
    if (pid !== undefined) this.live.add(pid)
    const parser = new StreamJsonParser()
    const queue: ParsedEvent[] = []
    let wake: (() => void) | null = null
    let closed = false
    let exitCode: number | null = null
    let spawnError: Error | null = null
    let aborted = false
    let stderr = ''
    const notify = (): void => {
      const w = wake
      wake = null
      w?.()
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      queue.push(...parser.push(chunk))
      notify()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.slice(0, STDERR_CAP - stderr.length)
    })
    child.on('error', (err) => {
      spawnError = err
      closed = true
      notify()
    })
    let onClosed: (() => void) | null = null
    const closedPromise = new Promise<void>((resolve) => (onClosed = resolve))
    child.on('close', (code) => {
      if (pid !== undefined) this.live.delete(pid)
      queue.push(...parser.end())
      exitCode = code
      closed = true
      onClosed?.()
      notify()
    })

    const onAbort = (): void => {
      aborted = true
      if (child.pid !== undefined && !closed) this.kill(child.pid)
      notify()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdin?.on('error', () => undefined)
    child.stdin?.end(withPictures(req), 'utf8')

    let finished = false
    try {
      for (;;) {
        if (aborted) throw new ProviderError('Aborted', 'ABORTED')
        const ev = queue.shift()
        if (ev) {
          if (ev.type === 'text') yield { type: 'text', text: ev.text }
          else if (ev.type === 'result') {
            // An error result (a turn limit, an API error mid-run) still reports what it used: it was billed.
            if (ev.isError) {
              finished = true
              const code = ev.errorMessage === 'error_max_turns' ? 'TURN_LIMIT' : 'FAILED'
              throw new ProviderError(errorText(ev.errorMessage), code, ev.result.usage, ev.result.costUsd)
            }
            finished = true
            yield { type: 'done', result: { ...ev.result, model: ev.result.model || req.model } }
            return
          }
          continue
        }
        if (closed) {
          if (spawnError) throw new ProviderError(`Could not start Claude Code: ${String(spawnError)}`, 'FAILED')
          const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
          // Turns that only called tools stream no text, but the model ran: the call is booked, not refunded.
          throw new ProviderError(
            `Claude Code exited (code ${exitCode ?? 'null'}) without a result${tail ? `: ${tail}` : ''}`,
            'FAILED',
            undefined,
            null,
            parser.reachedModel ? true : null
          )
        }
        await new Promise<void>((resolve) => (wake = resolve))
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      // Consumer stopped early, an error was thrown, or abort: make sure nothing keeps running.
      if (!finished && !closed && child.pid !== undefined && !aborted) this.kill(child.pid)
      // Windows cannot delete a folder that a live process uses as its working directory: wait for the exit
      // (bounded; after a result the CLI exits on its own), killing the tree if it lingers.
      if (!closed && !spawnError) {
        if (!(await settlesWithin(closedPromise, this.exitWaitMs)) && child.pid !== undefined) {
          this.kill(child.pid)
          await settlesWithin(closedPromise, this.exitWaitMs)
        }
      }
      try {
        this.removeDir(workDir)
      } catch {
        // A leftover empty temp folder must never turn a good answer into an error.
      }
    }
  }
}

/** Built-in tools an agent must never get (WebSearch is allowed for research roles only). */
export const DISALLOWED_TOOLS = [
  'Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'NotebookEdit',
  'NotebookRead', 'Task', 'Agent', 'TodoWrite', 'BashOutput', 'KillShell', 'SlashCommand', 'Skill', 'ToolSearch',
  'ExitPlanMode', 'Monitor', 'LSP'
]

/**
 * Tool flags. Plain completion: no built-in tools and no MCP servers at all. Agent run: ONLY the Atelier MCP
 * server of this run (`--strict-mcp-config` ignores every other MCP config), its tools pre-approved one by one,
 * every built-in tool disabled and denied except WebSearch for research roles, and nothing else can be approved
 * (`dontAsk` denies anything not pre-approved).
 */
export function agentArgs(req: CompletionRequest, workDir: string): string[] {
  const tools = req.tools
  // pictures to look at: the Read tool only, on their folders only (avatar-qualite's illustration check)
  if (!tools?.mcp && req.images && req.images.length > 0) {
    const dirs = [...new Set(req.images.map((f) => path.dirname(f)))]
    return ['--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--max-turns', String(req.images.length + 3), '--strict-mcp-config', ...dirs.flatMap((d) => ['--add-dir', d])]
  }
  if (!tools?.mcp) return ['--tools', '', '--strict-mcp-config']
  const file = path.join(workDir, 'mcp.json')
  const env: Record<string, string> = { ...tools.mcp.env }
  for (const key of MCP_SECRET_ENV) if (key in env) env[key] = `\${${key}}` // expanded by the CLI from its own env
  const config = { mcpServers: { [MCP_SERVER_NAME]: { type: 'stdio', ...tools.mcp, env } } }
  writeFileSync(file, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
  const allowed = tools.specs.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`)
  if (tools.webSearch) allowed.push('WebSearch')
  const denied = tools.webSearch ? DISALLOWED_TOOLS : [...DISALLOWED_TOOLS, 'WebSearch']
  const turns = req.maxTurns !== undefined && Number.isInteger(req.maxTurns) && req.maxTurns >= 1 ? req.maxTurns : DEFAULT_MAX_TURNS
  return [
    '--max-turns', String(turns),
    '--mcp-config', file, '--strict-mcp-config',
    '--tools', tools.webSearch ? 'WebSearch' : '',
    '--allowedTools', allowed.join(','),
    '--disallowedTools', denied.join(','),
    '--permission-mode', 'dontAsk'
  ]
}

/** The prompt, with the pictures to read first when the request has some. */
export function withPictures(req: CompletionRequest): string {
  if (!req.images || req.images.length === 0 || req.tools?.mcp) return req.prompt
  const list = req.images.map((f, i) => `${i + 1}. ${f}`).join('\n')
  return `Read these pictures first, in this order (picture 1 is the first file):\n${list}\n\n${req.prompt}`
}

export const MCP_SERVER_NAME = 'atelier'
/** Env entries of the MCP server that never touch disk: mcp.json holds `${NAME}`, the CLI process holds the value. */
export const MCP_SECRET_ENV = [ENV_TOKEN] as const

/** The secret MCP env entries of a request, to add to the CLI's own environment. */
export function mcpSecretEnv(req: CompletionRequest): Record<string, string> {
  const env = req.tools?.mcp?.env ?? {}
  return Object.fromEntries(MCP_SECRET_ENV.filter((k) => k in env).map((k) => [k, env[k] as string]))
}
/** Turn limit of a tool run when the caller sets none: a tool loop must never run on unbounded. */
export const DEFAULT_MAX_TURNS = 12

function errorText(message: string | null): string {
  if (message === 'error_max_turns') return 'Claude Code stopped at its turn limit before finishing'
  return message ?? 'Claude Code failed'
}

function settlesWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    void p.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** Quotes one argument for cmd.exe. Our arguments are fixed flags, a validated model id and a temp path. */
export function quoteForCmd(arg: string): string {
  if (/["%!^&|<>\r\n]/.test(arg)) throw new ProviderError(`Unsafe argument for cmd.exe: ${arg}`, 'FAILED')
  if (arg === '') return '""'
  return /[\s]/.test(arg) ? `"${arg}"` : arg
}
