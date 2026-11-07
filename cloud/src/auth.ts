// App sign-in (§4.3): a device login approved in the browser, bound by PKCE S256 (RFC 7636) so a stolen device code is
// useless without the verifier that only the app holds. Tokens are opaque random strings stored as SHA-256 hashes:
// access 1 h, refresh 30 days, rotated on every use; a refresh token used twice revokes its device (theft signal).
// Each device can be revoked, which kills all of its tokens.
import { randomInt, timingSafeEqual } from 'node:crypto'
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, pkceChallenge } from '../../src/shared/cloud-api.ts'
import type { Account, Accounts } from './accounts.ts'
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId, newSecret, sha256Bytes, sha256Hex } from './ids.ts'

export const DEVICE_LOGIN_TTL_S = 600
export const DEVICE_POLL_INTERVAL_S = 5
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MS = 15 * 60_000
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789'

export interface Session {
  account: Account
  teamId: string
  deviceId: string
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
  deviceId: string
}

interface LoginRow {
  device_code_hash: string
  user_code: string
  code_challenge: string
  device_name: string
  account_id: string | null
  team_id: string | null
  approved_at: string | null
  consumed_at: string | null
  failed_attempts: number
  created_at: string
  expires_at: string
}

interface TokenRow {
  hash: string
  kind: 'access' | 'refresh'
  device_id: string
  account_id: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function newUserCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

export const normaliseUserCode = (code: string): string => {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

export class Auth {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  private readonly accounts: Accounts
  /** Wrong-password times per e-mail address (in memory: a restart forgets them). */
  private readonly failures = new Map<string, number[]>()
  constructor(db: CloudDb, clock: Clock, audit: Audit, accounts: Accounts) {
    this.db = db
    this.clock = clock
    this.audit = audit
    this.accounts = accounts
  }

  startDevice(p: { codeChallenge: string; deviceName: string; baseUrl: string }) {
    const deviceCode = newSecret('atd')
    const userCode = newUserCode()
    const now = this.clock.now()
    this.db
      .prepare(
        `INSERT INTO device_logins (device_code_hash, user_code, code_challenge, device_name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sha256Hex(deviceCode), userCode, p.codeChallenge, p.deviceName, iso(now), iso(now + DEVICE_LOGIN_TTL_S * 1000))
    return {
      deviceCode,
      userCode,
      verificationUri: `${p.baseUrl}/device?code=${encodeURIComponent(userCode)}`,
      expiresIn: DEVICE_LOGIN_TTL_S,
      interval: DEVICE_POLL_INTERVAL_S
    }
  }

  /** What the approval page shows about a pending login (device name and when it was asked), or null. */
  pendingLogin(userCode: string): { deviceName: string; createdAt: string } | null {
    const login = this.openLogin(userCode)
    return login && !login.approved_at ? { deviceName: login.device_name, createdAt: login.created_at } : null
  }

  /** The browser step: a person signs in and approves the login shown by the app (same user code on both screens).
   *  Wrong passwords count on the login (5 kill it) and on the e-mail address (5 in 15 min lock it for 15 min,
   *  whatever login they come through); each failure is audited. */
  async approve(p: { userCode: string; email: string; password: string }): Promise<void> {
    const login = this.openLogin(p.userCode)
    if (!login) throw new CloudError('gone', 'this code is unknown or expired')
    if (login.approved_at) throw new CloudError('conflict', 'this code is already approved')
    const key = p.email.trim().toLowerCase()
    this.beginAttempt(key)
    let account: Account
    try {
      account = await this.accounts.authenticate(p.email, p.password)
    } catch (err) {
      this.db.prepare('UPDATE device_logins SET failed_attempts = failed_attempts + 1 WHERE device_code_hash = ?').run(login.device_code_hash)
      this.audit.record('anonymous', 'auth.login_failed', key.slice(0, 200))
      throw err
    }
    this.endAttempt(key)
    const teamId = this.accounts.primaryTeam(account.id)
    // Re-read after the await: another request may have used or approved this login meanwhile.
    const res = this.db
      .prepare(
        `UPDATE device_logins SET account_id = ?, team_id = ?, approved_at = ?
         WHERE device_code_hash = ? AND approved_at IS NULL AND consumed_at IS NULL`
      )
      .run(account.id, teamId, iso(this.clock.now()), login.device_code_hash)
    if (res.changes !== 1) throw new CloudError('conflict', 'this code is already approved')
  }

  /** The website's sign-in: e-mail + password straight to tokens, for a device named after the browser. Same lockout as
   *  the device flow's browser step (5 wrong passwords in 15 min lock the address). */
  async passwordLogin(p: { email: string; password: string; deviceName: string }): Promise<Tokens> {
    const key = p.email.trim().toLowerCase()
    this.beginAttempt(key)
    let account: Account
    try {
      account = await this.accounts.authenticate(p.email, p.password)
    } catch (err) {
      this.audit.record('anonymous', 'auth.login_failed', key.slice(0, 200))
      throw err
    }
    this.endAttempt(key)
    const teamId = this.accounts.primaryTeam(account.id)
    const at = iso(this.clock.now())
    const deviceId = newId('dev')
    const tokens = tx(this.db, () => {
      this.db.prepare('INSERT INTO devices (id, account_id, team_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(deviceId, account.id, teamId, p.deviceName.slice(0, 100), at, at)
      return this.issue(deviceId, account.id)
    })
    this.audit.record(account.id, 'auth.login', deviceId)
    return tokens
  }

  /**
   * A device with tokens for an account, without its password: for the local admin tool (`admin token`), which already
   * has the whole data folder. Only the access token is meant to be shown (valid one hour); the device is named so it
   * can be revoked from the audit log.
   */
  issueForCli(accountId: string, deviceName: string): Tokens {
    const teamId = this.accounts.primaryTeam(accountId)
    const at = iso(this.clock.now())
    const deviceId = newId('dev')
    const tokens = tx(this.db, () => {
      this.db.prepare('INSERT INTO devices (id, account_id, team_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(deviceId, accountId, teamId, deviceName.slice(0, 100), at, at)
      return this.issue(deviceId, accountId)
    })
    this.audit.record('cli', 'auth.cli_token', deviceId, { accountId })
    return tokens
  }

  /**
   * A device with tokens for a test team's member (test-teams.ts exchanges a test brain's key for them): bound to the key's
   * team, named so the console and `admin test-team revoke` find it. The usual tokens: access 1 h, refresh rotated.
   */
  issueForTestBrain(accountId: string, teamId: string, deviceName: string): Tokens {
    const at = iso(this.clock.now())
    const deviceId = newId('dev')
    return tx(this.db, () => {
      this.db.prepare('INSERT INTO devices (id, account_id, team_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(deviceId, accountId, teamId, deviceName.slice(0, 100), at, at)
      return this.issue(deviceId, accountId)
    })
  }

  /**
   * Counts a password attempt BEFORE checking it: requests sent at once all see the attempts of the others, so the
   * lockout (5 in 15 min) cannot be raced. A right password clears the count. The map is pruned so it stays bounded.
   */
  private beginAttempt(key: string): void {
    const now = this.clock.now()
    if (this.failures.size > 10_000) for (const [k, ts] of this.failures) if (ts.every((t) => now - t >= LOCKOUT_MS)) this.failures.delete(k)
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < LOCKOUT_MS)
    if (recent.length >= MAX_FAILED_ATTEMPTS) throw new CloudError('rate_limited', 'too many wrong passwords: try again in 15 minutes')
    this.failures.set(key, [...recent, now])
  }

  /** A right password clears the address's count, as before. */
  private endAttempt(key: string): void {
    this.failures.delete(key)
  }

  private openLogin(userCode: string): LoginRow | null {
    const login = this.db.prepare('SELECT * FROM device_logins WHERE user_code = ?').get(normaliseUserCode(userCode)) as LoginRow | undefined
    if (!login || login.consumed_at || this.expired(login.expires_at) || login.failed_attempts >= MAX_FAILED_ATTEMPTS) return null
    return login
  }

  /** The app polls with its device code and the PKCE verifier; once approved this answers the tokens exactly once. */
  poll(p: { deviceCode: string; codeVerifier: string }): Tokens {
    const result = tx(this.db, () => {
      const login = this.db.prepare('SELECT * FROM device_logins WHERE device_code_hash = ?').get(sha256Hex(p.deviceCode)) as
        | LoginRow
        | undefined
      if (!login) throw new CloudError('unauthorized', 'unknown device code')
      if (login.consumed_at || this.expired(login.expires_at) || login.failed_attempts >= MAX_FAILED_ATTEMPTS) {
        throw new CloudError('gone', 'this login is expired or already used')
      }
      if (!sameText(pkceChallenge(p.codeVerifier, sha256Bytes), login.code_challenge)) {
        this.db.prepare('UPDATE device_logins SET failed_attempts = failed_attempts + 1 WHERE device_code_hash = ?').run(login.device_code_hash)
        return { error: new CloudError('unauthorized', 'the code verifier does not match') }
      }
      if (!login.approved_at || !login.account_id || !login.team_id) {
        throw new CloudError('authorization_pending', 'waiting for the approval in the browser')
      }
      const now = iso(this.clock.now())
      this.db.prepare('UPDATE device_logins SET consumed_at = ? WHERE device_code_hash = ?').run(now, login.device_code_hash)
      const deviceId = newId('dev')
      this.db
        .prepare('INSERT INTO devices (id, account_id, team_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(deviceId, login.account_id, login.team_id, login.device_name, now, now)
      return { tokens: this.issue(deviceId, login.account_id), accountId: login.account_id }
    })
    // The failed-attempt counter must survive, so the refusal is thrown after the commit.
    if ('error' in result) throw result.error
    this.audit.record(result.accountId, 'auth.login', result.tokens.deviceId)
    return result.tokens
  }

  refresh(refreshToken: string): Tokens {
    const outcome = tx(this.db, () => {
      const row = this.token(refreshToken, 'refresh')
      if (!row) return { error: new CloudError('unauthorized', 'unknown refresh token') }
      // A revoked (logged-out) token is merely refused; a token used twice is a theft signal.
      if (row.revoked_at && !row.used_at) return { error: new CloudError('unauthorized', 'this device is revoked') }
      if (row.used_at) {
        this.revokeDeviceRows(row.device_id)
        return { error: new CloudError('unauthorized', 'refresh token already used: device revoked'), reuse: row }
      }
      if (this.expired(row.expires_at)) return { error: new CloudError('token_expired', 'the refresh token has expired') }
      if (this.deviceRevoked(row.device_id)) return { error: new CloudError('unauthorized', 'this device is revoked') }
      if (this.accounts.isDisabled(row.account_id)) return { error: new CloudError('unauthorized', 'this account is disabled') }
      this.db.prepare('UPDATE tokens SET used_at = ? WHERE hash = ?').run(iso(this.clock.now()), row.hash)
      return { tokens: this.issue(row.device_id, row.account_id) }
    })
    if ('error' in outcome) {
      if (outcome.reuse) this.audit.record(outcome.reuse.account_id, 'auth.refresh_reuse', outcome.reuse.device_id)
      throw outcome.error
    }
    return outcome.tokens
  }

  /** Checks an access token: unknown → unauthorized, expired → token_expired, revoked device → unauthorized. */
  session(accessToken: string): Session {
    const row = this.token(accessToken, 'access')
    if (!row || row.revoked_at) throw new CloudError('unauthorized', 'invalid access token')
    if (this.expired(row.expires_at)) throw new CloudError('token_expired', 'the access token has expired')
    const device = this.db.prepare('SELECT team_id, revoked_at, last_seen_at FROM devices WHERE id = ?').get(row.device_id) as
      | { team_id: string; revoked_at: string | null; last_seen_at: string | null }
      | undefined
    if (!device || device.revoked_at) throw new CloudError('unauthorized', 'this device is revoked')
    if (this.accounts.isDisabled(row.account_id)) throw new CloudError('unauthorized', 'this account is disabled')
    const now = this.clock.now()
    if (!device.last_seen_at || now - Date.parse(device.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(iso(now), row.device_id)
    }
    return { account: this.accounts.account(row.account_id), teamId: device.team_id, deviceId: row.device_id }
  }

  logout(session: Session): void {
    this.revokeDeviceRows(session.deviceId)
    this.audit.record(session.account.id, 'auth.logout', session.deviceId)
  }

  /** A password reset: every device of the account and all their tokens stop working (the person signs in again). */
  revokeAllDevices(accountId: string): number {
    const now = iso(this.clock.now())
    const res = this.db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?').run(now, accountId)
    this.db.prepare('UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?').run(now, accountId)
    // a browser approval given before the reset must not turn into a new device afterwards
    this.db.prepare('UPDATE device_logins SET consumed_at = ? WHERE account_id = ? AND consumed_at IS NULL').run(now, accountId)
    return Number(res.changes)
  }

  /** Forgets the wrong-password count of an address (after a reset, so the person can sign in at once). */
  clearFailures(email: string): void {
    this.failures.delete(email.trim().toLowerCase())
  }

  devices(accountId: string, currentDeviceId: string | null) {
    const rows = this.db
      .prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE account_id = ? ORDER BY created_at')
      .all(accountId) as { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      revokedAt: r.revoked_at,
      current: r.id === currentDeviceId
    }))
  }

  /** A person revokes one of their own devices (or a platform admin any device, from the CLI). */
  revokeDevice(deviceId: string, by: { accountId: string; platformAdmin: boolean }): void {
    const d = this.db.prepare('SELECT account_id FROM devices WHERE id = ?').get(deviceId) as { account_id: string } | undefined
    if (!d || (d.account_id !== by.accountId && !by.platformAdmin)) throw new CloudError('not_found', 'no such device')
    this.revokeDeviceRows(deviceId)
    this.audit.record(by.accountId, 'device.revoke', deviceId)
  }

  private issue(deviceId: string, accountId: string): Tokens {
    const now = this.clock.now()
    const accessToken = newSecret('atk')
    const refreshToken = newSecret('atr')
    const insert = this.db.prepare(
      'INSERT INTO tokens (hash, kind, device_id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(sha256Hex(accessToken), 'access', deviceId, accountId, iso(now), iso(now + ACCESS_TOKEN_TTL_S * 1000))
    insert.run(sha256Hex(refreshToken), 'refresh', deviceId, accountId, iso(now), iso(now + REFRESH_TOKEN_TTL_S * 1000))
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, refreshExpiresIn: REFRESH_TOKEN_TTL_S, deviceId }
  }

  private token(value: string, kind: TokenRow['kind']): TokenRow | null {
    if (!value || value.length > 200) return null
    const row = this.db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha256Hex(value)) as TokenRow | undefined
    return row && row.kind === kind ? row : null
  }

  private revokeDeviceRows(deviceId: string): void {
    const now = iso(this.clock.now())
    this.db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(now, deviceId)
    this.db.prepare('UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?').run(now, deviceId)
  }

  private deviceRevoked(deviceId: string): boolean {
    const d = this.db.prepare('SELECT revoked_at FROM devices WHERE id = ?').get(deviceId) as { revoked_at: string | null } | undefined
    return !d || d.revoked_at !== null
  }

  private expired(expiresAt: string): boolean {
    return this.clock.now() >= Date.parse(expiresAt)
  }
}
