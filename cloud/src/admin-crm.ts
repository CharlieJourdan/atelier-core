// The founder console's CRM (src/shared/cloud-admin-crm.ts): the accounts with their team, plan, credits, spend over 30
// days, team computers, last activity and verified address; search and pages; one account's detail; and the admin actions.
// Each action is audited: a grant through the wallet (`wallet.grant`, idempotent), the others as `admin.*` here or in
// accounts.ts. Plain SQL reads over the Cloud's tables; nothing here touches the vault.
import type { CrmAccountDetail, CrmAccountRow, CrmListQuery, CrmTeam } from '../../src/shared/cloud-admin-crm.ts'
import type { Cloud } from './cloud.ts'
import { CloudError } from './errors.ts'

const DAY_MS = 86_400_000

interface AccountDbRow {
  id: string
  email: string
  name: string
  platform_admin: number
  email_verified_at: string | null
  disabled_at: string | null
  created_at: string
}

function teamOf(cloud: Cloud, teamId: string, role: CrmTeam['role']): CrmTeam {
  const t = cloud.accounts.team(teamId)
  const sub = cloud.db.prepare('SELECT plan, status FROM billing_subscriptions WHERE team_id = ?').get(teamId) as { plan: string; status: CrmTeam['planStatus'] } | undefined
  const since = new Date(cloud.clock.now() - 30 * DAY_MS).toISOString()
  const spent = cloud.db
    .prepare("SELECT COALESCE(SUM(-delta), 0) AS n FROM wallet_entries WHERE team_id = ? AND kind = 'capture' AND created_at >= ?")
    .get(teamId, since) as { n: number }
  const machines = cloud.db.prepare("SELECT COUNT(*) AS n FROM team_machines WHERE team_id = ? AND status <> 'deleted'").get(teamId) as { n: number }
  const w = cloud.wallet.state(teamId)
  return {
    id: t.id,
    name: t.name,
    internal: t.internal,
    test: t.test,
    role,
    plan: sub?.plan ?? null,
    planStatus: sub?.status ?? null,
    balance: w.balance,
    available: w.available,
    spent30d: Number(spent.n),
    machines: Number(machines.n)
  }
}

function rowOf(cloud: Cloud, r: AccountDbRow): CrmAccountRow {
  const seen = cloud.db
    .prepare('SELECT MAX(last_seen_at) AS at, SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS open FROM devices WHERE account_id = ?')
    .get(r.id) as { at: string | null; open: number | null }
  const member = cloud.db.prepare('SELECT team_id, role FROM members WHERE account_id = ? ORDER BY created_at LIMIT 1').get(r.id) as
    | { team_id: string; role: CrmTeam['role'] }
    | undefined
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    platformAdmin: r.platform_admin === 1,
    emailVerified: r.email_verified_at !== null,
    disabled: r.disabled_at !== null,
    createdAt: r.created_at,
    lastActiveAt: seen.at ?? null,
    activeSessions: Number(seen.open ?? 0),
    team: member ? teamOf(cloud, member.team_id, member.role) : null
  }
}

const SELECT = 'SELECT a.id, a.email, a.name, a.platform_admin, a.email_verified_at, a.disabled_at, a.created_at FROM accounts a'

/** The accounts matching the search, newest first, one page. */
export function crmList(cloud: Cloud, q: CrmListQuery): { accounts: CrmAccountRow[]; total: number; limit: number; offset: number } {
  const where: string[] = []
  const args: string[] = []
  const text = q.q.trim().toLowerCase()
  if (text) {
    // LIKE with escaped wildcards: the search is a plain substring
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(
      `(lower(a.email) LIKE ? ESCAPE '\\' OR lower(a.name) LIKE ? ESCAPE '\\' OR a.id = ? OR EXISTS (SELECT 1 FROM members m JOIN teams t ON t.id = m.team_id WHERE m.account_id = a.id AND (lower(t.name) LIKE ? ESCAPE '\\' OR t.id = ?)))`
    )
    args.push(like, like, text, like, text)
  }
  if (q.status === 'active') where.push('a.disabled_at IS NULL')
  if (q.status === 'disabled') where.push('a.disabled_at IS NOT NULL')
  if (q.status === 'unverified') where.push('a.email_verified_at IS NULL')
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const total = (cloud.db.prepare(`SELECT COUNT(*) AS n FROM accounts a${clause}`).get(...args) as { n: number }).n
  const rows = cloud.db.prepare(`${SELECT}${clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`).all(...args, q.limit, q.offset) as unknown as AccountDbRow[]
  return { accounts: rows.map((r) => rowOf(cloud, r)), total: Number(total), limit: q.limit, offset: q.offset }
}

function dbRow(cloud: Cloud, accountId: string): AccountDbRow {
  const r = cloud.db.prepare(`${SELECT} WHERE a.id = ?`).get(accountId) as AccountDbRow | undefined
  if (!r) throw new CloudError('not_found', 'no such account')
  return r
}

export const crmRow = (cloud: Cloud, accountId: string): CrmAccountRow => rowOf(cloud, dbRow(cloud, accountId))

export function crmDetail(cloud: Cloud, accountId: string): CrmAccountDetail {
  const account = crmRow(cloud, accountId)
  const memberships = cloud.db.prepare('SELECT team_id, role FROM members WHERE account_id = ? ORDER BY created_at').all(accountId) as {
    team_id: string
    role: CrmTeam['role']
  }[]
  const devices = cloud.db
    .prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE account_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(accountId) as { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }[]
  const wallet = account.team
    ? (cloud.db
        .prepare('SELECT id, kind, delta, note, created_at FROM wallet_entries WHERE team_id = ? ORDER BY seq DESC LIMIT 20')
        .all(account.team.id) as { id: string; kind: string; delta: number; note: string | null; created_at: string }[])
    : []
  const audit = cloud.db
    .prepare('SELECT id, at, actor, action, target FROM audit_log WHERE actor = ? OR target = ? OR target IN (SELECT team_id FROM members WHERE account_id = ?) ORDER BY id DESC LIMIT 30')
    .all(accountId, accountId, accountId) as { id: number; at: string; actor: string; action: string; target: string | null }[]
  return {
    account,
    teams: memberships.map((m) => teamOf(cloud, m.team_id, m.role)),
    devices: devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at })),
    wallet: wallet.map((e) => ({ id: e.id, kind: e.kind, credits: e.delta, note: e.note, createdAt: e.created_at })),
    audit: audit.map((a) => ({ id: a.id, at: a.at, actor: a.actor, action: a.action, target: a.target }))
  }
}

/** Credits for the account's team (or another team of the account), through the wallet's idempotent grant. */
export function crmGrant(cloud: Cloud, accountId: string, p: { credits: number; idempotencyKey: string; note: string; teamId?: string | undefined }, actor: string) {
  dbRow(cloud, accountId)
  const teams = cloud.accounts.teamsOf(accountId)
  const teamId = p.teamId ?? teams[0]
  if (!teamId || !teams.includes(teamId)) throw new CloudError('bad_request', 'this account is not a member of that team')
  const m = cloud.wallet.grant({ teamId, credits: p.credits, idemKey: `crm:${p.idempotencyKey}`, note: p.note || `console: ${accountId}`, actor })
  return { teamId, entryId: m.entry.id, replayed: m.replayed, balance: m.state.balance, available: m.state.available }
}

/** Marks the address verified (as its link would). Audited even when it already was, so the log shows who looked. */
export function crmVerifyEmail(cloud: Cloud, accountId: string, actor: string): CrmAccountRow {
  dbRow(cloud, accountId)
  const changed = cloud.accounts.markVerified(accountId)
  cloud.audit.record(actor, 'admin.verify_email', accountId, { changed })
  return crmRow(cloud, accountId)
}

/** Disables (and signs out everywhere) or enables an account. An admin cannot disable their own account. */
export function crmSetDisabled(cloud: Cloud, accountId: string, disabled: boolean, actor: string): CrmAccountRow {
  dbRow(cloud, accountId)
  if (disabled && accountId === actor) throw new CloudError('conflict', 'you cannot disable your own account')
  cloud.accounts.setDisabled(accountId, disabled, actor)
  if (disabled) cloud.auth.revokeAllDevices(accountId)
  return crmRow(cloud, accountId)
}

/** Every device of the account and all their tokens stop working; the person signs in again. */
export function crmRevokeSessions(cloud: Cloud, accountId: string, actor: string): { revoked: number; account: CrmAccountRow } {
  dbRow(cloud, accountId)
  const open = (cloud.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ? AND revoked_at IS NULL').get(accountId) as { n: number }).n
  cloud.auth.revokeAllDevices(accountId)
  cloud.audit.record(actor, 'admin.revoke_sessions', accountId, { devices: Number(open) })
  return { revoked: Number(open), account: crmRow(cloud, accountId) }
}
