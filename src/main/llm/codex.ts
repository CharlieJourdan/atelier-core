// OpenAI Codex CLI on the user's own ChatGPT login (agent runtime, docs/AGENT-RUNTIME.md). Spawns
// `codex exec --json …` with the prompt on stdin (`-`) and parses its JSONL events (codex-json.ts). Flags checked
// against `codex exec --help` of codex-cli 0.164: --json, --skip-git-repo-check, --ignore-user-config, --ephemeral,
// -m, -c key=value, `exec resume <id>`. VERIFY on a real account: the `sandbox_mode` and `model_reasoning_effort`
// config keys, and the event shapes (see codex-json.ts). Codex has no system-prompt flag: the instructions go first in
// the prompt. Each account is its own `CODEX_HOME` (passed in `env`); a stray OPENAI_API_KEY is removed so the
// subscription login is used. Abort kills the whole process tree.
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findOnPath, killTree } from '../platform/process'
import { quoteForCmd, type SpawnFn } from './claude-code'
import { CodexJsonParser, type CodexEvent } from './codex-json'
import {
  collect,
  ProviderError,
  type CallOptions,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type StreamEvent
} from './types'

/** Model id meaning "the model configured in the account's Codex" (no `-m` flag). */
export const CODEX_DEFAULT_MODEL = 'codex-default'

export interface CodexDeps {
  platform?: NodeJS.Platform
  findBinary?: () => string | null
  spawn?: SpawnFn
  killTree?: (pid: number) => void
  env?: NodeJS.ProcessEnv
  removeDir?: (dir: string) => void
  exitWaitMs?: number
}

const MODEL_RE = /^[A-Za-z0-9._:-]{1,100}$/
const SESSION_RE = /^[A-Za-z0-9-]{1,100}$/
const STDERR_CAP = 8 * 1024
/** Codex reasoning effort levels (Atelier's `max` maps to `high`). */
const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'high' }

export class CodexCliProvider implements Provider {
  readonly id = 'codex'
  private readonly platform: NodeJS.Platform
  private readonly findBinary: () => string | null
  private readonly spawn: SpawnFn
  private readonly kill: (pid: number) => void
  private readonly env: NodeJS.ProcessEnv
  private readonly removeDir: (dir: string) => void
  private readonly exitWaitMs: number
  private readonly live = new Set<number>()

  constructor(deps: CodexDeps = {}) {
    this.platform = deps.platform ?? process.platform
    this.findBinary = deps.findBinary ?? (() => findOnPath('codex'))
    this.spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn)
    this.kill = deps.killTree ?? ((pid) => killTree(pid, this.platform))
    this.env = deps.env ?? process.env
    this.removeDir = deps.removeDir ?? ((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    this.exitWaitMs = deps.exitWaitMs ?? 5000
  }

  /** Pids of the Codex processes still running. */
  livePids(): number[] {
    return [...this.live]
  }

  killAll(): number {
    const pids = [...this.live]
    this.live.clear()
    for (const pid of pids) this.kill(pid)
    return pids.length
  }

  complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    return collect(this.stream(req, opts))
  }

  async *stream(req: CompletionRequest, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
    const bin = this.findBinary()
    if (!bin) throw new ProviderError('Codex CLI not found on PATH (npm install -g @openai/codex, then `codex login`)', 'NOT_FOUND')
    if (!MODEL_RE.test(req.model)) throw new ProviderError(`Invalid model id: ${req.model}`, 'FAILED')
    const session = req.session
    if (session?.resumeId && !SESSION_RE.test(session.resumeId)) throw new ProviderError(`Invalid session id: ${session.resumeId}`, 'FAILED')
    if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED', undefined, null, false)

    const args = codexArgs(req)
    const viaShell = this.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const command = viaShell ? quoteForCmd(bin) : bin
    const finalArgs = viaShell ? args.map(quoteForCmd) : args
    const env = { ...this.env }
    delete env.OPENAI_API_KEY
    const tempDir = session ? null : mkdtempSync(path.join(tmpdir(), 'atelier-codex-'))
    const cwd = session ? session.cwd : (tempDir as string)
    let child: ReturnType<SpawnFn>
    try {
      if (session) mkdirSync(session.cwd, { recursive: true })
      child = this.spawn(command, finalArgs, {
        cwd,
        env,
        shell: viaShell,
        detached: this.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      if (tempDir) {
        try {
          this.removeDir(tempDir)
        } catch {
          // a leftover empty temp folder must never hide the real error
        }
      }
      throw err
    }
    const pid = child.pid
    if (pid !== undefined) this.live.add(pid)
    const parser = new CodexJsonParser()
    const queue: CodexEvent[] = []
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
    let onClosed: (() => void) | null = null
    const closedPromise = new Promise<void>((resolve) => (onClosed = resolve))
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
      onClosed?.()
      notify()
    })
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
    child.stdin?.end(promptText(req), 'utf8')

    let finished = false
    try {
      for (;;) {
        if (aborted) throw new ProviderError('Aborted', 'ABORTED')
        const ev = queue.shift()
        if (ev) {
          if (ev.type === 'text') yield { type: 'text', text: ev.text }
          // A transient `error` (a reconnect) is not the end: the turn may still complete.
          if (ev.type === 'done') {
            finished = true
            yield { type: 'done', result: this.result(req, parser) }
            return
          }
          continue
        }
        if (closed) {
          if (spawnError) throw new ProviderError(`Could not start Codex: ${String(spawnError)}`, 'FAILED')
          const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
          const why = parser.error ?? (tail || `exited with code ${exitCode ?? 'null'}`)
          throw new ProviderError(`Codex failed: ${why}`, 'FAILED', parser.reachedModel ? parser.usage : undefined, null, parser.reachedModel ? true : null)
        }
        await new Promise<void>((resolve) => (wake = resolve))
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      if (!finished && !closed && child.pid !== undefined && !aborted) this.kill(child.pid)
      if (!closed && !spawnError && !(await settlesWithin(closedPromise, this.exitWaitMs)) && child.pid !== undefined) {
        this.kill(child.pid)
        await settlesWithin(closedPromise, this.exitWaitMs)
      }
      if (tempDir) {
        try {
          this.removeDir(tempDir)
        } catch {
          // a leftover empty temp folder is harmless
        }
      }
    }
  }

  private result(req: CompletionRequest, parser: CodexJsonParser): CompletionResult {
    return {
      text: parser.lastMessage,
      model: req.model,
      usage: parser.usage,
      costUsd: null,
      stopReason: 'end_turn',
      sessionId: parser.sessionId
    }
  }
}

/** The argument list (exported for tests): `exec` (or `exec resume <id>`), JSONL, read-only sandbox, prompt on stdin. */
export function codexArgs(req: CompletionRequest): string[] {
  const session = req.session
  const args = session?.resumeId ? ['exec', 'resume', session.resumeId] : ['exec']
  args.push('--json', '--skip-git-repo-check', '--ignore-user-config', '-c', 'sandbox_mode=read-only')
  if (!session) args.push('--ephemeral')
  if (req.model && req.model !== CODEX_DEFAULT_MODEL) args.push('-m', req.model)
  const effort = session?.effortFlag && req.effort ? CODEX_EFFORT[req.effort] : undefined
  if (effort) args.push('-c', `model_reasoning_effort=${effort}`)
  args.push('-')
  return args
}

/** Codex has no system-prompt flag: the instructions come first, then the task. */
export function promptText(req: CompletionRequest): string {
  if (!req.system) return req.prompt
  return `# Instructions\n${req.system}\n\n# Task\n${req.prompt}`
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
