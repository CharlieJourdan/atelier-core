// The billing routes of CLOUD_ROUTES: the team's plan, card and top-up, a checkout for a plan or a pack, the simulated
// payment of the demo, and the payment provider's webhook (no bearer: the signature over the raw body is the
// credential, so it is parsed as text in its own scope).
import type { FastifyInstance } from 'fastify'
import { CLOUD_ROUTES } from '../../../src/shared/cloud-api.ts'
import type { Session } from '../auth.ts'
import { FakePayments } from '../billing/payments.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

const must = (s: Session | null): Session => {
  if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
  return s
}

/** Only the team's owner or an admin changes what the team pays (a member could otherwise charge the owner's card). */
function payer(cloud: Cloud, s: Session | null): Session {
  const session = must(s)
  const role = cloud.accounts.membership(session.teamId, session.account.id).role
  if (role === 'member') throw new CloudError('forbidden', 'only the owner or an admin of the team manages billing')
  // checkout, simulated payment and top-up settings wait for a confirmed address
  cloud.accounts.requireVerified(session.account.id)
  return session
}

export function registerBillingRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter, siteOrigins: readonly string[]): void {
  const r = CLOUD_ROUTES
  const demo = cloud.payments instanceof FakePayments ? cloud.payments : null
  const origins = new Set(siteOrigins)
  /** The checkout sends the payer back to the site only (never to any https page). */
  const returnUrl = (u: string): string => {
    let origin: string
    try {
      origin = new URL(u).origin
    } catch {
      throw new CloudError('bad_request', 'invalid return URL')
    }
    if (!origins.has(origin)) throw new CloudError('bad_request', 'return URLs must be on the Atelier site')
    return u
  }

  route(app, cloud, limiter, r.billing, ({ session }) => cloud.billing.status(must(session).teamId))

  route(app, cloud, limiter, r.billingCheckout, async ({ session, body }) => {
    const s = payer(cloud, session)
    return cloud.billing.checkout(s.teamId, s.account.email, body.item, { successUrl: returnUrl(body.successUrl), cancelUrl: returnUrl(body.cancelUrl) })
  })

  route(app, cloud, limiter, r.billingAutoRecharge, ({ session, body }) => cloud.billing.setAutoRecharge(payer(cloud, session).teamId, body))

  route(app, cloud, limiter, r.billingDemoComplete, async ({ session, body }) => {
    const s = payer(cloud, session)
    if (!demo) throw new CloudError('forbidden', 'payments are real: there is no simulated payment')
    // real providers or real machines cost money: a simulated payment must never pay for them
    if (cloud.registry.paidCalls) throw new CloudError('forbidden', 'simulated payments are off while paid calls are on (set up Stripe)')
    const pending = demo.sessions.get(body.sessionId)
    if (!pending || pending.teamId !== s.teamId) throw new CloudError('not_found', 'no such checkout')
    const signed = demo.complete(body.sessionId)
    await cloud.billing.webhook(signed.body, signed.signature)
    return { ok: true as const }
  })

  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body))
    // no rate limit here: the signature is the credential and is checked first (a flood of unsigned bodies costs one
    // HMAC each), and the provider's retries must never be refused
    scope.post(r.billingWebhook.path, async (req, reply) => {
      if (typeof req.body !== 'string') throw new CloudError('bad_request', 'a JSON body is expected')
      const sig = req.headers['stripe-signature'] ?? req.headers['x-atelier-signature']
      await cloud.billing.webhook(req.body, typeof sig === 'string' ? sig : undefined)
      return reply.header('cache-control', 'no-store').send({ ok: true })
    })
  })
}
