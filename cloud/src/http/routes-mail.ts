// The e-mail routes of CLOUD_ROUTES: the verification link, a new verification e-mail, « mot de passe oublié » and the
// reset link (the logic and its limits are in mail/flows.ts).
import type { FastifyInstance } from 'fastify'
import { CLOUD_ROUTES } from '../../../src/shared/cloud-api.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

export function registerMailRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ROUTES
  route(app, cloud, limiter, r.verifyEmail, ({ body }) => {
    cloud.emailFlows.verify(body.token)
    return { ok: true as const }
  })
  route(app, cloud, limiter, r.resendVerification, ({ session, req }) => {
    if (!session) throw new CloudError('unauthorized', 'a bearer token is required')
    return cloud.emailFlows.resend(session.account.id, req.ip)
  })
  // the same answer whether the address has an account or not
  route(app, cloud, limiter, r.forgotPassword, ({ body, req }) => {
    cloud.emailFlows.forgotPassword({ email: body.email, lang: body.lang, ip: req.ip })
    return { ok: true as const }
  })
  route(app, cloud, limiter, r.resetPassword, ({ body }) => {
    cloud.emailFlows.resetPassword(body.token, body.password)
    return { ok: true as const }
  })
}
