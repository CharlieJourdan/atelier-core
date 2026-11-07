// After a quit or a crash (solidite): every run left queued or running becomes `interrupted` with its holds given back,
// then is either resumed by itself (the brain on the team computer, `autoResume`, a few attempts at most) or told to
// the team (inbox, channel room, Atlas) with its reason — never left half-done in silence. A run whose last attempts
// all ended in a crash is not resumed again (it may be what crashes the brain): the team hears of it instead.
import { t } from '../../../shared/fr'
import { transaction, type Db } from '../../db'
import type { ProductionRunsDeps } from './deps'
import { releaseHold } from './money'

/** A run is started again by itself at most this many attempts in all (start = 1, each resume + 1). */
export const MAX_AUTO_ATTEMPTS = 3

/** Marks the runs a quit or crash left queued/running `interrupted`; returns their ids. */
export function markInterrupted(db: Db, deps: ProductionRunsDeps): number[] {
  const rows = db.prepare("SELECT id, hold_id FROM video_runs WHERE status IN ('queued','running','waiting')").all() as { id: number; hold_id: number | null }[]
  for (const r of rows) releaseHold(deps.credits, db, r.id, r.hold_id)
  return transaction(db, () => {
    const ids = (db.prepare("SELECT id FROM video_runs WHERE status IN ('queued','running')").all() as { id: number }[]).map((r) => r.id)
    for (const id of ids) {
      db.prepare("UPDATE video_runs SET status = 'interrupted', error = ? WHERE id = ?").run(t('runs.error.interrupted'), id)
      db.prepare("UPDATE video_run_nodes SET state = 'pending', progress = 0, step = NULL WHERE run_id = ? AND state IN ('queued','running')").run(id)
    }
    return ids
  })
}

export interface AfterRestart {
  db: Db
  deps: ProductionRunsDeps
  ids: readonly number[]
  /** Starts the run again; throws when it cannot. */
  resume: (id: number) => void
  /** Whether a real run can start now (the brain signs in to Atelier Cloud a moment after it starts). */
  realReady?: () => boolean
  /** How long a real run waits for that sign-in before it is resumed anyway (and fails loudly if still signed out). */
  waitRealMs?: number
  /** True once the app is closing: nothing more is started. */
  closed?: () => boolean
}

/** Resumes (or tells the team about) each interrupted run. A real run waits for the Cloud sign-in first (polled). */
export function afterRestart(o: AfterRestart): { resumed: number[]; told: number[]; waiting: number[] } {
  const resumed: number[] = []
  const told: number[] = []
  const waiting: number[] = []
  for (const id of o.ids) {
    const row = o.db
      .prepare('SELECT r.id, r.attempt, r.cloud, r.video_id, r.channel_id, r.topic, r.demo, r.example, v.title FROM video_runs r JOIN videos v ON v.id = r.video_id WHERE r.id = ?')
      .get(id) as { attempt: number; cloud: number; video_id: number; channel_id: number; topic: string; demo: number; example: number; title: string } | undefined
    if (!row) continue
    let reason = t('runs.error.interrupted')
    const auto = o.deps.autoResume && row.example !== 1 && row.attempt < MAX_AUTO_ATTEMPTS
    if (auto && row.cloud === 1 && o.realReady && !o.realReady() && (o.waitRealMs ?? 0) > 0) {
      waiting.push(id)
      continue
    }
    if (auto) {
      try {
        o.resume(id)
        resumed.push(id)
        continue
      } catch (e) {
        // a real run refused for a lost sign-in was already failed and told (service.cloudHost)
        if ((o.db.prepare('SELECT status FROM video_runs WHERE id = ?').get(id) as { status: string } | undefined)?.status === 'failed') continue
        reason = e instanceof Error ? e.message : String(e)
      }
    } else if (o.deps.autoResume && row.example !== 1) {
      reason = t('runs.error.interruptedTooOften', { n: String(row.attempt) })
    }
    told.push(id)
    try {
      o.deps.onFinished?.({ runId: id, videoId: row.video_id, channelId: row.channel_id, status: 'failed', error: reason, title: row.title || row.topic, demo: row.demo === 1 })
    } catch {
      // the team's notice is a convenience: the run stays « interrupted », resumable by hand
    }
  }
  if (waiting.length > 0) {
    const step = 5_000
    const timer = setTimeout(() => {
      if (o.closed?.()) return
      const left = Math.max(0, (o.waitRealMs ?? 0) - step)
      afterRestart({ ...o, ids: waiting, waitRealMs: o.realReady?.() ? 0 : left })
    }, step)
    timer.unref?.()
  }
  return { resumed, told, waiting }
}
