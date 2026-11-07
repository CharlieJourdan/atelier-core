// Screens of lot Z1 owned by this area: ordinateurs. The proto refresh routes it to the team computer screen
// (screens/team); the old ComputersScreen blocks stay reachable under « Avancé » there.
import type { ScreenMap } from '../registry'
import { ComputerScreen } from '../team/ComputerScreen'

export const COMPUTERS_SCREENS: ScreenMap = { ordinateurs: ComputerScreen }
