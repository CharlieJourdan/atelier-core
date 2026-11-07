// A run and its video (agents-production): the video's status follows its production run — `in_progress` while it runs,
// `ready` once it succeeded, `failed` or `cancelled` when it ended so (a published video is never touched) — and whoever
// listens (the team: the planner, the inbox, Atlas) hears of the end. Also the French text of an engine that refused to
// start (never the engine's raw « required inputs missing »).
import type { Db } from '../../db'
import type { ProductionRunsDeps } from './deps'

export type RunEnd = 'succeeded' | 'failed' | 'cancelled'

/** What the team hears when a run ends. */
export interface RunFinished {
  runId: number
  videoId: number
  channelId: number
  status: RunEnd
  /** French reason of a failure (null otherwise). */
  error: string | null
  title: string
  demo: boolean
}

const VIDEO_OF: Record<RunEnd | 'running', string> = { running: 'in_progress', succeeded: 'ready', failed: 'failed', cancelled: 'cancelled' }

/** Sets the video's status from its run's state (a published video keeps its status). */
export function videoFollowsRun(db: Db, videoId: number, state: RunEnd | 'running', at: string): void {
  db.prepare(`UPDATE videos SET status = ?, updated_at = ? WHERE id = ? AND status != 'published'`).run(VIDEO_OF[state], at, videoId)
}

/** A run ended: its video follows, then the listener is told (it never throws into the run). */
export function runEnded(deps: ProductionRunsDeps, runId: number, status: RunEnd, at: string): void {
  const row = deps.db
    .prepare(
      `SELECT r.video_id, r.channel_id, r.error, r.topic, r.demo, v.title FROM video_runs r JOIN videos v ON v.id = r.video_id WHERE r.id = ?`
    )
    .get(runId) as { video_id: number; channel_id: number; error: string | null; topic: string; demo: number; title: string } | undefined
  if (!row) return
  videoFollowsRun(deps.db, row.video_id, status, at)
  try {
    deps.onFinished?.({
      runId,
      videoId: row.video_id,
      channelId: row.channel_id,
      status,
      error: status === 'failed' ? (row.error ?? 'La fabrication s’est arrêtée sur une erreur.') : null,
      title: row.title || row.topic,
      demo: row.demo === 1
    })
  } catch {
    // the team's notice is a convenience: the run is finished either way
  }
}

/** The French reason an engine did not start. */
export function startError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const missing = /required inputs missing: (.+)$/.exec(raw)?.[1]
  if (missing) {
    const ids = missing.split(',').map((s) => s.trim())
    return ids.includes('script')
      ? 'Le moteur n’a pas pu démarrer : il manque le script de la vidéo. Colle-le ou importe un fichier .txt ou .docx, puis relance.'
      : `Le moteur n’a pas pu démarrer : il manque des entrées de la pipeline (${ids.join(', ')}).`
  }
  return `Le moteur n’a pas pu démarrer : ${raw}`
}
