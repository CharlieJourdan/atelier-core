// IPC contract, module "settings": Settings store (secrets never travel here).
import type { JsonValue } from './core'

export interface SettingsContract {
  'settings.get': { args: [key: string]; result: JsonValue | null }

  'settings.set': { args: [key: string, value: JsonValue]; result: void }

  'settings.list': { args: []; result: Record<string, JsonValue> }
}

export const SETTINGS_METHODS = [
  'settings.get',
  'settings.set',
  'settings.list'
] as const satisfies readonly (keyof SettingsContract)[]
