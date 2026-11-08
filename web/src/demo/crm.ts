// Demo fixtures of the founder console's « Utilisateurs et CRM »: invented accounts and teams (example.com addresses
// only), the list with its search / status filter / pages, each account's detail and the actions, all in memory.
import type { CrmAccount, CrmDetail, CrmPage, CrmTeam } from '../admin/crm'
import { DEMO_ACCOUNT } from './mode'

const MIN = 60_000
export const ago = (minutes: number): string => new Date(Date.now() - minutes * MIN).toISOString()

interface Seed {
  name: string
  team: string
  plan: CrmTeam['plan']
  planStatus?: CrmTeam['planStatus']
  role?: CrmTeam['role']
  balance: number
  spent: number
  machines: number
  createdDays: number
  activeMin: number | null
  sessions: number
  verified?: boolean
  disabled?: boolean
  test?: boolean
}

const SEEDS: Seed[] = [
  { name: 'Studio Démo', team: 'Studio Démo', plan: 'studio', balance: 48_200, spent: 6_350, machines: 2, createdDays: 120, activeMin: 1, sessions: 3 },
  { name: 'Camille Rivière', team: 'Atelier Nuages', plan: 'agency', balance: 12_400, spent: 3_870, machines: 1, createdDays: 64, activeMin: 35, sessions: 2 },
  { name: 'Léo Martin', team: 'Les Petits Moteurs', plan: 'starter', balance: 2_150, spent: 1_240, machines: 1, createdDays: 41, activeMin: 180, sessions: 1 },
  { name: 'Inès Garnier', team: 'Chroniques du Rail', plan: 'agency', balance: 9_800, spent: 4_420, machines: 1, createdDays: 88, activeMin: 12, sessions: 2 },
  { name: 'Hugo Lefèvre', team: 'Planète Recettes', plan: 'creator', planStatus: 'past_due', balance: 0, spent: 980, machines: 1, createdDays: 53, activeMin: 2_900, sessions: 0 },
  { name: 'Manon Petit', team: 'Manon Petit', plan: null, balance: 500, spent: 0, machines: 0, createdDays: 2, activeMin: 300, sessions: 1, verified: false },
  { name: 'Nathan Roux', team: 'Mécanique Facile', plan: 'studio', balance: 31_000, spent: 8_900, machines: 3, createdDays: 150, activeMin: 6, sessions: 4 },
  { name: 'Chloé Bernard', team: 'Mythes en 10 minutes', plan: 'agency', balance: 7_300, spent: 2_640, machines: 1, createdDays: 77, activeMin: 95, sessions: 1 },
  { name: 'Lucas Fontaine', team: 'Lucas Fontaine', plan: 'creator', planStatus: 'canceled', balance: 120, spent: 410, machines: 0, createdDays: 99, activeMin: 20_000, sessions: 0 },
  { name: 'Sarah Moreau', team: 'Cartes et Frontières', plan: 'agency', balance: 15_600, spent: 5_120, machines: 1, createdDays: 70, activeMin: 48, sessions: 2 },
  { name: 'Théo Girard', team: 'Le Labo du Dimanche', plan: 'creator', balance: 3_400, spent: 760, machines: 1, createdDays: 23, activeMin: 600, sessions: 1 },
  { name: 'Emma Lambert', team: 'Atelier Nuages', plan: 'agency', role: 'member', balance: 12_400, spent: 3_870, machines: 1, createdDays: 60, activeMin: 240, sessions: 1 },
  { name: 'Jules Mercier', team: 'Jules Mercier', plan: null, balance: 500, spent: 0, machines: 0, createdDays: 1, activeMin: 50, sessions: 1, verified: false },
  { name: 'Louise Faure', team: 'Histoires de Phares', plan: 'creator', balance: 1_900, spent: 1_050, machines: 1, createdDays: 35, activeMin: 1_400, sessions: 1 },
  { name: 'Gabriel Andre', team: 'Gabriel Andre', plan: null, balance: 0, spent: 0, machines: 0, createdDays: 40, activeMin: 30_000, sessions: 0, disabled: true },
  { name: 'Alice Chevalier', team: 'Le Petit Cosmos', plan: 'studio', balance: 22_700, spent: 7_310, machines: 2, createdDays: 110, activeMin: 15, sessions: 3 },
  { name: 'Raphaël Blanc', team: 'Bricolage Malin', plan: 'agency', balance: 6_100, spent: 2_980, machines: 1, createdDays: 58, activeMin: 420, sessions: 1 },
  { name: 'Zoé Guerin', team: 'Zoé Guerin', plan: null, balance: 500, spent: 0, machines: 0, createdDays: 4, activeMin: 2_000, sessions: 0, verified: false },
  { name: 'Arthur Boyer', team: 'Les Petits Moteurs', plan: 'creator', role: 'admin', balance: 2_150, spent: 1_240, machines: 1, createdDays: 39, activeMin: 75, sessions: 1 },
  { name: 'Jade Rousseau', team: 'Jardins Secrets', plan: 'creator', balance: 2_800, spent: 640, machines: 1, createdDays: 19, activeMin: 160, sessions: 2 },
  { name: 'Louis Clement', team: 'Archives Sonores', plan: 'agency', balance: 8_900, spent: 3_200, machines: 1, createdDays: 83, activeMin: 30, sessions: 2 },
  { name: 'Lina Gauthier', team: 'Lina Gauthier', plan: 'creator', balance: 1_200, spent: 300, machines: 1, createdDays: 9, activeMin: 900, sessions: 1 },
  { name: 'Adam Perrin', team: 'Équipe de test', plan: 'agency', balance: 50_000, spent: 1_500, machines: 1, createdDays: 30, activeMin: 5, sessions: 1, test: true },
  { name: 'Rose Morel', team: 'Contes du Soir', plan: 'creator', balance: 3_100, spent: 870, machines: 1, createdDays: 27, activeMin: 2_200, sessions: 0 },
  { name: 'Paul Fournier', team: 'Paul Fournier', plan: null, balance: 500, spent: 0, machines: 0, createdDays: 6, activeMin: null, sessions: 0, verified: false },
  { name: 'Anna Dupuis', team: 'Science en Poche', plan: 'agency', balance: 10_300, spent: 4_010, machines: 1, createdDays: 92, activeMin: 66, sessions: 2 },
  { name: 'Victor Lemoine', team: 'Victor Lemoine', plan: 'creator', balance: 900, spent: 520, machines: 1, createdDays: 14, activeMin: 3_600, sessions: 0 },
  { name: 'Mila Caron', team: 'Mila Caron', plan: null, balance: 500, spent: 0, machines: 0, createdDays: 3, activeMin: 700, sessions: 1 },
  { name: 'Tom Colin', team: 'Rétro Consoles', plan: 'agency', balance: 5_400, spent: 2_330, machines: 1, createdDays: 47, activeMin: 210, sessions: 1 }
]

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')

interface Row {
  account: CrmAccount
  wallet: CrmDetail['wallet']
  devices: CrmDetail['devices']
}

const teamIds = new Map<string, string>()
const teamId = (name: string): string => {
  let id = teamIds.get(name)
  if (!id) {
    id = `team_demo${String(teamIds.size + 1).padStart(2, '0')}`
    teamIds.set(name, id)
  }
  return id
}

function build(s: Seed, i: number): Row {
  const id = `acc_demo${String(i + 1).padStart(2, '0')}`
  const email = i === 0 ? DEMO_ACCOUNT.email : `${slug(s.name)}@example.com`
  const team: CrmTeam = {
    id: teamId(s.team),
    name: s.team,
    internal: i === 0,
    ...(s.test ? { test: true } : {}),
    role: s.role ?? 'owner',
    plan: s.plan,
    planStatus: s.plan ? (s.planStatus ?? 'active') : null,
    balance: s.balance,
    available: Math.max(0, s.balance - Math.round(s.balance * 0.04)),
    spent30d: s.spent,
    machines: s.machines
  }
  const createdMin = s.createdDays * 1440
  const account: CrmAccount = {
    id,
    email,
    name: s.name,
    platformAdmin: i === 0,
    emailVerified: s.verified !== false,
    disabled: s.disabled === true,
    createdAt: ago(createdMin),
    lastActiveAt: s.activeMin === null ? null : ago(s.activeMin),
    activeSessions: s.sessions,
    team
  }
  const wallet: CrmDetail['wallet'] = [
    { id: `${id}_w1`, kind: 'welcome', credits: 500, note: 'Crédits de bienvenue', createdAt: ago(createdMin - 5) },
    ...(s.plan ? [{ id: `${id}_w2`, kind: 'subscription', credits: Math.round(s.balance + s.spent), note: `Plan ${s.plan}`, createdAt: ago(createdMin - 30) }] : []),
    ...(s.spent > 0 ? [{ id: `${id}_w3`, kind: 'spend', credits: -s.spent, note: 'Rendus et générations (30 jours)', createdAt: ago(Math.max(10, (s.activeMin ?? 600) + 20)) }] : [])
  ]
  const devices: CrmDetail['devices'] = s.sessions > 0 || s.activeMin !== null
    ? [
        { id: `${id}_d1`, name: 'Ordinateur d’équipe', createdAt: ago(createdMin - 60), lastSeenAt: s.activeMin === null ? null : ago(s.activeMin), revokedAt: null },
        ...(s.sessions > 1 ? [{ id: `${id}_d2`, name: 'Portable (app)', createdAt: ago(createdMin / 2), lastSeenAt: ago((s.activeMin ?? 60) + 90), revokedAt: null }] : [])
      ]
    : []
  return { account, wallet, devices }
}

const rows: Row[] = SEEDS.map(build)
const audit: CrmDetail['audit'] = [
  { id: 3, at: ago(2_000), actor: DEMO_ACCOUNT.email, action: 'account.disable', target: rows[14]?.account.id ?? null },
  { id: 2, at: ago(9_000), actor: DEMO_ACCOUNT.email, action: 'credits.grant', target: rows[22]?.account.id ?? null },
  { id: 1, at: ago(40_000), actor: 'system', action: 'team.create', target: rows[0]?.account.id ?? null }
]

/** The other accounts of one team share its wallet: keep the numbers in step. */
function syncTeam(team: CrmTeam): void {
  for (const r of rows) if (r.account.team && r.account.team.id === team.id) r.account.team = { ...r.account.team, balance: team.balance, available: team.available }
}

export function crmList(params: URLSearchParams): CrmPage {
  const limit = Math.max(1, Number(params.get('limit') ?? 25) || 25)
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const status = params.get('status')
  const list = rows
    .map((r) => r.account)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.email.includes(q) || (a.team?.name.toLowerCase().includes(q) ?? false))
    .filter((a) => (status === 'active' ? !a.disabled : status === 'disabled' ? a.disabled : status === 'unverified' ? !a.emailVerified : true))
  return { accounts: list.slice(offset, offset + limit), total: list.length, limit, offset }
}

const find = (id: string): Row | undefined => rows.find((r) => r.account.id === id)

export function crmDetail(id: string): CrmDetail | null {
  const r = find(id)
  if (!r) return null
  const teams = rows.filter((x) => x.account.id === id && x.account.team).map((x) => x.account.team as CrmTeam)
  return { account: r.account, teams, devices: r.devices, wallet: [...r.wallet].reverse(), audit: audit.filter((a) => a.target === id || a.actor === r.account.email) }
}

function log(action: string, target: string): void {
  audit.unshift({ id: (audit[0]?.id ?? 0) + 1, at: new Date().toISOString(), actor: DEMO_ACCOUNT.email, action, target })
}

/** One console action on an account; null when the account is unknown. */
export function crmAction(id: string, action: string, body: Record<string, unknown>): { ok: true } | null {
  const r = find(id)
  if (!r) return null
  const a = r.account
  if (action === 'grant') {
    const credits = Math.round(Number(body.credits) || 0)
    r.wallet.push({ id: `${id}_g${r.wallet.length + 1}`, kind: 'grant', credits, note: typeof body.note === 'string' && body.note ? body.note : null, createdAt: new Date().toISOString() })
    if (a.team) {
      a.team = { ...a.team, balance: a.team.balance + credits, available: a.team.available + credits }
      syncTeam(a.team)
    }
    log('credits.grant', id)
  } else if (action === 'verify-email') {
    a.emailVerified = true
    log('account.verify_email', id)
  } else if (action === 'status') {
    a.disabled = body.disabled === true
    if (a.disabled) a.activeSessions = 0
    log(a.disabled ? 'account.disable' : 'account.enable', id)
  } else if (action === 'revoke-sessions') {
    a.activeSessions = 0
    r.devices = r.devices.map((d) => ({ ...d, revokedAt: d.revokedAt ?? new Date().toISOString() }))
    log('account.revoke_sessions', id)
  } else return null
  return { ok: true }
}

/** Numbers the overview shows, from the same accounts. */
export function crmTotals(): { accounts: number; teams: number; plans: { plan: string; active: number }[] } {
  const owners = rows.filter((r) => r.account.team?.role === 'owner')
  const plans = new Map<string, number>()
  for (const r of owners) {
    const t = r.account.team
    if (t?.plan && t.planStatus === 'active') plans.set(t.plan, (plans.get(t.plan) ?? 0) + 1)
  }
  return { accounts: rows.length, teams: new Set(rows.map((r) => r.account.team?.id)).size, plans: [...plans].map(([plan, active]) => ({ plan, active })) }
}

/** Team names for the other fixtures (machines, finance). */
export const demoTeams = (): { id: string; name: string; plan: string | null; owner: string; machines: number; spent: number; test: boolean; internal: boolean }[] =>
  rows
    .filter((r) => r.account.team?.role === 'owner')
    .map((r) => {
      const t = r.account.team as CrmTeam
      return { id: t.id, name: t.name, plan: t.plan, owner: r.account.email, machines: t.machines, spent: t.spent30d, test: t.test === true, internal: t.internal }
    })
