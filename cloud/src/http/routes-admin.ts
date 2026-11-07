// The platform-admin routes of CLOUD_ADMIN_ROUTES: price grids, teams, granted credits and adjustments, P&L, support
// and the audit log. None of them touches the vault (vault values have no route at all).
import type { FastifyInstance } from 'fastify'
import { CLOUD_ADMIN_ROUTES } from '../../../src/shared/cloud-api.ts'
import { pnl } from '../admin.ts'
import { adminOverview } from '../admin-overview.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { route, type RateLimiter } from './route.ts'

export function registerAdminRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  const r = CLOUD_ADMIN_ROUTES
  const actor = (s: { account: { id: string } } | null): string => {
    if (!s) throw new CloudError('unauthorized', 'a bearer token is required')
    return s.account.id
  }

  route(app, cloud, limiter, r.adminPrices, () => ({ current: cloud.pricing.current(), versions: cloud.pricing.versions() }))
  route(app, cloud, limiter, r.adminSetPrices, ({ session, body }) => {
    const { grid, warnings } = cloud.pricing.publishChecked(body, actor(session))
    return { ...grid, warnings }
  })
  route(app, cloud, limiter, r.adminTeams, () => ({
    teams: cloud.accounts.teams().map((t) => ({ ...t, balance: cloud.wallet.state(t.id).balance }))
  }))
  route(app, cloud, limiter, r.adminGrant, ({ session, body }) => {
    cloud.accounts.team(body.teamId)
    const m = cloud.wallet.grant({ teamId: body.teamId, credits: body.credits, idemKey: body.idempotencyKey, note: body.note, actor: actor(session) })
    return { entryId: m.entry.id, replayed: m.replayed, balance: m.state.balance, available: m.state.available }
  })
  route(app, cloud, limiter, r.adminAdjust, ({ session, body }) => {
    cloud.accounts.team(body.teamId)
    const m = cloud.wallet.adjust({ teamId: body.teamId, credits: body.credits, idemKey: body.idempotencyKey, note: body.note, actor: actor(session) })
    return { entryId: m.entry.id, replayed: m.replayed, balance: m.state.balance, available: m.state.available }
  })
  route(app, cloud, limiter, r.adminPnl, ({ query }) => ({
    rows: pnl(cloud.db, { from: query.from, to: query.to, includeDemo: query.includeDemo === '1' }),
    internalExcluded: true
  }))
  route(app, cloud, limiter, r.adminSupport, () => ({ requests: cloud.support.list() }))
  route(app, cloud, limiter, r.adminOverview, () => adminOverview(cloud))
  route(app, cloud, limiter, r.adminBlueprints, () => ({ current: cloud.blueprints.current(), versions: cloud.blueprints.versions() }))
  route(app, cloud, limiter, r.adminPublishBlueprint, ({ session, body }) => cloud.blueprints.publish(body.blueprint, body.note, actor(session)))
  route(app, cloud, limiter, r.adminMachines, () => {
    const machines = cloud.machines()
    const names = new Map(cloud.accounts.teams().map((t) => [t.id, t.name]))
    return {
      provider: machines.providerKind,
      machines: machines.list().map((m) => ({
        id: m.id,
        teamId: m.teamId,
        teamName: names.get(m.teamId) ?? m.teamId,
        plan: m.plan,
        serverType: m.serverType,
        location: m.location,
        status: m.status,
        ipv4: m.ipv4,
        demo: m.provider === 'fake',
        error: m.error,
        createdAt: m.createdAt
      }))
    }
  })
  route(app, cloud, limiter, r.adminMachineAction, async ({ session, params, body }) => {
    const machines = cloud.machines()
    const id = params.id ?? ''
    if (body.action === 'hibernate') await machines.hibernate(id, actor(session))
    else if (body.action === 'resume') await machines.resume(id, actor(session))
    else if (body.action === 'revoke') machines.credentials.revoke(machines.get(id).id, actor(session))
    else await machines.destroy(id, actor(session))
    // A machine put to sleep, cut off or deleted holds no relay any more: its waiting calls end « hors ligne ».
    if (body.action !== 'resume') cloud.relay.drop(id)
    return { ok: true as const }
  })
  route(app, cloud, limiter, r.adminAudit, () => ({
    entries: cloud.audit.list().map(({ id, at, actor: who, action, target }) => ({ id, at, actor: who, action, target }))
  }))
}
