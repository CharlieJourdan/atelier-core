// Screens of lot Z1 owned by this area: production/idees, production/automatisations, production/ressources.
import type { ScreenMap } from '../registry'
import { AutomationsScreen } from './AutomationsScreen'
import { IdeasScreen } from './IdeasScreen'
import { ResourcesScreen } from './ResourcesScreen'

export const IDEAS_SCREENS: ScreenMap = {
  'production/idees': IdeasScreen,
  'production/automatisations': AutomationsScreen,
  'production/ressources': ResourcesScreen
}
