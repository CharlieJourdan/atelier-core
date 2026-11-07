// Security review, finding 7: `--rotate-token` used to start a second brain on the service's database, write the new
// hash, fail on the busy port without printing the token, and leave the running service on the old one. Now: the
// rotation is an offline command that opens no database and refuses while the service holds its port; a start that
// cannot get its port writes no token and opens no database; and a running brain re-reads the hash when the file changes.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startHeadless } from '../../src/main/headless/host'
import { BrainTokens, RotateRefused, TOKEN_FILE, portHeld, rotateOffline } from '../../src/main/headless/token'
import { REPO, startTestBrain, tempDir, type TestBrain } from './headless-helpers'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function holdPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', pathToFileURL(path.join(REPO, 'scripts', 'ts-transpile.mjs')).href, path.join(REPO, 'src', 'main', 'headless', 'main.ts'), ...args],
      { cwd: REPO, env: { ...process.env, ...env }, windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

describe('--rotate-token', () => {
  it('is refused while the service holds its port: no token is changed, the running one keeps working', async () => {
    const brain: TestBrain = await startTestBrain()
    cleanups.push(() => brain.stop())
    const port = Number(new URL(brain.url).port)
    const file = path.join(brain.dir, 'data', TOKEN_FILE)
    const before = readFileSync(file, 'utf8')
    expect(await portHeld('127.0.0.1', port)).toBe(true)
    await expect(rotateOffline({ dataDir: path.join(brain.dir, 'data'), host: '127.0.0.1', port })).rejects.toBeInstanceOf(RotateRefused)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect((await brain.rpc('app.info')).status).toBe(200)
  })

  it('a running brain re-reads the hash when the file changes: the new token works at once, the old one is refused', async () => {
    const brain = await startTestBrain()
    cleanups.push(() => brain.stop())
    // a rotation the probe cannot see (the service on another port, or the file replaced by hand)
    const fresh = await rotateOffline({ dataDir: path.join(brain.dir, 'data'), host: '127.0.0.1', port: 0 })
    expect(fresh).toMatch(/^atb_[A-Za-z0-9_-]{43}$/)
    expect((await brain.rpc('app.info')).status).toBe(401)
    expect((await brain.rpc('app.info', [], { authorization: `Bearer ${fresh}` })).status).toBe(200)
    expect(new BrainTokens(path.join(brain.dir, 'data')).verifyHeader(`Bearer ${fresh}`)).toBe(true)
  })

  it('as a command: prints the new token once and exits, without opening the database; refused (exit 1) on a busy port', async () => {
    const dir = tempDir('atb-rotate-')
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const env = { ATELIER_DATA_DIR: path.join(dir, 'data'), ATELIER_KEY_FILE: path.join(dir, 'key', 'machine.key') }
    const held = await holdPort()
    cleanups.push(held.close)
    const refused = await runCli(['--rotate-token', '--port', String(held.port)], env)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toMatch(/tourne déjà .*Aucun jeton n'a été changé/s)
    expect(existsSync(path.join(dir, 'data', TOKEN_FILE))).toBe(false)
    await held.close()
    const ok = await runCli(['--rotate-token', '--port', String(held.port)], env)
    expect(ok.code, ok.stderr).toBe(0)
    const token = /\n {2}(atb_[A-Za-z0-9_-]{43})\n/.exec(ok.stdout)?.[1]
    expect(token).toBeTruthy()
    expect(new BrainTokens(path.join(dir, 'data')).verifyHeader(`Bearer ${token}`)).toBe(true)
    expect(readFileSync(path.join(dir, 'data', TOKEN_FILE), 'utf8')).not.toContain(token!)
    expect(existsSync(path.join(dir, 'data', 'atelier.db'))).toBe(false) // no core, no database
  }, 60_000)
})

describe('a start that cannot get its port', () => {
  it('fails with EADDRINUSE before it opens the database or writes a token', async () => {
    const held = await holdPort()
    cleanups.push(held.close)
    const dir = tempDir('atb-busy-')
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    await expect(
      startHeadless({
        dataDir: path.join(dir, 'data'),
        keyFile: path.join(dir, 'key', 'machine.key'),
        host: '127.0.0.1',
        port: held.port,
        origins: [],
        repoRoot: REPO,
        env: { ATELIER_FAKE_LLM: '1', ATELIER_RUNNER: 'off', ATELIER_AUTOMATIONS: 'off', ATELIER_EXAMPLE: '0' }
      })
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(existsSync(path.join(dir, 'data', TOKEN_FILE))).toBe(false)
    expect(existsSync(path.join(dir, 'data', 'atelier.db'))).toBe(false)
  })
})
