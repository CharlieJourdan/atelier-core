// Demo handlers: the app itself (info, machine, settings store, updates, example workspace), Atelier Cloud (signed in as
// the fictional « Studio Démo », every function on) and the team computer link (Réglages › Ordinateur d'équipe).
// Signing in, out or linking always succeeds at once: no browser page, no code to type, no token kept.
import type { BrainStatus, CloudAccount, CloudLoginState, CloudStatus, CloudTeam, UpdateStatus } from '../../../shared/api'
import { CLOUD_FUNCTIONS, type CloudCatalog } from '../../../shared/features'
import { changed, wait, type DemoHandlers } from './bridge'
import { DEMO_ACCOUNT, S, setting } from './api-settings-state'
import { ago, DEMO_CHANNELS, nextId } from './world'

const VERSION = '2.4.0-demo'

function cloudStatus(): CloudStatus {
  return S.cloud.connected
    ? { connected: true, baseUrl: S.cloud.baseUrl, deviceId: 'demo-device', account: { ...DEMO_ACCOUNT } }
    : { connected: false, baseUrl: S.cloud.baseUrl, deviceId: null }
}

function loginState(): CloudLoginState {
  if (S.cloud.connected) return 'connected'
  return S.cloud.pendingLogin ? { pending: true, userCode: 'DEMO-2024', verificationUri: `${S.cloud.baseUrl}/device` } : 'idle'
}

const catalog = (): CloudCatalog => ({
  functions: Object.fromEntries(CLOUD_FUNCTIONS.map((id) => [id, 'real' as const])),
  hasCredits: true
})

const account = (): CloudAccount => ({
  ...DEMO_ACCOUNT,
  role: 'owner',
  wallet: { balance: 12_450, held: 320, available: 12_130 },
  caps: { dailyCredits: 2_000, monthlyCredits: 40_000 },
  creditValueEur: 0.01
})

const team: CloudTeam = {
  canInvite: true,
  members: [
    { accountId: 'acc-1', email: DEMO_ACCOUNT.email, name: DEMO_ACCOUNT.name, role: 'owner' },
    { accountId: 'acc-2', email: 'monteuse@example.com', name: 'Camille (montage)', role: 'admin' },
    { accountId: 'acc-3', email: 'redaction@example.com', name: 'Noé (rédaction)', role: 'member' }
  ],
  invites: [
    { id: 'inv-1', email: 'voix@example.com', role: 'member', invitedBy: DEMO_ACCOUNT.email, createdAt: ago(60 * 30), expiresAt: ago(-60 * 24 * 6) }
  ]
}

function brainStatus(): BrainStatus {
  const cloud = S.cloud.connected
    ? { machines: [{ id: 'pc-studio-demo', status: 'running', online: true, demo: true }], checked: true, error: null }
    : undefined
  if (!S.brain.remote) return { mode: 'local', url: null, name: null, tokenSet: false, live: false, error: null, storage: null, ...(cloud ? { cloud } : {}) }
  return {
    mode: 'remote',
    url: S.brain.url ?? 'https://relay.example.com/pc-studio-demo',
    name: 'pc-studio-demo',
    tokenSet: S.brain.via === 'direct',
    live: true,
    error: null,
    storage: 'session',
    via: S.brain.via,
    ...(cloud ? { cloud } : {})
  }
}

function updateStatus(): UpdateStatus {
  return {
    phase: 'idle',
    unsupported: null,
    current: VERSION,
    channel: S.update.channel,
    available: null,
    notes: null,
    percent: null,
    checkedAt: S.update.checkedAt,
    error: null,
    platform: 'other',
    feedUrl: `${S.cloud.baseUrl}/v1/releases/${S.update.channel}`
  }
}

export const cloudSettingsHandlers: DemoHandlers = {
  'app.info': () => ({ name: 'Atelier', version: VERSION, platform: 'web', dbPath: '(démo) mémoire du navigateur', schemaVersion: 42 }),
  'app.machine': () => ({
    hostname: 'pc-studio-demo',
    os: 'Linux (démo)',
    cpuModel: 'Processeur 8 cœurs (démo)',
    cores: 8,
    cpu: 20 + Math.round(Math.random() * 25),
    ramTotalGb: 32,
    ram: 41,
    diskTotalGb: 512,
    diskUsedGb: 188,
    uptimeHours: 26 * 24 + 5
  }),
  'app.onboarding': () => ({ done: true }),
  'app.finishOnboarding': () => ({ done: true }),

  'settings.get': (key) => setting(key),
  'settings.list': () => Object.fromEntries(S.settings),
  'settings.set': (key, value) => {
    S.settings.set(key, value)
    changed('settings')
  },

  'app.update.status': () => updateStatus(),
  'app.update.check': async () => {
    await wait(700)
    S.update.checkedAt = new Date().toISOString()
    changed('update')
    return updateStatus()
  },
  'app.update.install': () => undefined,
  'app.update.setChannel': (channel) => {
    S.update.channel = channel
    S.update.checkedAt = new Date().toISOString()
    changed('update')
    return updateStatus()
  },

  'example.status': () => ({ loaded: S.example.loaded, channelIds: S.example.loaded ? DEMO_CHANNELS.map((c) => c.id) : [], deleted: S.example.deleted }),
  'example.load': () => {
    S.example.loaded = true
    changed('example', 'channels')
    return { loaded: true, channelIds: DEMO_CHANNELS.map((c) => c.id), deleted: S.example.deleted }
  },
  'example.delete': () => {
    S.example = { loaded: false, deleted: true }
    changed('example', 'channels')
    return { loaded: false, channelIds: [], deleted: true }
  },

  'cloud.status': () => cloudStatus(),
  'cloud.loginState': () => loginState(),
  'cloud.connect': async (): Promise<CloudLoginState> => {
    // the real app opens the browser on the approval page; the demo approves at once
    await wait(500)
    S.cloud.connected = true
    S.cloud.pendingLogin = false
    changed('cloud')
    return 'connected'
  },
  'cloud.reopenLogin': () => undefined,
  'cloud.cancelLogin': () => {
    S.cloud.pendingLogin = false
    changed('cloud')
  },
  'cloud.disconnect': () => {
    S.cloud.connected = false
    changed('cloud')
  },
  'cloud.setBaseUrl': (url) => {
    S.cloud.baseUrl = url
    changed('cloud')
    return cloudStatus()
  },
  'cloud.account': () => (S.cloud.connected ? account() : null),
  'cloud.catalog': () => (S.cloud.connected ? catalog() : null),
  'cloud.profile': () =>
    S.cloud.connected
      ? { ...DEMO_ACCOUNT, role: 'owner', emailVerified: true, plan: 'creator', planStatus: 'active', credits: { balance: 12_450, held: 320, available: 12_130 } }
      : null,
  'cloud.team': () => (S.cloud.connected ? team : null),
  'cloud.invite': (email, role = 'member') => {
    const invite = { id: `inv-${nextId()}`, email, role, invitedBy: DEMO_ACCOUNT.email, createdAt: new Date().toISOString(), expiresAt: ago(-60 * 24 * 7) }
    team.invites = [...team.invites, invite]
    changed('cloud')
    return invite
  },
  'cloud.revokeInvite': (id) => {
    team.invites = team.invites.filter((i) => i.id !== id)
    changed('cloud')
  },
  'cloud.spend': (month) => ({ month: month ?? new Date().toISOString().slice(0, 7), reservedCredits: 320, spentCredits: 4_870, spentEur: 48.7, jobs: 37 }),

  'brain.status': () => brainStatus(),
  'brain.connect': async (input) => {
    await wait(500)
    // nothing is checked nor kept: a pasted token is dropped here
    S.brain = { remote: true, via: input.via === 'cloud' ? 'cloud' : 'direct', url: input.via === 'cloud' ? null : (input.url ?? null) }
    changed('brain')
    return brainStatus()
  },
  'brain.disconnect': () => {
    S.brain = { remote: false, via: 'cloud', url: null }
    changed('brain')
    return brainStatus()
  }
}
