import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

/**
 * Keys the renderer may not write through the generic `settings.set`: they have dedicated, validated api
 * methods (llm.*, budget.* via spend.*, cloud.* via cloud.*, discord.* via discord.*, brain.* via brain.*) or will hold paths or hosts the main process uses (engine.*,
 * production.*, paths.*). `engines.` and `blueprint.` are caches the main process writes from the Cloud (decision 0076).
 */
export const RESERVED_SETTING_PREFIXES = ['llm.', 'engine.', 'engines.', 'blueprint.', 'production.', 'paths.', 'budget.', 'cloud.', 'discord.', 'brain.', 'channelLife.'] as const

/** The largest value `settings.set` stores (as JSON): a setting is a preference, not a data store (decision 0076). */
export const MAX_SETTING_BYTES = 64 * 1024

export function settingsApi(ctx: ApiContext): Pick<ApiHandlers, 'settings.get' | 'settings.set' | 'settings.list'> {
  return {
    'settings.get': (key) => {
      if (typeof key !== 'string') throw new Error('Réglage invalide : un nom est attendu.')
      return ctx.settings.get(key)
    },
    'settings.set': (key, value) => {
      if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(key)) throw new Error('Réglage invalide : un nom est attendu.')
      if ((JSON.stringify(value ?? null) ?? '').length > MAX_SETTING_BYTES) throw new Error(`Setting ${key} is too large`)
      if (RESERVED_SETTING_PREFIXES.some((p) => key.startsWith(p))) {
        throw new Error(`Setting ${key} cannot be changed with settings.set`)
      }
      ctx.settings.set(key, value)
      ctx.notify('settings')
    },
    'settings.list': () => ctx.settings.all()
  }
}
