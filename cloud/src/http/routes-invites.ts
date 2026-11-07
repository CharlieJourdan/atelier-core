// The team-invitation routes of CLOUD_ROUTES (the logic is in invites.ts): an owner or admin lists, sends and revokes
// invitations; the site's /invitation page previews a link, accepts it when signed in, or creates the account from it.
import type { FastifyInstance } from 'fastify'
import { CLOUD_ROUTES } from '../../../src/shared/cloud-api.ts'
import type { Session } from '../auth.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

export function registerInviteRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ROUTES
  route(app, cloud, limiter, r.invites, ({ session }) => {
    const s = must(session)
    return { invites: cloud.invites.list(s.teamId, s.account.id) }
  })
  route(app, cloud, limiter, r.createInvite, ({ session, body }) => {
    const s = must(session)
    return cloud.invites.create({ teamId: s.teamId, byAccountId: s.account.id, email: body.email, role: body.role, lang: body.lang })
  })
  route(app, cloud, limiter, r.revokeInvite, ({ session, params }) => {
    const s = must(session)
    cloud.invites.revoke(s.teamId, s.account.id, params.id ?? '')
    return { ok: true as const }
  })
  route(app, cloud, limiter, r.invitePreview, ({ body }) => cloud.invites.preview(body.token))
  route(app, cloud, limiter, r.inviteAccept, ({ session, body }) => cloud.invites.accept(body.token, must(session).account.id))
  route(app, cloud, limiter, r.inviteSignup, ({ body }) => cloud.invites.signup({ token: body.token, name: body.name, password: body.password, lang: body.lang }))
}
