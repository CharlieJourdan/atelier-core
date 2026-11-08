// Demo handlers: settings (see handlers.ts). The shell chrome and every Réglages page, plus the API-backed parts of
// Équipe, Monétisation › Avancé and Ordinateurs, split by area in the api-settings-*.ts siblings (shared state in
// api-settings-state.ts). Every account, key and connection form succeeds at once on fictional data; no secret is kept.
import type { DemoHandlers } from './bridge'
import { accountSettingsHandlers } from './api-settings-account'
import { cloudSettingsHandlers } from './api-settings-cloud'
import { moneySettingsHandlers } from './api-settings-money'
import { prefsSettingsHandlers } from './api-settings-prefs'

export const settingsHandlers: DemoHandlers = {
  ...cloudSettingsHandlers,
  ...accountSettingsHandlers,
  ...prefsSettingsHandlers,
  ...moneySettingsHandlers
}
