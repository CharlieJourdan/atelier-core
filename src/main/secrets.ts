// Encrypted secrets. The cipher is injected: Electron's safeStorage in the app, a test cipher in unit tests.
// Plain values never touch the database, logs or the renderer.
import type { Db } from './db'

export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Uint8Array
  decrypt(cipher: Uint8Array): string
}

export class SecretsUnavailableError extends Error {
  readonly code = 'SECRETS_UNAVAILABLE'
  constructor() {
    super('OS encryption is not available, so secrets cannot be stored safely on this machine.')
  }
}

export class SecretsStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  set(name: string, value: string): void {
    if (!value) throw new Error('Secret value is empty')
    if (!this.cipher.isAvailable()) throw new SecretsUnavailableError()
    const ciphertext = this.cipher.encrypt(value)
    this.db
      .prepare(
        `INSERT INTO secrets (name, ciphertext, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
      )
      .run(name, ciphertext)
  }

  /** Main-process only. Never send the result to the renderer. */
  get(name: string): string | null {
    const row = this.db.prepare('SELECT ciphertext FROM secrets WHERE name = ?').get(name) as
      | { ciphertext: Uint8Array }
      | undefined
    if (!row) return null
    if (!this.cipher.isAvailable()) throw new SecretsUnavailableError()
    return this.cipher.decrypt(row.ciphertext)
  }

  has(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM secrets WHERE name = ?').get(name) !== undefined
  }

  clear(name: string): void {
    this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name)
  }
}
