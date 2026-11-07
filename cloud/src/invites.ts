// Team invitations: an owner or an admin invites a person by e-mail. The link (single use, 7 days) is e-mailed, never
// answered by the API, and only its SHA-256 is stored (like the e-mail tokens). The invitee either creates an account
// from the link (its address is the invitation's, so it counts as confirmed) or, having one, signs in and accepts; both
// join the team with the invitation's role and sign in to that team from then on (accounts.default_team_id).
// An owner invites admins or members; an admin invites members. Inviting is rate-limited per team (in memory).
import type { Role } from '../../src/shared/cloud-api.ts'
import type { Accounts } from './accounts.ts'
import type { Audit } from './audit.ts'
import type { Auth } from './auth.ts'
import { DAY_MS, HOUR_MS, iso, type Clock } from './clock.ts'
import { tx, type CloudDb } from './db/index.ts'
import { CloudError } from './errors.ts'
import { newId, newSecret, sha256Hex } from './ids.ts'
import { HitLimiter } from './mail/limits.ts'
import type { MailService } from './mail/service.ts'
import type { MailLang } from './mail/templates.ts'

/** The website's page the invitation link opens (web/src/pages/Invitation.tsx). */
export const INVITE_PATH = '/invitation'
export const INVITE_TTL_MS = 7 * DAY_MS
/** At most 20 invitations per team an hour. */
export const INVITE_LIMIT = { windowMs: HOUR_MS, perTeam: 20 }
const BAD_LINK = 'this invitation is invalid, expired or already used'

export type InviteRole = 'admin' | 'member'

export interface InviteView {
  id: string
  email: string
  role: InviteRole
  invitedBy: string
  createdAt: string
  expiresAt: string
}

interface InviteRow {
  id: string
  team_id: string
  email: string
  role: InviteRole
  invited_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export interface InvitesOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  accounts: Accounts
  auth: Auth
  mail: MailService
}

const sameAddress = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export class Invites {
  private readonly o: InvitesOptions
  private readonly perTeam: HitLimiter
  constructor(o: InvitesOptions) {
    this.o = o
    this.perTeam = new HitLimiter(o.clock, INVITE_LIMIT.windowMs, INVITE_LIMIT.perTeam)
  }

  /** The inviter's role in the team; a plain member manages no invitation. */
  private manager(teamId: string, accountId: string): Role {
    const role = this.o.accounts.membership(teamId, accountId).role
    if (role === 'member') throw new CloudError('forbidden', 'only the owner or an admin manages invitations')
    return role
  }

  private view(r: InviteRow): InviteView {
    let invitedBy = ''
    try {
      invitedBy = this.o.accounts.account(r.invited_by).name
    } catch {
      // the inviter's account is gone: the invitation stays readable
    }
    return { id: r.id, email: r.email, role: r.role, invitedBy, createdAt: r.created_at, expiresAt: r.expires_at }
  }

  /** Invites `email` into the team: a new link replaces a pending one for the same address; the e-mail is queued. */
  create(p: { teamId: string; byAccountId: string; email: string; role: InviteRole; lang?: MailLang | undefined }): InviteView {
    const byRole = this.manager(p.teamId, p.byAccountId)
    if (p.role === 'admin' && byRole !== 'owner') throw new CloudError('forbidden', 'only the owner invites an admin')
    const email = p.email.trim()
    if (this.o.accounts.members(p.teamId).some((m) => sameAddress(m.email, email))) {
      throw new CloudError('conflict', 'this person is already a member of the team')
    }
    this.perTeam.hit(`team:${p.teamId}`, 'too many invitations: try again in an hour')
    const now = this.o.clock.now()
    const token = newSecret('inv')
    const id = newId('invite')
    tx(this.o.db, () => {
      this.o.db
        .prepare('UPDATE team_invites SET revoked_at = ? WHERE team_id = ? AND lower(email) = lower(?) AND used_at IS NULL AND revoked_at IS NULL')
        .run(iso(now), p.teamId, email)
      this.o.db
        .prepare('INSERT INTO team_invites (id, team_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, p.teamId, email, p.role, sha256Hex(token), p.byAccountId, iso(now), iso(now + INVITE_TTL_MS))
    })
    this.o.audit.record(p.byAccountId, 'invite.create', id, { team: p.teamId, role: p.role })
    const inviter = this.o.accounts.account(p.byAccountId)
    this.o.mail.deliver({
      to: email,
      lang: p.lang ?? this.o.accounts.langOf(p.byAccountId),
      template: { kind: 'invite', name: '', inviter: inviter.name, team: this.o.accounts.team(p.teamId).name, role: p.role, link: this.o.mail.link(INVITE_PATH, { token }) }
    })
    return this.view(this.row(id))
  }

  private row(id: string): InviteRow {
    const r = this.o.db.prepare('SELECT * FROM team_invites WHERE id = ?').get(id) as InviteRow | undefined
    if (!r) throw new CloudError('not_found', 'no such invitation')
    return r
  }

  /** The team's invitations still waiting (not used, not revoked, not expired), newest first. */
  list(teamId: string, byAccountId: string): InviteView[] {
    this.manager(teamId, byAccountId)
    const rows = this.o.db
      .prepare('SELECT * FROM team_invites WHERE team_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC')
      .all(teamId, iso(this.o.clock.now())) as unknown as InviteRow[]
    return rows.map((r) => this.view(r))
  }

  /** The link stops working. */
  revoke(teamId: string, byAccountId: string, id: string): void {
    this.manager(teamId, byAccountId)
    const res = this.o.db
      .prepare('UPDATE team_invites SET revoked_at = ? WHERE id = ? AND team_id = ? AND used_at IS NULL AND revoked_at IS NULL')
      .run(iso(this.o.clock.now()), id, teamId)
    if (res.changes !== 1) throw new CloudError('not_found', 'no such pending invitation')
    this.o.audit.record(byAccountId, 'invite.revoke', id, { team: teamId })
  }

  /** The invitation behind a link that still works, or a `gone` refusal. */
  private open(token: string): InviteRow {
    if (!token || token.length > 200) throw new CloudError('gone', BAD_LINK)
    const r = this.o.db.prepare('SELECT * FROM team_invites WHERE token_hash = ?').get(sha256Hex(token)) as InviteRow | undefined
    if (!r || r.used_at || r.revoked_at || r.expires_at <= iso(this.o.clock.now())) throw new CloudError('gone', BAD_LINK)
    return r
  }

  /** Spends the link inside the caller's transaction; a second use (even at the same time) is refused. */
  private spend(r: InviteRow, accountId: string | null): void {
    const now = iso(this.o.clock.now())
    const res = this.o.db
      .prepare('UPDATE team_invites SET used_at = ?, accepted_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?')
      .run(now, accountId, r.id, now)
    if (res.changes !== 1) throw new CloudError('gone', BAD_LINK)
  }

  private hasAccount(email: string): string | null {
    const r = this.o.db.prepare('SELECT id FROM accounts WHERE lower(email) = lower(?)').get(email.trim()) as { id: string } | undefined
    return r?.id ?? null
  }

  /** What the invitation page shows (the token is the credential: it was sent to that address). */
  preview(token: string): { teamName: string; email: string; invitedBy: string; role: InviteRole; hasAccount: boolean } {
    const r = this.open(token)
    return { teamName: this.o.accounts.team(r.team_id).name, email: r.email, invitedBy: this.view(r).invitedBy, role: r.role, hasAccount: this.hasAccount(r.email) !== null }
  }

  /** A signed-in account whose address is the invitation's joins the team (already a member: the link is just spent). */
  accept(token: string, accountId: string): { team: { id: string; name: string }; role: InviteRole } {
    const r = this.open(token)
    const account = this.o.accounts.account(accountId)
    if (!sameAddress(account.email, r.email)) throw new CloudError('forbidden', 'this invitation was sent to another e-mail address')
    tx(this.o.db, () => {
      this.spend(r, account.id)
      const member = this.o.db.prepare('SELECT 1 FROM members WHERE team_id = ? AND account_id = ?').get(r.team_id, account.id)
      if (!member) this.o.accounts.addMember(r.team_id, account.id, r.role, account.id)
      this.o.accounts.setDefaultTeam(account.id, r.team_id)
    })
    this.o.audit.record(account.id, 'invite.accept', r.id, { team: r.team_id, role: r.role })
    const team = this.o.accounts.team(r.team_id)
    return { team: { id: team.id, name: team.name }, role: r.role }
  }

  /** No account yet for the address: one is made in the team (confirmed: the link proves the address), then signed in. */
  async signup(p: { token: string; name: string; password: string; lang?: MailLang | undefined }) {
    const r = this.open(p.token)
    if (this.hasAccount(r.email)) throw new CloudError('conflict', 'an account already uses this e-mail address: sign in, then accept')
    const accountId = tx(this.o.db, () => {
      this.spend(r, null)
      const { account } = this.o.accounts.createAccount({
        email: r.email,
        name: p.name,
        password: p.password,
        teamId: r.team_id,
        role: r.role,
        verified: true,
        ...(p.lang ? { lang: p.lang } : {}),
        actor: 'invite'
      })
      this.o.db.prepare('UPDATE team_invites SET accepted_by = ? WHERE id = ?').run(account.id, r.id)
      this.o.accounts.setDefaultTeam(account.id, r.team_id)
      return account.id
    })
    this.o.audit.record(accountId, 'invite.accept', r.id, { team: r.team_id, role: r.role, signup: true })
    return this.o.auth.passwordLogin({ email: r.email, password: p.password, deviceName: 'Site Atelier' })
  }
}
