// Codex CLI provider: `codex exec --json` JSONL parsing (current and legacy event shapes), arguments, CODEX_HOME,
// session resume, failures and usage limits, abort → process-tree kill; and a Claude Code → Codex failover in the pool.
// The events below are SYNTHETIC, written from the documented `--json` stream (codex-cli 0.164): no real run.
import { trackTemp } from '../setup/track-temp'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SpawnFn, SpawnOptions, SpawnedProcess } from '../../src/main/llm/claude-code'
import { CodexCliProvider, CODEX_DEFAULT_MODEL, codexArgs } from '../../src/main/llm/codex'
import { CodexJsonParser } from '../../src/main/llm/codex-json'
import { FakeProvider } from '../../src/main/llm/fake'
import { ProviderError } from '../../src/main/llm/types'
import { detectLimit } from '../../src/main/orchestra/limits'
import { scriptedReply } from '../../src/main/orchestra/fake-team'
import { agentBySlug, rig, T0 } from './orchestra-helpers'

const ev = (o: unknown): string => `${JSON.stringify(o)}\n`
const SESSION = '0199a213-81c0-7800-8aa1-bbab2a035a53'
const RUN = [
  ev({ type: 'thread.started', thread_id: SESSION }),
  ev({ type: 'turn.started' }),
  ev({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Thinking**' } }),
  ev({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Three topics: A, B, C.' } }),
  ev({ type: 'turn.completed', usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122 } })
].join('')

class Child extends EventEmitter implements SpawnedProcess {
  pid = 9100
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  input = ''
  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => (this.input += d))
  }
  finish(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

function codex(script: (c: Child, args: string[]) => void, extra: { bin?: string } = {}) {
  const spawned: { args: string[]; options: SpawnOptions; child: Child; command: string }[] = []
  const killed: number[] = []
  const spawn: SpawnFn = (command, args, options) => {
    const child = new Child()
    spawned.push({ command, args, options, child })
    child.stdin.on('end', () => setImmediate(() => script(child, args)))
    return child
  }
  const provider = new CodexCliProvider({
    platform: 'win32',
    findBinary: () => extra.bin ?? 'C:\\Users\\charlie\\AppData\\Roaming\\npm\\codex.exe',
    spawn,
    killTree: (pid) => {
      killed.push(pid)
      spawned.find((s) => s.child.pid === pid)?.child.finish(1)
    },
    env: { PATH: 'x', CODEX_HOME: 'C:\\codex\\one', OPENAI_API_KEY: 'must-not-leak' },
    removeDir: (d: string) => void trackTemp(d),
    exitWaitMs: 50
  })
  return { provider, spawned, killed }
}

describe('Codex JSONL parser', () => {
  it('reads the session, the last agent message and the usage (cached input apart)', () => {
    const p = new CodexJsonParser()
    const out = [...p.push(RUN.slice(0, 50)), ...p.push(RUN.slice(50)), ...p.end()]
    expect(out.map((e) => e.type)).toEqual(['session', 'text', 'usage', 'done'])
    expect(p.sessionId).toBe(SESSION)
    expect(p.lastMessage).toBe('Three topics: A, B, C.')
    expect(p.usage).toEqual({ inputTokens: 315, cacheReadTokens: 24448, outputTokens: 122, cacheWriteTokens: 0 })
    expect(p.completed).toBe(true)
  })

  it('reads the legacy envelope and keeps bad lines aside', () => {
    const p = new CodexJsonParser()
    p.push('not json\n')
    p.push(ev({ id: '0', msg: { type: 'session_configured', session_id: 'abc-1' } }))
    p.push(ev({ id: '1', msg: { type: 'agent_message', message: 'hello' } }))
    p.push(ev({ id: '2', msg: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, output_tokens: 5 } } } }))
    const last = p.push(ev({ id: '3', msg: { type: 'task_complete', last_agent_message: 'hello' } }))
    expect(last.map((e) => e.type)).toEqual(['done'])
    expect(p).toMatchObject({ sessionId: 'abc-1', lastMessage: 'hello', badLines: ['not json'] })
    expect(p.usage.outputTokens).toBe(5)
  })

  it('reports turn failures and errors', () => {
    const p = new CodexJsonParser()
    expect(p.push(ev({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again in 3 hours." } }))).toEqual([
      { type: 'error', message: "You've hit your usage limit. Try again in 3 hours." }
    ])
    expect(p.push(ev({ type: 'error', message: 'stream disconnected' }))[0]).toMatchObject({ type: 'error' })
  })
})

describe('CodexCliProvider', () => {
  it('runs codex exec --json on stdin with a read-only sandbox, its own CODEX_HOME and no API key', async () => {
    const { provider, spawned } = codex((c) => {
      c.stdout.write(RUN)
      c.finish(0)
    })
    const r = await provider.complete({ model: 'gpt-5.5', system: 'Be brief.', prompt: 'Give me 3 topics' })
    expect(r).toMatchObject({ text: 'Three topics: A, B, C.', sessionId: SESSION, costUsd: null })
    const s = spawned[0]!
    expect(s.args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-c', 'sandbox_mode=read-only', '--ephemeral', '-m', 'gpt-5.5', '-'])
    expect(s.child.input).toBe('# Instructions\nBe brief.\n\n# Task\nGive me 3 topics')
    expect(s.options.env.CODEX_HOME).toBe('C:\\codex\\one')
    expect(s.options.env.OPENAI_API_KEY).toBeUndefined()
    expect(s.options.shell).toBe(false)
  })

  it('keeps and resumes a session in the agent folder; the default model sends no -m; effort as a config key', () => {
    expect(codexArgs({ model: CODEX_DEFAULT_MODEL, prompt: 'x', effort: 'max', session: { cwd: 'C:\\a', resumeId: SESSION, effortFlag: true } })).toEqual([
      'exec', 'resume', SESSION, '--json', '--skip-git-repo-check', '--ignore-user-config', '-c', 'sandbox_mode=read-only', '-c', 'model_reasoning_effort=high', '-'
    ])
  })

  it('quotes for cmd.exe when codex is the npm .cmd shim', async () => {
    const { provider, spawned } = codex(
      (c) => {
        c.stdout.write(RUN)
        c.finish(0)
      },
      { bin: 'C:\\Program Files\\nodejs\\codex.cmd' }
    )
    await provider.complete({ model: CODEX_DEFAULT_MODEL, prompt: 'x' })
    expect(spawned[0]!.command).toBe('"C:\\Program Files\\nodejs\\codex.cmd"')
    expect(spawned[0]!.options.shell).toBe(true)
  })

  it('a failed turn (usage limit) is a ProviderError whose text the pool recognises', async () => {
    const { provider } = codex((c) => {
      c.stdout.write(ev({ type: 'thread.started', thread_id: SESSION }) + ev({ type: 'turn.started' }))
      c.stdout.write(ev({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again in 3 hours." } }))
      c.finish(1)
    })
    const err = await provider.complete({ model: CODEX_DEFAULT_MODEL, prompt: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).reached).toBe(true)
    expect(detectLimit((err as Error).message, T0)).toMatchObject({ kind: 'usage', until: T0 + 3 * 3_600_000 })
  })

  it('abort kills the process tree', async () => {
    const { provider, killed } = codex((c) => {
      c.stdout.write(ev({ type: 'thread.started', thread_id: SESSION }))
    })
    const ac = new AbortController()
    const p = provider.complete({ model: CODEX_DEFAULT_MODEL, prompt: 'x' }, { signal: ac.signal })
    await new Promise((r) => setTimeout(r, 20))
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' })
    expect(killed).toEqual([9100])
  })

  it('says how to install it when the binary is missing', async () => {
    const p = new CodexCliProvider({ findBinary: () => null })
    await expect(p.complete({ model: CODEX_DEFAULT_MODEL, prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('pool: Claude Code → Codex', () => {
  it('a limited Claude Code account hands the turn to a Codex account (its own model, its own session)', async () => {
    const { provider: cx, spawned } = codex((c) => {
      const prompt = c.input
      const text = scriptedReply(prompt.slice(0, prompt.indexOf('# Task')), prompt.slice(prompt.indexOf('# Task') + 7))
      c.stdout.write(ev({ type: 'thread.started', thread_id: SESSION }) + ev({ type: 'turn.started' }))
      c.stdout.write(ev({ type: 'item.completed', item: { type: 'agent_message', text } }))
      c.stdout.write(ev({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } }))
      c.finish(0)
    })
    const r = rig({
      providerFor: (a) => (a.kind === 'codex' ? cx : new FakeProvider(() => ({ text: '', error: 'Claude AI usage limit reached|1793012400' })))
    })
    const o = r.core.orchestra
    const acc = o.saveAccount({ kind: 'codex', label: 'Codex (ChatGPT)', configDir: 'C:\\codex\\one', models: { balanced: 'gpt-5.5' } })
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: a.id, kind: 'research', title: 'Sujets' })
    await o.tick({ wait: true })
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'done', accountId: acc.id })
    expect(spawned[0]!.args).toContain('gpt-5.5')
    expect(spawned[0]!.options.cwd).toContain(a.slug)
    expect(o.parts.memory.session(a.id)).toMatchObject({ cliSessionId: SESSION, accountId: acc.id })
    const row = r.core.db.prepare("SELECT provider_id, model, status, input_tokens, cache_read_tokens FROM ledger WHERE account_id = ?").get(acc.id)
    expect(row).toEqual({ provider_id: 'codex', model: 'gpt-5.5', status: 'settled', input_tokens: 100, cache_read_tokens: 0 })
  })
})
