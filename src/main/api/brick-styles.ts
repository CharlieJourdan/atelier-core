// IPC handlers, module "brickStyles": the brick styles store (src/main/production/styles). Writes notify 'production'.
import type { ApiHandlers } from '../../shared/api'
import type { BRICK_STYLES_METHODS } from '../../shared/api/brick-styles'
import { BrickStyleStore } from '../production/styles'
import type { ApiContext } from './context'

type BrickStylesMethodKey = (typeof BRICK_STYLES_METHODS)[number]

export function brickStylesApi(ctx: ApiContext): Pick<ApiHandlers, BrickStylesMethodKey> {
  const store = new BrickStyleStore(ctx.db)
  const write = <T>(v: T): T => {
    ctx.notify('production')
    return v
  }
  return {
    'brickStyles.list': () => store.list(),
    'brickStyles.get': (name, version) => store.get(name, version),
    'brickStyles.save': (input) => write(store.save(input)),
    'brickStyles.export': (name, version) => store.exportFile(name, version),
    'brickStyles.import': (json) => write(store.importFile(json))
  }
}
