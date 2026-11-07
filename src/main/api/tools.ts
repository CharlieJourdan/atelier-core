// IPC handlers, module "tools" (lot Z1). One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { TOOLS_METHODS } from '../../shared/api/tools'
import { ToolsStore } from '../tools/store'
import type { ApiContext } from './context'

type ToolsMethodKey = (typeof TOOLS_METHODS)[number]

export function toolsApi(ctx: ApiContext): Pick<ApiHandlers, ToolsMethodKey> {
  const store = new ToolsStore(ctx.db, ctx.secrets, () => ctx.agents.list().map((a) => a.id))
  const done = <T>(value: T): T => {
    ctx.notify('tools')
    return value
  }
  return {
    'tools.list': () => store.list(),
    'tools.get': (slug) => store.get(slug),
    'tools.validate': (text) => store.validate(text),
    'tools.add': (text) => done(store.add(text)),
    'tools.delete': (slug) => {
      store.delete(slug)
      done(undefined)
    },
    'tools.setEnabled': (slug, enabled) => done(store.setEnabled(slug, enabled)),
    'tools.setPermission': (slug, id, granted) => done(store.setPermission(slug, id, granted)),
    'tools.setAgents': (slug, ids) => done(store.setAgents(slug, ids)),
    'tools.setSecret': (slug, name, value) => done(store.setSecret(slug, name, value)),
    'tools.clearSecret': (slug, name) => done(store.clearSecret(slug, name)),
    'tools.importVersion': (slug, text) => done(store.importVersion(slug, text)),
    'tools.activateVersion': (slug, version) => done(store.activateVersion(slug, version)),
    'tools.dryRun': (slug, input) => done(store.dryRun(slug, input)),
    'tools.runs': (slug) => store.runs(slug)
  }
}
