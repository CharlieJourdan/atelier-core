// The `api` object behind `atelier:call`. Typed against ApiHandlers: a missing or mistyped method fails
// typecheck. One domain per file.
import type { ApiArgs, ApiHandlers, ApiMethod, ApiResult } from '../../shared/api'
import { agentsApi } from './agents'
import { appApi } from './app'
import { chatApi } from './chat'
import { cloudApi } from './cloud'
import { groupApi } from './group'
import type { ApiContext } from './context'
import { pricesApi } from './prices'
import { productionApi } from './production'
import { providersApi } from './providers'
import { routesApi } from './routes'
import { llmAccessApi } from './llm-access'
import { settingsApi } from './settings'
import { workflowApi } from './workflow'
import { spendApi } from './spend'
import { viewsApi } from './views'
import { runsApi } from './runs'
import { analysisApi } from './analysis'
import { moneyApi } from './money'
import { toolsApi } from './tools'
import { teamApi } from './team'
import { homeApi } from './home'
import { ideasApi } from './ideas'
import { exampleApi } from './example'
import { orchestraApi } from './orchestra'
import { discordApi } from './discord'
import { brainApi } from './brain'
import { eyesApi } from './eyes'
import { updateApi } from './update'
import { channelLifeApi } from './channel-life'
import { googleApi } from './google'
import { bricksApi } from './bricks'
import { recipesApi } from './recipes'
import { enginesApi } from './engines'
import { estimatesApi } from './estimates'
import { pipelineAgentApi } from './pipeline-agent'
import { styleAgentApi } from './style-agent'
import { cloneApi } from './clone'
import { reverseApi } from './reverse'
import { ordersApi } from './orders'
import { previewsApi } from './previews'
import { graphApi } from './graph'
import { brickStylesApi } from './brick-styles'
import { channelVoicesApi } from './channel-voices'
import { channelPresentersApi } from './channel-presenters'
import { channelSponsorApi } from './channel-sponsors'
import { channelClipsApi } from './channel-clips'
import { projectsApi } from './projects'
import { autopilotApi } from './autopilot'

export type { ApiContext } from './context'

export function createApi(ctx: ApiContext): ApiHandlers {
  return {
    ...appApi(ctx),
    ...settingsApi(ctx),
    ...providersApi(ctx),
    ...routesApi(ctx),
    ...llmAccessApi(ctx),
    ...pricesApi(ctx),
    ...workflowApi(ctx),
    ...spendApi(ctx),
    ...chatApi(ctx),
    ...groupApi(ctx),
    ...viewsApi(ctx),
    ...agentsApi(ctx),
    ...productionApi(ctx),
    ...runsApi(ctx),
    ...analysisApi(ctx),
    ...moneyApi(ctx),
    ...toolsApi(ctx),
    ...teamApi(ctx),
    ...homeApi(ctx),
    ...ideasApi(ctx),
    ...exampleApi(ctx),
    ...cloudApi(ctx),
    ...orchestraApi(ctx),
    ...discordApi(ctx),
    ...brainApi(ctx),
    ...eyesApi(ctx),
    ...updateApi(ctx),
    ...channelLifeApi(ctx),
    ...googleApi(ctx),
    ...bricksApi(ctx),
    ...recipesApi(ctx),
    ...enginesApi(ctx),
    ...estimatesApi(ctx),
    ...pipelineAgentApi(ctx),
    ...styleAgentApi(ctx),
    ...cloneApi(ctx),
    ...reverseApi(ctx),
    ...ordersApi(ctx),
    ...previewsApi(ctx),
    ...graphApi(ctx),
    ...brickStylesApi(ctx),
    ...channelVoicesApi(ctx),
    ...channelPresentersApi(ctx),
    ...channelSponsorApi(ctx),
    ...channelClipsApi(ctx),
    ...projectsApi(ctx),
    ...autopilotApi(ctx)
  }
}

export function isApiMethod(api: ApiHandlers, method: unknown): method is ApiMethod {
  return typeof method === 'string' && Object.prototype.hasOwnProperty.call(api, method)
}

/** Calls a method by name with untyped args coming from IPC. */
export async function dispatch<M extends ApiMethod>(
  api: ApiHandlers,
  method: M,
  args: ApiArgs<M>
): Promise<ApiResult<M>> {
  const handler = api[method] as (...a: ApiArgs<M>) => ApiResult<M> | Promise<ApiResult<M>>
  return await handler(...args)
}
