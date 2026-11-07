// IPC handlers, module "llm" (access): the beta rule on models (decision 0038). One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

export function llmAccessApi(ctx: ApiContext): Pick<ApiHandlers, 'llm.access' | 'llm.setDirectorBackend'> {
  return {
    'llm.access': () => ctx.access.status(),
    'llm.setDirectorBackend': (backend) => {
      const out = ctx.access.setDirectorBackend(backend)
      ctx.notify('routes')
      return out
    }
  }
}
