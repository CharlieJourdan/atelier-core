// Screens of lot Z1 owned by this area: outils.
import type { ScreenMap } from '../registry'

import { ToolsScreen } from './ToolsScreen'

// Proto refresh: Mes outils lives inside Production (tab « Outils (bêta) »); the old route still works.
export const TOOLS_SCREENS: ScreenMap = { outils: ToolsScreen, 'production/outils': ToolsScreen }
