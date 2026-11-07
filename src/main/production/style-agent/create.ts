// The style agent as the app builds it (core.ts): the eyes through Atelier Cloud (their demonstration when it is not
// connected), the samples as normal runs, its one model call on the « pipeline_architect » route (the best tier, reserved
// and settled on the ledger like every agent call; the beta rule of decision 0038 applies through the routes), the
// adoption through production-12's pipeline agent.
import type { ChangeTopic } from '../../../shared/api'
import type { AppCloud } from '../../cloud'
import type { Db } from '../../db'
import type { Ledger } from '../../ledger'
import { askModel } from '../../llm/ask'
import type { PricesStore } from '../../llm/prices'
import type { RoutesStore } from '../../llm/routes'
import type { Provider, Usage } from '../../llm/types'
import { creditsForUnits, type UnitPrices } from '../../credits/prices'
import type { SettingsStore } from '../../settings'
import { EstimatesService } from '../estimates'
import type { PipelineAgentService } from '../pipeline-agent'
import type { ProductionRuns } from '../runs/service'
import { youtubeMeta } from '../../eyes/youtube-meta'
import { demoIntel } from './references'
import { runSampler } from './sample-runner'
import { StyleAgentService } from './service'

/** One turn: the references' measures and the proposal in, two short texts out. */
const TURN: Usage = { inputTokens: 6_000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 }

export interface CreateStyleAgent {
  db: Db
  settings: SettingsStore
  prices: PricesStore
  routes: RoutesStore
  ledger: Ledger
  cloud: AppCloud
  getProvider: (id: string) => Provider
  pipelineAgent: PipelineAgentService
  runs: () => ProductionRuns | null
  unitPrices: () => UnitPrices | null
  notify: (topic: ChangeTopic) => void
  /** Read the references' public pages with yt-dlp on this machine (titles, length, channel, description). */
  readPages?: boolean
  now?: () => Date
}

export function createStyleAgent(o: CreateStyleAgent): StyleAgentService {
  const estimates = new EstimatesService({
    db: o.db,
    settings: o.settings,
    prices: o.prices,
    routes: o.routes,
    liveEngines: async () => (o.cloud.session.connected() ? (await o.cloud.api.engines()).engines : null),
    ...(o.now ? { now: o.now } : {})
  })
  const recipes = o.pipelineAgent.recipes
  const demo = demoIntel()
  return new StyleAgentService({
    db: o.db,
    reg: recipes.registry,
    costInput: () => estimates.costInput(),
    intel: () => (o.cloud.intel.connected() ? o.cloud.intel : demo),
    // the real app reads the public pages on this machine (tests never start yt-dlp)
    ...(o.readPages ? { meta: youtubeMeta() } : {}),
    sampler: runSampler(o.db, recipes, o.runs),
    model: async (req) => {
      const r = await askModel({ ledger: o.ledger, routes: o.routes, settings: o.settings, getProvider: o.getProvider }, { role: 'pipeline_architect', tier: 'best', system: req.system, prompt: req.prompt, estimate: TURN, maxTokens: 2000 })
      return { text: r.text, model: r.model }
    },
    adopt: (input) => o.pipelineAgent.adopt(input),
    recipe: (id) => {
      try {
        return { name: recipes.get(id).name, doc: recipes.doc(id).doc }
      } catch {
        return null
      }
    },
    rework: (id, ops, note) => recipes.edit(id, ops, note),
    channels: () => (o.db.prepare('SELECT id FROM channels WHERE archived_at IS NULL ORDER BY id').all() as { id: number }[]).map((r) => r.id),
    measureCredits: (minutes) => creditsForUnits([{ unit: 'watch_min', qty: minutes }], undefined, o.unitPrices()),
    notify: o.notify,
    ...(o.now ? { now: o.now } : {})
  })
}
