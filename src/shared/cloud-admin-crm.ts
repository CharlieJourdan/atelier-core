// The founder console's CRM on Atelier Cloud (« Utilisateurs et CRM »): the accounts with their team, plan, credit balance,
// spend over 30 days, team computers, last activity and whether the address is verified; search and pages; one account's
// detail; and the admin actions (grant credits, verify the address, disable / enable the account, revoke its sessions).
// Platform admins only; every action is written to the audit log. Kept apart from cloud-api.ts (over 600 lines).
//
// Imports only zod, like cloud-kit.ts and cloud-releases.ts: the Cloud (type stripping) and the console (bundler) read it as is.
import { z } from 'zod'

export const CRM_STATUSES = ['all', 'active', 'disabled', 'unverified'] as const

export const CrmListQuery = z.object({
  /** Part of the e-mail, the name or the team's name (case does not matter). */
  q: z.string().trim().max(200).default(''),
  status: z.enum(CRM_STATUSES).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
})
export type CrmListQuery = z.infer<typeof CrmListQuery>

export const CrmTeam = z.object({
  id: z.string(),
  name: z.string(),
  internal: z.boolean(),
  /** A test team (record 0066): its credits are test credits, its member never signs in with a password. */
  test: z.boolean().default(false),
  role: z.enum(['owner', 'admin', 'member']),
  /** The team's plan (`starter`, `pro`…) and its billing state; null without a subscription. */
  plan: z.string().nullable(),
  planStatus: z.enum(['active', 'past_due', 'canceled']).nullable(),
  /** Credits: the balance and what is not held by a running job. */
  balance: z.number().int(),
  available: z.number().int(),
  /** Credits captured by the team's jobs over the last 30 days. */
  spent30d: z.number().int(),
  /** Team computers that are not deleted. */
  machines: z.number().int()
})
export type CrmTeam = z.infer<typeof CrmTeam>

export const CrmAccountRow = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  platformAdmin: z.boolean(),
  emailVerified: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
  /** The last time one of its devices (app, site, CLI) was seen; null if never signed in. */
  lastActiveAt: z.string().nullable(),
  /** Devices not revoked. */
  activeSessions: z.number().int(),
  /** The team it signs in to (its oldest membership). */
  team: CrmTeam.nullable()
})
export type CrmAccountRow = z.infer<typeof CrmAccountRow>

export const CrmListResponse = z.object({
  accounts: z.array(CrmAccountRow),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int()
})
export type CrmListResponse = z.infer<typeof CrmListResponse>

export const CrmAccountDetail = z.object({
  account: CrmAccountRow,
  /** Every team the account belongs to. */
  teams: z.array(CrmTeam),
  devices: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string(), lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable() })),
  /** The latest moves of its team's wallet. */
  wallet: z.array(z.object({ id: z.string(), kind: z.string(), credits: z.number().int(), note: z.string().nullable(), createdAt: z.string() })),
  /** The latest audit entries by or about this account. */
  audit: z.array(z.object({ id: z.number().int(), at: z.string(), actor: z.string(), action: z.string(), target: z.string().nullable() }))
})
export type CrmAccountDetail = z.infer<typeof CrmAccountDetail>

export const CrmGrantRequest = z.object({
  credits: z.number().int().min(1).max(1_000_000),
  /** The same key twice grants once (a double click, a retried request). */
  idempotencyKey: z.string().min(8).max(100),
  note: z.string().max(300).default(''),
  /** Another team of the account than the one it signs in to. */
  teamId: z.string().max(100).optional()
})
export type CrmGrantRequest = z.infer<typeof CrmGrantRequest>

export const CrmGrantResponse = z.object({
  teamId: z.string(),
  entryId: z.string(),
  replayed: z.boolean(),
  balance: z.number().int(),
  available: z.number().int()
})

export const CrmStatusRequest = z.object({ disabled: z.boolean() })

export const CrmActionResponse = z.object({ ok: z.literal(true), account: CrmAccountRow })

export const CrmRevokeResponse = z.object({ ok: z.literal(true), revoked: z.number().int(), account: CrmAccountRow })

export interface CrmRoute {
  method: 'GET' | 'POST'
  path: string
  auth: 'platformAdmin'
  body?: z.ZodType
  query?: z.ZodType
  response: z.ZodType
}

export const ADMIN_CRM_ROUTES = {
  crmAccounts: { method: 'GET', path: '/v1/admin/accounts', auth: 'platformAdmin', query: CrmListQuery, response: CrmListResponse },
  crmAccount: { method: 'GET', path: '/v1/admin/accounts/:id', auth: 'platformAdmin', response: CrmAccountDetail },
  crmGrant: { method: 'POST', path: '/v1/admin/accounts/:id/grant', auth: 'platformAdmin', body: CrmGrantRequest, response: CrmGrantResponse },
  crmVerifyEmail: { method: 'POST', path: '/v1/admin/accounts/:id/verify-email', auth: 'platformAdmin', response: CrmActionResponse },
  crmSetStatus: { method: 'POST', path: '/v1/admin/accounts/:id/status', auth: 'platformAdmin', body: CrmStatusRequest, response: CrmActionResponse },
  crmRevokeSessions: { method: 'POST', path: '/v1/admin/accounts/:id/revoke-sessions', auth: 'platformAdmin', response: CrmRevokeResponse }
} as const satisfies Record<string, CrmRoute>
