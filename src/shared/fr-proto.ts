// French strings of the proto refresh (2026-10-24), one file per area so parallel work never edits the same file.
import { frPBrain } from './fr-p-brain'
import { frPHome } from './fr-p-home'
import { frPLiveBrain } from './fr-p-live-brain'
import { frPOnboarding } from './fr-p-onboarding'
import { frPFirstRun } from './fr-p-firstrun'
import { frPPlanning } from './fr-p-planning'
import { frPProduction } from './fr-p-production'
import { frPRecipes } from './fr-p-recipes'
import { frPEstimates } from './fr-p-estimates'
import { frPAgent } from './fr-p-agent'
import { frPStyle } from './fr-p-style'
import { frPParcours } from './fr-p-parcours'
import { frPGraph } from './fr-p-graph'
import { frPShell } from './fr-p-shell'
import { frPTeam } from './fr-p-team'
import { frPLab } from './fr-p-lab'
import { frPCreation } from './fr-p-creation'
import { frPMascots } from './fr-p-mascots'

export const frProto = {
  ...frPShell,
  ...frPHome,
  ...frPPlanning,
  ...frPProduction,
  ...frPRecipes,
  ...frPEstimates,
  ...frPAgent,
  ...frPStyle,
  ...frPParcours,
  ...frPLab,
  ...frPCreation,

  ...frPGraph,
  ...frPTeam,
  ...frPMascots,
  ...frPOnboarding,
  ...frPFirstRun,
  ...frPBrain,
  ...frPLiveBrain
} as const
