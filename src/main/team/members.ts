// Team members and devices (lot Z1). Local only: an invitation is stored, no e-mail is sent. Lot 14/15 moves members to
// the Cloud's team (GET /v1/team/members) behind the same shapes.
import { hostname } from 'node:os'
import type { InviteInput, MemberPatch, TeamDevice, TeamMember, TeamRole } from '../../shared/api/team'
import type { Db } from '../db'

interface MemberDb {
  id: number
  name: string
  email: string | null
  role: TeamRole
  status: 'invited' | 'active'
  monthly_cap: number | null
  is_self: number
  example: number
  created_at: string
}

interface DeviceDb {
  id: number
  name: string
  os: string
  last_seen_at: string
  is_current: number
  example: number
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_CAP = 100_000_000

const toMember = (r: MemberDb): TeamMember => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  status: r.status,
  monthlyCap: r.monthly_cap,
  self: r.is_self === 1,
  example: r.example === 1,
  createdAt: r.created_at
})

const toDevice = (r: DeviceDb): TeamDevice => ({
  id: r.id,
  name: r.name,
  os: r.os,
  lastSeenAt: r.last_seen_at,
  current: r.is_current === 1,
  example: r.example === 1
})

export function osLabel(platform: string = process.platform): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return 'Linux'
}

export function requireId(id: unknown, what: string): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) throw new Error(`${what} : identifiant invalide.`)
  return id
}

export function requireText(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${what} : texte attendu.`)
  const v = value.trim()
  if (!v) throw new Error(`${what} : ce champ est obligatoire.`)
  if (v.length > max) throw new Error(`${what} : ${max} caractères au plus.`)
  return v
}

function requireCap(cap: unknown): number | null {
  if (cap === null || cap === undefined) return null
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > MAX_CAP) {
    throw new Error('Plafond mensuel : un nombre entier de crédits (0 ou plus) est attendu.')
  }
  return cap
}

function requireRole(role: unknown): 'admin' | 'member' {
  if (role !== 'admin' && role !== 'member') throw new Error('Rôle : administrateur ou membre.')
  return role
}

export class MembersStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Credits granted so far, summed in SQL per source (the whole wallet, not just its latest entries). */
  grantedBySource(): { source: string; total: number }[] {
    return this.db.prepare("SELECT source, COALESCE(SUM(amount), 0) AS total FROM credit_entries WHERE kind = 'grant' GROUP BY source").all() as unknown as {
      source: string
      total: number
    }[]
  }

  /** The user of this app is always the owner of the team; created on first use. */
  private ensureSelf(): void {
    const has = this.db.prepare('SELECT 1 FROM team_members WHERE is_self = 1').get()
    if (!has) this.db.prepare("INSERT INTO team_members (name, email, role, status, is_self) VALUES ('Vous', NULL, 'owner', 'active', 1)").run()
  }

  list(): TeamMember[] {
    this.ensureSelf()
    const rows = this.db.prepare("SELECT * FROM team_members ORDER BY is_self DESC, CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id").all() as unknown as MemberDb[]
    return rows.map(toMember)
  }

  private get(id: number): TeamMember {
    const r = this.db.prepare('SELECT * FROM team_members WHERE id = ?').get(id) as MemberDb | undefined
    if (!r) throw new Error('Membre introuvable.')
    return toMember(r)
  }

  /** The member of this app (owner). */
  self(): TeamMember {
    this.ensureSelf()
    return toMember(this.db.prepare('SELECT * FROM team_members WHERE is_self = 1').get() as unknown as MemberDb)
  }

  invite(input: InviteInput): TeamMember {
    if (!input || typeof input !== 'object') throw new Error('Invitation invalide.')
    const name = requireText(input.name, 'Nom', 80)
    const email = requireText(input.email, 'Adresse e-mail', 200).toLowerCase()
    if (!EMAIL.test(email)) throw new Error('Adresse e-mail : format invalide.')
    const role = requireRole(input.role)
    const cap = requireCap(input.monthlyCap)
    this.ensureSelf()
    if (this.db.prepare('SELECT 1 FROM team_members WHERE email = ?').get(email)) throw new Error('Cette adresse est déjà dans l’équipe.')
    const r = this.db
      .prepare("INSERT INTO team_members (name, email, role, status, monthly_cap) VALUES (?, ?, ?, 'invited', ?)")
      .run(name, email, role, cap)
    return this.get(Number(r.lastInsertRowid))
  }

  update(id: number, patch: MemberPatch): TeamMember {
    requireId(id, 'Membre')
    if (!patch || typeof patch !== 'object') throw new Error('Modification invalide.')
    const current = this.get(id)
    if (current.self && patch.role !== undefined) throw new Error('Le propriétaire de l’équipe ne peut pas changer de rôle.')
    const role = patch.role === undefined ? current.role : requireRole(patch.role)
    const cap = patch.monthlyCap === undefined ? current.monthlyCap : requireCap(patch.monthlyCap)
    this.db.prepare('UPDATE team_members SET role = ?, monthly_cap = ? WHERE id = ?').run(role, cap, id)
    return this.get(id)
  }

  remove(id: number): void {
    requireId(id, 'Membre')
    if (this.get(id).self) throw new Error('Le propriétaire de l’équipe ne peut pas être retiré.')
    this.db.prepare('DELETE FROM team_members WHERE id = ?').run(id)
  }

  /** This computer is always listed, flagged « cet appareil », seen now. */
  devices(): TeamDevice[] {
    const now = this.now().toISOString()
    const cur = this.db.prepare('SELECT id FROM team_devices WHERE is_current = 1').get() as { id: number } | undefined
    if (cur) this.db.prepare('UPDATE team_devices SET last_seen_at = ? WHERE id = ?').run(now, cur.id)
    else this.db.prepare('INSERT INTO team_devices (name, os, last_seen_at, is_current) VALUES (?, ?, ?, 1)').run(hostname() || 'Cet ordinateur', osLabel(), now)
    const rows = this.db.prepare('SELECT * FROM team_devices ORDER BY is_current DESC, last_seen_at DESC, id').all() as unknown as DeviceDb[]
    return rows.map(toDevice)
  }

  revokeDevice(id: number): void {
    requireId(id, 'Appareil')
    const r = this.db.prepare('SELECT is_current FROM team_devices WHERE id = ?').get(id) as { is_current: number } | undefined
    if (!r) throw new Error('Appareil introuvable.')
    if (r.is_current === 1) throw new Error('Cet appareil ne peut pas être révoqué depuis lui-même.')
    this.db.prepare('DELETE FROM team_devices WHERE id = ?').run(id)
  }
}
