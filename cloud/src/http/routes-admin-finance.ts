// The founder console's money routes (ADMIN_FINANCE_ROUTES, src/shared/cloud-admin-finance.ts): platform admins only,
// the caller checked before any byte of the body is read (route.ts), every change audited (finance-settings.ts).
import type { FastifyInstance } from 'fastify'
import { ADMIN_FINANCE_ROUTES } from '../../../src/shared/cloud-admin-finance.ts'
import { financeDashboard } from '../admin-finance.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

export function registerAdminFinanceRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = ADMIN_FINANCE_ROUTES
  const actor = (s: { account: { id: string } } | null): string => {
    if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
    return s.account.id
  }
  const settings = () => {
    const fx = cloud.finance.fx()
    return { priceMultiplier: cloud.finance.multiplier(), eurPerUsd: fx.eurPerUsd, fxAsOf: fx.asOf, creditValueEur: cloud.pricing.current().creditValueEur }
  }

  route(app, cloud, limiter, r.financeDashboard, ({ query }) => financeDashboard(cloud, { period: query.period, includeDemo: query.demo === '1' }))
  route(app, cloud, limiter, r.financeSettings, ({ session, body }) => {
    const who = actor(session)
    if (body.priceMultiplier !== undefined) cloud.finance.setMultiplier(body.priceMultiplier, who)
    if (body.eurPerUsd !== undefined) cloud.finance.setFx(body.eurPerUsd, body.fxAsOf ?? new Date(cloud.clock.now()).toISOString().slice(0, 10), who)
    return settings()
  })
  route(app, cloud, limiter, r.financeSaveFixedCost, ({ session, body }) => {
    const saved = cloud.finance.saveFixedCost(body, actor(session))
    const fx = cloud.finance.fx()
    return {
      ok: true as const,
      cost: { ...saved, monthlyEurCents: saved.currency === 'USD' ? Math.round(saved.amountCents * fx.eurPerUsd * 100) / 100 : saved.amountCents, auto: false, demo: false }
    }
  })
  route(app, cloud, limiter, r.financeRemoveFixedCost, ({ session, params }) => {
    cloud.finance.removeFixedCost(params.id ?? '', actor(session))
    return { ok: true as const }
  })
}
