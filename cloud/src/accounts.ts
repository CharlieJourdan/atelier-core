// Accounts, teams and members (§4.3): one account = one person; a team = one wallet and its members (owner, admin,
// member), with per-member daily and monthly caps set by the owner or an admin. Passwords are scrypt-hashed.
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Role } from '../../src/shared/cloud-api.ts'
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId } from './ids.ts'

export interface Account {
  id: string
  email: string
  name: string
  platformAdmin: boolean
  /** The address was confirmed through the link of the verification e-mail (or the account was made by an admin). */
  emailVerified: boolean
}

/** Why a payment or a paid job is refused until the address is confirmed (shown as is by the apps and the site). */
export const UNVERIFIED_MESSAGE = 'Vérifie ton adresse e-mail avant de payer ou de lancer un travail payant : un lien de confirmation t’a été envoyé.'

/** Why a disabled account cannot sign in (the founder console disabled it). */
export const DISABLED_MESSAGE = 'Ce compte est désactivé. Écris au support d’Atelier si tu penses que c’est une erreur.'

export interface Team {
  id: string
  name: string
  internal: boolean
  /** A test team (test-teams.ts): its credits are test credits, its only member never signs in with a password. */
  test: boolean
}

export interface Membership {
  team: Team
  role: Role
  dailyCap: number | null
  monthlyCap: number | null
}

const SCRYPT = { N: 16384, r: 8, p: 1 }
/** The password hash of an account that never signs in with a password (a test team's member): no password matches it,
 *  and it cannot be replaced (no reset). */
export const NO_PASSWORD = '!no-password'
export const MIN_PASSWORD = 10

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return Promise.resolve(false)
  const expected = Buffer.from(hash, 'base64url')
  return new Promise((resolve, reject) =>
    scrypt(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT, (err, actual) => (err ? reject(err) : resolve(timingSafeEqual(actual, expected))))
  )
}

/** Compared against when the e-mail is unknown, so both cases cost one scrypt. Computed once. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class Accounts {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly audit: Audit
  constructor(db: CloudDb, clock: Clock, audit: Audit) {
    this.db = db
    this.clock = clock
    this.audit = audit
  }

  /** `atelier-cloud admin user add`: an account and, unless `teamId` is given, its own team where it is owner. */
  createAccount(p: {
    email: string
    name: string
    password: string
    platformAdmin?: boolean
    teamId?: string
    teamName?: string
    internal?: boolean
    role?: Role
    /** The website's sign-up creates unverified accounts; the admin tool's and the tests' are verified (the default). */
    verified?: boolean
    /** The language of the account's e-mails. */
    lang?: 'fr' | 'en'
    actor: string
  }): { account: Account; team: Team } {
    if (!EMAIL.test(p.email) || p.email.length > 200) throw new CloudError('bad_request', 'invalid e-mail address')
    if (!p.name.trim() || p.name.length > 100) throw new CloudError('bad_request', 'a name is 1..100 characters')
    if (p.password.length < MIN_PASSWORD) throw new CloudError('bad_request', `a password has at least ${MIN_PASSWORD} characters`)
    const passwordHash = hashPassword(p.password)
    const result = tx(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(p.email)) {
        throw new CloudError('conflict', 'an account already uses this e-mail address')
      }
      const now = iso(this.clock.now())
      const accountId = newId('acc')
      this.db
        .prepare('INSERT INTO accounts (id, email, name, password_hash, platform_admin, created_at, email_verified_at, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(accountId, p.email.trim(), p.name.trim(), passwordHash, p.platformAdmin ? 1 : 0, now, p.verified === false ? null : now, p.lang ?? 'fr')
      let team: Team
      if (p.teamId) {
        team = this.team(p.teamId)
      } else {
        team = { id: newId('team'), name: p.teamName?.trim() || `Équipe de ${p.name.trim()}`, internal: p.internal ?? false, test: false }
        this.db.prepare('INSERT INTO teams (id, name, internal, created_at) VALUES (?, ?, ?, ?)').run(team.id, team.name, team.internal ? 1 : 0, now)
        this.db.prepare('INSERT INTO wallets (team_id, balance, held) VALUES (?, 0, 0)').run(team.id)
      }
      const role: Role = p.teamId ? (p.role ?? 'member') : 'owner'
      this.db.prepare('INSERT INTO members (team_id, account_id, role, created_at) VALUES (?, ?, ?, ?)').run(team.id, accountId, role, now)
      return { account: this.account(accountId), team }
    })
    this.audit.record(p.actor, 'account.create', result.account.id, { team: result.team.id, platformAdmin: !!p.platformAdmin })
    return result
  }

  /** Checks a password off the event loop (async scrypt); the same error and about the same time for an unknown
   *  e-mail and a wrong password. */
  async authenticate(email: string, password: string): Promise<Account> {
    const row = this.db.prepare('SELECT id, password_hash FROM accounts WHERE email = ?').get(email.trim()) as
      | { id: string; password_hash: string }
      | undefined
    const usable = row !== undefined && row.password_hash !== NO_PASSWORD
    // an account without a password costs the same scrypt as an unknown address, and fails the same way
    const ok = await verifyPassword(password, usable ? row.password_hash : DUMMY_HASH)
    if (!row || !usable || !ok) throw new CloudError('unauthorized', 'wrong e-mail address or password')
    // said only to the person who knows the password, so it tells nothing about who has an account
    if (this.isDisabled(row.id)) throw new CloudError('forbidden', DISABLED_MESSAGE)
    return this.account(row.id)
  }

  account(id: string): Account {
    const r = this.db.prepare('SELECT id, email, name, platform_admin, email_verified_at FROM accounts WHERE id = ?').get(id) as
      | { id: string; email: string; name: string; platform_admin: number; email_verified_at: string | null }
      | undefined
    if (!r) throw new CloudError('not_found', 'no such account')
    return { id: r.id, email: r.email, name: r.name, platformAdmin: r.platform_admin === 1, emailVerified: r.email_verified_at !== null }
  }

  /** The founder console disabled it: no sign-in, no token works (auth.ts checks it on every request). */
  isDisabled(accountId: string): boolean {
    const r = this.db.prepare('SELECT disabled_at FROM accounts WHERE id = ?').get(accountId) as { disabled_at: string | null } | undefined
    return r !== undefined && r.disabled_at !== null
  }

  /** Disables or enables an account (audited). The caller revokes the sessions of a disabled one. False if nothing changed. */
  setDisabled(accountId: string, disabled: boolean, actor: string): boolean {
    this.account(accountId)
    const res = disabled
      ? this.db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL').run(iso(this.clock.now()), accountId)
      : this.db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT NULL').run(accountId)
    if (res.changes !== 1) return false
    this.audit.record(actor, disabled ? 'admin.account_disable' : 'admin.account_enable', accountId)
    return true
  }

  /** Paying and starting paid work need a confirmed address. */
  requireVerified(accountId: string): void {
    if (!this.account(accountId).emailVerified) throw new CloudError('forbidden', UNVERIFIED_MESSAGE)
  }

  /** The address was confirmed (a verification link, or a password reset, which proves the same thing). False if it already was. */
  markVerified(accountId: string): boolean {
    const res = this.db.prepare('UPDATE accounts SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').run(iso(this.clock.now()), accountId)
    return res.changes === 1
  }

  /** The language an account's e-mails are written in. */
  langOf(accountId: string): 'fr' | 'en' {
    const r = this.db.prepare('SELECT lang FROM accounts WHERE id = ?').get(accountId) as { lang: string } | undefined
    return r?.lang === 'en' ? 'en' : 'fr'
  }

  /** The people who pay for a team and are told about it: its owners and admins. */
  billingContacts(teamId: string): Account[] {
    const rows = this.db.prepare("SELECT account_id FROM members WHERE team_id = ? AND role IN ('owner', 'admin') ORDER BY created_at").all(teamId) as { account_id: string }[]
    return rows.map((r) => this.account(r.account_id))
  }

  /** The teams an account is a member of. */
  teamsOf(accountId: string): string[] {
    return (this.db.prepare('SELECT team_id FROM members WHERE account_id = ? ORDER BY created_at').all(accountId) as { team_id: string }[]).map((r) => r.team_id)
  }

  /** A new password (already checked by the caller for length). The caller revokes the sessions. */
  setPassword(accountId: string, password: string): void {
    if (password.length < MIN_PASSWORD) throw new CloudError('bad_request', `a password has at least ${MIN_PASSWORD} characters`)
    if (this.hasNoPassword(accountId)) throw new CloudError('forbidden', 'this account never signs in with a password')
    const res = this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(password), accountId)
    if (res.changes !== 1) throw new CloudError('not_found', 'no such account')
  }

  /** A test team's member: no password, never one (setPassword refuses). */
  hasNoPassword(accountId: string): boolean {
    const r = this.db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId) as { password_hash: string } | undefined
    return r?.password_hash === NO_PASSWORD
  }

  accountByEmail(email: string): Account | null {
    const r = this.db.prepare('SELECT id FROM accounts WHERE email = ?').get(email.trim()) as { id: string } | undefined
    return r ? this.account(r.id) : null
  }

  team(id: string): Team {
    const r = this.db.prepare('SELECT id, name, internal, test FROM teams WHERE id = ?').get(id) as
      | { id: string; name: string; internal: number; test: number }
      | undefined
    if (!r) throw new CloudError('not_found', 'no such team')
    return { id: r.id, name: r.name, internal: r.internal === 1, test: r.test === 1 }
  }

  teams(): (Team & { members: number })[] {
    const rows = this.db
      .prepare('SELECT t.id, t.name, t.internal, t.test, (SELECT COUNT(*) FROM members m WHERE m.team_id = t.id) AS n FROM teams t ORDER BY t.created_at')
      .all() as { id: string; name: string; internal: number; test: number; n: number }[]
    return rows.map((r) => ({ id: r.id, name: r.name, internal: r.internal === 1, test: r.test === 1, members: r.n }))
  }

  /** The team an account signs in to (one team per login in v2): the team it joined by invitation while it is still a
   *  member there, else its oldest membership. */
  primaryTeam(accountId: string): string {
    const chosen = this.db
      .prepare('SELECT m.team_id FROM accounts a JOIN members m ON m.team_id = a.default_team_id AND m.account_id = a.id WHERE a.id = ?')
      .get(accountId) as { team_id: string } | undefined
    if (chosen) return chosen.team_id
    const r = this.db.prepare('SELECT team_id FROM members WHERE account_id = ? ORDER BY created_at LIMIT 1').get(accountId) as
      | { team_id: string }
      | undefined
    if (!r) throw new CloudError('forbidden', 'this account belongs to no team')
    return r.team_id
  }

  membership(teamId: string, accountId: string): Membership {
    const r = this.db.prepare('SELECT role, daily_cap, monthly_cap FROM members WHERE team_id = ? AND account_id = ?').get(teamId, accountId) as
      | { role: Role; daily_cap: number | null; monthly_cap: number | null }
      | undefined
    if (!r) throw new CloudError('forbidden', 'not a member of this team')
    return { team: this.team(teamId), role: r.role, dailyCap: r.daily_cap, monthlyCap: r.monthly_cap }
  }

  members(teamId: string): (Account & { role: Role; dailyCap: number | null; monthlyCap: number | null })[] {
    const rows = this.db
      .prepare('SELECT account_id, role, daily_cap, monthly_cap FROM members WHERE team_id = ? ORDER BY created_at')
      .all(teamId) as { account_id: string; role: Role; daily_cap: number | null; monthly_cap: number | null }[]
    return rows.map((r) => ({ ...this.account(r.account_id), role: r.role, dailyCap: r.daily_cap, monthlyCap: r.monthly_cap }))
  }

  /** The team the account signs in to from now on (it must be a member there: primaryTeam checks). */
  setDefaultTeam(accountId: string, teamId: string): void {
    this.db.prepare('UPDATE accounts SET default_team_id = ? WHERE id = ?').run(teamId, accountId)
  }

  addMember(teamId: string, accountId: string, role: Role, actor: string): void {
    this.team(teamId)
    this.account(accountId)
    this.db
      .prepare('INSERT INTO members (team_id, account_id, role, created_at) VALUES (?, ?, ?, ?)')
      .run(teamId, accountId, role, iso(this.clock.now()))
    this.audit.record(actor, 'member.add', accountId, { team: teamId, role })
  }

  /** Caps are set by the owner (§4.3). An admin may set the caps of plain members only: never their own, another
   *  admin's or the owner's. */
  setCaps(p: { teamId: string; byAccountId: string; accountId: string; dailyCap: number | null; monthlyCap: number | null }): void {
    const by = this.membership(p.teamId, p.byAccountId)
    if (by.role === 'member') throw new CloudError('forbidden', 'only the owner or an admin sets caps')
    const target = this.membership(p.teamId, p.accountId)
    if (by.role !== 'owner' && (target.role !== 'member' || p.accountId === p.byAccountId)) {
      throw new CloudError('forbidden', "an admin sets plain members' caps only")
    }
    for (const cap of [p.dailyCap, p.monthlyCap]) {
      if (cap !== null && (!Number.isSafeInteger(cap) || cap < 0)) throw new CloudError('bad_request', 'a cap is a whole number ≥ 0, or null')
    }
    this.db
      .prepare('UPDATE members SET daily_cap = ?, monthly_cap = ? WHERE team_id = ? AND account_id = ?')
      .run(p.dailyCap, p.monthlyCap, p.teamId, p.accountId)
    this.audit.record(p.byAccountId, 'member.caps', p.accountId, { team: p.teamId, daily: p.dailyCap, monthly: p.monthlyCap })
  }
}
