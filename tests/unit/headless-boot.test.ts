// The headless brain boots the app's core in plain Node with no `electron` module anywhere on its path: a child Node
// (the same loader as `npm run brain:headless`) gets an extra resolve hook that fails any import of `electron` (or a
// subpath / @electron/*), boots the host, answers one RPC, and reports the CommonJS cache. Plus the machine-key cipher.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fileKeyCipher, loadMachineKey } from '../../src/main/headless/cipher'
import { SecretsStore } from '../../src/main/secrets'
import { openDatabase } from '../../src/main/db'
import { REPO, tempDir } from './headless-helpers'

const HOOK = `
import { register, createRequire } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(\`
export async function resolve(specifier, context, next) {
  if (/^(?:electron(?:\\\\/.*)?|@electron\\\\/.*)$/.test(specifier)) throw new Error('ELECTRON_IMPORTED ' + specifier + ' from ' + context.parentURL)
  return next(specifier, context)
}\`))
`
const CHILD = HOOK + `
const dir = process.env.ATB_DIR
const { startHeadless } = await import(process.env.ATB_HOST)
const brain = await startHeadless({ dataDir: dir + '/data', keyFile: dir + '/key/machine.key', host: '127.0.0.1', port: 0, origins: [],
  repoRoot: process.env.ATB_REPO, env: { ATELIER_FAKE_LLM: '1', ATELIER_RUNNER: 'off', ATELIER_AUTOMATIONS: 'off', ATELIER_EXAMPLE: '1' } })
const res = await fetch(brain.url + '/rpc', { method: 'POST', headers: { authorization: 'Bearer ' + brain.newToken }, body: JSON.stringify({ method: 'channels.list', args: [] }) })
const body = await res.json()
const cache = Object.keys(createRequire(import.meta.url).cache)
await brain.close()
process.stdout.write('RESULT ' + JSON.stringify({ electronVersion: process.versions.electron ?? null, channels: body.value.length,
  electronInCache: cache.filter((k) => /[\\\\/]node_modules[\\\\/](electron|@electron)[\\\\/]/.test(k)) }) + '\\n')
`

function runChild(code: string, env: Record<string, string> = {}): string {
  return execFileSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(path.join(REPO, 'scripts', 'ts-transpile.mjs')).href, '--input-type=module', '-e', code],
    { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

describe('headless boot', () => {
  it('the guard works: importing the Electron cipher fails in the child', () => {
    const target = pathToFileURL(path.join(REPO, 'src', 'main', 'electron', 'cipher.ts')).href
    let failure = ''
    try {
      runChild(HOOK + `await import(${JSON.stringify(target)})`)
    } catch (err) {
      failure = String((err as { stderr?: string }).stderr ?? err)
    }
    expect(failure).toMatch(/ELECTRON_IMPORTED electron/)
  }, 60_000)

  it('boots the core and the remote API with no electron module loaded', () => {
    const dir = tempDir('atb-boot-')
    let out: string
    try {
      out = runChild(CHILD, { ATB_DIR: dir, ATB_REPO: REPO, ATB_HOST: pathToFileURL(path.join(REPO, 'src', 'main', 'headless', 'host.ts')).href })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const line = out.split('\n').find((l) => l.startsWith('RESULT '))
    expect(line, out).toBeTruthy()
    const result = JSON.parse((line as string).slice('RESULT '.length)) as { electronVersion: string | null; channels: number; electronInCache: string[] }
    expect(result.electronVersion).toBeNull()
    expect(result.electronInCache).toEqual([])
    // the example workspace is loaded on first start when asked (ATELIER_EXAMPLE=1, as in the app; without it the brain starts empty)
    expect(result.channels).toBeGreaterThan(0)
  }, 120_000)
})

describe('machine-key cipher', () => {
  it('encrypts secrets with the machine key; the database never holds the plain value', () => {
    const dir = tempDir('atb-key-')
    const keyFile = path.join(dir, 'k', 'machine.key')
    const key = loadMachineKey(keyFile)
    expect(loadMachineKey(keyFile).equals(key)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(keyFile).mode & 0o777).toBe(0o600)
    const db = openDatabase(':memory:')
    const secrets = new SecretsStore(db, fileKeyCipher(key))
    secrets.set('anthropic.apiKey', 'sk-ant-PLAIN-VALUE')
    const raw = (db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Uint8Array }).ciphertext
    expect(Buffer.from(raw).toString('latin1')).not.toContain('PLAIN-VALUE')
    expect(secrets.get('anthropic.apiKey')).toBe('sk-ant-PLAIN-VALUE')
    // another machine's key cannot read it
    const other = new SecretsStore(db, fileKeyCipher(Buffer.alloc(32, 7)))
    expect(() => other.get('anthropic.apiKey')).toThrow()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a key file inside a git repository or readable by others', () => {
    expect(() => loadMachineKey(path.join(REPO, 'tmp-machine.key'))).toThrow(/dépôt git/)
    const dir = tempDir('atb-key2-')
    mkdirSync(path.join(dir, '.git'))
    expect(() => loadMachineKey(path.join(dir, 'sub', 'machine.key'))).toThrow(/dépôt git/)
    rmSync(dir, { recursive: true, force: true })
    if (process.platform !== 'win32') {
      const looseDir = tempDir('atb-key3-')
      const loose = path.join(looseDir, 'machine.key')
      writeFileSync(loose, 'ab'.repeat(32), { mode: 0o644 })
      expect(() => loadMachineKey(loose)).toThrow(/chmod 600/)
      rmSync(looseDir, { recursive: true, force: true })
    }
    expect(() => readFileSync(path.join(REPO, 'tmp-machine.key'))).toThrow()
  })
})
