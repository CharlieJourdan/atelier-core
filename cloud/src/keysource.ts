// Where the vault's master key comes from (§4.5). OS differences are injected (platform, file mode, the Keychain call)
// so the macOS rules are tested on H1 with a simulated darwin.
//  - file: ATELIER_CLOUD_MASTER_KEY_FILE, 64 hex characters; refused inside the repository, and on macOS/Linux
//    refused unless its mode is 0600 (or 0400). On Windows the mode bits mean nothing: keep the file under your own
//    user profile, whose ACL is yours (not checked by the code).
//  - keychain (macOS): `/usr/bin/security find-generic-password -s atelier-cloud -a master-key -w`, no shell.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { KeySource } from './vault.ts'

// Real path, so a key reached through a symlinked folder is still recognised as inside the repository.
export const REPO_ROOT = realpathSync(resolve(fileURLToPath(new URL('../../', import.meta.url))))
export const KEYCHAIN_SERVICE = 'atelier-cloud'
export const KEYCHAIN_ACCOUNT = 'master-key'

export interface KeyFileEnv {
  platform: NodeJS.Platform
  repoRoot: string
  readFile: (path: string) => string
  modeOf: (path: string) => number
  realpath: (path: string) => string
}

export const realKeyFileEnv: KeyFileEnv = {
  platform: process.platform,
  repoRoot: REPO_ROOT,
  readFile: (p) => readFileSync(p, 'utf8'),
  modeOf: (p) => statSync(p).mode,
  realpath: (p) => realpathSync(p)
}

/** Path rules of the target OS (not of the machine running the tests). */
const pathsOf = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

export function isInside(root: string, path: string, platform: NodeJS.Platform): boolean {
  // Windows and macOS file systems ignore case by default.
  const fold = platform === 'win32' || platform === 'darwin'
  const a = fold ? root.toLowerCase() : root
  const b = fold ? path.toLowerCase() : path
  const p = pathsOf(platform)
  const rel = p.relative(a, b)
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))
}

export function parseKey(text: string): Buffer {
  const hex = text.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('the master key file must hold 64 hex characters (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function fileKeySource(path: string, env: KeyFileEnv = realKeyFileEnv): KeySource {
  return {
    description: `file ${path}`,
    load() {
      if (!pathsOf(env.platform).isAbsolute(path)) throw new Error('ATELIER_CLOUD_MASTER_KEY_FILE must be an absolute path')
      const real = env.realpath(path)
      if (isInside(env.repoRoot, real, env.platform)) throw new Error('the master key file must live outside the repository')
      if (env.platform !== 'win32') {
        const perms = env.modeOf(real) & 0o777
        if (perms !== 0o600 && perms !== 0o400) {
          throw new Error(`the master key file must be mode 0600 (it is ${perms.toString(8).padStart(4, '0')})`)
        }
      }
      return parseKey(env.readFile(real))
    }
  }
}

export type ExecFile = (file: string, args: string[]) => string

export function keychainKeySource(exec: ExecFile = (f, a) => execFileSync(f, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })): KeySource {
  return {
    description: 'macOS Keychain',
    load: () => parseKey(exec('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']))
  }
}

export function staticKeySource(key: Buffer): KeySource {
  return { description: 'injected key', load: () => Buffer.from(key) }
}

/** The key source from the environment: the file if ATELIER_CLOUD_MASTER_KEY_FILE is set, else the Keychain on macOS
 *  when ATELIER_CLOUD_KEYCHAIN=1, else none (the vault is then closed; every provider stays in demo). */
export function keySourceFromEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): KeySource | null {
  const file = env.ATELIER_CLOUD_MASTER_KEY_FILE
  if (file) return fileKeySource(file)
  if (platform === 'darwin' && env.ATELIER_CLOUD_KEYCHAIN === '1') return keychainKeySource()
  return null
}

/** `atelier-cloud key init`: writes a new random key, mode 0600, never over an existing file, never inside the repo. */
export function initKeyFile(path: string, platform: NodeJS.Platform = process.platform, repoRoot = REPO_ROOT): void {
  if (!isAbsolute(path)) throw new Error('give an absolute path')
  if (isInside(repoRoot, resolve(path), platform)) throw new Error('the master key file must live outside the repository')
  if (existsSync(path)) throw new Error(`${path} already exists; it is never overwritten`)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' })
}
