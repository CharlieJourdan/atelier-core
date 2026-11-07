// IPC handlers, module "channelVoices": the channel voice (src/main/production/voices). Writes notify 'production'.
import type { ApiHandlers } from '../../shared/api'
import type { CHANNEL_VOICES_METHODS } from '../../shared/api/channel-voices'
import type { ApiContext } from './context'

type ChannelVoicesMethodKey = (typeof CHANNEL_VOICES_METHODS)[number]

export function channelVoicesApi(ctx: ApiContext): Pick<ApiHandlers, ChannelVoicesMethodKey> {
  const v = ctx.channelVoices
  return {
    'channelVoices.list': (channelId) => v.list(channelId),
    'channelVoices.design': (input) => v.design(input),
    'channelVoices.keepDesign': (input) => v.keepDesign(input),
    'channelVoices.clone': (input) => v.clone(input),
    'channelVoices.fromChannelVideo': (input) => v.fromChannelVideo(input),
    'channelVoices.cloneOn': (voiceId, engine) => v.cloneOn(voiceId, engine),
    'channelVoices.import': (input) => v.import(input),
    'channelVoices.accept': (voiceId) => v.accept(voiceId),
    'channelVoices.setDefault': (voiceId) => v.setDefault(voiceId),
    'channelVoices.retire': (voiceId) => v.retire(voiceId),
    'channelVoices.blindTest': (voiceId, text) => v.blindTest(voiceId, text)
  }
}
