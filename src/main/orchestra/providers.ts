// Providers of the account pool. A Claude Code account with its own config folder runs the CLI with
// `CLAUDE_CONFIG_DIR=<folder>` (the folder the user logged that subscription into with `claude` → `/login`); a Codex
// account runs `codex` with `CODEX_HOME=<folder>` (`codex login` there). Without a folder, the CLI's default login is
// used (the app's existing Claude Code provider). The API account is the existing Anthropic provider (key in the
// encrypted secrets). The Atelier relay (credits) is a placeholder until Atelier Cloud offers it.
import { ClaudeCodeProvider, type ClaudeCodeDeps } from '../llm/claude-code'
import { CodexCliProvider, type CodexDeps } from '../llm/codex'
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider, type StreamEvent } from '../llm/types'
import type { AccountRecord, ProviderFactory } from './accounts'

export class RelayPlaceholderProvider implements Provider {
  readonly id = 'atelier-relay'

  complete(_req: CompletionRequest): Promise<CompletionResult> {
    return Promise.reject(new ProviderError('The Atelier relay (credits) is not available yet', 'NOT_FOUND', undefined, null, false))
  }

  // eslint-disable-next-line require-yield
  async *stream(_req: CompletionRequest): AsyncGenerator<StreamEvent> {
    throw new ProviderError('The Atelier relay (credits) is not available yet', 'NOT_FOUND', undefined, null, false)
  }
}

export interface AccountProvidersDeps {
  /** The app's default Claude Code provider (no config folder) and the Anthropic API provider. */
  defaultClaudeCode: Provider
  anthropic: Provider
  env?: NodeJS.ProcessEnv
  /** Test seams for the CLIs (fake spawn, fake kill). */
  claudeCode?: Omit<ClaudeCodeDeps, 'env'>
  codex?: Omit<CodexDeps, 'env'>
}

export class AccountProviders {
  private readonly deps: AccountProvidersDeps
  private readonly cli: (ClaudeCodeProvider | CodexCliProvider)[] = []

  constructor(deps: AccountProvidersDeps) {
    this.deps = deps
  }

  readonly factory: ProviderFactory = (a: AccountRecord): Provider => {
    const env = this.deps.env ?? process.env
    switch (a.kind) {
      case 'claude-code': {
        if (!a.configDir) return this.deps.defaultClaudeCode
        const p = new ClaudeCodeProvider({ ...this.deps.claudeCode, env: { ...env, CLAUDE_CONFIG_DIR: a.configDir } })
        this.cli.push(p)
        return p
      }
      case 'codex': {
        const p = new CodexCliProvider({ ...this.deps.codex, env: a.configDir ? { ...env, CODEX_HOME: a.configDir } : { ...env } })
        this.cli.push(p)
        return p
      }
      case 'anthropic':
        return this.deps.anthropic
      default:
        return new RelayPlaceholderProvider()
    }
  }

  /** Quit: kills the CLI processes these accounts started. */
  killAll(): number {
    return this.cli.reduce((n, p) => n + p.killAll(), 0)
  }
}
