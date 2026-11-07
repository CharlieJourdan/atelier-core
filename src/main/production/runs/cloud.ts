// « Moteur réel » (production-16, decision 0044): a run the owner turned real sends its paid bricks (voice, presenter,
// stills, clips, the eyes) to Atelier Cloud's job API, the rest runs here as in a demo run. The Cloud is the wallet: each
// job holds its quoted credits, captures what was used on success and releases them on failure or cancel (cloud/src/
// jobs.ts); the Cloud also picks, per engine, the real provider or its demo. What this module adds on the app's side:
//   - `CloudRunsPort`, what ProductionRuns needs of the Cloud (core.ts builds it from the production host and the session);
//   - `recordJob`: every job a node makes is kept with that node (`video_run_jobs`, one row per job id), so the run view
//     shows which engine each brick really used, real or demo, and its real cost; the node's and the run's credits are
//     the sums of their succeeded jobs.
//   - `OpenJobsRefresh` (production-17): a job the app stopped waiting for (a slow clip given up by its brick) may still end
//     and be captured on the Cloud; the run view asks the Cloud about such jobs, so each brick shows what the Cloud captured.
import type { Spender } from '../../../engine/estimate'
import type { Executors } from '../../../engine/executor'
import type { EngineServices } from '../../../engine/services'
import { TERMINAL_JOB_STATES, type Job } from '../../../shared/cloud-api'
import type { CreditsBalance, RunNodeEngine } from '../../../shared/runs'
import { t } from '../../../shared/fr'
import type { Db } from '../../db'
import type { Live } from './deps'

/** One Cloud job event of a run, with the node that made it. */
export interface NodeJobEvent {
  phase: 'created' | 'ended'
  job: Job
}

/** The services, executors and wallet guard of one real run. */
export interface CloudRunHost {
  services: EngineServices
  executors: Executors
  /** Before each paid node: refuses it when it would cross the video's cap or the Cloud wallet (nothing asked of a provider). */
  spender: Spender
  cleanup(): Promise<void>
}

export interface CloudRunsPort {
  /** Whether a run can go real now (the app is signed in to a Cloud), and why not. */
  state(): { available: boolean; reason: string }
  /** The Cloud wallet now (throws a French error when the Cloud cannot be reached). */
  balance(): Promise<CreditsBalance>
  /** One job as the Cloud knows it now (its state and the credits it captured). */
  job(id: string): Promise<Job>
  forRun(o: {
    dataDir: string
    resourcesDir: string
    videoId: number
    channelId: number
    capCredits: number | null
    /** The run's quote ceiling and what its earlier attempts spent (decision 0078): a step past it is refused before it starts. */
    run?: { ceilingCredits: number; spentCredits: number }
    onJob: (nodeId: string, e: NodeJobEvent) => void
  }): CloudRunHost
  /** A demo run's services while signed in (decision 0109): the Cloud's free usages only, never a spend; null otherwise. */
  forDemoRun?(o: { dataDir: string; resourcesDir: string }): { services: EngineServices; cleanup(): Promise<void> } | null
}

export const notSignedIn = (): { available: false; reason: string } => ({ available: false, reason: t('runs.real.notSignedIn') })

interface JobRow {
  node_id: string
  provider: string | null
  demo: number
  state: string
  credits: number
}

/** Keeps one job of a real run with its node; the node's and the run's credits follow its succeeded jobs. */
export function recordJob(db: Db, runId: number, nodeId: string, e: NodeJobEvent, now: string): void {
  const j = e.job
  const credits = j.state === 'succeeded' ? j.credits : 0
  db.prepare(
    `INSERT INTO video_run_jobs (job_id, run_id, node_id, usage, provider, demo, state, credits, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET state = excluded.state, credits = excluded.credits,
       provider = COALESCE(excluded.provider, video_run_jobs.provider), updated_at = excluded.updated_at`
  ).run(j.id, runId, nodeId, j.usage, j.provider ?? null, j.demo ? 1 : 0, j.state, credits, now)
  db.prepare(
    `UPDATE video_run_nodes SET credits = (SELECT COALESCE(SUM(credits), 0) FROM video_run_jobs WHERE run_id = ? AND node_id = ?)
     WHERE run_id = ? AND node_id = ?`
  ).run(runId, nodeId, runId, nodeId)
  db.prepare('UPDATE video_runs SET spent_credits = (SELECT COALESCE(SUM(credits), 0) FROM video_run_jobs WHERE run_id = ?) WHERE id = ?').run(runId, runId)
}

/**
 * The price promise of a real run (solidite, decision 0078): what the Cloud captured for it never passes its quote by
 * more than CAPTURE_TOLERANCE (× 1.25, + 5 credits for the roundings of a tiny quote). Past it the run stops at once with
 * the reason, so at most the job that crossed the line is paid above the quote.
 */
export const CAPTURE_TOLERANCE = { factor: 1.25, slackCredits: 5 } as const
export const captureCeiling = (quoteCredits: number): number => Math.ceil(quoteCredits * CAPTURE_TOLERANCE.factor) + CAPTURE_TOLERANCE.slackCredits

/** Stops a live real run whose captures passed its ceiling; returns the French reason (null: within its quote). */
export function stopIfOverQuote(db: Db, runId: number, live: Live | undefined): string | null {
  // only real captures count: a development Cloud (paid calls off) bills its demo answers at the grid, in play money
  const r = db
    .prepare(`SELECT quote_credits, (SELECT COALESCE(SUM(credits), 0) FROM video_run_jobs WHERE run_id = ? AND demo = 0) AS real FROM video_runs WHERE id = ?`)
    .get(runId, runId) as { quote_credits: number; real: number } | undefined
  if (!r || r.real <= captureCeiling(r.quote_credits)) return null
  const reason = t('runs.error.overQuote', { spent: String(r.real), quote: String(r.quote_credits) })
  if (live && !live.stop) {
    live.stop = reason
    live.engine.cancel()
  }
  return reason
}

/** The engines each node of a run used, from its jobs (node id → engines, most credits first). */
export function enginesOf(db: Db, runId: number): Map<string, RunNodeEngine[]> {
  const rows = db.prepare('SELECT node_id, provider, demo, state, credits FROM video_run_jobs WHERE run_id = ? ORDER BY rowid').all(runId) as unknown as JobRow[]
  const out = new Map<string, RunNodeEngine[]>()
  for (const r of rows) {
    const list = out.get(r.node_id) ?? []
    const id = r.provider ?? '?'
    let e = list.find((x) => x.id === id && x.real === (r.demo === 0))
    if (!e) {
      e = { id, real: r.demo === 0, jobs: 0, credits: 0 }
      list.push(e)
    }
    e.jobs += 1
    e.credits += r.state === 'succeeded' ? r.credits : 0
    out.set(r.node_id, list)
  }
  for (const list of out.values()) list.sort((a, b) => b.credits - a.credits)
  return out
}

/** The jobs of a run the app has not seen end, with their nodes. */
export function openRunJobs(db: Db, runId: number): { jobId: string; nodeId: string }[] {
  const terminal = TERMINAL_JOB_STATES.map(() => '?').join(', ')
  return db
    .prepare(`SELECT job_id AS jobId, node_id AS nodeId FROM video_run_jobs WHERE run_id = ? AND state NOT IN (${terminal}) ORDER BY rowid`)
    .all(runId, ...TERMINAL_JOB_STATES) as unknown as { jobId: string; nodeId: string }[]
}

/**
 * Asks the Cloud about the open jobs of finished real runs, in the background and at most once every `everyMs` per run: a
 * job that ended there is recorded like any other (its brick's and the run's credits follow), then `changed` is called.
 * An unreachable or signed-out Cloud leaves them open for the next look.
 */
export class OpenJobsRefresh {
  private readonly asked = new Map<number, number>()
  private readonly running = new Map<number, Promise<number>>()

  constructor(private readonly o: { db: Db; job: ((id: string) => Promise<Job>) | null; now: () => Date; changed: () => void; everyMs?: number }) {}

  /** Starts a refresh of the run's open jobs unless one ran lately (never throws). */
  poke(runId: number): void {
    const at = this.o.now().getTime()
    if (!this.o.job || this.running.has(runId) || at - (this.asked.get(runId) ?? -Infinity) < (this.o.everyMs ?? 15_000)) return
    if (openRunJobs(this.o.db, runId).length === 0) return
    this.asked.set(runId, at)
    void this.refresh(runId)
  }

  /** Asks the Cloud now; resolves with how many jobs ended. */
  refresh(runId: number): Promise<number> {
    const prior = this.running.get(runId)
    if (prior) return prior
    const p = this.ask(runId).finally(() => this.running.delete(runId))
    this.running.set(runId, p)
    return p
  }

  private async ask(runId: number): Promise<number> {
    const job = this.o.job
    if (!job) return 0
    let ended = 0
    for (const open of openRunJobs(this.o.db, runId)) {
      let j: Job
      try {
        j = await job(open.jobId)
      } catch {
        // unreachable or signed out: the rest waits for the next look
        break
      }
      if (!TERMINAL_JOB_STATES.includes(j.state)) continue
      recordJob(this.o.db, runId, open.nodeId, { phase: 'ended', job: j }, this.o.now().toISOString())
      ended++
    }
    if (ended > 0) this.o.changed()
    return ended
  }
}
