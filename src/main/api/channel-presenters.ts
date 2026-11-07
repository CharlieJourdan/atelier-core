// IPC handlers, module "channelPresenters": the channel presenter (src/main/production/presenters). The service notifies
// 'production' after every write.
import type { ApiHandlers } from '../../shared/api'
import type { CHANNEL_PRESENTERS_METHODS } from '../../shared/api/channel-presenters'
import type { ApiContext } from './context'

type ChannelPresentersMethodKey = (typeof CHANNEL_PRESENTERS_METHODS)[number]

export function channelPresentersApi(ctx: ApiContext): Pick<ApiHandlers, ChannelPresentersMethodKey> {
  const p = ctx.channelPresenters
  return {
    'channelPresenters.list': (channelId) => p.list(channelId),
    'channelPresenters.portrait': (input) => p.portrait(input),
    'channelPresenters.clone': (input) => p.clone(input),
    'channelPresenters.angles': (presenterId, input) => p.angles(presenterId, input),
    'channelPresenters.clean': (presenterId) => p.clean(presenterId),
    'channelPresenters.register': (presenterId, engine, id) => p.register(presenterId, engine, id),
    'channelPresenters.accept': (presenterId) => p.accept(presenterId),
    'channelPresenters.setDefault': (presenterId) => p.setDefault(presenterId),
    'channelPresenters.retire': (presenterId) => p.retire(presenterId),
    'channelPresenters.linkVoice': (presenterId, voiceId) => p.linkVoice(presenterId, voiceId)
  }
}
