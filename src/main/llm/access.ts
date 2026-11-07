// The beta rule on models (decision 0038). The agents (team, Atlas, autopilot, planner) and every LLM feature but the
// director (script writing, ideas, support videos, fact check, analysis…) run only on a connected Claude Code or Codex
// subscription: without one they are locked with a French message pointing at Réglages › Claude, never silently sent
// to an API key. The director (the scene pass and the editing passes of a run) runs on the subscription or on the
// Anthropic API key, as the user picks (setting `llm.directorBackend`; default: the subscription when one works).
// Imported scripts call no model: always free, always available.
import type { DirectorBackend, LlmAccessStatus } from '../../shared/api'
import { t } from '../../shared/fr'
import type { AccountPool } from '../orchestra/accounts'
import type { SettingsStore } from '../settings'
import { ProviderError, type CallOptions, type CompletionRequest, type CompletionResult, type Provider, type StreamEvent } from './types'

export const DIRECTOR_BACKEND_SETTING = 'llm.directorBackend'

/**
 * Engine roles that write the script (`script.write`, its passes, the research and fact check, the sponsor read):
 * subscription only. Every other engine role is the director's side of a run (scenes, cuts, chapters, sponsor card,
 * packaging…) and follows the director's backend, so an imported script can still be rendered on an API key.
 */
export const SCRIPT_ROLES: ReadonlySet<string> = new Set(['scriptwriter', 'researcher', 'factchecker', 'sponsor_writer'])

export function isDirectorRole(role: string): boolean {
  return !SCRIPT_ROLES.has(role)
}

export interface LlmAccessDeps {
  /** The agent runtime's account pool (null before the runtime is built: everything is locked). */
  pool: () => AccountPool | null
  settings: SettingsStore
  apiKeySet: () => boolean
}

export class LlmAccess {
  private readonly deps: LlmAccessDeps

  constructor(deps: LlmAccessDeps) {
    this.deps = deps
  }

  /** A connected subscription account works (enabled, ready, not limited, not « à reconnecter »). */
  hasSubscription(): boolean {
    return (this.deps.pool()?.usableSubscriptions().length ?? 0) > 0
  }

  /** Throws the French « locked » error when no subscription works (the call never reaches a model). */
  requireSubscription(): void {
    if (!this.hasSubscription()) throw lockedError()
  }

  directorChoice(): DirectorBackend | null {
    const v = this.deps.settings.get<string | null>(DIRECTOR_BACKEND_SETTING, null)
    return v === 'subscription' || v === 'api' ? v : null
  }

  setDirectorBackend(v: DirectorBackend | null): LlmAccessStatus {
    if (v !== null && v !== 'subscription' && v !== 'api') throw new Error(`Unknown director backend: ${String(v)}`)
    this.deps.settings.set(DIRECTOR_BACKEND_SETTING, v)
    return this.status()
  }

  /** What the director runs on now: the choice, else the subscription when one works, else the key when one is set. */
  directorBackend(): DirectorBackend | null {
    const choice = this.directorChoice()
    if (choice) return choice
    if (this.hasSubscription()) return 'subscription'
    return this.deps.apiKeySet() ? 'api' : null
  }

  status(): LlmAccessStatus {
    const pool = this.deps.pool()
    return {
      subscription: this.hasSubscription(),
      reconnect: (pool?.needsReconnect() ?? []).map((a) => ({ id: a.id, label: a.label })),
      director: { choice: this.directorChoice(), effective: this.directorBackend(), apiKeySet: this.deps.apiKeySet() }
    }
  }

  /** A provider whose every call first checks the rule (subscription features: chat, ask, runner, script nodes). */
  gate(inner: Provider): Provider {
    const check = (): void => this.requireSubscription()
    return {
      id: inner.id,
      complete(req: CompletionRequest, opts?: CallOptions): Promise<CompletionResult> {
        try {
          check()
        } catch (err) {
          return Promise.reject(err as Error)
        }
        return inner.complete(req, opts)
      },
      async *stream(req: CompletionRequest, opts?: CallOptions): AsyncGenerator<StreamEvent> {
        check()
        yield* inner.stream(req, opts)
      },
      ...(inner.acceptsTools ? { acceptsTools: (tools) => inner.acceptsTools?.(tools) === true } : {})
    }
  }
}

/** The error of a locked feature: it never reached a model (nothing billed). */
export function lockedError(): ProviderError {
  return new ProviderError(t('llmAccess.error.locked'), 'LOCKED', undefined, null, false)
}
