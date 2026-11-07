// The vault (§4.5): AES-256-GCM bound to the secret's name, write-only from the outside, audited reads; the master key
// sources with the macOS rules simulated on H1; the no-echo keyboard input; and the CLI never taking a value in argv.
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { fileKeySource, initKeyFile, isInside, keychainKeySource, keySourceFromEnv, parseKey, staticKeySource, type KeyFileEnv } from '../src/keysource.ts'
import { readSecret } from '../src/secret-input.ts'
import { makeCloud } from './helpers.ts'

const SECRET = 'sk-test-ATELIER-0123456789abcdef'

function io(input = '', isTTY = false) {
  const stdin = Object.assign(new PassThrough(), { isTTY }) as PassThrough & { isTTY: boolean; setRawMode?: (m: boolean) => void }
  const out: string[] = []
  const err: string[] = []
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (d) => out.push(String(d)))
  stderr.on('data', (d) => err.push(String(d)))
  if (input) stdin.end(input)
  return { stdin, stdout, stderr, out, err }
}

describe('vault', () => {
  it('stores ciphertext only, decrypts for an adapter with an audit line, and lists names and dates only', () => {
    const t = makeCloud()
    t.cloud.vault.set('ELEVENLABS_API_KEY', SECRET, 'cli')
    const row = t.cloud.db.prepare('SELECT iv, tag, ciphertext FROM vault_secrets').get() as { iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }
    expect(row.iv).toHaveLength(12)
    expect(row.tag).toHaveLength(16)
    expect(Buffer.from(row.ciphertext).toString('utf8')).not.toContain('ATELIER')
    const listing = t.cloud.vault.list()
    expect(listing).toEqual([{ name: 'ELEVENLABS_API_KEY', createdAt: expect.any(String), updatedAt: expect.any(String) }])
    expect(JSON.stringify(listing)).not.toContain(SECRET)
    expect(t.cloud.vault.readForAdapter('ELEVENLABS_API_KEY', 'elevenlabs')).toBe(SECRET)
    const audit = t.cloud.audit.list()
    expect(audit[0]).toMatchObject({ actor: 'adapter:elevenlabs', action: 'vault.read', target: 'ELEVENLABS_API_KEY' })
    expect(audit.some((e) => e.action === 'vault.set')).toBe(true)
    expect(JSON.stringify(audit)).not.toContain(SECRET)
    expect(t.cloud.vault.mask(`call failed with key ${SECRET}`)).toBe('call failed with key •••')
  })

  it('a ciphertext moved to another name, or read with another master key, does not decrypt', () => {
    const t = makeCloud()
    t.cloud.vault.set('A_KEY', SECRET, 'cli')
    t.cloud.vault.set('B_KEY', 'other-value-1234', 'cli')
    t.cloud.db.exec(`UPDATE vault_secrets SET iv = (SELECT iv FROM vault_secrets WHERE name = 'A_KEY'),
      tag = (SELECT tag FROM vault_secrets WHERE name = 'A_KEY'), ciphertext = (SELECT ciphertext FROM vault_secrets WHERE name = 'A_KEY')
      WHERE name = 'B_KEY'`)
    expect(() => t.cloud.vault.readForAdapter('B_KEY', 'x')).toThrow(/cannot be decrypted/)
    const other = makeCloud({ keySource: staticKeySource(Buffer.alloc(32, 9)) })
    const row = t.cloud.db.prepare(`SELECT * FROM vault_secrets WHERE name = 'A_KEY'`).get() as Record<string, unknown>
    other.cloud.db
      .prepare('INSERT INTO vault_secrets (name, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('A_KEY', row.iv as Uint8Array, row.tag as Uint8Array, row.ciphertext as Uint8Array, 'x', 'x')
    expect(() => other.cloud.vault.readForAdapter('A_KEY', 'x')).toThrow(/cannot be decrypted/)
    // A tag cut to 4 bytes (GCM would otherwise accept it) is refused before any decryption.
    t.cloud.db.exec(`UPDATE vault_secrets SET tag = substr(tag, 1, 4) WHERE name = 'A_KEY'`)
    expect(() => t.cloud.vault.readForAdapter('A_KEY', 'x')).toThrow(/malformed tag/)
  })

  it('refuses bad names and values, and closes without a master key', () => {
    const t = makeCloud()
    expect(() => t.cloud.vault.set('lower_case', SECRET, 'cli')).toThrow(/UPPER_SNAKE_CASE/)
    expect(() => t.cloud.vault.set('MULTI_LINE', 'a\nb', 'cli')).toThrow(/one line/)
    const closed = makeCloud({ keySource: null })
    expect(closed.cloud.vault.available).toBe(false)
    expect(() => closed.cloud.vault.set('X_KEY', SECRET, 'cli')).toThrow(/no master key/)
  })
})

describe('master key sources', () => {
  const key = 'ab'.repeat(32)
  const env = (o: Partial<KeyFileEnv>): KeyFileEnv => ({
    platform: 'darwin',
    repoRoot: '/Users/charlie/dev/atelier',
    readFile: () => key + '\n',
    modeOf: () => 0o100600,
    realpath: (p) => p,
    ...o
  })

  it('macOS (simulated): a 0600 file outside the repo is accepted; 0644, a relative path or a file inside the repo is refused', () => {
    expect(fileKeySource('/Users/charlie/.atelier-cloud/master.key', env({})).load()).toEqual(Buffer.from(key, 'hex'))
    expect(fileKeySource('/Users/charlie/.atelier-cloud/master.key', env({ modeOf: () => 0o100400 })).load()).toHaveLength(32)
    expect(() => fileKeySource('/Users/charlie/.atelier-cloud/master.key', env({ modeOf: () => 0o100644 })).load()).toThrow(/0600 \(it is 0644\)/)
    expect(() => fileKeySource('master.key', env({})).load()).toThrow(/absolute/)
    expect(() => fileKeySource('/Users/charlie/dev/atelier/cloud/master.key', env({})).load()).toThrow(/outside the repository/)
    // The macOS file system is case-insensitive: a different case is still inside.
    expect(() => fileKeySource('/users/CHARLIE/dev/Atelier/k', env({})).load()).toThrow(/outside the repository/)
    // A symlink from outside into the repo is resolved first.
    expect(() => fileKeySource('/tmp/k', env({ realpath: () => '/Users/charlie/dev/atelier/k' })).load()).toThrow(/outside/)
  })

  it('Windows: mode bits are not checked, the repo rule still applies', () => {
    const win = env({ platform: 'win32', repoRoot: 'C:\\dev\\atelier', modeOf: () => 0o100666 })
    expect(fileKeySource('C:\\Users\\charlie\\.atelier-cloud\\master.key', win).load()).toHaveLength(32)
    expect(isInside('C:\\dev\\atelier', 'c:\\DEV\\atelier\\x.key', 'win32')).toBe(true)
    expect(isInside('C:\\dev\\atelier', 'C:\\dev\\atelier-other\\x.key', 'win32')).toBe(false)
  })

  it('the Keychain source calls /usr/bin/security with fixed arguments, without a shell', () => {
    const calls: [string, string[]][] = []
    const src = keychainKeySource((file, args) => {
      calls.push([file, args])
      return key + '\n'
    })
    expect(src.load()).toHaveLength(32)
    expect(calls).toEqual([['/usr/bin/security', ['find-generic-password', '-s', 'atelier-cloud', '-a', 'master-key', '-w']]])
    expect(keySourceFromEnv({ ATELIER_CLOUD_KEYCHAIN: '1' }, 'darwin')?.description).toBe('macOS Keychain')
    expect(keySourceFromEnv({ ATELIER_CLOUD_KEYCHAIN: '1' }, 'win32')).toBeNull()
    expect(keySourceFromEnv({}, 'darwin')).toBeNull()
    expect(() => parseKey('too short')).toThrow(/64 hex/)
  })

  it('key init writes 64 hex characters, never over a file, never inside the repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-key-'))
    try {
      const path = join(dir, 'sub', 'master.key')
      initKeyFile(path)
      expect(readFileSync(path, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/)
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(() => initKeyFile(path)).toThrow(/never overwritten/)
      expect(() => initKeyFile(join(process.cwd(), 'master.key'))).toThrow(/outside the repository/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('keyboard input without echo', () => {
  it('raw mode on a terminal: nothing is echoed, backspace edits, Enter ends, raw mode is restored', async () => {
    const { stdin, stdout, out } = io('', true)
    const modes: boolean[] = []
    stdin.setRawMode = (m: boolean) => void modes.push(m)
    const p = readSecret('Valeur : ', stdin, stdout)
    stdin.write('sk-abc')
    stdin.write('X\u007f')
    stdin.write('123\r')
    expect(await p).toBe('sk-abc123')
    expect(modes).toEqual([true, false])
    expect(out.join('')).toBe('Valeur : \n')
  })

  it('Ctrl-C cancels', async () => {
    const { stdin, stdout } = io('', true)
    stdin.setRawMode = () => {}
    const p = readSecret('Valeur : ', stdin, stdout)
    stdin.write('sk\u0003')
    await expect(p).rejects.toThrow('cancelled')
  })

  it('`vault set NAME` reads the value from stdin, prints no value, and refuses a value in argv', async () => {
    const t = makeCloud()
    const a = io(`${SECRET}\n`)
    expect(await runCli(['vault', 'set', 'ELEVENLABS_API_KEY', '--from-stdin'], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    expect(a.out.join('')).toContain('ELEVENLABS_API_KEY stored')
    expect(a.out.join('')).not.toContain(SECRET)
    expect(t.cloud.vault.readForAdapter('ELEVENLABS_API_KEY', 'test')).toBe(SECRET)
    // Not a terminal and no --from-stdin: typing would be echoed (Git Bash on Windows), so it is refused.
    const piped = io(`${SECRET}\n`)
    expect(await runCli(['vault', 'set', 'PIPED_KEY'], { ...piped, env: {}, cloud: t.cloud })).toBe(1)
    expect(piped.err.join('')).toContain('stdin is not a terminal')
    expect(t.cloud.vault.has('PIPED_KEY')).toBe(false)
    const b = io()
    expect(await runCli(['vault', 'set', 'OTHER_KEY', SECRET], { ...b, env: {}, cloud: t.cloud })).toBe(1)
    expect(b.err.join('')).toContain('never passed')
    expect(t.cloud.vault.has('OTHER_KEY')).toBe(false)
    const c = io()
    expect(await runCli(['vault', 'list'], { ...c, env: {}, cloud: t.cloud })).toBe(0)
    expect(c.out.join('')).toMatch(/^ELEVENLABS_API_KEY\tcreated .+\tupdated .+\n$/)
    expect(c.out.join('')).not.toContain(SECRET)
  })
})
