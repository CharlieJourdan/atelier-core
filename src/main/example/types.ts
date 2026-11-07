// The example workspace (lot Z1): invented channels, videos and figures stored in the DB, marked `example = 1`, that the
// user deletes in one click. Each area seeds and clears its own rows.
import type { Db } from '../db'

/** Ids created by the core seed, handed to every area. */
export interface ExampleSeed {
  channels: { documentary: number; top10: number }
  /** Example videos by key (see core.ts in this folder). */
  videos: Record<ExampleVideoKey, number>
}

export type ExampleVideoKey = 'gevaudan' | 'bermudes' | 'atlantide' | 'templiers' | 'toutankhamon' | 'inventions' | 'animaux' | 'villes'

export interface ExampleArea {
  name: string
  /** Inserts the area's example rows (inside the load transaction). */
  seed: (db: Db, seed: ExampleSeed) => void
  /** Deletes every row of the area marked example = 1 (inside the delete transaction). */
  clear: (db: Db) => void
}
