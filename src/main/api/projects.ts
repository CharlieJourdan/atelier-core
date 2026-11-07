// IPC handlers, module "projects": one video from a pinned recipe version, launched through our engine's runs
// (src/main/production/recipes/projects.ts). Writes notify 'production'.
import type { ApiHandlers } from '../../shared/api'
import type { PROJECTS_METHODS } from '../../shared/api/projects'
import { ProjectStore, RecipeStore } from '../production/recipes'
import { scriptFromFile } from '../production/recipes/script-file'
import type { ApiContext } from './context'

type ProjectsMethodKey = (typeof PROJECTS_METHODS)[number]

export function projectsApi(ctx: ApiContext): Pick<ApiHandlers, ProjectsMethodKey> {
  const projects = new ProjectStore(ctx.db, new RecipeStore(ctx.db), ctx.productionRuns)
  const write = <T>(v: T): T => {
    ctx.notify('production')
    return v
  }
  return {
    'projects.list': (filter) => projects.list(filter),
    'projects.get': (id) => projects.get(id),
    'projects.create': (input) => write(projects.create(input)),
    'projects.update': (id, input) => write(projects.update(id, input)),
    'projects.compile': (id) => projects.compile(id),
    'projects.run': async (id, options) => write(await projects.run(id, options)),
    'projects.quote': (id, options) => projects.quote(id, options),
    'projects.readScript': (file) => scriptFromFile(file)
  }
}
