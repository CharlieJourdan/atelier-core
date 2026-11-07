// The key vault (§4.5). Provider keys are encrypted with AES-256-GCM (random 96-bit IV, the secret's name as associated
// data, so a ciphertext cannot be moved to another name). The 32-byte master key comes from a KeySource: a 0600 file
// outside the repository (ATELIER_CLOUD_MASTER_KEY_FILE), the macOS Keychain, or one injected by the tests.
// Write-only from the outside: `list` gives names and dates; only `readForAdapter` returns a value, and each read is
// audited. No HTTP route reaches this module's values.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'

/** AES-256-GCM authentication tag length, pinned on both sides. */
const TAG_BYTES = 16

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/

export interface KeySource {
  readonly description: string
  load(): Buffer
}

export interface VaultListing {
  name: string
  createdAt: string
  updatedAt: string
}

export class Vault {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  private readonly source: KeySource | null
  private key: Buffer | null = null
  /** Values seen in this process, so logs and error texts can be masked (never persisted, never returned). */
  private readonly seen = new Set<string>()

  constructor(db: CloudDb, clock: Clock, audit: Audit, source: KeySource | null) {
    this.db = db
    this.clock = clock
    this.audit = audit
    this.source = source
  }

  get available(): boolean {
    return this.source !== null
  }

  set(name: string, value: string, actor: string): void {
    checkName(name)
    if (value.length === 0 || value.length > 8192) throw new CloudError('bad_request', 'a secret value is 1..8192 characters')
    if (/[\r\n]/.test(value)) throw new CloudError('bad_request', 'a secret value is one line')
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    cipher.setAAD(Buffer.from(name, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const now = iso(this.clock.now())
    this.db
      .prepare(
        `INSERT INTO vault_secrets (name, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at`
      )
      .run(name, iv, tag, ciphertext, now, now)
    this.seen.add(value)
    this.audit.record(actor, 'vault.set', name)
  }

  delete(name: string, actor: string): boolean {
    checkName(name)
    const res = this.db.prepare('DELETE FROM vault_secrets WHERE name = ?').run(name)
    if (res.changes > 0) this.audit.record(actor, 'vault.delete', name)
    return res.changes > 0
  }

  has(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM vault_secrets WHERE name = ?').get(name) !== undefined
  }

  list(): VaultListing[] {
    const rows = this.db.prepare('SELECT name, created_at, updated_at FROM vault_secrets ORDER BY name').all() as {
      name: string
      created_at: string
      updated_at: string
    }[]
    return rows.map((r) => ({ name: r.name, createdAt: r.created_at, updatedAt: r.updated_at }))
  }

  /** The only way to a value: a provider adapter about to make a call. Audited (§4.11). */
  readForAdapter(name: string, adapterId: string): string {
    const value = this.decrypt(name)
    this.seen.add(value)
    this.audit.record(`adapter:${adapterId}`, 'vault.read', name)
    return value
  }

  private decrypt(name: string): string {
    checkName(name)
    const row = this.db.prepare('SELECT iv, tag, ciphertext FROM vault_secrets WHERE name = ?').get(name) as
      | { iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }
      | undefined
    if (!row) throw new CloudError('not_found', `no secret ${name}`)
    // A full 16-byte tag only: a truncated tag would weaken the authentication.
    if (row.tag.length !== TAG_BYTES) throw new CloudError('internal', `secret ${name} has a malformed tag`)
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey(), row.iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(name, 'utf8'))
    decipher.setAuthTag(row.tag)
    let value: string
    try {
      value = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8')
    } catch {
      throw new CloudError('internal', `secret ${name} cannot be decrypted with this master key`)
    }
    return value
  }

  /** At start-up (when a master key is set): learn every stored value so logs and errors can mask secrets that were
   *  set by the CLI and not read yet. Values stay in memory only; nothing is returned or audited as an adapter read. */
  primeMask(): number {
    if (!this.source) return 0
    const names = this.list().map((l) => l.name)
    for (const name of names) this.seen.add(this.decrypt(name))
    return names.length
  }

  /** Replaces every secret value this process has handled with •••. */
  mask(text: string): string {
    let out = text
    for (const v of this.seen) if (v.length >= 4) out = out.split(v).join('•••')
    return out
  }

  private masterKey(): Buffer {
    if (this.key) return this.key
    if (!this.source) throw new CloudError('internal', 'no master key: set ATELIER_CLOUD_MASTER_KEY_FILE')
    const key = this.source.load()
    if (key.length !== 32) throw new CloudError('internal', `the master key must be 32 bytes (${this.source.description})`)
    this.key = key
    return key
  }
}

function checkName(name: string): void {
  if (!SECRET_NAME.test(name)) throw new CloudError('bad_request', 'a secret name is UPPER_SNAKE_CASE (2..64 chars)')
}
