// The founder console's « Utilisateurs et CRM » on the real Atelier Cloud (site built with VITE_ATELIER_CLOUD): the shapes
// of the CRM routes (the contract is src/shared/cloud-admin-crm.ts, and a test parses real answers with it; the types are
// written out here so the site does not import the app's sources), the calls, and the labels. Without the Cloud, the
// page stays the mock-up of Users.tsx.
import { cloudCall } from '../cloud'

export type CrmStatusFilter = 'all' | 'active' | 'disabled' | 'unverified'

export interface CrmTeam {
  id: string
  name: string
  internal: boolean
  /** A test team (record 0066): test credits, a member without a password. */
  test?: boolean
  role: 'owner' | 'admin' | 'member'
  plan: string | null
  planStatus: 'active' | 'past_due' | 'canceled' | null
  balance: number
  available: number
  spent30d: number
  machines: number
}

export interface CrmAccount {
  id: string
  email: string
  name: string
  platformAdmin: boolean
  emailVerified: boolean
  disabled: boolean
  createdAt: string
  lastActiveAt: string | null
  activeSessions: number
  team: CrmTeam | null
}

export interface CrmPage {
  accounts: CrmAccount[]
  total: number
  limit: number
  offset: number
}

export interface CrmDetail {
  account: CrmAccount
  teams: CrmTeam[]
  devices: { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }[]
  wallet: { id: string; kind: string; credits: number; note: string | null; createdAt: string }[]
  audit: { id: number; at: string; actor: string; action: string; target: string | null }[]
}

export type CrmAction = { kind: 'grant'; credits: number; note: string; idempotencyKey: string } | { kind: 'verify' } | { kind: 'disable' } | { kind: 'enable' } | { kind: 'revoke' }

export const PAGE_SIZE = 25

export function listPath(q: string, status: CrmStatusFilter, offset: number): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
  if (q.trim()) p.set('q', q.trim())
  if (status !== 'all') p.set('status', status)
  return `/v1/admin/accounts?${p.toString()}`
}

export const fetchPage = (q: string, status: CrmStatusFilter, offset: number): Promise<CrmPage> => cloudCall<CrmPage>(listPath(q, status, offset))
export const fetchDetail = (id: string): Promise<CrmDetail> => cloudCall<CrmDetail>(`/v1/admin/accounts/${encodeURIComponent(id)}`)

/** Sends one admin action; the Cloud audits it. */
export function runAction(id: string, a: CrmAction): Promise<unknown> {
  const base = `/v1/admin/accounts/${encodeURIComponent(id)}`
  switch (a.kind) {
    case 'grant':
      return cloudCall(`${base}/grant`, { method: 'POST', body: { credits: a.credits, note: a.note, idempotencyKey: a.idempotencyKey } })
    case 'verify':
      return cloudCall(`${base}/verify-email`, { method: 'POST', body: {} })
    case 'disable':
    case 'enable':
      return cloudCall(`${base}/status`, { method: 'POST', body: { disabled: a.kind === 'disable' } })
    case 'revoke':
      return cloudCall(`${base}/revoke-sessions`, { method: 'POST', body: {} })
  }
}

/** A fresh key per grant dialog: a double click or a retried request grants once. */
export function newGrantKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `console-${c.randomUUID()}`
  return `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export const PLAN_STATUS_LABEL: Record<NonNullable<CrmTeam['planStatus']>, string> = { active: 'actif', past_due: 'impayé', canceled: 'résilié' }
export const ROLE_LABEL: Record<CrmTeam['role'], string> = { owner: 'propriétaire', admin: 'admin', member: 'membre' }

export function planLabel(t: CrmTeam | null): string {
  if (!t || !t.plan) return 'Sans plan'
  const name = t.plan.charAt(0).toUpperCase() + t.plan.slice(1)
  return t.planStatus && t.planStatus !== 'active' ? `${name} (${PLAN_STATUS_LABEL[t.planStatus]})` : name
}

export const credits = (n: number): string => n.toLocaleString('fr-FR')

/** « il y a 3 h », « il y a 2 j », « jamais ». */
export function sinceLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'jamais'
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return iso
  const min = Math.max(0, Math.round((now - at) / 60_000))
  if (min < 2) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`
  return `il y a ${Math.round(min / 1440)} j`
}

/** What the confirmation dialog of an action says. */
export function confirmText(a: CrmAction, who: CrmAccount): { title: string; body: string; ok: string } {
  switch (a.kind) {
    case 'grant':
      return {
        title: `Accorder des crédits à ${who.name}`,
        body: `Les crédits vont sur le portefeuille de l’équipe « ${who.team?.name ?? '—'} ». L’opération est écrite au journal d’audit.`,
        ok: `Accorder ${credits(a.credits)} crédits`
      }
    case 'verify':
      return { title: `Vérifier l’adresse de ${who.name}`, body: `${who.email} sera considérée comme confirmée, comme si le lien de l’e-mail avait été ouvert.`, ok: 'Vérifier l’adresse' }
    case 'disable':
      return {
        title: `Désactiver le compte de ${who.name}`,
        body: 'Le compte est déconnecté partout tout de suite et ne peut plus se connecter, jusqu’à ce que tu le réactives. Son équipe, ses crédits et ses machines restent là.',
        ok: 'Désactiver le compte'
      }
    case 'enable':
      return { title: `Réactiver le compte de ${who.name}`, body: 'La personne pourra se reconnecter avec son mot de passe.', ok: 'Réactiver le compte' }
    case 'revoke':
      return {
        title: `Déconnecter ${who.name} partout`,
        body: `Les ${who.activeSessions} session(s) ouvertes (app, site, outil) s’arrêtent ; la personne devra se reconnecter. Le compte reste actif.`,
        ok: 'Révoquer les sessions'
      }
  }
}

export function doneText(a: CrmAction, who: CrmAccount): string {
  switch (a.kind) {
    case 'grant':
      return `${credits(a.credits)} crédits accordés à ${who.name}.`
    case 'verify':
      return `Adresse de ${who.name} vérifiée.`
    case 'disable':
      return `Compte de ${who.name} désactivé.`
    case 'enable':
      return `Compte de ${who.name} réactivé.`
    case 'revoke':
      return `Sessions de ${who.name} révoquées.`
  }
}
