import type { ApiHandlers } from '../../shared/api'
import { ERROR_HOLD } from '../agents/runner'
import type { ApiContext } from './context'

export function pricesApi(ctx: ApiContext): Pick<ApiHandlers, 'prices.list' | 'prices.set'> {
  return {
    'prices.list': () => ctx.prices.list(),
    'prices.set': (model, patch) => {
      const row = ctx.prices.set(model, patch)
      ctx.notify('prices')
      ctx.runner.resumeHolds(ERROR_HOLD)
      return row
    }
  }
}
