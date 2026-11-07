import type { ApiHandlers } from '../../shared/api'
import { pastRenders } from '../production/history'
import type { ApiContext } from './context'

export function productionApi(ctx: ApiContext): Pick<ApiHandlers, 'production.pastRenders'> {
  return {
    'production.pastRenders': (videoId) => pastRenders(ctx.db, videoId)
  }
}
