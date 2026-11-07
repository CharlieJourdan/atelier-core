// IPC handlers, module "previews" (production-15): the saved previews per technology (src/main/production/previews).
import { previewKeysOf, type RecipeDoc } from '../../engine/technologies'
import type { ApiHandlers } from '../../shared/api'
import type { PREVIEWS_METHODS } from '../../shared/api/previews'
import type { ApiContext } from './context'

type PreviewsMethodKey = (typeof PREVIEWS_METHODS)[number]

export function previewsApi(ctx: Pick<ApiContext, 'previews' | 'pipelineAgent'>): Pick<ApiHandlers, PreviewsMethodKey> {
  return {
    'previews.forDoc': (doc) => {
      if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as { bricks?: unknown }).bricks)) throw new Error('Pipeline invalide.')
      return ctx.previews.list(previewKeysOf(doc as unknown as RecipeDoc, ctx.pipelineAgent.recipes.registry).map((k) => k.key))
    },
    'previews.file': (key, ref) => ctx.previews.file(key, ref),
    'previews.options': () => ctx.previews.list().filter((i) => i.kind === 'option')
  }
}
