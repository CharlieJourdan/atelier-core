// Demo handlers: Réglages › Compte (wallet, simulated packs), Équipe (local members, devices), Claude (subscription
// accounts of the agent team, director backend), Admin plateforme (an invented price grid) and support requests.
// Adding a Claude Code / Codex account « logs in » at once: no terminal, no token, the account is ready after « Vérifier ».
import type { AdminOverview, ClaudeProfile, ClaudeUsage, OrchAccount, TeamDevice, TeamMember } from '../../../shared/api'
import type { SupportRequestRow } from '../../../shared/analysis'
import type { CreditEntry, CreditPack, CreditsBalance } from '../../../shared/runs'
import { changed, wait, type DemoHandlers } from './bridge'
import { DEMO_ACCOUNT, S } from './api-settings-state'
import { ago, nextId } from './world'

// ------------------------------------------------------------------------------------------------ wallet

// available = 12 480 at start, the same figure as the demo store's sidebar (proto/data-core.ts WORKSPACE.credits)
const wallet = { granted: 15_350, simulated: 0, captured: 2_550, held: 320 }

function balance(): CreditsBalance {
  const total = wallet.granted + wallet.simulated - wallet.captured
  return { available: total - wallet.held, held: wallet.held, total, simulated: wallet.simulated, example: 0 }
}

const entry = (kind: CreditEntry['kind'], amount: number, minutes: number, note: string, source: CreditEntry['source'] = 'local'): CreditEntry => ({
  id: nextId(),
  kind,
  amount,
  runId: kind === 'grant' ? null : 40 + (minutes % 7),
  holdId: null,
  source,
  note,
  createdAt: ago(minutes),
  example: false
})

let entries: CreditEntry[] = [
  entry('hold', 320, 25, 'Les Grandes Énigmes · « Le phare qui s’éteignait seul »'),
  entry('capture', 610, 60 * 5, 'Histoires Vraies · 3 shorts'),
  entry('release', 90, 60 * 5 + 2, 'Réservation non utilisée'),
  entry('capture', 1_140, 60 * 28, 'Cuisine en 5 minutes · « Pâtes au citron »'),
  entry('capture', 800, 60 * 50, 'Les Grandes Énigmes · « La carte qui n’existait pas »'),
  entry('grant', 15_000, 60 * 24 * 9, 'Crédits de bienvenue (démo)')
]

const PACKS: CreditPack[] = [
  { id: 'pack-s', credits: 5_000, priceEur: 50, label: 'Essai' },
  { id: 'pack-m', credits: 12_000, priceEur: 110, label: 'Créateur' },
  { id: 'pack-l', credits: 30_000, priceEur: 250, label: 'Studio' }
]

// ------------------------------------------------------------------------------------------------ team

let members: TeamMember[] = [
  { id: 1, name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, role: 'owner', status: 'active', monthlyCap: null, self: true, example: false, createdAt: ago(60 * 24 * 300) },
  { id: 2, name: 'Camille (montage)', email: 'monteuse@example.com', role: 'admin', status: 'active', monthlyCap: 8_000, self: false, example: false, createdAt: ago(60 * 24 * 120) },
  { id: 3, name: 'Noé (rédaction)', email: 'redaction@example.com', role: 'member', status: 'invited', monthlyCap: 3_000, self: false, example: false, createdAt: ago(60 * 30) }
]

let devices: TeamDevice[] = [
  { id: 1, name: 'Ce navigateur', os: 'Web (démo)', lastSeenAt: ago(0), current: true, example: false },
  { id: 2, name: 'Portable de Camille', os: 'macOS', lastSeenAt: ago(60 * 3), current: false, example: false },
  { id: 3, name: 'pc-studio-demo', os: 'Linux', lastSeenAt: ago(4), current: false, example: false }
]

let profiles: ClaudeProfile[] = [
  { id: 1, name: 'Abonnement du studio', kind: 'cli', status: 'ready', limitedUntil: null, keySet: null, isDefault: true, example: false }
]

// ------------------------------------------------------------------------------------------------ agent accounts

const account = (id: number, kind: 'claude-code' | 'codex', label: string, state: OrchAccount['state']): OrchAccount => ({
  id,
  kind,
  label,
  configDir: `~/.atelier/comptes/${kind}-${id}`,
  enabled: true,
  priority: id,
  maxConcurrent: 2,
  tiers: ['best', 'balanced', 'fast'],
  limitedUntil: null,
  limitNote: null,
  running: 0,
  calls: state === 'ready' ? 140 + id * 37 : 0,
  failures: 0,
  lastUsedAt: state === 'ready' ? ago(12) : null,
  spentUsdMonth: 0,
  state,
  checkNote: state === 'ready' ? 'Réponse reçue en 1,2 s (démo).' : null,
  checkedAt: state === 'ready' ? ago(60) : null,
  reconnect: false
})

let accounts: OrchAccount[] = [account(1, 'claude-code', 'Claude Code · studio', 'ready')]

const access = () => {
  const subscription = accounts.some((a) => a.state === 'ready')
  const effective = S.director ?? (subscription ? 'subscription' : null)
  return { subscription, reconnect: [], director: { choice: S.director, effective, apiKeySet: false } }
}

const power = () => ({
  state: S.power.state,
  pausedUntil: S.power.pausedUntil,
  claudeConnected: accounts.some((a) => a.state === 'ready'),
  loopRunning: S.power.state === 'on'
})

// ------------------------------------------------------------------------------------------------ admin, support

const ADMIN: AdminOverview['prices'] = {
  version: 3,
  creditValueEur: 0.01,
  overheadPct: 12,
  lines: [
    { unit: 'chars', providerCostUsd: 0.00018, marginPct: 40, creditsPerUnit: 0.027 },
    { unit: 'images', providerCostUsd: 0.04, marginPct: 35, creditsPerUnit: 5.9 },
    { unit: 'video_s', providerCostUsd: 0.05, marginPct: 35, creditsPerUnit: 7.4 },
    { unit: 'avatar_s', providerCostUsd: 0.09, marginPct: 30, creditsPerUnit: 12.8 },
    { unit: 'gpu_s', providerCostUsd: 0.0006, marginPct: 30, creditsPerUnit: 0.085 },
    { unit: 'searches', providerCostUsd: 0.002, marginPct: 50, creditsPerUnit: 0.32 },
    { unit: 'watch_min', providerCostUsd: 0.01, marginPct: 40, creditsPerUnit: 1.5 }
  ]
}

let support: SupportRequestRow[] = [
  {
    id: 1,
    what: 'Recréer le style de montage d’une chaîne de vulgarisation (exemple fictif)',
    links: 'https://example.com/video-exemple',
    budget: '200 €',
    contact: 'demo@example.com',
    attachAnalysis: false,
    analysisId: null,
    status: 'open',
    example: false,
    createdAt: ago(60 * 7),
    closedAt: null
  }
]

const WEEK_USAGE: ClaudeUsage = {
  calls: 312,
  inputTokens: 4_820_000,
  outputTokens: 610_000,
  cacheReadTokens: 12_400_000,
  cacheWriteTokens: 930_000,
  apiEquivalentUsd: 41.8,
  durationMs: 5_400_000,
  totalTokens: 18_760_000,
  byModel: [
    { model: 'claude-opus-5-5', calls: 64, inputTokens: 1_900_000, outputTokens: 260_000, cacheReadTokens: 5_100_000, cacheWriteTokens: 400_000, apiEquivalentUsd: 27.4, durationMs: 2_300_000 },
    { model: 'claude-sonnet-5-5', calls: 171, inputTokens: 2_400_000, outputTokens: 300_000, cacheReadTokens: 6_200_000, cacheWriteTokens: 450_000, apiEquivalentUsd: 12.6, durationMs: 2_600_000 },
    { model: 'claude-haiku-5-5', calls: 77, inputTokens: 520_000, outputTokens: 50_000, cacheReadTokens: 1_100_000, cacheWriteTokens: 80_000, apiEquivalentUsd: 1.8, durationMs: 500_000 }
  ]
  }

function scaleUsage(u: ClaudeUsage, k: number): ClaudeUsage {
  const n = (x: number): number => Math.round(x * k)
  const money = (x: number): number => Math.round(x * k * 100) / 100
  const part = <T extends Omit<ClaudeUsage, 'totalTokens' | 'byModel'>>(m: T): T => ({ ...m, calls: Math.max(1, n(m.calls)), inputTokens: n(m.inputTokens), outputTokens: n(m.outputTokens), cacheReadTokens: n(m.cacheReadTokens), cacheWriteTokens: n(m.cacheWriteTokens), apiEquivalentUsd: money(m.apiEquivalentUsd), durationMs: n(m.durationMs) })
  return { ...part(u), totalTokens: n(u.totalTokens), byModel: u.byModel.map(part) }
}

export const accountSettingsHandlers: DemoHandlers = {
  'credits.balance': () => balance(),
  'credits.entries': (limit = 100) => entries.slice(0, limit),
  'credits.packs': () => PACKS,
  'credits.simulatePurchase': async (packId) => {
    await wait(400)
    const pack = PACKS.find((p) => p.id === packId) ?? PACKS[0]!
    wallet.simulated += pack.credits
    const e = entry('grant', pack.credits, 0, `Pack « ${pack.label} » (achat simulé)`, 'simulated_purchase')
    entries = [e, ...entries]
    changed('credits')
    return { simulated: true, entry: e, balance: balance() }
  },

  'team.members': () => members,
  'team.invite': (input) => {
    const m: TeamMember = { id: nextId(), name: input.name, email: input.email, role: input.role, status: 'invited', monthlyCap: input.monthlyCap ?? null, self: false, example: false, createdAt: new Date().toISOString() }
    members = [...members, m]
    changed('team')
    return m
  },
  'team.updateMember': (id, patch) => {
    members = members.map((m) => (m.id === id ? { ...m, ...patch } : m))
    changed('team')
    return members.find((m) => m.id === id) ?? members[0]!
  },
  'team.removeMember': (id) => {
    members = members.filter((m) => m.id !== id || m.self)
    changed('team')
  },
  'team.devices': () => devices,
  'team.revokeDevice': (id) => {
    devices = devices.filter((d) => d.id !== id || d.current)
    changed('team')
  },

  'claude.profiles': () => profiles,
  'claude.saveProfile': (input) => {
    // an API key typed here is dropped: only « enregistrée » is remembered
    const keySet = input.kind === 'api' ? true : null
    const id = input.id ?? nextId()
    const old = profiles.find((p) => p.id === id)
    const p: ClaudeProfile = { id, name: input.name, kind: input.kind, status: 'ready', limitedUntil: null, keySet: old?.keySet ?? keySet, isDefault: input.isDefault ?? old?.isDefault ?? false, example: false }
    profiles = [...profiles.filter((x) => x.id !== id).map((x) => (p.isDefault ? { ...x, isDefault: false } : x)), p]
    changed('team')
    return p
  },
  'claude.removeProfile': (id) => {
    profiles = profiles.filter((p) => p.id !== id)
    changed('team')
  },
  'claude.setLimit': (id, until) => {
    profiles = profiles.map((p) => (p.id === id ? { ...p, status: until ? 'limited' : 'ready', limitedUntil: until } : p))
    changed('team')
    return profiles.find((p) => p.id === id)!
  },
  'claude.routing': () => [],
  'claude.setRouting': () => undefined,

  'admin.overview': () => ({ prices: ADMIN, granted: { local: wallet.granted, simulated: wallet.simulated, example: 0 }, balance: balance() }),
  'support.list': () => support,
  'support.create': (input) => {
    const row: SupportRequestRow = { ...input, id: nextId(), status: 'open', example: false, createdAt: new Date().toISOString(), closedAt: null }
    support = [row, ...support]
    changed('analysis')
    return row
  },
  'support.close': (id) => {
    support = support.map((r) => (r.id === id ? { ...r, status: 'closed', closedAt: new Date().toISOString() } : r))
    changed('analysis')
    return support.find((r) => r.id === id)!
  },

  'orchestra.status': () => ({
    enabled: S.power.state === 'on',
    running: S.power.state === 'on' ? 2 : 0,
    maxConcurrent: 4,
    tasks: { queued: 3, running: S.power.state === 'on' ? 2 : 0, done: 128 },
    agents: 14,
    accountsReady: accounts.filter((a) => a.state === 'ready').length,
    accountsLimited: 0,
    resumesAt: null,
    openInbox: 2
  }),
  'orchestra.accounts': () => accounts,
  'orchestra.addCliAccount': async (input) => {
    await wait(400)
    const a = account(nextId(), input.kind, input.label ?? (input.kind === 'codex' ? 'Codex · nouveau compte' : 'Claude Code · nouveau compte'), 'login')
    accounts = [...accounts, a]
    changed('orchestra')
    const cli = input.kind === 'codex' ? 'codex' : 'claude'
    return { account: a, configDir: a.configDir ?? '', command: `${cli} login`, launched: true, note: 'Démo : la connexion est simulée. Clique sur « Vérifier » pour finir.' }
  },
  'orchestra.openLogin': (id) => {
    const a = accounts.find((x) => x.id === id) ?? accounts[0]!
    return { account: a, configDir: a.configDir ?? '', command: a.kind === 'codex' ? 'codex login' : 'claude login', launched: true, note: 'Démo : la connexion est simulée.' }
  },
  'orchestra.checkAccount': async (id) => {
    await wait(700)
    accounts = accounts.map((a) => (a.id === id ? { ...a, state: 'ready', reconnect: false, checkNote: 'Réponse reçue en 1,1 s (démo).', checkedAt: new Date().toISOString() } : a))
    changed('orchestra')
    return accounts.find((a) => a.id === id)!
  },
  'orchestra.tick': async () => {
    await wait(300)
    changed('orchestra')
    return { started: 2, expired: 0, recovered: 0, routines: 1, bumped: 0, waitingAccounts: 0 }
  },
  'orchestra.contextBlock': (scope, channelId) => {
    if (scope === 'channel' && channelId !== undefined) {
      const b = S.channelMemory.get(channelId)
      return { scope, channelId, text: b?.text ?? '', source: 'user', updatedAt: b?.updatedAt ?? null, archived: false }
    }
    return { scope: 'workspace', channelId: null, text: S.workspaceMemory.text, source: 'user', updatedAt: S.workspaceMemory.updatedAt, archived: false }
  },
  'orchestra.saveContextBlock': (input) => {
    const at = new Date().toISOString()
    if (input.scope === 'channel' && input.channelId != null) S.channelMemory.set(input.channelId, { text: input.text, updatedAt: at })
    else S.workspaceMemory = { text: input.text, updatedAt: at }
    changed('orchestra')
    return { scope: input.scope, channelId: input.channelId ?? null, text: input.text, source: 'user', updatedAt: at, archived: false }
  },

  'llm.access': () => access(),
  'llm.setDirectorBackend': (backend) => {
    S.director = backend
    changed('orchestra')
    return access()
  },
  'autopilot.power': () => power(),
  'autopilot.setPower': (input) => {
    S.power = { state: input.state, pausedUntil: input.state === 'paused' ? (input.until ?? null) : null }
    changed('orchestra')
    return power()
  },
  'autopilot.stop': () => {
    S.power = { state: 'off', pausedUntil: null }
    changed('orchestra')
    return { power: power(), killed: 2, requeued: 2, runsStopped: 0 }
  },
  // a week of the studio's subscription; one video is about a twentieth of it
  'spend.claudeUsage': (scope) => scaleUsage(WEEK_USAGE, 'videoId' in scope ? 0.05 : 1)
}
