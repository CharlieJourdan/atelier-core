// IPC handlers, module "example" (lot Z1): the example workspace.
import type { ApiHandlers, ChangeTopic } from '../../shared/api'
import type { ApiContext } from './context'

/** Every screen may show example rows: after a load or a delete they all refresh. */
const TOPICS: readonly ChangeTopic[] = ['example', 'channels', 'videos', 'production', 'credits', 'analysis', 'pipelines', 'money', 'tools', 'team', 'computers', 'ideas', 'agents']

export function exampleApi(ctx: ApiContext): Pick<ApiHandlers, 'example.status' | 'example.load' | 'example.delete'> {
  const changed = (): void => {
    for (const t of TOPICS) ctx.notify(t)
  }
  return {
    'example.status': () => ctx.example.status(),
    'example.load': () => {
      const s = ctx.example.load()
      changed()
      return s
    },
    'example.delete': () => {
      const s = ctx.example.delete()
      changed()
      return s
    }
  }
}
