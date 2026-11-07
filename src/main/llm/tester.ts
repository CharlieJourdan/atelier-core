// "Test" buttons in Settings → Providers. Neither check spends tokens:
// Claude Code runs `claude --version`; the API lists one model.
import { spawn } from 'node:child_process'
import type { ProviderId, ProviderTestResult } from '../../shared/api'
import { quoteForCmd } from './claude-code'
import { killTree } from '../platform/process'
import type { ProviderSet } from './index'

export interface ProviderTester {
  test(id: ProviderId): Promise<ProviderTestResult>
}

export type VersionRunner = (bin: string) => Promise<string>

const VERSION_TIMEOUT_MS = 15_000

const runVersion: VersionRunner = (bin) =>
  new Promise((resolve, reject) => {
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const child = spawn(viaShell ? quoteForCmd(bin) : bin, ['--version'], {
      windowsHide: true,
      shell: viaShell,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (out += d))
    // A timeout must stop the whole tree, not just the cmd.exe wrapper.
    const timer = setTimeout(() => {
      if (child.pid !== undefined) killTree(child.pid)
      reject(new Error(`claude --version did not answer within ${VERSION_TIMEOUT_MS / 1000} s`))
    }, VERSION_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(`claude --version exited with code ${code ?? 'null'}`))
    })
  })

export function createProviderTester(
  providers: ProviderSet,
  version: VersionRunner = runVersion,
  now: () => number = Date.now
): ProviderTester {
  return {
    async test(id) {
      const start = now()
      const done = (ok: boolean, message: string): ProviderTestResult => ({ ok, message, latencyMs: now() - start })
      try {
        if (id === 'claude-code') {
          const bin = providers['claude-code'].binaryPath()
          if (!bin) return done(false, 'claude not found on PATH. Install Claude Code and log in.')
          const v = await version(bin)
          return done(true, `Found ${bin} (${v})`)
        }
        await providers.anthropic.ping()
        return done(true, 'API key accepted')
      } catch (err) {
        return done(false, err instanceof Error ? err.message : String(err))
      }
    }
  }
}
