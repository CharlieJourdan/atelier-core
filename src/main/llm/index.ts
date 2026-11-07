import type { ProviderId } from '../../shared/api'
import type { SecretsStore } from '../secrets'
import { AnthropicProvider, type AnthropicClientLike } from './anthropic'
import { ClaudeCodeProvider, type ClaudeCodeDeps } from './claude-code'

export * from './types'
export { AnthropicProvider } from './anthropic'
export { ClaudeCodeProvider } from './claude-code'
export { CodexCliProvider, CODEX_DEFAULT_MODEL } from './codex'
export { FakeProvider } from './fake'
export { RoutesStore } from './routes'
export { PricesStore, costOf } from './prices'

export const ANTHROPIC_KEY_SECRET = 'provider.anthropic.apiKey'

export interface ProviderSet {
  'claude-code': ClaudeCodeProvider
  anthropic: AnthropicProvider
}

export interface ProviderSetDeps {
  secrets: SecretsStore
  claudeCode?: ClaudeCodeDeps
  createAnthropicClient?: (apiKey: string) => AnthropicClientLike
  /** Where the Anthropic key is read (default: the providers' secret); the app adds the Réglages › Claude API profile. */
  anthropicKey?: () => string | null
}

export function createProviders(deps: ProviderSetDeps): ProviderSet {
  return {
    'claude-code': new ClaudeCodeProvider(deps.claudeCode),
    anthropic: new AnthropicProvider({
      getKey: deps.anthropicKey ?? (() => deps.secrets.get(ANTHROPIC_KEY_SECRET)),
      ...(deps.createAnthropicClient ? { createClient: deps.createAnthropicClient } : {})
    })
  }
}

export function secretNameFor(id: ProviderId): string | null {
  return id === 'anthropic' ? ANTHROPIC_KEY_SECRET : null
}
