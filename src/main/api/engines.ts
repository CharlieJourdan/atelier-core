// IPC handlers, module "engines": the engines registry of Atelier Cloud (decision 0021). Read-only; a signed-out or
// unreachable Cloud is an answer (`available: false` and a French reason), not an error.
import type { ApiHandlers, JsonValue } from '../../shared/api'
import type { ENGINES_METHODS } from '../../shared/api/engines'
import { ENGINES_CACHE_KEY } from '../production/estimates/book'
import type { ApiContext } from './context'

type EnginesMethodKey = (typeof ENGINES_METHODS)[number]

export function enginesApi(ctx: Pick<ApiContext, 'cloud'> & Partial<Pick<ApiContext, 'settings'>>): Pick<ApiHandlers, EnginesMethodKey> {
  const { session, api } = ctx.cloud
  return {
    'engines.list': async () => {
      if (!session.connected()) return { available: false, reason: 'Connecte Atelier Cloud pour voir les moteurs.', engines: [] }
      try {
        const engines = (await api.engines()).engines
        // kept for the estimates (production-11): the app still prices a pipeline offline with the last prices read
        ctx.settings?.set(ENGINES_CACHE_KEY, { at: new Date().toISOString(), engines: engines as unknown as JsonValue })
        return { available: true, reason: null, engines }
      } catch {
        return { available: false, reason: 'Atelier Cloud ne répond pas : moteurs indisponibles.', engines: [] }
      }
    }
  }
}
