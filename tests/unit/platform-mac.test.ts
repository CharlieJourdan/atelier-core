// The macOS port of the core, with a simulated darwin: the Claude Code CLI spawn (process group) and the Mac
// packaging config. Nothing real is started.
import { trackTemp } from '../setup/track-temp'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeProvider, type SpawnFn, type SpawnOptions } from '../../src/main/llm/claude-code'

const HOME = '/Users/charlie'

describe('Claude Code CLI on macOS', () => {
  it('spawns ~/.local/bin/claude directly (no shell) in its own process group, and kills the group', async () => {
    const spawned: { command: string; args: string[]; options: SpawnOptions }[] = []
    const killed: number[] = []
    const children: FakeCliChild[] = []
    const spawn: SpawnFn = (command, args, options) => {
      const child = new FakeCliChild()
      spawned.push({ command, args, options })
      children.push(child)
      return child
    }
    const provider = new ClaudeCodeProvider({
      platform: 'darwin',
      findBinary: () => `${HOME}/.local/bin/claude`,
      spawn,
      killTree: (pid) => {
        killed.push(pid)
        children.find((c) => c.pid === pid)?.finish(1)
      },
      removeDir: (d: string) => void trackTemp(d),
      exitWaitMs: 50,
      env: { PATH: '/opt/homebrew/bin:/usr/bin', ANTHROPIC_API_KEY: 'must-not-leak' }
    })
    const ac = new AbortController()
    const run = provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' }, { signal: ac.signal })
    await new Promise((r) => setTimeout(r, 20))
    ac.abort()
    await expect(run).rejects.toBeDefined()
    expect(spawned[0]!.command).toBe('/Users/charlie/.local/bin/claude')
    expect(spawned[0]!.options).toMatchObject({ shell: false, detached: true })
    expect(spawned[0]!.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(killed).toEqual([4343])
  })

  it('says where it looked when claude is missing (no Windows file names on the Mac)', async () => {
    const provider = new ClaudeCodeProvider({ platform: 'darwin', findBinary: () => null })
    await expect(provider.complete({ model: 'claude-haiku-5-5', prompt: 'x' })).rejects.toThrow("~/.local/bin/claude; Atelier reads your login shell's PATH")
  })
})

class FakeCliChild extends EventEmitter {
  pid = 4343
  exitCode: number | null = null
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  finish(code: number): void {
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

describe('Mac packaging', () => {
  it('electron-builder.mac.config.mjs: arm64 dir + dmg, no identity then an ad-hoc signature, microphone text', async () => {
    // A plain .mjs config (no type declarations): imported through a variable so tsc does not resolve it.
    const configPath = '../../electron-builder.mac.config.mjs'
    const mod = (await import(configPath)) as {
      default: Record<string, unknown> & { mac: Record<string, unknown>; afterPack: (c: unknown) => void }
      adhocSign: (c: unknown) => void
    }
    const cfg = mod.default
    expect(cfg.appId).toBe('fr.charlie.atelier')
    expect(cfg.productName).toBe('Atelier')
    expect(cfg.directories).toEqual({ output: 'dist/mac' })
    expect(cfg.mac.target).toEqual([
      { target: 'dir', arch: 'arm64' },
      { target: 'dmg', arch: 'arm64' }
    ])
    expect(cfg.mac.identity).toBeNull()
    expect((cfg.mac.extendInfo as Record<string, string>).NSMicrophoneUsageDescription).toMatch(/micro/)
    // lot P5: the local worker (run by Electron as Node, outside the archive) and the zod it loads at run time
    expect(cfg.asarUnpack).toEqual(['out/main/mcp.js', 'out/main/worker.js', 'out/main/chunks/**', 'node_modules/zod/**'])
    expect(cfg.afterPack).toBe(mod.adhocSign)
    // Not a Mac (or not a darwin pack): the hook does nothing.
    expect(() => mod.adhocSign({ electronPlatformName: 'win32', appOutDir: '/x', packager: { appInfo: { productFilename: 'Atelier' } } })).not.toThrow()
  })

  it('one app: no flavour scripts or configs left, dist:mac builds with the Mac config', async () => {
    const pkg = (await import('../../package.json')).default as { scripts: Record<string, string> }
    expect(pkg.scripts['dist:mac']).toBe('npm run build && electron-builder --config electron-builder.mac.config.mjs --mac --arm64')
  })
})
