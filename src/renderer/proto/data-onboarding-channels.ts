// Demo data of the Chaînes screen (2026-10-24): what a channel's detail view shows beyond the shared channel model
// (watched competitors, rules the agents follow, connections, the mix of styles). Invented values.
import type { MessageKey } from '../../shared/fr'
import { FOUND_COMPETITORS, type FoundCompetitor } from './data-onboarding'
import type { ChannelId } from './types'

export interface WatchedCompetitor extends FoundCompetitor {
  watched: boolean
}

/** 8 to 14 competitors per channel: the same pool, a different slice and order. */
export function competitorsOf(channelId: ChannelId): WatchedCompetitor[] {
  const offsets: Record<string, [number, number]> = {
    'ch-enigmes': [0, 14],
    'ch-histoires': [4, 10],
    'ch-top': [2, 9],
    'ch-mystery': [6, 8]
  }
  const [from, count] = offsets[channelId] ?? [0, 10]
  const pool = [...FOUND_COMPETITORS.slice(from), ...FOUND_COMPETITORS.slice(0, from)]
  return pool.slice(0, count).map((c, i) => ({ ...c, watched: i < Math.max(5, count - 4) }))
}

export const CHANNEL_RULES: Record<string, string[]> = {
  'ch-enigmes': ['Jamais de sujets politiques.', 'Toujours sourcer une affirmation chiffrée dans le script.', 'Pas de théories du complot présentées comme vraies.'],
  'ch-histoires': ['Histoires sans violence graphique.', 'Pas de prénoms réels.'],
  'ch-top': ['Les classements citent leurs sources à l’écran.', 'Jamais deux vidéos de suite sur le même thème.'],
  'ch-mystery': ['Garder les unités locales (miles, °F).', 'Adapter les références culturelles, pas seulement les mots.']
}

export type ConnectionId = 'analytics' | 'storage' | 'publishing' | 'discord'
export type ConnectionState = 'on' | 'off'

export const CONNECTION_IDS: readonly ConnectionId[] = ['analytics', 'storage', 'publishing', 'discord']

export const CONNECTION_DETAIL: Record<string, Partial<Record<ConnectionId, string>>> = {
  'ch-enigmes': { storage: 'Google Drive · /Atelier/Grandes Énigmes', publishing: 'Publication automatique, créneaux du planning', discord: 'Salon #grandes-enigmes' },
  'ch-histoires': { storage: 'Atelier · 214 Go', publishing: 'Publication automatique, 3 créneaux par jour', discord: 'Salon #histoires-vraies' },
  'ch-top': { storage: 'Atelier · 38 Go' },
  'ch-mystery': { storage: 'Google Drive · /Atelier/Mystery Files', publishing: 'Publication automatique, soirée américaine' }
}

export const CONNECTION_DEFAULTS: Record<string, Record<ConnectionId, ConnectionState>> = {
  'ch-enigmes': { analytics: 'on', storage: 'on', publishing: 'on', discord: 'on' },
  'ch-histoires': { analytics: 'on', storage: 'on', publishing: 'on', discord: 'on' },
  'ch-top': { analytics: 'off', storage: 'on', publishing: 'off', discord: 'off' },
  'ch-mystery': { analytics: 'on', storage: 'on', publishing: 'on', discord: 'off' }
}

export const CONNECTION_LABELS: Record<ConnectionId, { title: MessageKey; hint: MessageKey }> = {
  analytics: { title: 'chan.conn.analytics', hint: 'chan.conn.analytics.hint' },
  storage: { title: 'chan.conn.storage', hint: 'chan.conn.storage.hint' },
  publishing: { title: 'chan.conn.publishing', hint: 'chan.conn.publishing.hint' },
  discord: { title: 'chan.conn.discord', hint: 'chan.conn.discord.hint' }
}

/** Share of each pipeline in the channel's output, in %, when a channel mixes several styles. */
export const STYLE_MIX: Record<string, Record<string, number>> = {
  'ch-enigmes': { 'pl-docu': 80, 'pl-avatar': 20 }
}
