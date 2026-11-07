import path from 'node:path'
import type { ApiHandlers, OnboardingStatus } from '../../shared/api'
import type { Db } from '../db'
import { machineReader } from '../machine'
import { pipelineCodesOn } from '../production/recipes/codes'
import type { SettingsStore } from '../settings'
import type { ApiContext } from './context'

/** Database setting: the first-run onboarding was finished (or ended with « Plus tard »). */
export const ONBOARDED_KEY = 'app.onboarded'

/**
 * Done once stored, or when the workspace already has a channel of its own (made before this setting existed, archived
 * ones included); the example workspace's invented channels do not count.
 */
export function onboardingStatus(db: Db, settings: SettingsStore): OnboardingStatus {
  if (settings.get(ONBOARDED_KEY) === true) return { done: true }
  const own = db.prepare('SELECT 1 FROM channels WHERE example = 0 LIMIT 1').get()
  return { done: own !== undefined }
}

export function appApi(ctx: ApiContext): Pick<ApiHandlers, 'app.info' | 'app.setTheme' | 'app.machine' | 'app.onboarding' | 'app.finishOnboarding'> {
  const machine = machineReader()
  return {
    // the dev flags of hand editing (decision 0051) and pipeline codes (production-lab): read at each call, off in the beta
    'app.info': () => ({ ...ctx.appInfo(), pipelineDev: process.env.ATELIER_PIPELINE_DEV === '1', pipelineCodes: pipelineCodesOn() }),

    'app.setTheme': (theme) => {
      if (theme !== 'dark' && theme !== 'light') throw new Error(`Unknown theme: ${String(theme)}`)
      ctx.setWindowTheme(theme)
    },
    'app.machine': () => machine(path.dirname(ctx.appInfo().dbPath)),
    'app.onboarding': () => onboardingStatus(ctx.db, ctx.settings),
    'app.finishOnboarding': () => {
      ctx.settings.set(ONBOARDED_KEY, true)
      ctx.notify('settings')
      return onboardingStatus(ctx.db, ctx.settings)
    }
  }
}
