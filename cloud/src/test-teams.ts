// Test teams (record 0066): our own headless brains run real paid tests without waiting for a person to approve a sign-in.
// `admin test-team create` makes a team marked `test` (internal: at cost, out of the customers' P&L), its credits granted as
// test credits, and ONE member account that has no password (accounts.ts NO_PASSWORD: no browser sign-in, no reset, no
// invitation it could accept). It issues a key for the brains: a long random secret, stored here as its SHA-256 hash, valid a
// year, which a brain exchanges (`POST /v1/auth/test-brain`) for the usual device tokens of that team only. `revoke` kills the
// keys and every device the member has, at once. The key is written to a file the operator names, never printed.
import type { Accounts, Team } from './accounts.ts'
import { NO_PASSWORD } from './accounts.ts'
import type { Audit } from './audit.ts'
import type { Auth, Tokens } from './auth.ts'
import { iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId, newSecret, sha256Hex } from './ids.ts'
import type { Wallet } from './wallet.ts'

export const TEST_KEY_PREFIX = 'attb'
export const TEST_KEY_TTL_DAYS = 365
/** The member's address: a reserved domain (RFC 2606), so no e-mail ever reaches anyone. */
const TEST_DOMAIN = 'tests.atelier.invalid'

interface KeyRow {
  id: string
  team_id: string
  account_id: string
  expires_at: string
  revoked_at: string | null
}

export interface TestTeamCreated {
  team: Team
  accountId: string
  email: string
  keyId: string
  /** The brains' key, shown to the caller once (the CLI writes it to a file); only its hash is kept. */
  key: string
  expiresAt: string
  balance: number
}

export interface TestTeamRow {
  team: Team
  email: string | null
  balance: number
  keys: { id: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null }[]
}

export class TestTeams {
  private readonly o: { db: CloudDb; clock: Clock; audit: Audit; accounts: Accounts; auth: Auth; wallet: Wallet }
  constructor(o: { db: CloudDb; clock: Clock; audit: Audit; accounts: Accounts; auth: Auth; wallet: Wallet }) {
    this.o = o
  }

  /** A test team, its member without a password, `credits` test credits and a brain key. */
  create(p: { name: string; credits: number; actor: string }): TestTeamCreated {
    const name = p.name.trim()
    if (!name || name.length > 100) throw new CloudError('bad_request', 'a team name is 1..100 characters')
    if (!Number.isSafeInteger(p.credits) || p.credits < 0 || p.credits > 1_000_000) throw new CloudError('bad_request', '--credits is a whole number from 0 to 1000000')
    const { db, clock } = this.o
    const now = clock.now()
    const at = iso(now)
    const teamId = newId('team')
    const accountId = newId('acc')
    const email = `${accountId}@${TEST_DOMAIN}`
    const keyId = newId('ttk')
    const key = newSecret(TEST_KEY_PREFIX, 48)
    const expiresAt = iso(now + TEST_KEY_TTL_DAYS * 86_400_000)
    tx(db, () => {
      db.prepare('INSERT INTO teams (id, name, internal, test, created_at) VALUES (?, ?, 1, 1, ?)').run(teamId, name, at)
      db.prepare('INSERT INTO wallets (team_id, balance, held) VALUES (?, 0, 0)').run(teamId)
      db.prepare('INSERT INTO accounts (id, email, name, password_hash, platform_admin, created_at, email_verified_at, lang) VALUES (?, ?, ?, ?, 0, ?, ?, ?)').run(
        accountId,
        email,
        `Cerveau de test (${name})`.slice(0, 100),
        NO_PASSWORD,
        at,
        at,
        'fr'
      )
      db.prepare('INSERT INTO members (team_id, account_id, role, created_at) VALUES (?, ?, ?, ?)').run(teamId, accountId, 'owner', at)
      db.prepare('INSERT INTO test_brain_keys (id, hash, team_id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(keyId, sha256Hex(key), teamId, accountId, at, expiresAt)
    })
    if (p.credits > 0) this.o.wallet.grant({ teamId, credits: p.credits, idemKey: `test-team:${teamId}`, note: 'crédits de test', actor: p.actor })
    this.o.audit.record(p.actor, 'test_team.create', teamId, { accountId, keyId, credits: p.credits })
    return { team: this.o.accounts.team(teamId), accountId, email, keyId, key, expiresAt, balance: this.o.wallet.state(teamId).balance }
  }

  /** A new key for an existing test team (the old ones keep working until revoked). */
  newKey(teamId: string, actor: string): { keyId: string; key: string; expiresAt: string } {
    const team = this.testTeam(teamId)
    const member = this.memberOf(team.id)
    const now = this.o.clock.now()
    const keyId = newId('ttk')
    const key = newSecret(TEST_KEY_PREFIX, 48)
    const expiresAt = iso(now + TEST_KEY_TTL_DAYS * 86_400_000)
    this.o.db.prepare('INSERT INTO test_brain_keys (id, hash, team_id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(keyId, sha256Hex(key), team.id, member, iso(now), expiresAt)
    this.o.audit.record(actor, 'test_team.key', team.id, { keyId })
    return { keyId, key, expiresAt }
  }

  /** Kills every key of the team and every device (and token) of its member, at once. The team and its history stay. */
  revoke(teamId: string, actor: string): { keys: number; devices: number } {
    const team = this.testTeam(teamId)
    const member = this.memberOf(team.id)
    const at = iso(this.o.clock.now())
    const keys = this.o.db.prepare('UPDATE test_brain_keys SET revoked_at = ? WHERE team_id = ? AND revoked_at IS NULL').run(at, team.id).changes
    const devices = this.o.auth.revokeAllDevices(member)
    this.o.audit.record(actor, 'test_team.revoke', team.id, { keys: Number(keys), devices })
    return { keys: Number(keys), devices }
  }

  /** `POST /v1/auth/test-brain`: a valid key → the usual tokens on a new device of the key's team (and only that team). */
  exchange(key: string, deviceName: string): Tokens {
    if (!key.startsWith(`${TEST_KEY_PREFIX}_`) || key.length > 200) throw new CloudError('unauthorized', 'invalid test brain key')
    const row = this.o.db.prepare('SELECT id, team_id, account_id, expires_at, revoked_at FROM test_brain_keys WHERE hash = ?').get(sha256Hex(key)) as KeyRow | undefined
    if (!row || row.revoked_at) throw new CloudError('unauthorized', 'invalid test brain key')
    if (this.o.clock.now() >= Date.parse(row.expires_at)) throw new CloudError('unauthorized', 'this test brain key has expired')
    if (!this.o.accounts.team(row.team_id).test) throw new CloudError('unauthorized', 'invalid test brain key')
    if (this.o.accounts.isDisabled(row.account_id)) throw new CloudError('unauthorized', 'this account is disabled')
    const tokens = this.o.auth.issueForTestBrain(row.account_id, row.team_id, `Cerveau de test — ${deviceName.trim().slice(0, 60) || 'sans nom'}`)
    this.o.db.prepare('UPDATE test_brain_keys SET last_used_at = ? WHERE id = ?').run(iso(this.o.clock.now()), row.id)
    this.o.audit.record(row.account_id, 'auth.test_brain', tokens.deviceId, { keyId: row.id })
    return tokens
  }

  list(): TestTeamRow[] {
    const teams = this.o.accounts.teams().filter((t) => t.test)
    return teams.map((t) => {
      const member = this.o.db.prepare('SELECT a.email FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.team_id = ? ORDER BY m.created_at LIMIT 1').get(t.id) as { email: string } | undefined
      const keys = this.o.db.prepare('SELECT id, created_at, expires_at, last_used_at, revoked_at FROM test_brain_keys WHERE team_id = ? ORDER BY created_at').all(t.id) as {
        id: string
        created_at: string
        expires_at: string
        last_used_at: string | null
        revoked_at: string | null
      }[]
      return {
        team: { id: t.id, name: t.name, internal: t.internal, test: t.test },
        email: member?.email ?? null,
        balance: this.o.wallet.state(t.id).balance,
        keys: keys.map((k) => ({ id: k.id, createdAt: k.created_at, expiresAt: k.expires_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at }))
      }
    })
  }

  private testTeam(teamId: string): Team {
    const team = this.o.accounts.team(teamId)
    if (!team.test) throw new CloudError('bad_request', 'this team is not a test team')
    return team
  }

  private memberOf(teamId: string): string {
    const r = this.o.db.prepare('SELECT account_id FROM members WHERE team_id = ? ORDER BY created_at LIMIT 1').get(teamId) as { account_id: string } | undefined
    if (!r) throw new CloudError('not_found', 'this test team has no member')
    return r.account_id
  }
}
