// Secrets on the team computer (no Electron safeStorage there): AES-256-GCM with a 32-byte machine key kept in a file
// readable by its owner only (0600, folder 0700), outside any git repository and outside the data folder by default.
// The key is never printed or logged; losing the file makes the stored secrets unreadable (they are typed again).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Cipher } from '../secrets'

const MAGIC = Buffer.from('ATK1')
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

/** Default place of the machine key: ~/.config/atelier-brain/machine.key (XDG_CONFIG_HOME respected). */
export function defaultKeyFile(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config')
  return path.join(base, 'atelier-brain', 'machine.key')
}

/** The nearest folder at or above `p` holding a `.git` entry, or null. */
export function gitRepoAbove(p: string): string | null {
  let dir = path.resolve(p)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

export class MachineKeyError extends Error {
  readonly code = 'MACHINE_KEY'
}

/**
 * Reads the machine key, or creates it (random, 0600) on first start. Refuses a key file inside a git repository (it
 * would end up committed) and, on Linux/macOS, a key file other users can read.
 */
export function loadMachineKey(file: string, platform: NodeJS.Platform = process.platform): Buffer {
  const abs = path.resolve(file)
  const repo = gitRepoAbove(path.dirname(abs))
  if (repo) throw new MachineKeyError(`La clé de la machine ne doit pas être dans un dépôt git (${repo}) : choisis un autre ATELIER_KEY_FILE.`)
  if (!existsSync(abs)) {
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 })
    // 'wx': never overwrite a key that appeared meanwhile.
    writeFileSync(abs, randomBytes(KEY_BYTES).toString('hex') + '\n', { mode: 0o600, flag: 'wx' })
    if (platform !== 'win32') chmodSync(abs, 0o600)
  }
  if (platform !== 'win32' && (statSync(abs).mode & 0o077) !== 0) {
    throw new MachineKeyError(`La clé de la machine (${abs}) est lisible par d’autres comptes : chmod 600 ce fichier.`)
  }
  const hex = readFileSync(abs, 'utf8').trim()
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new MachineKeyError(`La clé de la machine (${abs}) est illisible.`)
  return Buffer.from(hex, 'hex')
}

/** A `Cipher` for SecretsStore: MAGIC | iv (12) | tag (16) | ciphertext. */
export function fileKeyCipher(key: Buffer): Cipher {
  if (key.length !== KEY_BYTES) throw new MachineKeyError('La clé de la machine doit faire 32 octets.')
  return {
    isAvailable: () => true,
    encrypt(plain: string): Uint8Array {
      const iv = randomBytes(IV_BYTES)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return Buffer.concat([MAGIC, iv, c.getAuthTag(), body])
    },
    decrypt(blob: Uint8Array): string {
      const buf = Buffer.from(blob)
      if (buf.length < MAGIC.length + IV_BYTES + TAG_BYTES || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new MachineKeyError('Secret illisible : il a été chiffré ailleurs (retape-le sur cet ordinateur).')
      }
      const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_BYTES)
      const tag = buf.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES)
      const d = createDecipheriv('aes-256-gcm', key, iv)
      d.setAuthTag(tag)
      return Buffer.concat([d.update(buf.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)), d.final()]).toString('utf8')
    }
  }
}
