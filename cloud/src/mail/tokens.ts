// Single-use links for e-mail verification (24 h) and password reset (1 h). Like the sign-in tokens, only the SHA-256 of a
// token is stored: the database alone cannot build a link. A token works once (the `used_at` write is conditional, so two
// requests at once cannot both succeed) and issuing a new one retires the unused ones of the same kind for that account.
import { iso, DAY_MS, HOUR_MS, type Clock } from '../clock.ts'
import type { CloudDb } from '../db/index.ts'
import { newSecret, sha256Hex } from '../ids.ts'

export type EmailTokenKind = 'verify' | 'reset'

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenKind, number> = { verify: DAY_MS, reset: HOUR_MS }
const PREFIX: Record<EmailTokenKind, string> = { verify: 'ver', reset: 'rst' }
/** Used or expired tokens are kept this long (support can see what happened), then deleted. */
const KEEP_MS = 7 * DAY_MS

export class EmailTokens {
  private readonly db: CloudDb
  private readonly clock: Clock
  constructor(db: CloudDb, clock: Clock) {
    this.db = db
    this.clock = clock
  }

  /** A new token for the account; the one issued before (same kind) stops working. Only the hash is stored. */
  issue(accountId: string, kind: EmailTokenKind): string {
    const now = this.clock.now()
    const raw = newSecret(PREFIX[kind])
    this.db.prepare('UPDATE email_tokens SET used_at = ? WHERE account_id = ? AND kind = ? AND used_at IS NULL').run(iso(now), accountId, kind)
    this.db.prepare('DELETE FROM email_tokens WHERE expires_at < ?').run(iso(now - KEEP_MS))
    this.db
      .prepare('INSERT INTO email_tokens (hash, kind, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256Hex(raw), kind, accountId, iso(now), iso(now + EMAIL_TOKEN_TTL_MS[kind]))
    return raw
  }

  /** The account a valid, unused, unexpired token belongs to, and the token is spent; null for anything else. */
  consume(raw: string, kind: EmailTokenKind): string | null {
    if (!raw || raw.length > 200) return null
    const hash = sha256Hex(raw)
    const row = this.db.prepare('SELECT account_id FROM email_tokens WHERE hash = ? AND kind = ?').get(hash, kind) as { account_id: string } | undefined
    if (!row) return null
    const now = iso(this.clock.now())
    const res = this.db.prepare('UPDATE email_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?').run(now, hash, now)
    return res.changes === 1 ? row.account_id : null
  }
}
