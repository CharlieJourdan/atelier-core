// One-shot model call for the lot Z1 screens (the Analyste, the Builder, offer packs, sponsor drafts…): the role's
// route picks provider, model and effort (Réglages › Claude et modèles), the ledger reserves before and settles after,
// exactly like agent runs. Claude Code (the user's subscription) by default; tests inject a FakeProvider.
import type { Ledger } from '../ledger'
import type { SettingsStore } from '../settings'
import { reserveFor, runReserved, unpricedReserveUsd } from '../agents/call'
import type { RoutesStore } from './routes'
import type { McpLaunch } from '../agents/runner'
import type { Tier } from '../../shared/roles'
import type { AgentTools, Provider, Usage } from './types'

export interface AskDeps {
  ledger: Ledger
  routes: RoutesStore
  settings: SettingsStore
  getProvider: (providerId: string) => Provider
  /** The agents' MCP relay: Claude Code reaches `tools` through it (absent: Claude Code runs without them). */
  mcp?: () => McpLaunch | null
}

export interface AskInput {
  /** Route role (an existing one, or any name: unknown roles use the balanced tier). */
  role: string
  /** The system prompt; a function gets whether the tools were offered (the prompt then explains the fallback). */
  system: string | ((toolsOffered: boolean) => string)
  prompt: string
  channelId?: number | null
  videoId?: number | null
  maxTokens?: number
  /** Expected usage for the reservation (default: one ordinary turn). */
  estimate?: Usage
  onText?: (delta: string) => void
  signal?: AbortSignal
  /** Atelier tools the model may call (production-12's pipeline tools); offered only when the provider takes them. */
  tools?: AgentTools
  /** The tier of a role that has no route of its own (default: balanced). */
  tier?: Tier
  /** Most agentic turns with tools (default 8). */
  maxTurns?: number
  /** Pictures to look at (absolute JPEG/PNG paths): « watch a whole video » sends its contact sheets. */
  images?: string[]
}

export interface AskResult {
  text: string
  model: string
  costUsd: number
  /** The provider took `tools` (Claude Code through the bridge, the fake in-process). */
  toolsOffered: boolean
  providerId: string
  usage: Usage
}

const ONE_TURN: Usage = { inputTokens: 3000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 }

export async function askModel(deps: AskDeps, input: AskInput): Promise<AskResult> {
  const resolved = deps.routes.resolve(input.role)
  // a role with no route of its own (not in Réglages › Claude et modèles) may ask for its tier: drafting a pipeline is « best »
  const route = input.tier && !deps.routes.get(input.role) ? { ...resolved, tier: input.tier, model: deps.routes.tierModels()[input.tier] } : resolved
  const estimate = input.estimate ?? ONE_TURN
  const channelId = input.channelId ?? null
  const who = { channelId, videoId: input.videoId ?? null, taskId: null }
  const unpriced = unpricedReserveUsd(deps.ledger, deps.settings, deps.routes, channelId, estimate)
  const handle = reserveFor(deps.ledger, route, estimate, who, unpriced)
  const provider = deps.getProvider(route.providerId)
  // Claude Code reaches the tools through the agents' MCP bridge (one token for this call, revoked after it)
  let revoke = (): void => undefined
  let tools: AgentTools | undefined
  if (input.tools && input.tools.specs.length > 0) {
    tools = { ...input.tools }
    const mcp = deps.mcp?.() ?? null
    if (route.providerId === 'claude-code' && mcp?.server.listening) {
      const reg = mcp.server.register({ specs: tools.specs, call: (n, a) => input.tools?.call(n, a) ?? Promise.reject(new Error('no tools')) })
      revoke = reg.revoke
      tools.mcp = { command: mcp.command, args: mcp.args, env: { ...mcp.env, ELECTRON_RUN_AS_NODE: '1', ATELIER_BRIDGE: mcp.server.address, ATELIER_BRIDGE_TOKEN: reg.token } }
    }
    if (provider.acceptsTools?.(tools) !== true) {
      revoke()
      revoke = (): void => undefined
      tools = undefined
    }
  }
  const { result, costUsd } = await runReserved(
    deps.ledger,
    handle,
    provider,
    {
      model: route.model,
      system: typeof input.system === 'string' ? input.system : input.system(tools !== undefined),
      prompt: input.prompt,
      maxTokens: input.maxTokens ?? 4000,
      ...(route.effort ? { effort: route.effort } : {}),
      ...(tools ? { tools, maxTurns: input.maxTurns ?? 8 } : {}),
      ...(input.images && input.images.length > 0 ? { images: input.images } : {})
    },
    input.onText,
    input.signal
  ).finally(revoke)
  return { text: result.text, model: route.model, costUsd, toolsOffered: tools !== undefined, providerId: route.providerId, usage: result.usage }
}
