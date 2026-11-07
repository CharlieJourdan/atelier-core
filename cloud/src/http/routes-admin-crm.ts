// The founder console's CRM routes (ADMIN_CRM_ROUTES, src/shared/cloud-admin-crm.ts): platform admins only, the caller
// checked before any byte of the body is read (route.ts), every action audited (admin-crm.ts).
import type { FastifyInstance } from 'fastify'
import { ADMIN_CRM_ROUTES } from '../../../src/shared/cloud-admin-crm.ts'
import { crmDetail, crmGrant, crmList, crmRevokeSessions, crmSetDisabled, crmVerifyEmail } from '../admin-crm.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

export function registerAdminCrmRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = ADMIN_CRM_ROUTES
  const actor = (s: { account: { id: string } } | null): string => {
    if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
    return s.account.id
  }
  const id = (params: Record<string, string>): string => params.id ?? ''

  route(app, cloud, limiter, r.crmAccounts, ({ query }) => crmList(cloud, query))
  route(app, cloud, limiter, r.crmAccount, ({ params }) => crmDetail(cloud, id(params)))
  route(app, cloud, limiter, r.crmGrant, ({ session, params, body }) => crmGrant(cloud, id(params), body, actor(session)))
  route(app, cloud, limiter, r.crmVerifyEmail, ({ session, params }) => ({ ok: true as const, account: crmVerifyEmail(cloud, id(params), actor(session)) }))
  route(app, cloud, limiter, r.crmSetStatus, ({ session, params, body }) => ({ ok: true as const, account: crmSetDisabled(cloud, id(params), body.disabled, actor(session)) }))
  route(app, cloud, limiter, r.crmRevokeSessions, ({ session, params }) => ({ ok: true as const, ...crmRevokeSessions(cloud, id(params), actor(session)) }))
}
