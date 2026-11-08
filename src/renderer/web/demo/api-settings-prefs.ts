// Demo handlers: the Réglages preference pages (Discord, Google, Chaînes, Moteur, Audio, Budgets, Admin's providers) and
// Ordinateurs (declared PCs, agent browsers). Discord and Google « connect » at once on a fictional bot / account: no token,
// no client secret is kept (a typed one is dropped on the spot), no request leaves the browser.
import type { DiscordRoomStatus, DiscordStatus, GoogleStatus, Machine, ProviderInfo } from '../../../shared/api'
import type { AgentRow } from '../../../shared/agents'
import type { BrowserSession } from '../../../shared/api/home'
import type { ChannelRow } from '../../../shared/workflow'
import { changed, wait, type DemoHandlers } from './bridge'
import { S } from './api-settings-state'
import { ago, nextId } from './world'

// ------------------------------------------------------------------------------------------------ Discord

const GUILD = { id: 'guild-demo', name: 'Studio Démo (serveur fictif)' }

function discordRooms(): DiscordRoomStatus[] {
  if (!S.discord.guildId) return []
  const fixed: DiscordRoomStatus[] = [
    { key: 'atlas', name: 'atlas', discordId: 'room-atlas', channelId: null },
    { key: 'approvals', name: 'à-valider', discordId: 'room-approvals', channelId: null },
    { key: 'production', name: 'production', discordId: 'room-production', channelId: null }
  ]
  const rooms = S.channels
    .filter((c) => !c.archived)
    .map((c): DiscordRoomStatus => ({ key: 'room', name: c.name.toLowerCase().replace(/\s+/g, '-'), discordId: `room-${c.id}`, channelId: c.id }))
  return [...fixed, ...rooms]
}

function discordStatus(): DiscordStatus {
  const d = S.discord
  return {
    tokenSet: d.tokenSet,
    bot: d.tokenSet ? { id: 'bot-demo', name: 'Atlas (démo)' } : null,
    applicationId: d.tokenSet ? 'app-demo' : null,
    guild: d.guildId ? GUILD : null,
    channels: discordRooms(),
    allowedUserIds: d.allowedUserIds,
    enabled: d.enabled,
    running: d.enabled,
    summaryHour: d.summaryHour,
    lastPollAt: d.enabled ? ago(1) : null,
    lastError: null,
    teamOn: S.power.state === 'on',
    contentIntentMissing: false,
    notifications: d.notifications,
    weeklyDay: d.weeklyDay,
    buttonsLive: d.enabled
  }
}

const discordChanged = (): DiscordStatus => {
  changed('discord')
  return discordStatus()
}

// ------------------------------------------------------------------------------------------------ Google

const YT = [
  { youtubeChannelId: 'yt-demo-enigmes', title: 'Les Grandes Énigmes', handle: '@grandesenigmes', channelId: 1 },
  { youtubeChannelId: 'yt-demo-histoires', title: 'Histoires Vraies', handle: '@histoiresvraies.fr', channelId: 2 },
  { youtubeChannelId: 'yt-demo-ancienne', title: 'Ancienne chaîne (démo)', handle: null, channelId: null }
]

function googleStatus(): GoogleStatus {
  const g = S.google
  const channels = g.connected
    ? YT.map((y) => {
        const linked = g.linked.get(y.youtubeChannelId) ?? y.channelId
        return {
          youtubeChannelId: y.youtubeChannelId,
          title: y.title,
          handle: y.handle,
          atelierChannelId: linked,
          atelierChannelName: S.channels.find((c) => c.id === linked)?.name ?? null,
          revenueAvailable: y.channelId !== null
        }
      })
    : []
  return {
    clientIdSet: true,
    clientId: null,
    clientSecretSet: true,
    clientSource: 'env',
    connected: g.connected,
    needsReconnect: false,
    connecting: false,
    scopes: g.connected ? ['yt-analytics.readonly', 'yt-analytics-monetary.readonly', 'youtube.readonly'] : [],
    lastRefreshAt: g.refreshedAt,
    lastError: null,
    channels
  }
}

// ------------------------------------------------------------------------------------------------ computers

let machines: Machine[] = [
  { id: 1, name: 'pc-studio-demo', os: 'linux', host: 'pc-studio.example.com', port: 22, status: 'reachable', lastSeenAt: ago(3), lastCheckedAt: ago(3), lastError: null, createdAt: ago(60 * 24 * 40), example: false },
  { id: 2, name: 'Mac de montage', os: 'macos', host: 'mac-montage.example.com', port: 22, status: 'unknown', lastSeenAt: null, lastCheckedAt: null, lastError: null, createdAt: ago(60 * 24 * 3), example: false }
]

const AGENTS: AgentRow[] = [
  ['researcher', 'Chercheur', 'best'],
  ['scriptwriter', 'Scénariste', 'best'],
  ['thumbnail_designer', 'Miniaturiste', 'balanced'],
  ['video_producer', 'Monteur', 'balanced'],
  ['publisher', 'Éditeur', 'fast']
].map(([role, name, tier]) => ({
  id: role!,
  role: role!,
  name: name!,
  instructions: `Agent ${name} du Studio Démo (instructions fictives).`,
  customized: false,
  tools: ['get_brief', 'save_version', 'post_message'],
  webSearch: role === 'researcher',
  tier: tier as AgentRow['tier'],
  cadence: 'on_task',
  enabled: true,
  updatedAt: ago(60 * 24)
}))

let browsers: BrowserSession[] = [
  { id: 1, role: 'researcher', agentName: 'Chercheur', startUrl: 'https://example.com/recherche', status: 'open', screenshotPath: null, createdAt: ago(18), closedAt: null, example: false }
]

const PROVIDERS: ProviderInfo[] = [
  { id: 'claude-code', kind: 'claude_code', label: 'Claude Code (abonnement)', enabled: true, keySet: null },
  { id: 'anthropic', kind: 'anthropic', label: 'API Anthropic', enabled: false, keySet: false }
]

// ------------------------------------------------------------------------------------------------ spend

const SPENT = [18.4, 6.2, 9.7, 1.3]
const month = (): string => new Date().toISOString().slice(0, 7)

function updateChannel(id: number, patch: Partial<ChannelRow>): ChannelRow {
  S.channels = S.channels.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c))
  changed('channels')
  return S.channels.find((c) => c.id === id) ?? S.channels[0]!
}

export const prefsSettingsHandlers: DemoHandlers = {
  'discord.status': () => discordStatus(),
  'discord.setToken': async () => {
    // the token typed (if any) is not kept, not even in memory
    await wait(400)
    S.discord.tokenSet = true
    return discordChanged()
  },
  'discord.clearToken': () => {
    S.discord = { ...S.discord, tokenSet: false, enabled: false }
    return discordChanged()
  },
  'discord.inviteUrl': () => ({ applicationId: 'app-demo', url: 'https://example.com/demo/inviter-atlas' }),
  'discord.guilds': () => [{ ...GUILD, owner: true }],
  'discord.setup': async (guildId) => {
    await wait(500)
    const first = S.discord.guildId === null
    S.discord.guildId = guildId || GUILD.id
    const channels = discordRooms()
    changed('discord')
    return { created: first ? channels.length : 0, reused: first ? 0 : channels.length, guild: GUILD, channels }
  },
  'discord.setEnabled': (enabled) => {
    S.discord.enabled = enabled
    return discordChanged()
  },
  'discord.configure': (input) => {
    S.discord = { ...S.discord, ...input }
    return discordChanged()
  },
  'discord.test': () => ({ ok: true, channel: 'atlas' }),

  'google.status': () => googleStatus(),
  'google.setClient': () => {
    changed('google')
    return googleStatus()
  },
  'google.clearClient': () => googleStatus(),
  'google.connect': async () => {
    await wait(700)
    S.google.connected = true
    S.google.refreshedAt = new Date().toISOString()
    changed('google')
    return googleStatus()
  },
  'google.disconnect': () => {
    S.google = { connected: false, refreshedAt: null, linked: new Map() }
    changed('google')
    return googleStatus()
  },
  'google.refresh': async () => {
    await wait(500)
    S.google.refreshedAt = new Date().toISOString()
    changed('google')
    return googleStatus()
  },

  'channels.list': (includeArchived) => S.channels.filter((c) => includeArchived || !c.archived),
  'channels.get': (id) => S.channels.find((c) => c.id === id) ?? S.channels[0]!,
  'channels.create': (input) => {
    const at = new Date().toISOString()
    const row: ChannelRow = {
      ...S.channels[0]!,
      niche: '',
      standards: '',
      monthlyBudgetUsd: null,
      autopilotOn: false,
      autopilotTarget: null,
      autopilotWeeklyMax: null,
      ...input,
      id: nextId(),
      youtubeChannelId: input.youtubeChannelId ?? null,
      archived: false,
      createdAt: at,
      updatedAt: at
    }
    S.channels = [...S.channels, row]
    changed('channels')
    return row
  },
  'channels.update': (id, patch) => {
    if (patch.youtubeChannelId) S.google.linked.set(patch.youtubeChannelId, id)
    if (patch.youtubeChannelId) changed('google')
    return updateChannel(id, patch)
  },
  'channels.archive': (id, archived = true) => updateChannel(id, { archived } as Partial<ChannelRow>),

  'production.engineStatus': () => ({
    ffmpeg: { found: true, path: '/usr/bin/ffmpeg', version: '7.1 (démo)' },
    ffprobe: { found: true, path: '/usr/bin/ffprobe' },
    systemVoice: true,
    platform: 'web (démo)',
    dataDir: '~/Atelier (démo)',
    productionDir: '~/Atelier (démo)/production',
    resourcesDir: '~/Atelier (démo)/ressources',
    resourcesFound: true,
    activeRuns: 1,
    activeRunIds: [41],
    cloudConnected: S.cloud.connected,
    note: 'Démo : rien ne tourne vraiment, les chiffres sont inventés.'
  }),
  'production.voices': () => ({
    voices: [
      { id: 'sys-fr-1', name: 'Amélie (voix système)', language: 'fr', system: true },
      { id: 'sys-fr-2', name: 'Thomas (voix système)', language: 'fr', system: true },
      { id: 'sys-en-1', name: 'Daniel (voix système)', language: 'en', system: true }
    ],
    listed: true,
    note: 'Voix du système de démonstration.'
  }),

  'providers.list': () => PROVIDERS,
  'providers.test': async (id) => {
    await wait(500)
    return id === 'claude-code' ? { ok: true, message: 'Connexion simulée (démo).', latencyMs: 840 } : { ok: false, message: 'Aucune clé en démo.', latencyMs: 0 }
  },
  'providers.setKey': () => changed('providers'),
  'providers.clearKey': () => changed('providers'),
  'llm.defaults': () => ({ defaultProvider: 'claude-code', tierModels: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' } }),

  'spend.overview': () => {
    const channels = S.channels
      .filter((c) => !c.archived)
      .map((c, i) => ({ channelId: c.id, name: c.name, spentUsd: SPENT[i] ?? 0.8, reservedUsd: i === 0 ? 1.2 : 0, budgetUsd: c.monthlyBudgetUsd }))
    const spentUsd = channels.reduce((s, c) => s + c.spentUsd, 0)
    return { month: month(), spentUsd, reservedUsd: 1.2, calls: 412, globalCapUsd: S.globalCapUsd, channels }
  },
  'spend.summary': (group) => {
    const rows: [string, string, number, number][] =
      group === 'provider'
        ? [['claude-code', 'Claude Code (abonnement)', 0, 380], ['cloud', 'Atelier Cloud', 35.6, 32]]
        : group === 'model'
          ? [['claude-opus-5-5', 'Claude Opus', 0, 90], ['claude-sonnet-5-5', 'Claude Sonnet', 0, 230], ['voice', 'Voix de la plateforme', 21.4, 18]]
          : S.channels.map((c, i): [string, string, number, number] => [String(c.id), c.name, SPENT[i] ?? 0.8, 60 - i * 10])
    return rows.map(([key, label, spentUsd, calls]) => ({ key, label, spentUsd, calls, inputTokens: calls * 9_000, outputTokens: calls * 1_100 }))
  },
  'spend.entries': (_month, limit = 100) =>
    Array.from({ length: Math.min(limit, 12) }, (_, i) => {
      const c = S.channels[i % S.channels.length]!
      const usd = i % 3 === 0 ? 0 : Math.round((0.4 + i * 0.37) * 100) / 100
      return {
        id: 500 + i,
        createdAt: ago(35 + i * 140),
        providerId: i % 3 === 0 ? 'claude-code' : 'cloud',
        model: i % 3 === 0 ? 'claude-sonnet-5-5' : 'voix-plateforme',
        channelId: c.id,
        channelName: c.name,
        videoId: null,
        videoTitle: null,
        status: i === 0 ? 'reserved' : 'settled',
        estimateUsd: usd,
        amountUsd: usd,
        inputTokens: i % 3 === 0 ? 12_000 : 0,
        outputTokens: i % 3 === 0 ? 1_800 : 0
      }
    }),
  'spend.setGlobalCap': (usd) => {
    S.globalCapUsd = usd
    changed('spend')
  },
  'spend.setChannelCap': (id, usd) => {
    updateChannel(id, { monthlyBudgetUsd: usd })
    changed('spend')
  },

  'machines.list': () => machines,
  'machines.add': (input) => {
    const m: Machine = { id: nextId(), name: input.name, os: input.os, host: input.host, port: input.port ?? 22, status: 'unknown', lastSeenAt: null, lastCheckedAt: null, lastError: null, createdAt: new Date().toISOString(), example: false }
    machines = [...machines, m]
    changed('computers')
    return m
  },
  'machines.rename': (id, name) => {
    machines = machines.map((m) => (m.id === id ? { ...m, name } : m))
    changed('computers')
    return machines.find((m) => m.id === id)!
  },
  'machines.remove': (id) => {
    machines = machines.filter((m) => m.id !== id)
    changed('computers')
  },
  'machines.test': async (id) => {
    await wait(600)
    const at = new Date().toISOString()
    machines = machines.map((m) => (m.id === id ? { ...m, status: 'reachable', lastSeenAt: at, lastCheckedAt: at, lastError: null } : m))
    changed('computers')
    return { machine: machines.find((m) => m.id === id)!, ok: true, ms: 38, message: 'Joignable (test simulé).' }
  },
  'agents.list': () => AGENTS,
  'browsers.list': () => browsers,
  'browsers.open': (input) => {
    const s: BrowserSession = { id: nextId(), role: input.role, agentName: AGENTS.find((a) => a.role === input.role)?.name ?? input.role, startUrl: input.startUrl, status: 'open', screenshotPath: null, createdAt: new Date().toISOString(), closedAt: null, example: false }
    browsers = [s, ...browsers]
    changed('computers')
    return s
  },
  'browsers.close': (id) => {
    browsers = browsers.map((b) => (b.id === id ? { ...b, status: 'closed', closedAt: new Date().toISOString() } : b))
    changed('computers')
    return browsers.find((b) => b.id === id)!
  },
  'browsers.remove': (id) => {
    browsers = browsers.filter((b) => b.id !== id)
    changed('computers')
  }
}
