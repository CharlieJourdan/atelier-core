// The pipeline agent as the app builds it (core.ts): priced with the Cloud's engines like the estimates, its model calls on
// the « pipeline_architect » route (the best tier, Opus, until Réglages gives the role a route of its own: decision 0013),
// reserved and settled on the ledger like every agent call, Claude Code reaching the pipeline tools through the MCP bridge.
import type { ChangeTopic } from '../../../shared/api'
import type { McpLaunch } from '../../agents/runner'
import type { AppCloud } from '../../cloud'
import type { Db } from '../../db'
import type { Ledger } from '../../ledger'
import { askModel } from '../../llm/ask'
import type { PricesStore } from '../../llm/prices'
import type { RoutesStore } from '../../llm/routes'
import type { Provider, Usage } from '../../llm/types'
import type { SettingsStore } from '../../settings'
import { EstimatesService } from '../estimates'
import { PipelineAgentService } from './service'

/** What one turn of the pipeline agent is reserved at: a long prompt (the pipeline, the variants) and a few tool rounds. */
const TURN: Usage = { inputTokens: 20_000, outputTokens: 3_000, cacheReadTokens: 0, cacheWriteTokens: 0 }

export interface CreatePipelineAgent {
  db: Db
  settings: SettingsStore
  prices: PricesStore
  routes: RoutesStore
  ledger: Ledger
  cloud: AppCloud
  getProvider: (id: string) => Provider
  mcp: () => McpLaunch | null
  notify: (topic: ChangeTopic) => void
  now?: () => Date
}

export function createPipelineAgent(o: CreatePipelineAgent): PipelineAgentService {
  const estimates = new EstimatesService({
    db: o.db,
    settings: o.settings,
    prices: o.prices,
    routes: o.routes,
    liveEngines: async () => (o.cloud.session.connected() ? (await o.cloud.api.engines()).engines : null),
    ...(o.now ? { now: o.now } : {})
  })
  return new PipelineAgentService({
    db: o.db,
    estimates,
    notify: o.notify,
    ...(o.now ? { now: o.now } : {}),
    model: async (req) => {
      const r = await askModel(
        { ledger: o.ledger, routes: o.routes, settings: o.settings, getProvider: o.getProvider, mcp: o.mcp },
        { role: 'pipeline_architect', tier: 'best', system: req.system, prompt: req.prompt, tools: req.tools, channelId: req.channelId, estimate: TURN, maxTokens: 6000 }
      )
      return { text: r.text, model: r.model, toolsOffered: r.toolsOffered }
    }
  })
}
