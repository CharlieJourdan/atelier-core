import type { ApiHandlers } from '../../shared/api'
import { ERROR_HOLD } from '../agents/runner'
import type { ApiContext } from './context'

export function routesApi(
  ctx: ApiContext
): Pick<
  ApiHandlers,
  'llm.defaults' | 'llm.setDefaultProvider' | 'llm.setTierModel' | 'routes.list' | 'routes.set' | 'routes.resolve'
> {
  return {
    'llm.defaults': () => ({ defaultProvider: ctx.routes.defaultProvider(), tierModels: ctx.routes.tierModels() }),
    'llm.setDefaultProvider': (id) => {
      ctx.routes.setDefaultProvider(id)
      ctx.notify('routes')
      ctx.runner.resumeHolds(ERROR_HOLD)
    },
    'llm.setTierModel': (tier, model) => {
      ctx.routes.setTierModel(tier, model)
      ctx.notify('routes')
      ctx.runner.resumeHolds(ERROR_HOLD)
    },
    'routes.list': () => ctx.routes.list(),
    'routes.set': (role, patch) => {
      const row = ctx.routes.set(role, patch)
      ctx.notify('routes')
      // A task that could not start (bad route, unpriced model) may start now.
      ctx.runner.resumeHolds(ERROR_HOLD)
      return row
    },
    'routes.resolve': (role) => ctx.routes.resolve(role)
  }
}
