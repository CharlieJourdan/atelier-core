// The example workspace (lot Z1): loads and deletes invented data so the app feels alive on first launch, without
// ever presenting it as real. Rows are marked `example = 1`; deleting removes exactly those rows, in one transaction.
// Example videos are plain rows (no deliverables, no tasks): the agent runner never picks them up, so loading the
// example costs nothing and calls no model.
import type { ExampleStatus } from '../../shared/api/example'
import { transaction, type Db } from '../db'
import type { SettingsStore } from '../settings'
import { analysisExample } from './analysis'
import { homeExample } from './home'
import { ideasExample } from './ideas'
import { moneyExample } from './money'
import { runsExample } from './runs'
import { teamExample } from './team'
import { toolsExample } from './tools'
import type { ExampleArea, ExampleSeed, ExampleVideoKey } from './types'

export type { ExampleArea, ExampleSeed, ExampleVideoKey } from './types'

export const EXAMPLE_AREAS: readonly ExampleArea[] = [
  runsExample,
  analysisExample,
  moneyExample,
  toolsExample,
  teamExample,
  homeExample,
  ideasExample
]

/**
 * Whether the app (and the headless brain) loads the example workspace at start: only when asked with ATELIER_EXAMPLE=1.
 * A fresh install starts empty, so the first-run onboarding opens; Réglages › Données can still load the example.
 */
export function exampleAtStart(env: NodeJS.ProcessEnv): boolean {
  return env.ATELIER_EXAMPLE === '1'
}

/** Setting written once the example was loaded (and kept after a delete, so it never comes back by itself). */
export const EXAMPLE_STATE_KEY = 'example.state'

export type { ExampleStatus }

const CHANNELS = {
  documentary: {
    name: 'Les Grandes Énigmes',
    niche: 'Histoire et mystères, documentaire raconté sans visage',
    standards: 'Ton posé, faits vérifiés, une source par affirmation forte.'
  },
  top10: {
    name: 'Top Savoirs',
    niche: 'Classements « top 10 » de culture générale, en animations',
    standards: 'Rythme rapide, un chiffre par entrée, pas de superlatif sans source.'
  }
} as const

const VIDEOS: readonly { key: ExampleVideoKey; channel: keyof typeof CHANNELS; title: string; status: string; daysAgo: number }[] = [
  { key: 'gevaudan', channel: 'documentary', title: 'La Bête du Gévaudan : ce que disent vraiment les archives', status: 'published', daysAgo: 41 },
  { key: 'bermudes', channel: 'documentary', title: 'Le Triangle des Bermudes, enquête sur une légende', status: 'published', daysAgo: 20 },
  { key: 'atlantide', channel: 'documentary', title: 'L’Atlantide : de Platon aux plongeurs', status: 'ready', daysAgo: 6 },
  { key: 'templiers', channel: 'documentary', title: 'Le trésor des Templiers a-t-il existé ?', status: 'in_progress', daysAgo: 2 },
  { key: 'toutankhamon', channel: 'documentary', title: 'Toutânkhamon : la malédiction mise à l’épreuve', status: 'idea', daysAgo: 1 },
  { key: 'inventions', channel: 'top10', title: '10 inventions qui ont changé le quotidien', status: 'published', daysAgo: 27 },
  { key: 'animaux', channel: 'top10', title: 'Les 10 animaux les plus rapides du monde', status: 'in_progress', daysAgo: 3 },
  { key: 'villes', channel: 'top10', title: '10 villes englouties sous la mer', status: 'idea', daysAgo: 0 }
]

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

export class ExampleWorkspace {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsStore,
    private readonly areas: readonly ExampleArea[] = EXAMPLE_AREAS,
    private readonly now: () => Date = () => new Date()
  ) {}

  status(): ExampleStatus {
    const ids = this.db.prepare('SELECT id FROM channels WHERE example = 1 ORDER BY id').all() as { id: number }[]
    const state = this.settings.get(EXAMPLE_STATE_KEY)
    return { loaded: ids.length > 0, channelIds: ids.map((r) => r.id), deleted: state === 'deleted' }
  }

  /** Loads the example workspace. Refused while it is already there. */
  load(): ExampleStatus {
    if (this.status().loaded) throw new Error('L’espace d’exemple est déjà chargé.')
    const now = this.now()
    transaction(this.db, () => {
      const insertChannel = this.db.prepare(
        'INSERT INTO channels (name, niche, standards, example, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      const created = daysAgoIso(60, now)
      const channels = {
        documentary: Number(insertChannel.run(CHANNELS.documentary.name, CHANNELS.documentary.niche, CHANNELS.documentary.standards, created, created).lastInsertRowid),
        top10: Number(insertChannel.run(CHANNELS.top10.name, CHANNELS.top10.niche, CHANNELS.top10.standards, created, created).lastInsertRowid)
      }
      const insertVideo = this.db.prepare(
        'INSERT INTO videos (channel_id, title, brief, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      const videos = {} as Record<ExampleVideoKey, number>
      for (const v of VIDEOS) {
        const at = daysAgoIso(v.daysAgo, now)
        videos[v.key] = Number(insertVideo.run(channels[v.channel], v.title, `Exemple : ${v.title}.`, v.status, at, at).lastInsertRowid)
      }
      const seed: ExampleSeed = { channels, videos }
      for (const area of this.areas) area.seed(this.db, seed)
      this.settings.set(EXAMPLE_STATE_KEY, 'loaded')
    })
    return this.status()
  }

  /** Deletes every example row (areas first, then the example channels and, by cascade, their videos). */
  delete(): ExampleStatus {
    transaction(this.db, () => {
      for (const area of [...this.areas].reverse()) area.clear(this.db)
      this.db.prepare('DELETE FROM channels WHERE example = 1').run()
      this.settings.set(EXAMPLE_STATE_KEY, 'deleted')
    })
    return this.status()
  }

  /** First launch: loads the example once, when the database has no channel and it was never loaded or deleted. */
  loadOnFirstLaunch(): boolean {
    if (this.settings.get(EXAMPLE_STATE_KEY) !== null) return false
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }).n
    if (n > 0) return false
    this.load()
    return true
  }
}
