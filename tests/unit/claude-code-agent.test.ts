// ClaudeCodeProvider tool flags for agent runs, against a fake child process replaying the recorded fixture.
// The real CLI is never run.
import { trackTemp } from '../setup/track-temp'
import { EventEmitter } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeProvider, DISALLOWED_TOOLS, type SpawnFn, type SpawnedProcess } from '../../src/main/llm/claude-code'
import type { AgentTools, ToolSpec } from '../../src/main/llm/types'
import { fixture } from './helpers'

const FIXTURE = fixture('claude-stream.jsonl')

class FakeChild extends EventEmitter implements SpawnedProcess {
  pid = 4242
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  finish(code: number): void {
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

const workDirs: string[] = []
afterEach(() => {
  for (const d of workDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Captured {
  args: string[]
  /** mcp.json as it was when the CLI was started (the folder is removed afterwards). */
  mcpConfig: unknown
  systemFile: string | null
  /** mcp.json text as written, and the environment the CLI was spawned with. */
  mcpText: string | null
  env: NodeJS.ProcessEnv
}

function setup() {
  const captured: Captured[] = []
  const spawn: SpawnFn = (_command, args, options) => {
    workDirs.push(options.cwd)
    const at = (flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] as string) : null)
    const mcpFile = at('--mcp-config')
    captured.push({
      args,
      mcpConfig: mcpFile ? JSON.parse(readFileSync(mcpFile, 'utf8')) : null,
      mcpText: mcpFile ? readFileSync(mcpFile, 'utf8') : null,
      env: options.env,
      systemFile: at('--system-prompt-file')
    })
    const child = new FakeChild()
    setImmediate(() => {
      child.stdout.write(FIXTURE)
      child.finish(0)
    })
    return child
  }
  const provider = new ClaudeCodeProvider({
    platform: 'linux',
    findBinary: () => '/usr/local/bin/claude',
    spawn,
    killTree: () => undefined,
    removeDir: (d: string) => void trackTemp(d),
    exitWaitMs: 200,
    env: { PATH: '/bin' }
  })
  return { provider, captured }
}

const spec = (name: string): ToolSpec => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })
const MCP = { command: '/opt/atelier/electron', args: ['/opt/atelier/out/main/mcp.js'], env: { ATELIER_BRIDGE: '/tmp/b.sock', ATELIER_BRIDGE_TOKEN: 'tok-123' } }

function tools(over: Partial<AgentTools> = {}): AgentTools {
  return {
    specs: [spec('get_brief'), spec('save_version')],
    webSearch: false,
    mcp: MCP,
    call: async () => ({ text: '', isError: false }),
    ...over
  }
}

const value = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const REQ = { model: 'claude-sonnet-5-5', prompt: 'Make the Research', system: 'You are the researcher.' }

describe('agent runs with the Atelier MCP server', () => {
  it('loads no user settings and only the run\'s own MCP config', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools() })
    const { args, mcpConfig } = captured[0]!
    expect(value(args, '--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    const file = value(args, '--mcp-config')!
    expect(path.basename(file)).toBe('mcp.json')
    expect(path.dirname(file)).toBe(path.dirname(captured[0]!.systemFile!)) // same temp workdir
    expect(mcpConfig).toEqual({
      mcpServers: {
        atelier: { type: 'stdio', command: MCP.command, args: MCP.args, env: { ATELIER_BRIDGE: '/tmp/b.sock', ATELIER_BRIDGE_TOKEN: '${ATELIER_BRIDGE_TOKEN}' } }
      }
    })
  })

  it('review 2 #5: the bridge token is not in the config file; it reaches the server through the CLI environment', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools() })
    expect(captured[0]!.mcpText).not.toContain('tok-123')
    expect(captured[0]!.args.join(' ')).not.toContain('tok-123')
    expect(captured[0]!.env.ATELIER_BRIDGE_TOKEN).toBe('tok-123')
  })

  it('disables every built-in tool and pre-approves only the Atelier tools', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools() })
    const { args } = captured[0]!
    expect(value(args, '--tools')).toBe('')
    expect(value(args, '--allowedTools')).toBe('mcp__atelier__get_brief,mcp__atelier__save_version')
    const denied = value(args, '--disallowedTools')!.split(',')
    for (const t of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch']) expect(denied).toContain(t)
    expect(denied).toEqual([...DISALLOWED_TOOLS, 'WebSearch'])
    expect(value(args, '--permission-mode')).toBe('dontAsk')
  })

  it('allows WebSearch (and only it) when the agent may search the web', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools({ webSearch: true }) })
    const { args } = captured[0]!
    expect(value(args, '--tools')).toBe('WebSearch')
    expect(value(args, '--allowedTools')!.split(',')).toEqual(['mcp__atelier__get_brief', 'mcp__atelier__save_version', 'WebSearch'])
    const denied = value(args, '--disallowedTools')!.split(',')
    expect(denied).not.toContain('WebSearch')
    for (const t of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch']) expect(denied).toContain(t)
    expect(value(args, '--permission-mode')).toBe('dontAsk')
  })

  it('still writes the system prompt file and keeps the stream-json flags', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools() })
    expect(captured[0]!.systemFile).toMatch(/system\.md$/)
    expect(captured[0]!.args.slice(0, 3)).toEqual(['-p', '--output-format', 'stream-json'])
  })
})

describe('runs without tools', () => {
  it('a plain completion has no tools, no MCP config and no user settings', async () => {
    const { provider, captured } = setup()
    await provider.complete(REQ)
    const { args, mcpConfig } = captured[0]!
    expect(value(args, '--setting-sources')).toBe('')
    expect(value(args, '--tools')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--permission-mode')
    expect(mcpConfig).toBeNull()
  })

  it('tools without the MCP bridge are ignored: still no tools at all, even with webSearch', async () => {
    const { provider, captured } = setup()
    await provider.complete({ ...REQ, tools: tools({ webSearch: true, mcp: undefined }) })
    const { args } = captured[0]!
    expect(value(args, '--tools')).toBe('')
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--allowedTools')
  })
})

describe('acceptsTools', () => {
  it('is true only when the MCP launch info is present', () => {
    const { provider } = setup()
    expect(provider.acceptsTools(tools())).toBe(true)
    expect(provider.acceptsTools(tools({ mcp: undefined }))).toBe(false)
  })
})
