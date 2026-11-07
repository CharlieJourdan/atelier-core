// IPC handlers, module "channelClips": a channel's clip library and post-card avatar (src/main/production/clips). The service
// notifies 'production' after every write.
import type { ApiHandlers } from '../../shared/api'
import type { CHANNEL_CLIPS_METHODS } from '../../shared/api/channel-clips'
import type { ApiContext } from './context'

type ChannelClipsMethodKey = (typeof CHANNEL_CLIPS_METHODS)[number]

export function channelClipsApi(ctx: ApiContext): Pick<ApiHandlers, ChannelClipsMethodKey> {
  return {
    'channelClips.get': (channelId) => ctx.channelClips.view(channelId),
    'channelClips.fromStock': (channelId, req) => ctx.channelClips.fromStock(channelId, req ?? {}),
    'channelClips.addFiles': (channelId, files) => ctx.channelClips.addFiles(channelId, files),
    'channelClips.setAvatar': (channelId, file) => ctx.channelClips.setAvatar(channelId, file),
    'channelClips.setMusic': (channelId, file) => ctx.channelClips.setMusic(channelId, file)
  }
}
