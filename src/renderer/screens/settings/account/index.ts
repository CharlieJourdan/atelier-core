// Réglages pages of the team area (lot Z1): compte, equipe, claude, cloud, admin.
import type { ScreenMap } from '../../registry'
import { AccountScreen } from './AccountScreen'
import { AdminScreen } from './AdminScreen'
import { ClaudeScreen } from './ClaudeScreen'
import { CloudScreen } from './CloudScreen'
import { TeamScreen } from './TeamScreen'

export const ACCOUNT_SCREENS: ScreenMap = {
  'reglages/compte': AccountScreen,
  'reglages/equipe': TeamScreen,
  'reglages/claude': ClaudeScreen,
  'reglages/cloud': CloudScreen,
  'reglages/admin': AdminScreen
}
