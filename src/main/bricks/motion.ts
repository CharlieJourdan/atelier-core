// The headless browser the motion designer's previews use (bricks.preview): the engine's own `chromiumService` on the Chromium, Chrome or
// Edge already on this computer (nothing is downloaded), started on the first preview and closed with the app; plus the embedded fonts.
import os from 'node:os'
import { chromiumService, findBrowser } from '../../engine/media/browser'
import { fontCssOf } from '../../engine/motion/fonts'
import type { BrowserService } from '../../engine/services'

export interface MotionTools {
  browser: () => BrowserService | null
  fontCss: () => Promise<string>
  close: () => Promise<void>
}

export function motionTools(resourcesDir: string): MotionTools {
  let service: BrowserService | null | undefined
  return {
    browser: () => {
      if (service !== undefined) return service
      const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
      service = exe ? chromiumService({ executablePath: exe }) : null
      return service
    },
    fontCss: () => fontCssOf(resourcesDir),
    close: async () => {
      await service?.close?.().catch(() => undefined)
      service = undefined
    }
  }
}
