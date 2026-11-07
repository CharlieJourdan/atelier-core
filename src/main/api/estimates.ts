// IPC handlers, module "estimates" (decision 0023): a pipeline's cost per minute and per video (min / avg / max, per brick)
// and its fit % to a channel, computed in main from the Cloud's prices (src/main/production/estimates). Read-only.
import type { ApiHandlers } from '../../shared/api'
import type { ESTIMATES_METHODS } from '../../shared/api/estimates'
import { EstimatesService } from '../production/estimates'
import type { ApiContext } from './context'

type EstimatesMethodKey = (typeof ESTIMATES_METHODS)[number]

export function estimatesApi(ctx: Pick<ApiContext, 'db' | 'settings' | 'prices' | 'routes' | 'cloud'>): Pick<ApiHandlers, EstimatesMethodKey> {
  const { session, api } = ctx.cloud
  const service = new EstimatesService({
    db: ctx.db,
    settings: ctx.settings,
    prices: ctx.prices,
    routes: ctx.routes,
    liveEngines: async () => (session.connected() ? (await api.engines()).engines : null)
  })
  return {
    'estimates.pipeline': (doc, channelId) => service.pipeline(doc, channelId),
    'estimates.cards': (channelId) => service.cards(channelId)
  }
}
