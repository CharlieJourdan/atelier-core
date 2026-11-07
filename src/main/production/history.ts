// Read-only history of the renders made by v1 and lot 3 (table `engine_jobs`, migration 008). Since lot P1 nothing
// writes it; it stays readable so past spend and versions can still be traced. Our own engine keeps its runs in new
// tables (lots P6 and P7).
import type { Db } from '../db'

export interface PastRender {
  id: number
  /** Where it ran: 'local' or 'h1'. */
  target: string
  title: string
  videoId: number
  deliverableId: number
  state: string
  error: string | null
  estimateUsd: number
  measuredUsd: number | null
  versionId: number | null
  createdAt: string
  updatedAt: string
}

interface Row {
  id: number
  target: string
  title: string
  video_id: number
  deliverable_id: number
  state: string
  error: string | null
  estimate_usd: number
  measured_usd: number | null
  version_id: number | null
  created_at: string
  updated_at: string
}

/** Past renders, newest first (of one video when `videoId` is given). */
export function pastRenders(db: Db, videoId?: number): PastRender[] {
  const where = videoId === undefined ? '' : 'WHERE video_id = ?'
  const rows = db
    .prepare(
      `SELECT id, target, title, video_id, deliverable_id, state, error, estimate_usd, measured_usd, version_id, created_at, updated_at
       FROM engine_jobs ${where} ORDER BY id DESC`
    )
    .all(...(videoId === undefined ? [] : [videoId])) as unknown as Row[]
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    title: r.title,
    videoId: r.video_id,
    deliverableId: r.deliverable_id,
    state: r.state,
    error: r.error,
    estimateUsd: r.estimate_usd,
    measuredUsd: r.measured_usd,
    versionId: r.version_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}
