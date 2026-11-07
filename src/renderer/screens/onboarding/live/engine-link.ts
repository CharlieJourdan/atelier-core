// Real mode, the onboarding's engine step: connecting the person's own Claude Code (or Codex) subscription for real, with the
// account flow of Réglages › Claude (docs/AGENT-RUNTIME.md §21) — « Ajouter mon compte » makes the account's own folder and
// opens a terminal where the person signs in himself; « Vérifier » asks Haiku one tiny question through that account (it
// uses the subscription and is booked in the ledger). Nothing here is simulated: the step shows what the brain says.
// When the app is connected to a team computer (Réglages › Ordinateur d'équipe), every call below is answered by that
// computer's brain, so the CLI, the account and the login are the team computer's, and the step says so.
// A plain class with a subscription (like LiveOnboardingSession), so it is unit-tested with a fake `call`.
import type { BrainStatus } from '../../../../shared/api/brain'
import type { OrchAccount, OrchAccountLogin } from '../../../../shared/api/orchestra'
import type { Call } from '@/proto/live/onboarding-live'

export type CliKind = 'claude-code' | 'codex'

/** The Claude Code CLI where the brain runs (`providers.test`, i.e. `claude --version`: no model call, no token). */
export type CliCheck = { state: 'loading' } | { state: 'found'; detail: string } | { state: 'missing'; detail: string } | { state: 'unknown' }

export interface EngineWhere {
  /** The team computer's brain answers (the account lives there), not this app. */
  remote: boolean
  name: string | null
}

export interface EngineLinkState {
  where: EngineWhere | null
  cli: CliCheck
  accounts: OrchAccount[] | null
  /** The last « Ajouter mon compte » / « Rouvrir le terminal »: the folder, the command, whether a terminal opened. */
  login: OrchAccountLogin | null
  busy: 'add' | 'check' | 'reopen' | null
  error: string | null
}

/** Where the step stands for the chosen kind of account. */
export type EnginePhase = 'loading' | 'no-cli' | 'add' | 'login' | 'checking' | 'failed' | 'ready'

/** A good « Vérifier » happened (the default login's account is `ready` without ever being checked: it does not count). */
export function isVerified(a: OrchAccount): boolean {
  return a.state === 'ready' && a.checkedAt !== null
}

export function verifiedAccount(kind: CliKind, accounts: readonly OrchAccount[]): OrchAccount | undefined {
  return accounts.find((a) => a.kind === kind && isVerified(a))
}

/** The account the step works on: the newest one added with its own folder (« Ajouter mon compte »). */
export function pendingAccount(kind: CliKind, accounts: readonly OrchAccount[]): OrchAccount | undefined {
  return accounts.filter((a) => a.kind === kind && a.configDir !== null).sort((x, y) => y.id - x.id)[0]
}

export function enginePhase(kind: CliKind, s: Pick<EngineLinkState, 'where' | 'cli' | 'accounts' | 'busy'>): EnginePhase {
  if (s.accounts === null || s.where === null) return 'loading'
  if (verifiedAccount(kind, s.accounts)) return 'ready'
  const a = pendingAccount(kind, s.accounts)
  if (s.busy === 'check' || a?.state === 'checking') return 'checking'
  if (kind === 'claude-code') {
    if (s.cli.state === 'missing') return 'no-cli'
    if (s.cli.state === 'loading' && !a) return 'loading'
  }
  if (!a) return 'add'
  if (a.state === 'failed') return 'failed'
  // waiting for the sign-in, or signed in but never checked
  return 'login'
}

export const INITIAL_ENGINE_LINK: EngineLinkState = { where: null, cli: { state: 'loading' }, accounts: null, login: null, busy: null, error: null }

const text = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export class EngineLink {
  private state: EngineLinkState = INITIAL_ENGINE_LINK
  private readonly listeners = new Set<() => void>()

  constructor(private readonly call: Call) {}

  getState = (): EngineLinkState => this.state

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private patch(p: Partial<EngineLinkState>): void {
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l()
  }

  /** Everything the step shows: where the brain runs, the CLI, the accounts. */
  async load(): Promise<void> {
    await Promise.all([this.loadWhere(), this.loadAccounts(), this.testCli()])
  }

  async loadWhere(): Promise<void> {
    try {
      const b: BrainStatus = await this.call('brain.status')
      this.patch({ where: { remote: b.mode === 'remote', name: b.name } })
    } catch {
      this.patch({ where: { remote: false, name: null } })
    }
  }

  async loadAccounts(): Promise<void> {
    try {
      this.patch({ accounts: await this.call('orchestra.accounts') })
    } catch (err) {
      this.patch({ accounts: this.state.accounts ?? [], error: text(err) })
    }
  }

  /** Looks for the Claude Code CLI again (after installing it). */
  async testCli(): Promise<void> {
    this.patch({ cli: { state: 'loading' } })
    try {
      const r = await this.call('providers.test', 'claude-code')
      this.patch({ cli: r.ok ? { state: 'found', detail: r.message } : { state: 'missing', detail: r.message } })
    } catch {
      this.patch({ cli: { state: 'unknown' } })
    }
  }

  private async act(busy: NonNullable<EngineLinkState['busy']>, fn: () => Promise<void>): Promise<void> {
    if (this.state.busy) return
    this.patch({ busy, error: null })
    try {
      await fn()
    } catch (err) {
      this.patch({ error: text(err) })
    } finally {
      this.patch({ busy: null })
    }
  }

  /** « Ajouter mon compte Claude Code / Codex »: its own folder, a terminal (or the command to type). */
  add(kind: CliKind): Promise<void> {
    return this.act('add', async () => {
      const login = await this.call('orchestra.addCliAccount', { kind })
      this.patch({ login })
      await this.loadAccounts()
    })
  }

  reopen(accountId: number): Promise<void> {
    return this.act('reopen', async () => {
      this.patch({ login: await this.call('orchestra.openLogin', accountId) })
    })
  }

  /** « Vérifier »: one tiny Haiku prompt through that account (the person's subscription, booked in the ledger). */
  check(accountId: number): Promise<void> {
    return this.act('check', async () => {
      const a = await this.call('orchestra.checkAccount', accountId)
      this.patch({ accounts: (this.state.accounts ?? []).map((x) => (x.id === a.id ? a : x)) })
    })
  }
}
