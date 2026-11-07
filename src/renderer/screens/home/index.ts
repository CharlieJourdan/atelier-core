// Screens owned by this area: accueil (the dashboard), validations.
import type { ScreenMap } from '../registry'
import { HomeScreen } from './HomeScreen'
import { ValidationsScreen } from './ValidationsScreen'

export const HOME_SCREENS: ScreenMap = { accueil: HomeScreen, validations: ValidationsScreen }
