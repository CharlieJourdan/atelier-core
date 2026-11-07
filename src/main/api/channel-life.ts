// IPC handlers, module "channelLife": archive / restore a channel, its language, « Traduire une chaîne » (src/main/channels/life.ts).
import type { ApiHandlers } from '../../shared/api'
import type { CHANNEL_LIFE_METHODS } from '../../shared/api/channel-life'
import { PipelineLibrary } from '../analysis/library'
import { StyleStore } from '../analysis/styles'
import { ChannelLife } from '../channels/life'
import type { ApiContext } from './context'

type Methods = (typeof CHANNEL_LIFE_METHODS)[number]

export function channelLifeApi(ctx: ApiContext): Pick<ApiHandlers, Methods> {
  const life = new ChannelLife({
    channels: ctx.workflow.channels,
    settings: ctx.settings,
    library: new PipelineLibrary(ctx.db),
    styles: new StyleStore(ctx.db),
    eyes: ctx.eyes.store,
    runtime: ctx.orchestra
  })
  const changed = (): void => {
    for (const t of ['channels', 'orchestra', 'videos'] as const) ctx.notify(t)
  }
  return {
    'channelLife.archive': (id) => {
      const res = life.archive(id)
      changed()
      return res
    },
    'channelLife.restore': (id) => {
      const res = life.restore(id)
      changed()
      return res
    },
    'channelLife.meta': () => life.meta(),
    'channelLife.findTranslation': (sourceId, language) => life.findTranslation(sourceId, language),
    'channelLife.translate': (input) => {
      const res = life.translate(input)
      changed()
      ctx.notify('pipelines')
      return res
    }
  }
}
