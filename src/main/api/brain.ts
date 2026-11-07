// brain.*: the link to the team computer's headless brain (src/main/brain). Without a link (the headless host itself,
// tests that do not build one) the app is always « local » and connecting is refused.
import type { ApiHandlers, BrainStatus } from '../../shared/api'
import { t } from '../../shared/fr'
import type { ApiContext } from './context'

const LOCAL: BrainStatus = { mode: 'local', url: null, name: null, tokenSet: false, live: false, error: null, storage: null }

export function brainApi(ctx: ApiContext): Pick<ApiHandlers, 'brain.status' | 'brain.connect' | 'brain.disconnect'> {
  return {
    'brain.status': () => ctx.brain?.status() ?? LOCAL,
    'brain.connect': async (input) => {
      if (!ctx.brain) throw new Error(t('brain.unavailable', { reason: t('brain.unavailable.link') }))
      return ctx.brain.connect(input)
    },
    'brain.disconnect': () => ctx.brain?.disconnect() ?? LOCAL
  }
}
