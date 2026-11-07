// The provider account pool (orch_accounts). One workspace can have several accounts: Claude Code subscriptions (each
// its own CLI config folder, `CLAUDE_CONFIG_DIR`), OpenAI Codex CLI logins (each its own `CODEX_HOME`), the Anthropic
// API key, and the Atelier relay (credits; placeholder until the Cloud offers it). Each user logs every CLI in on their
// own machine; Atelier only points the CLI at a folder and never reads or copies a token (docs/AGENT-RUNTIME.md).
// Selection for a call of tier T: enabled, not limited, serving T, below its concurrency; then the kind preference of T
// (setting `orchestra.kindPreference`), the account priority, the lightest load, the fewest calls. A usage limit marks
// the account `limited_until` (and the matching Réglages › Claude profile) and the next account takes over.
import type { OrchAccount, OrchAccountInput, OrchAccountKind, OrchAccountState } from '../../shared/api/orchestra'
import { ORCH_ACCOUNT_KINDS } from '../../shared/api/orchestra'
import { isTier, TIERS, type Tier } from '../../shared/roles'
import type { Db } from '../db'
import { monthBounds, monthOf } from '../ledger'
import { CODEX_DEFAULT_MODEL } from '../llm/codex'
import type { Provider } from '../llm/types'
import type { SettingsStore } from '../settings'
import type { LimitHit } from './limits'
import { iso, isRecord, parseJson, type Clock, type EventLog } from './util'

export interface AccountRecord {
  id: number
  kind: OrchAccountKind
  label: string
  configDir: string | null
  secretName: string | null
  profileId: number | null
  tiers: Tier[]
  models: Partial<Record<Tier, string>>
  priority: number
  maxConcurrent: number
  enabled: boolean
  limitedUntil: string | null
  limitNote: string | null
  calls: number
  failures: number
  lastUsedAt: string | null
  /** « Ajouter mon compte »: absent = ready (accounts made before the flow). */
  state?: OrchAccountState
  checkNote?: string | null
  checkedAt?: string | null
}

interface AccountDb {
  id: number
  kind: OrchAccountKind
  label: string
  config_dir: string | null
  secret_name: string | null
  profile_id: number | null
  tiers: string
  models: string
  priority: number
  max_concurrent: number
  enabled: number
  limited_until: string | null
  limit_note: string | null
  calls: number
  failures: number
  last_used_at: string | null
  state: OrchAccountState
  check_note: string | null
  checked_at: string | null
}

export type ProviderFactory = (account: AccountRecord) => Provider

export const KIND_PREFERENCE_SETTING = 'orchestra.kindPreference'
/** Subscriptions first (already paid), the API key (billed per token) and the relay last. */
export const DEFAULT_KIND_PREFERENCE: Readonly<Record<Tier, readonly OrchAccountKind[]>> = {
  best: ['claude-code', 'codex', 'anthropic', 'relay'],
  balanced: ['claude-code', 'codex', 'anthropic', 'relay'],
  fast: ['claude-code', 'codex', 'anthropic', 'relay']
}

/** The ledger's provider id for an account kind. */
export function ledgerProviderId(kind: OrchAccountKind): string {
  return kind === 'relay' ? 'atelier-relay' : kind
}

/** Subscriptions and credits are not priced per token in our price table; the API key is. */
export function isSubscription(kind: OrchAccountKind): boolean {
  return kind !== 'anthropic'
}

/**
 * The beta rule (decision 0038): the agents (and every LLM feature but the director) run only on a connected LLM
 * subscription, Claude Code or Codex. The API key and the relay are never picked for them.
 */
export const AGENT_ACCOUNT_KINDS: readonly OrchAccountKind[] = ['claude-code', 'codex']

/** The check note of an account whose login died in use: the renderer shows « À reconnecter ». */
export const RECONNECT_NOTE_PREFIX = 'À reconnecter : '

export class AccountPool {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog
  private readonly settings: SettingsStore
  private readonly factory: ProviderFactory
  private readonly providers = new Map<string, Provider>()
  private readonly load = new Map<number, number>()

  constructor(db: Db, now: Clock, events: EventLog, settings: SettingsStore, factory: ProviderFactory) {
    this.db = db
    this.now = now
    this.events = events
    this.settings = settings
    this.factory = factory
  }

  /** The user's own Claude Code login is always there as the first account. */
  ensureDefault(): void {
    if (this.db.prepare('SELECT 1 FROM orch_accounts').get()) return
    const profile = this.db.prepare(`SELECT id FROM claude_profiles WHERE kind = 'cli' AND example = 0 ORDER BY is_default DESC, id LIMIT 1`).get() as { id: number } | undefined
    this.db
      .prepare(`INSERT INTO orch_accounts (kind, label, profile_id, priority, max_concurrent, created_at) VALUES ('claude-code', ?, ?, 0, 2, ?)`)
      .run('Claude Code (connexion par défaut)', profile?.id ?? null, iso(this.now()))
  }

  list(): AccountRecord[] {
    return (this.db.prepare('SELECT * FROM orch_accounts ORDER BY priority, id').all() as unknown as AccountDb[]).map(toRecord)
  }

  get(id: number): AccountRecord {
    const r = Number.isInteger(id) ? (this.db.prepare('SELECT * FROM orch_accounts WHERE id = ?').get(id) as unknown as AccountDb | undefined) : undefined
    if (!r) throw new Error(`Unknown account: ${String(id)}`)
    return toRecord(r)
  }

  save(input: OrchAccountInput): AccountRecord {
    if (!isRecord(input)) throw new Error('An account needs a kind and a label')
    if (!(ORCH_ACCOUNT_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown account kind: ${String(input.kind)}`)
    const label = typeof input.label === 'string' ? input.label.trim() : ''
    if (!label || label.length > 80) throw new Error('An account needs a label (80 characters at most)')
    const configDir = input.configDir === undefined || input.configDir === null ? null : String(input.configDir).trim() || null
    if (configDir !== null && (configDir.length > 500 || /[\r\n\0"%!^&|<>]/.test(configDir))) throw new Error('Invalid config folder')
    const tiers = input.tiers === undefined ? [...TIERS] : input.tiers
    if (!Array.isArray(tiers) || tiers.length === 0 || !tiers.every(isTier)) throw new Error('tiers: a non-empty list of best, balanced, fast')
    const models: Partial<Record<Tier, string>> = {}
    for (const [k, v] of Object.entries(isRecord(input.models) ? input.models : {})) {
      if (!isTier(k) || typeof v !== 'string' || !/^[A-Za-z0-9._:[\]-]{1,100}$/.test(v)) throw new Error(`Invalid model for ${k}`)
      models[k] = v
    }
    const priority = input.priority ?? 0
    const maxConcurrent = input.maxConcurrent ?? 1
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error('priority is 0 to 100')
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new Error('maxConcurrent is 1 to 8')
    const enabled = input.enabled === undefined ? true : input.enabled === true
    const values = [input.kind, label, configDir, JSON.stringify(tiers), JSON.stringify(models), priority, maxConcurrent, enabled ? 1 : 0]
    let id: number
    if (input.id !== undefined) {
      const cur = this.get(input.id)
      if (cur.kind !== input.kind) throw new Error('The kind of an account cannot change: add another one')
      this.db
        .prepare('UPDATE orch_accounts SET kind = ?, label = ?, config_dir = ?, tiers = ?, models = ?, priority = ?, max_concurrent = ?, enabled = ? WHERE id = ?')
        .run(...values, cur.id)
      id = cur.id
      for (const k of [...this.providers.keys()]) if (k.startsWith(`${id}:`)) this.providers.delete(k)
    } else {
      const r = this.db
        .prepare('INSERT INTO orch_accounts (kind, label, config_dir, tiers, models, priority, max_concurrent, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(...values, iso(this.now()))
      id = Number(r.lastInsertRowid)
      this.events.add('account', `account added: ${label} (${input.kind})`)
    }
    return this.get(id)
  }

  /** The provider that runs calls on this account (one per account and configuration). */
  provider(a: AccountRecord): Provider {
    const key = `${a.id}:${a.kind}:${a.configDir ?? ''}`
    let p = this.providers.get(key)
    if (!p) {
      p = this.factory(a)
      this.providers.set(key, p)
    }
    return p
  }

  running(id: number): number {
    return this.load.get(id) ?? 0
  }

  acquire(id: number): void {
    this.load.set(id, this.running(id) + 1)
  }

  release(id: number): void {
    this.load.set(id, Math.max(0, this.running(id) - 1))
  }

  isLimited(a: AccountRecord): boolean {
    return a.limitedUntil !== null && Date.parse(a.limitedUntil) > this.now()
  }

  /** The kinds a call of `tier` may use, in order; only subscriptions (AGENT_ACCOUNT_KINDS) in the beta. */
  kindPreference(tier: Tier): readonly OrchAccountKind[] {
    const raw = this.settings.get(KIND_PREFERENCE_SETTING, {})
    const v = isRecord(raw) ? raw[tier] : undefined
    const pref = Array.isArray(v) && v.every((k) => (ORCH_ACCOUNT_KINDS as readonly unknown[]).includes(k)) ? (v as OrchAccountKind[]) : DEFAULT_KIND_PREFERENCE[tier]
    return pref.filter((k) => AGENT_ACCOUNT_KINDS.includes(k))
  }

  /** Ready to take a call: switched on, its login checked or never refused (not « à reconnecter »), not limited. */
  isUsable(a: AccountRecord): boolean {
    return a.enabled && (a.state ?? 'ready') === 'ready' && !this.isLimited(a)
  }

  /** The subscription accounts that can take a call now (the beta gate: none = agents and scripts locked). */
  usableSubscriptions(): AccountRecord[] {
    return this.list().filter((a) => AGENT_ACCOUNT_KINDS.includes(a.kind) && this.isUsable(a))
  }

  /** The subscription accounts whose login died in use and wait for their owner (Réglages › Claude › Reconnecter). */
  needsReconnect(): AccountRecord[] {
    return this.list().filter((a) => AGENT_ACCOUNT_KINDS.includes(a.kind) && isReconnect(a))
  }

  /** The account for a call of `tier`, or null when every candidate is limited, logged out, busy or excluded. */
  pick(tier: Tier, exclude: ReadonlySet<number> = new Set()): AccountRecord | null {
    const pref = this.kindPreference(tier)
    const candidates = this.list().filter(
      (a) => this.isUsable(a) && pref.includes(a.kind) && a.tiers.includes(tier) && !exclude.has(a.id) && this.running(a.id) < a.maxConcurrent
    )
    // An account that passed « Vérifier » goes before one that never did (the default login may be long expired).
    const verified = (a: AccountRecord): number => (a.checkedAt ? 0 : 1)
    candidates.sort(
      (a, b) =>
        pref.indexOf(a.kind) - pref.indexOf(b.kind) ||
        verified(a) - verified(b) ||
        a.priority - b.priority ||
        this.running(a.id) / a.maxConcurrent - this.running(b.id) / b.maxConcurrent ||
        a.calls - b.calls ||
        a.id - b.id
    )
    return candidates[0] ?? null
  }

  /** Whether `tier` can be served at all right now; when every account for it is limited, when the first comes back. */
  availability(tier: Tier): { allLimited: boolean; resumesAt: number | null } {
    const pref = this.kindPreference(tier)
    const serving = this.list().filter((a) => a.enabled && (a.state ?? 'ready') === 'ready' && pref.includes(a.kind) && a.tiers.includes(tier))
    if (serving.length === 0) return { allLimited: true, resumesAt: null }
    const limited = serving.filter((a) => this.isLimited(a))
    if (limited.length < serving.length) return { allLimited: false, resumesAt: null }
    return { allLimited: true, resumesAt: Math.min(...limited.map((a) => Date.parse(a.limitedUntil as string))) }
  }

  markLimited(id: number, hit: LimitHit): void {
    const a = this.get(id)
    this.db.prepare('UPDATE orch_accounts SET limited_until = ?, limit_note = ?, failures = failures + 1 WHERE id = ?').run(iso(hit.until), hit.note, id)
    // The Z1 profile screen shows the same « limite atteinte » (its own 8-day bound applies). The default login is the
    // default « Claude Code » profile, which that screen may only have created after this account.
    const profileId = a.profileId ?? (a.kind === 'claude-code' && a.configDir === null ? this.defaultCliProfile() : null)
    if (profileId !== null && hit.until - this.now() <= 8 * 86_400_000) {
      this.db.prepare('UPDATE claude_profiles SET limited_until = ? WHERE id = ?').run(iso(hit.until), profileId)
    }
    this.events.add('limit', `${a.label}: ${hit.kind} limit until ${iso(hit.until)} (${hit.note})`)
  }

  /**
   * The account's login died in use (expired OAuth session, CLI logged out or missing): « À reconnecter », switched off
   * and skipped until a good « Vérifier » makes it ready again. Retrying it is useless, so no task spends attempts on it.
   */
  markNeedsLogin(id: number, why: string): AccountRecord {
    const a = this.get(id)
    this.db.prepare('UPDATE orch_accounts SET failures = failures + 1 WHERE id = ?').run(id)
    const out = this.setState(id, 'login', `${RECONNECT_NOTE_PREFIX}${why}`, false)
    this.events.add('auth', `${a.label}: login refused, to reconnect (${why.slice(0, 160)})`)
    return out
  }

  private defaultCliProfile(): number | null {
    const r = this.db.prepare(`SELECT id FROM claude_profiles WHERE kind = 'cli' AND example = 0 ORDER BY is_default DESC, id LIMIT 1`).get() as { id: number } | undefined
    return r?.id ?? null
  }

  clearLimit(id: number): AccountRecord {
    const a = this.get(id)
    this.db.prepare('UPDATE orch_accounts SET limited_until = NULL, limit_note = NULL WHERE id = ?').run(id)
    const profileId = a.profileId ?? (a.kind === 'claude-code' && a.configDir === null ? this.defaultCliProfile() : null)
    if (profileId !== null) this.db.prepare('UPDATE claude_profiles SET limited_until = NULL WHERE id = ?').run(profileId)
    this.events.add('limit', `${a.label}: limit cleared`)
    return this.get(id)
  }

  /** « Ajouter mon compte »: login → checking → ready (enabled) | failed. A failed or pending account is not used. */
  setState(id: number, state: OrchAccountState, note: string | null, enabled?: boolean): AccountRecord {
    this.get(id)
    this.db
      .prepare('UPDATE orch_accounts SET state = ?, check_note = ?, checked_at = ?, enabled = COALESCE(?, enabled) WHERE id = ?')
      .run(state, note === null ? null : note.slice(0, 300), iso(this.now()), enabled === undefined ? null : enabled ? 1 : 0, id)
    for (const k of [...this.providers.keys()]) if (k.startsWith(`${id}:`)) this.providers.delete(k)
    return this.get(id)
  }

  recordCall(id: number, ok: boolean): void {
    this.db
      .prepare('UPDATE orch_accounts SET calls = calls + 1, failures = failures + ?, last_used_at = ? WHERE id = ?')
      .run(ok ? 0 : 1, iso(this.now()), id)
  }

  /** The model of a call: the agent's pinned model, the account's own model for the tier, else the tier map. */
  modelFor(a: AccountRecord, tier: Tier, tierModels: Record<Tier, string>, pinned: string | null): string {
    if (a.models[tier]) return a.models[tier] as string
    if (a.kind === 'codex') return CODEX_DEFAULT_MODEL
    return pinned ?? tierModels[tier]
  }

  spentThisMonth(id: number): number {
    const { start, end } = monthBounds(monthOf(new Date(this.now())))
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN estimate_usd WHEN 'refunded' THEN 0 ELSE amount_usd END), 0) AS s
         FROM ledger WHERE account_id = ? AND created_at >= ? AND created_at < ?`
      )
      .get(id, start, end) as { s: number }
    return Math.round(r.s * 1e6) / 1e6
  }

  toApi(a: AccountRecord): OrchAccount {
    return {
      id: a.id,
      kind: a.kind,
      label: a.label,
      configDir: a.configDir,
      enabled: a.enabled,
      priority: a.priority,
      maxConcurrent: a.maxConcurrent,
      tiers: a.tiers,
      limitedUntil: this.isLimited(a) ? a.limitedUntil : null,
      limitNote: this.isLimited(a) ? a.limitNote : null,
      running: this.running(a.id),
      calls: a.calls,
      failures: a.failures,
      lastUsedAt: a.lastUsedAt,
      spentUsdMonth: this.spentThisMonth(a.id),
      state: a.state ?? 'ready',
      checkNote: a.checkNote ?? null,
      checkedAt: a.checkedAt ?? null,
      reconnect: isReconnect(a)
    }
  }
}

function isReconnect(a: AccountRecord): boolean {
  return a.state === 'login' && (a.checkNote ?? '').startsWith(RECONNECT_NOTE_PREFIX)
}

function toRecord(r: AccountDb): AccountRecord {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    configDir: r.config_dir,
    secretName: r.secret_name,
    profileId: r.profile_id,
    tiers: parseJson<unknown[]>(r.tiers, [...TIERS]).filter(isTier),
    models: parseJson<Partial<Record<Tier, string>>>(r.models, {}),
    priority: r.priority,
    maxConcurrent: r.max_concurrent,
    enabled: r.enabled === 1,
    limitedUntil: r.limited_until,
    limitNote: r.limit_note,
    calls: r.calls,
    failures: r.failures,
    lastUsedAt: r.last_used_at,
    state: r.state ?? 'ready',
    checkNote: r.check_note ?? null,
    checkedAt: r.checked_at ?? null
  }
}
