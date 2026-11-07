// ClaudeCodeProvider against a fake child process replaying the recorded fixture. The real CLI is never run.
import { trackTemp } from '../setup/track-temp'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeProvider, type SpawnFn, type SpawnOptions, type SpawnedProcess } from '../../src/main/llm/claude-code'
import { findOnPath, killTree, taskkillPath } from '../../src/main/platform/process'
import { ProviderError, type StreamEvent } from '../../src/main/llm/types'
import { fixture } from './helpers'

const FIXTURE = fixture('claude-stream.jsonl') // recording (scrubbed: placeholder ids, paths and usage) (prompt "Reply with the word ok")
const SESSION = '00000000-0000-4000-8000-000000000001'
/** SYNTHETIC: the recorded head (init, status, message_start, content_block_start) then made-up text deltas; never finishes. */
const PARTIAL = (() => {
  const lines = FIXTURE.split('\n').filter(Boolean)
  const delta = (t: string): string => (lines[4] as string).replace('"text":"ok"', '"text":' + JSON.stringify(t))
  return [...lines.slice(0, 4), delta('Three video'), delta(' ideas')].join('\n') + '\n'
})()

class FakeChild extends EventEmitter implements SpawnedProcess {
  pid = 4242
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  stdinText = ''
  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => (this.stdinText += d))
  }
  finish(code: number): void {
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

interface Spawned {
  command: string
  args: string[]
  options: SpawnOptions
  child: FakeChild
}

interface SetupOptions {
  bin?: string | null
  platform?: NodeJS.Platform
  script?: (c: FakeChild) => void
  removeDir?: (dir: string) => void
}

function setup(opts: SetupOptions = {}) {
  const spawned: Spawned[] = []
  const killed: number[] = []
  const removed: string[] = []
  const spawn: SpawnFn = (command, args, options) => {
    const child = new FakeChild()
    spawned.push({ command, args, options, child })
    setImmediate(() => opts.script?.(child))
    return child
  }
  const provider = new ClaudeCodeProvider({
    platform: opts.platform ?? 'win32',
    findBinary: () => (opts.bin === undefined ? 'C:\\Users\\charlie\\.local\\bin\\claude.exe' : opts.bin),
    spawn,
    // Like taskkill: the tree dies and the child reports close.
    killTree: (pid) => {
      killed.push(pid)
      spawned.find((s) => s.child.pid === pid && s.child.exitCode === null)?.child.finish(1)
    },
    removeDir: opts.removeDir ?? ((dir) => (trackTemp(dir), removed.push(dir))),
    exitWaitMs: 200,
    env: { PATH: 'C:\\bin', ANTHROPIC_API_KEY: 'should-not-leak' }
  })
  return { provider, spawned, killed, removed }
}

const replay = (c: FakeChild): void => {
  // Deliver in uneven chunks to exercise line buffering.
  for (let i = 0; i < FIXTURE.length; i += 97) c.stdout.write(FIXTURE.slice(i, i + 97))
  c.finish(0)
}

describe('ClaudeCodeProvider', () => {
  it('spawns claude -p with stream-json, sends the prompt on stdin and streams deltas then the result', async () => {
    const { provider, spawned } = setup({ script: replay })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({ model: 'claude-haiku-5-5', prompt: 'Give me 3 ideas', system: 'Be brief.' })) {
      events.push(ev)
    }
    const s = spawned[0] as Spawned
    expect(s.command).toBe('C:\\Users\\charlie\\.local\\bin\\claude.exe')
    expect(s.args.slice(0, 5)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'])
    expect(s.args).toContain('--model')
    expect(s.args[s.args.indexOf('--model') + 1]).toBe('claude-haiku-5-5')
    expect(s.args).toContain('--system-prompt-file')
    expect(s.args).not.toContain('Give me 3 ideas') // prompt goes on stdin, not argv
    // No built-in tools and no MCP servers from the user's own config.
    expect(s.args[s.args.indexOf('--tools') + 1]).toBe('')
    expect(s.args).toContain('--strict-mcp-config')
    expect(s.child.stdinText).toBe('Give me 3 ideas')
    expect(s.options.shell).toBe(false)
    expect(s.options.windowsHide).toBe(true)
    expect(s.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('ok')
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.result.costUsd).toBe(0.001234)
      expect(done.result.usage).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 1000 })
    }
  })

  it('complete() returns the final result', async () => {
    const { provider } = setup({ script: replay })
    const r = await provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })
    expect(r.text).toBe('ok')
    expect(r.sessionId).toBe(SESSION)
  })

  it('runs the npm claude.cmd shim through the shell with quoted arguments', async () => {
    const { provider, spawned } = setup({ bin: 'C:\\Program Files\\nodejs\\claude.cmd', script: replay })
    await provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })
    const s = spawned[0] as Spawned
    expect(s.options.shell).toBe(true)
    expect(s.command).toBe('"C:\\Program Files\\nodejs\\claude.cmd"')
    expect(s.args[s.args.indexOf('--tools') + 1]).toBe('""')
  })

  it('waits for the CLI to exit before removing its working folder (Windows locks it)', async () => {
    const order: string[] = []
    const { provider } = setup({
      removeDir: (d) => (trackTemp(d), order.push('removed')),
      script: (c) => {
        c.stdout.write(FIXTURE)
        // The result is out but the process takes a moment to exit.
        setTimeout(() => {
          order.push('closed')
          c.finish(0)
        }, 50)
      }
    })
    const r = await provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })
    expect(r.costUsd).toBe(0.001234)
    expect(order).toEqual(['closed', 'removed'])
  })

  it('a folder that cannot be removed never turns a good answer into an error', async () => {
    const { provider } = setup({
      script: replay,
      removeDir: (d) => {
        trackTemp(d)
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
    })
    await expect(provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })).resolves.toMatchObject({ stopReason: 'end_turn' })
  })

  it('kills a CLI that lingers after its result, then cleans up', async () => {
    const { provider, killed, removed } = setup({ script: (c) => c.stdout.write(FIXTURE) }) // never exits by itself
    await provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })
    expect(killed).toEqual([4242])
    expect(removed).toHaveLength(1)
  })

  it('aborting kills the process tree and rejects with ABORTED', async () => {
    const { provider, killed, removed } = setup({
      script: (c) => c.stdout.write(PARTIAL) // never finishes
    })
    const ac = new AbortController()
    const seen: string[] = []
    const run = (async () => {
      for await (const ev of provider.stream({ model: 'claude-haiku-5-5', prompt: 'x' }, { signal: ac.signal })) {
        if (ev.type === 'text') {
          seen.push(ev.text)
          ac.abort()
        }
      }
    })()
    await expect(run).rejects.toMatchObject({ code: 'ABORTED' })
    expect(seen).toEqual(['Three video'])
    expect(killed).toEqual([4242])
    expect(removed).toHaveLength(1)
  })

  it('kills the child when the consumer stops early', async () => {
    const { provider, killed } = setup({ script: (c) => c.stdout.write(PARTIAL) })
    for await (const ev of provider.stream({ model: 'claude-haiku-5-5', prompt: 'x' })) {
      if (ev.type === 'text') break
    }
    expect(killed).toEqual([4242])
  })

  it('fails clearly when the CLI exits without a result or reports an error', async () => {
    const crash = setup({
      script: (c) => {
        c.stderr.write('Error: not logged in\n')
        c.finish(1)
      }
    })
    await expect(crash.provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })).rejects.toThrow(
      /exited \(code 1\) without a result: Error: not logged in/
    )
    const errored = setup({
      script: (c) => {
        c.stdout.write('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Credit balance is too low"}\n')
        c.finish(1)
      }
    })
    await expect(errored.provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })).rejects.toThrow('Credit balance is too low')
  })

  it('reports NOT_FOUND when claude is not installed and refuses odd model ids', async () => {
    const missing = setup({ bin: null })
    await expect(missing.provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const ok = setup({ script: replay })
    await expect(ok.provider.complete({ model: 'x & calc', prompt: 'x' })).rejects.toBeInstanceOf(ProviderError)
    expect(ok.spawned).toHaveLength(0)
  })
})

describe('finding claude and killing trees', () => {
  it('finds claude.exe before claude.cmd, directory by directory, on Windows', () => {
    const files = new Set(['C:\\npm\\claude.cmd', 'C:\\local\\claude.exe'])
    const env = (pathVar: string) => ({
      platform: 'win32' as const,
      pathVar,
      pathExt: '.COM;.EXE;.BAT;.CMD',
      exists: (f: string) => files.has(f)
    })
    expect(findOnPath('claude', env('C:\\local;C:\\npm'))).toBe('C:\\local\\claude.exe')
    expect(findOnPath('claude', env('C:\\npm;C:\\local'))).toBe('C:\\npm\\claude.cmd')
    expect(findOnPath('claude', env('"C:\\npm"'))).toBe('C:\\npm\\claude.cmd')
    expect(findOnPath('claude', env('C:\\nothing'))).toBeNull()
  })

  it('finds claude on a POSIX PATH', () => {
    const env = { platform: 'darwin' as const, pathVar: '/usr/bin:/opt/homebrew/bin', pathExt: undefined, exists: (f: string) => f === '/opt/homebrew/bin/claude' }
    expect(findOnPath('claude', env)).toBe('/opt/homebrew/bin/claude')
  })

  it('uses taskkill /T /F on Windows and the process group elsewhere', () => {
    const runs: [string, string[]][] = []
    killTree(1234, 'win32', (cmd, args) => runs.push([cmd, args]))
    // The full path of System32's taskkill, never a bare name looked up on the search path.
    expect(runs).toEqual([[taskkillPath(), ['/PID', '1234', '/T', '/F']]])
    expect(path.win32.isAbsolute(runs[0]![0])).toBe(true)
    expect(taskkillPath('D:\\Win')).toBe('D:\\Win\\System32\\taskkill.exe')
    const signals: [number, string][] = []
    killTree(55, 'linux', () => undefined, (pid, sig) => signals.push([pid, sig]))
    expect(signals).toEqual([[-55, 'SIGKILL']])
  })
})
