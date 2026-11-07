// IPC handlers, module "channelSponsor": the channel's sponsor (src/main/production/sponsors). The service notifies 'production'
// after every write.
import type { ApiHandlers } from '../../shared/api'
import type { CHANNEL_SPONSOR_METHODS } from '../../shared/api/channel-sponsors'
import type { ApiContext } from './context'

type ChannelSponsorMethodKey = (typeof CHANNEL_SPONSOR_METHODS)[number]

export function channelSponsorApi(ctx: ApiContext): Pick<ApiHandlers, ChannelSponsorMethodKey> {
  return {
    'channelSponsor.get': (channelId) => ctx.channelSponsors.get(channelId),
    'channelSponsor.set': (channelId, text) => ctx.channelSponsors.set(channelId, text)
  }
}
