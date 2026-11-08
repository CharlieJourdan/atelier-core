// All the demo's typed handlers, one domain file each (api-*.ts). A method no file answers gets the bridge's default.
import type { DemoHandlers } from './bridge'
import { createHandlers } from './api-create'
import { labHandlers } from './api-lab'
import { runsHandlers } from './api-runs'
import { settingsHandlers } from './api-settings'

export function demoHandlers(): DemoHandlers {
  return {
    'app.setTheme': () => undefined,
    ...settingsHandlers,
    ...labHandlers,
    ...runsHandlers,
    ...createHandlers
  }
}
