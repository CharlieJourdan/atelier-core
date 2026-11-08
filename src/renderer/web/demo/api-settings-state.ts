// Demo state of the settings domain (Réglages, shell chrome, Monétisation › Avancé, Ordinateurs): what the visitor
// changes during the tour lives here, in memory, and is lost on reload. Every name, address and figure is invented; no key,
// token or secret is ever stored (a pasted one is dropped on the spot, only « set » is remembered).
import type { JsonValue } from '../../../shared/api'
import type { ChannelRow } from '../../../shared/workflow'
import { ago, DEMO_CHANNELS } from './world'

export const DEMO_ACCOUNT = { name: 'Studio Démo', email: 'demo@example.com', teamName: 'Studio Démo' } as const
export const DEMO_CLOUD_URL = 'https://cloud.example.com'

const NICHE_STANDARDS = 'Ton posé, sources citées, pas de sensationnalisme.'

function channelRow(c: (typeof DEMO_CHANNELS)[number], i: number): ChannelRow {
  return {
    id: c.id,
    name: c.name,
    youtubeChannelId: null,
    niche: c.niche,
    standards: NICHE_STANDARDS,
    monthlyBudgetUsd: [60, 25, 40, null][i] ?? null,
    autopilotOn: i < 2,
    autopilotTarget: i < 2 ? 3 : null,
    autopilotWeeklyMax: i < 2 ? 5 : null,
    autoApprove: ['research', 'metadata'],
    ownerGates: ['publish_package'],
    thumbnailStyle: 'Contraste fort, un visage ou un objet, trois mots au plus.',
    scriptStyle: 'Accroche en dix secondes, une question par partie.',
    archived: false,
    createdAt: ago(60 * 24 * (300 - i * 60)),
    updatedAt: ago(60 * (i + 2))
  }
}

export const S = {
  settings: new Map<string, JsonValue>([
    ['app.offline', false],
    ['app.presentation', false],
    ['agents.runnerEnabled', true],
    ['agents.maxParallel', 3],
    ['chat.roundBudgetUsd', 2]
  ]),
  cloud: { connected: true, baseUrl: DEMO_CLOUD_URL, pendingLogin: false },
  brain: { remote: false, via: 'cloud' as 'direct' | 'cloud', url: null as string | null },
  discord: {
    tokenSet: false,
    guildId: null as string | null,
    enabled: false,
    summaryHour: 20 as number | null,
    weeklyDay: 1 as number | null,
    notifications: 'important' as 'important' | 'everything' | 'nothing',
    allowedUserIds: [] as string[]
  },
  google: { connected: false, refreshedAt: null as string | null, linked: new Map<string, number>() },
  update: { channel: 'beta' as 'beta' | 'stable', checkedAt: ago(95) as string | null },
  example: { loaded: true, deleted: false },
  power: { state: 'off' as 'off' | 'on' | 'paused', pausedUntil: null as string | null },
  director: null as 'subscription' | 'api' | null,
  workspaceMemory: {
    text: 'Studio Démo produit quatre chaînes fictives en français.\nTon : clair, chaleureux, jamais racoleur.\nToujours citer ses sources dans la description.',
    updatedAt: ago(60 * 26) as string | null
  },
  channelMemory: new Map<number, { text: string; updatedAt: string }>(),
  globalCapUsd: 150 as number | null,
  channels: DEMO_CHANNELS.map(channelRow),
  usdToEur: 0.92
}

export function setting(key: string): JsonValue | null {
  return S.settings.get(key) ?? null
}
