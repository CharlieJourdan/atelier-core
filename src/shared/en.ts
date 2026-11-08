// English catalogue: same keys as fr.ts, one file per area. A key missing here falls back to French (see `t`).
// The first-generation catalogues come first so the proto (`enP*`) files, spread last, win on any shared key.
import type { MessageKey } from './fr'
import { enAgents } from './en-agents'
import { enAnalysis } from './en-analysis'
import { enAnalysisPipelines } from './en-analysis-pipelines'
import { enAnalysisScreens } from './en-analysis-screens'
import { enChat } from './en-chat'
import { enCloud } from './en-cloud'
import { enComputers } from './en-computers'
import { enCore } from './en-core'
import { enExample } from './en-example'
import { enDemo } from './en-demo'
import { enHome } from './en-home'
import { enIdeas } from './en-ideas'
import { enMoney } from './en-money'
import { enProduction } from './en-production'
import { enRuns } from './en-runs'
import { enSettings } from './en-settings'
import { enSettingsPrefs } from './en-settings-prefs'
import { enTools } from './en-tools'
import { enDiscord } from './en-discord'
import { enBrain } from './en-brain'
import { enEyes } from './en-eyes'
import { enUpdate } from './en-update'
import { enAgentRuntime } from './en-agent-runtime'
import { enBeta } from './en-beta'
import { enLlmAccess } from './en-llm-access'
import { enClaudeUsage } from './en-claude-usage'
import { enGoogle } from './en-google'
import { enAutopilot } from './en-autopilot'
import { enPBrain } from './en-p-brain'
import { enPLiveBrain } from './en-p-live-brain'
import { enPHome } from './en-p-home'
import { enPOnboarding } from './en-p-onboarding'
import { enPFirstRun } from './en-p-firstrun'
import { enPPlanning } from './en-p-planning'
import { enPProduction } from './en-p-production'
import { enPRecipes } from './en-p-recipes'
import { enPEstimates } from './en-p-estimates'
import { enPAgent } from './en-p-agent'
import { enPStyle } from './en-p-style'
import { enPParcours } from './en-p-parcours'
import { enPLab } from './en-p-lab'
import { enPCreation } from './en-p-creation'
import { enClone } from './en-clone'
import { enPGraph } from './en-p-graph'
import { enPShell } from './en-p-shell'
import { enPTeam } from './en-p-team'
import { enPMascots } from './en-p-mascots'

export const en: Partial<Record<MessageKey, string>> = {
  ...enCore,
  ...enChat,
  ...enExample,
  ...enDemo,
  ...enHome,
  ...enProduction,
  ...enRuns,
  ...enAnalysis,
  ...enAnalysisPipelines,
  ...enAnalysisScreens,
  ...enMoney,
  ...enTools,
  ...enAgents,
  ...enComputers,
  ...enSettings,
  ...enIdeas,
  ...enSettingsPrefs,
  ...enCloud,
  ...enPShell,
  ...enPHome,
  ...enPPlanning,
  ...enPProduction,
  ...enPRecipes,
  ...enPEstimates,
  ...enPAgent,
  ...enPStyle,
  ...enPParcours,
  ...enPLab,
  ...enPCreation,
  ...enClone,

  ...enPGraph,
  ...enPTeam,
  ...enPMascots,
  ...enPOnboarding,
  ...enPFirstRun,
  ...enPBrain,
  ...enPLiveBrain,
  ...enDiscord,
  ...enBrain,
  ...enEyes,
  ...enUpdate,
  ...enAgentRuntime,
  ...enBeta,
  ...enLlmAccess,
  ...enClaudeUsage,
  ...enGoogle,
  ...enAutopilot
}
