// Screens of lot Z1 owned by this area: reglages/* except galerie. Two maps, so the team pages (account/)
// and the preference pages (prefs/) are built side by side without editing the same file.
import type { ScreenMap } from '../registry'
import { ACCOUNT_SCREENS } from './account'
import { PREFS_SCREENS } from './prefs'

export const SETTINGS_SCREENS: ScreenMap = { ...PREFS_SCREENS, ...ACCOUNT_SCREENS }
