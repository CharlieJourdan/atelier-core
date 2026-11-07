// IPC handlers, module "style" (production-15): « Reproduire un style » (src/main/production/style-agent).
import type { ApiHandlers } from '../../shared/api'
import type { STYLE_METHODS } from '../../shared/api/style-agent'
import { checkPositiveId } from '../production/recipes/store'
import type { ApiContext } from './context'

type StyleMethodKey = (typeof STYLE_METHODS)[number]

export function styleAgentApi(ctx: Pick<ApiContext, 'styleAgent'>): Pick<ApiHandlers, StyleMethodKey> {
  const s = ctx.styleAgent
  const study = (v: unknown): number => checkPositiveId(v, 'Étude')
  return {
    'style.study': (input) => s.study(input),
    'style.get': (id) => s.get(study(id)),
    'style.list': () => s.list(),
    'style.answer': (id, answers) => s.answer(study(id), answers),
    'style.channel': (id, channelId) => s.setChannel(study(id), checkPositiveId(channelId, 'Chaîne')),
    'style.script': (id, script) => s.setScript(study(id), script),
    'style.quote': (id, variant) => s.quote(study(id), variant),
    'style.sample': (id, variant, quoteId) => s.sample(study(id), variant, quoteId),
    'style.pick': (id, ids) => s.pick(study(id), ids),
    'style.choose': (id, ingredient, option) => s.choose(study(id), ingredient, option),
    'style.applyGap': (id, index) => s.applyGap(study(id), index),
    'style.adopt': (id, variant) => s.adopt(study(id), variant)
  }
}
