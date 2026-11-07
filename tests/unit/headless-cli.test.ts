// End to end, scripted: the real `npm run brain:headless` program (same command line, plain Node) with the example
// workspace and the fake team on a random port; a Node client built from the renderer's own modules (state/remote.ts as
// `window.atelier`, the proto store's real-mode driver) switches to real mode against it, sees the real data, starts a
// production run and finds it in production.list. Never a real model (ATELIER_FAKE_LLM=1), nothing outside temp folders.
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { killTree } from '../../src/main/platform/process'
import { createRemoteBridge, type RemoteBridge } from '../../src/renderer/state/remote'
import { REPO, tempDir } from './headless-helpers'

interface Started {
  child: ChildProcess
  url: string
  token: string
  stdout: () => string
}

function startCli(dir: string): Promise<Started> {
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      '--import',
      pathToFileURL(path.join(REPO, 'scripts', 'ts-transpile.mjs')).href,
      path.join(REPO, 'src', 'main', 'headless', 'main.ts'),
      '--port',
      '0',
      '--no-mcp',
      '--origin',
      'http://localhost:5180'
    ],
    {
      cwd: REPO,
      env: {
        ...process.env,
        ATELIER_DATA_DIR: path.join(dir, 'data'),
        ATELIER_KEY_FILE: path.join(dir, 'key', 'machine.key'),
        ATELIER_FAKE_LLM: '1',
        ATELIER_RUNNER: 'off',
        ATELIER_AUTOMATIONS: 'off',
        // the example workspace, asked for explicitly (a fresh brain starts empty since the first-run onboarding)
        ATELIER_EXAMPLE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let out = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) => (out += d))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`brain did not start:\n${out}`)), 60_000)
    child.on('exit', (code) => reject(new Error(`brain exited ${code}:\n${out}`)))
    child.stdout?.on('data', (d: string) => {
      out += d
      if (!out.includes('Prêt.')) return
      clearTimeout(timer)
      const url = /écoute\s+(http:\/\/\S+)/.exec(out)?.[1]
      const token = /^\s+(atb_[A-Za-z0-9_-]+)\s*$/m.exec(out)?.[1]
      if (!url || !token) reject(new Error(`no address or token in:\n${out}`))
      else resolve({ child, url, token, stdout: () => out })
    })
  })
}

describe('npm run brain:headless + the renderer client in real mode', () => {
  const dir = tempDir('atb-cli-')
  let brain: Started
  let bridge: RemoteBridge

  beforeAll(async () => {
    brain = await startCli(dir)
    bridge = createRemoteBridge({ url: brain.url, token: brain.token }, { local: { 'app.setTheme': () => null } })
    // what web/bridge.ts installs once connected (in a browser `window` is the global object)
    const g = globalThis as { window?: unknown; atelier?: unknown }
    g.window = globalThis
    g.atelier = bridge
  }, 90_000)

  afterAll(async () => {
    bridge?.close()
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { atelier?: unknown }).atelier
    if (brain?.child.pid) {
      const exited = new Promise((r) => brain.child.once('exit', r))
      if (process.platform === 'win32') killTree(brain.child.pid)
      else brain.child.kill('SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('prints the token once, with the copy line and the tunnel', () => {
    expect(brain.stdout()).toMatch(/copie-le maintenant/)
    expect(brain.stdout()).toMatch(/ssh -N -L \d+:127\.0\.0\.1:\d+/)
    expect(brain.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('the renderer client sees the real data, real mode loads, a run started remotely is listed', async () => {
    const { call } = await import('../../src/renderer/state/client')
    const { isDesktop, loadSnapshot } = await import('../../src/renderer/proto/live/driver')
    // the remote bridge counts as a real brain: the « Démo / Réel » switch is offered
    expect(isDesktop()).toBe(true)

    const channels = await call('channels.list')
    expect(channels.length).toBeGreaterThan(0) // the example workspace (ATELIER_EXAMPLE=1)

    // « Démo → Réel »: the proto store's snapshot, from the team computer
    const snap = await loadSnapshot('Atlas')
    expect(snap.channels.map((c) => c.name)).toEqual(expect.arrayContaining(channels.map((c) => c.name)))
    expect(snap.agents.length).toBeGreaterThan(3)
    expect(snap.agents.find((a) => a.role === 'principal')?.name).toBe('Atlas')

    const channel = channels[0] as { id: number }
    const run = await call('production.start', { channelId: channel.id, title: 'Vidéo distante', topic: 'Le phare englouti', minutes: 1, budgetMode: 'usage_max', gateMode: 'step' })
    const runs = await call('production.list')
    expect(runs.map((r) => r.id)).toContain(run.id)
    // and the next snapshot shows it among the videos
    const again = await loadSnapshot('Atlas')
    expect(again.videos.some((v) => v.title === 'Vidéo distante')).toBe(true)
  }, 120_000)
})
