// Screens of lot Z1 owned by this area: agents. The proto refresh routes `agents` to the team screen (screens/team);
// the old grid (AgentsScreen) stays in the code base and is still tested directly.
import type { ScreenMap } from '../registry'
import { TeamScreen } from '../team/TeamScreen'

export const AGENTS_SCREENS: ScreenMap = { agents: TeamScreen }
