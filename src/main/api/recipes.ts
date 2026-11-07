// IPC handlers, module "recipes": the technologies of the code registry, the team's recipes, a channel's production
// settings and the recipe file (src/main/production/recipes). Writes notify 'production'.
import type { ApiHandlers } from '../../shared/api'
import type { RECIPES_METHODS } from '../../shared/api/recipes'
import { listTechnologies, RecipeStore } from '../production/recipes'
import { CODES_OFF, pipelineCodesOn } from '../production/recipes/codes'
import type { ApiContext } from './context'

type RecipesMethodKey = (typeof RECIPES_METHODS)[number]

export function recipesApi(ctx: ApiContext): Pick<ApiHandlers, RecipesMethodKey> {
  const store = new RecipeStore(ctx.db)
  const write = <T>(v: T): T => {
    ctx.notify('production')
    return v
  }
  return {
    'technologies.list': () => listTechnologies(store.registry),
    'recipes.bases': () => store.bases(),
    'recipes.fromBase': (baseId, name) => write(store.fromBase(baseId, name)),
    'recipes.translate': (id, language) => write(store.translate(id, language)),
    'recipes.edit': (id, ops, note) => write(store.edit(id, ops, note)),
    'recipes.list': () => store.list(),
    'recipes.get': (id, version) => store.get(id, version),
    'recipes.check': (doc) => store.check(doc),
    'recipes.save': (input) => write(store.save(input)),
    'recipes.archive': (id, archived) => write(store.archive(id, archived)),
    'recipes.compile': (id, channelId) => store.compile(id, channelId),
    'recipes.export': (id, version) => store.exportFile(id, version),
    'recipes.import': (json) => write(store.importFile(json)),
    // pipeline codes: built, off in the beta (production-lab, Charlie 01/11)
    'recipes.share': (id, version) => {
      if (!pipelineCodesOn()) throw new Error(CODES_OFF)
      return store.share(id, version)
    },
    'recipes.fromCode': (text) => {
      if (!pipelineCodesOn()) throw new Error(CODES_OFF)
      return write(store.fromCode(text))
    },

    'recipes.channel': (channelId) => store.channel(channelId),
    'recipes.setChannel': (channelId, input) => write(store.setChannel(channelId, input)),
    'recipes.useForChannel': (channelId, videoType, recipeId) => write(store.useForChannel(channelId, videoType, recipeId))
  }
}
