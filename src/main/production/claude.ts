// The engine's Claude service in the app (ENGINE-SPEC R32.1, decisions 0013 and 0026): every Claude call of a production
// node goes to the team's LLM backend (the default provider of Réglages › Claude et modèles: « Mon abonnement Claude » =
// the Claude Code CLI, « Ma clé API » = the Anthropic API), reserved and settled in the ledger like the agents' calls.
// The model follows the use (0013): the call's tier (`balanced` = Sonnet writes, `fast` = Haiku for the small passes)
// picks the tier model, unless the owner pinned a model on the role. A role pinned to another provider keeps it.
// The beta rule (decision 0038): the script's roles run on the user's subscription only (locked without one); every
// other role is the director's side of the run, on the subscription or the Anthropic API key as the user picked.
// A dead sign-in becomes the run's French stop with the action to take (production-17).
// Tests inject a FakeProvider; nothing here talks to a network by itself.
import { EngineError } from '../../engine/errors'
import type { ClaudeService } from '../../engine/services'
import { detectAuthFailure } from '../orchestra/limits'
import { reserveFor, runReserved, unpricedReserveUsd } from '../agents/call'
import type { Ledger } from '../ledger'
import type { RoutesStore } from '../llm/routes'
import type { ProviderId } from '../../shared/api'
import { t } from '../../shared/fr'
import { isDirectorRole, lockedError, type LlmAccess } from '../llm/access'
import { ProviderError, type AgentTools, type Provider, type Usage } from '../llm/types'
import type { SettingsStore } from '../settings'

export interface EngineClaudeDeps {
  ledger: Ledger
  routes: RoutesStore
  settings: SettingsStore
  getProvider: (providerId: string) => Provider
  /** The tools a `web` call may use (WebSearch through the agents' MCP bridge); absent: the call runs without them. */
  webTools?: () => AgentTools | null
  /** The beta rule; absent (older callers, tests of the routing alone): the role's route decides, as before. */
  access?: LlmAccess
  /** The Anthropic API provider, for the director on « ma clé API ». */
  apiProvider?: () => Provider
}

const ONE_PASS: Usage = { inputTokens: 6000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** The model a call goes to: the role's own pinned model, else the model of the call's tier, else the role's tier model. */
export function modelFor(routes: RoutesStore, role: string, tier: 'best' | 'balanced' | 'fast' | undefined): { providerId: string; model: string } {
  const resolved = routes.resolve(role)
  const pinned = routes.get(role)?.model
  const model = pinned ?? (tier ? routes.tierModels()[tier] : resolved.model)
  return { providerId: resolved.providerId, model }
}

export function engineClaude(deps: EngineClaudeDeps): ClaudeService {
  return {
    async ask(req) {
      const resolved = deps.routes.resolve(req.role)
      const { model } = modelFor(deps.routes, req.role, req.tier)
      const providerId = backendOf(deps, req.role, resolved.providerId)
      const route = { ...resolved, providerId }
      const chosen = { ...route, model }
      const who = { channelId: null, videoId: null, taskId: null }
      const handle = reserveFor(deps.ledger, chosen, ONE_PASS, who, unpricedReserveUsd(deps.ledger, deps.settings, deps.routes, null, ONE_PASS))
      const tools = req.tools?.includes('web') ? (deps.webTools?.() ?? null) : null
      const { result } = await runReserved(
        deps.ledger,
        handle,
        providerId === 'anthropic' && deps.access && deps.apiProvider ? deps.apiProvider() : deps.getProvider(route.providerId),
        {
          model,
          system: req.system,
          prompt: req.prompt,
          maxTokens: 16_000,
          ...(req.images && req.images.length > 0 ? { images: req.images } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
          ...(tools ? { tools } : {})
        },
        undefined,
        req.signal
      ).catch((err: unknown) => {
        // a dead sign-in (the PC's Claude Code login expired…) is the owner's to fix: a French message with the action,
        // never « Erreur interne »; the run stops at once on it (runs/service.ts)
        if (detectAuthFailure(err instanceof Error ? err.message : String(err))) throw new EngineError('missing_tool', t('runs.error.claudeLogin'))
        throw err
      })
      return { text: result.text, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } }
    }
  }
}

/** Where a role's call goes under the beta rule: the script on the subscription, the director on its backend. */
function backendOf(deps: EngineClaudeDeps, role: string, routed: ProviderId): ProviderId {
  const access = deps.access
  if (!access) return routed
  if (!isDirectorRole(role)) return 'claude-code'
  const backend = access.directorBackend()
  if (backend === null) throw lockedError()
  if (backend === 'subscription') return 'claude-code'
  if (!access.status().director.apiKeySet) throw new ProviderError(t('llmAccess.error.noApiKey'), 'NO_KEY', undefined, null, false)
  return 'anthropic'
}
