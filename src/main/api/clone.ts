// IPC handlers, module "clone" (moteur-assemblage): « Créer une pipeline » on the cloning engine
// (src/main/production/clone/engine.ts). Every argument is checked in the engine (the renderer is untrusted).
import type { ApiHandlers } from '../../shared/api'
import type { CLONE_METHODS } from '../../shared/api/clone'
import type { ApiContext } from './context'

type CloneMethodKey = (typeof CLONE_METHODS)[number]

export function cloneApi(ctx: Pick<ApiContext, 'clones'>): Pick<ApiHandlers, CloneMethodKey> {
  const c = ctx.clones
  return {
    'clone.intakeStart': () => c.startIntake(),
    'clone.intakeTurn': (state, message) => c.intakeTurn(state, message),
    'clone.start': (state) => c.start(state),
    'clone.list': () => c.list(),
    'clone.progress': (id) => c.progress(id),
    'clone.report': (id) => c.report(id),
    'clone.resume': (id, budgetUsd) => c.resume(id, budgetUsd),
    'clone.answer': (id, style) => c.answer(id, style),
    'clone.file': (id, rel) => c.file(id, rel),
    'clone.remove': (id) => c.remove(id)
  }
}
