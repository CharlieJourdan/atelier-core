// IPC handlers, module "update": the app updating itself from Atelier Cloud's update feed (src/main/updater). The renderer
// only asks for the status, a check, the install and the channel; the downloaded file never travels over IPC.
import type { ApiHandlers } from '../../shared/api'
import type { UPDATE_METHODS } from '../../shared/api/update'
import type { ApiContext } from './context'

export function updateApi(ctx: ApiContext): Pick<ApiHandlers, (typeof UPDATE_METHODS)[number]> {
  const { updates } = ctx
  return {
    'app.update.status': () => updates.status(),
    'app.update.check': () => updates.check(),
    'app.update.install': async () => updates.install(),
    'app.update.setChannel': (channel) => updates.setChannel(channel)
  }
}
