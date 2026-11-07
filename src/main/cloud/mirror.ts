// The local copy of Atelier Cloud spending in the ledger (lot P5). The engine's Cloud client tells about every job it
// makes (`created`) and how it ended (`ended`); each job is one ledger row keyed by its Cloud id (unique index of
// migration 010), so a replayed event never adds a row. Credits, not dollars: the USD columns stay 0, so these rows
// never count against the USD caps (the Cloud enforces credit caps). A job the app lost track of (a crash) is closed
// by `reconcile` from the Cloud's own answer.
import { TERMINAL_JOB_STATES } from '../../shared/cloud-api'
import type { CloudSpendSummary } from '../../shared/api'
import { EngineError } from '../../engine/errors'
import type { Db } from '../db'
import { monthBounds, monthOf } from '../ledger'
import type { CloudJob } from './client'

export const CLOUD_PROVIDER_ID = 'atelier-cloud'

export interface CloudJobEvent {
  phase: 'created' | 'ended'
  job: CloudJob
  creditValueEur?: number
}

export interface CloudSpendTags {
  videoId?: number | null
  channelId?: number | null
  /** What the row is called in the ledger (else `cloud:<usage>`). */
  label?: string
}

interface Row {
  id: number
  status: string
  credits: number | null
  amount_eur: number | null
}

const euros = (credits: number, value: number | undefined): number | null =>
  value === undefined || !Number.isFinite(value) ? null : Math.round(credits * value * 1e6) / 1e6

export class CloudSpendMirror {
  constructor(
    private readonly db: Db,
    private readonly notify: () => void = () => undefined,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Copies one job event; never throws for a bad tag (an unknown video or channel is left out). */
  record(e: CloudJobEvent, tags: CloudSpendTags = {}): void {
    const changed = this.insert(e, tags) + (e.phase === 'ended' || TERMINAL_JOB_STATES.includes(e.job.state) ? this.close(e) : 0)
    if (changed > 0) this.notify()
  }

  private exists(table: 'videos' | 'channels', id: number | null | undefined): number | null {
    if (typeof id !== 'number') return null
    return this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) ? id : null
  }

  private insert(e: CloudJobEvent, tags: CloudSpendTags): number {
    const job = e.job
    const videoId = this.exists('videos', tags.videoId)
    let channelId = this.exists('channels', tags.channelId)
    if (channelId === null && videoId !== null) {
      const v = this.db.prepare('SELECT channel_id AS c FROM videos WHERE id = ?').get(videoId) as { c: number | null } | undefined
      channelId = v?.c ?? null
    }
    const model = (tags.label?.trim() || `cloud:${job.usage}`).slice(0, 200)
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO ledger (provider_id, model, channel_id, video_id, status, estimate_usd, amount_usd, credits,
                                       amount_eur, cloud_job_id, note, created_at)
         VALUES (?, ?, ?, ?, 'reserved', 0, 0, ?, ?, ?, ?, ?)`
      )
      .run(
        CLOUD_PROVIDER_ID,
        model,
        channelId,
        videoId,
        job.credits,
        euros(job.credits, e.creditValueEur),
        job.id,
        job.demo ? 'demo' : null,
        this.now().toISOString()
      )
    return Number(r.changes)
  }

  /** Closes the job's row once: succeeded → settled at the captured credits, failed / cancelled → refunded. */
  private close(e: CloudJobEvent): number {
    const job = e.job
    if (!TERMINAL_JOB_STATES.includes(job.state)) return 0
    const row = this.db.prepare('SELECT id, status, credits, amount_eur FROM ledger WHERE cloud_job_id = ?').get(job.id) as Row | undefined
    if (!row || row.status !== 'reserved') return 0
    let credits = 0
    let eur: number | null = 0
    if (job.state === 'succeeded') {
      credits = job.credits
      eur = euros(credits, e.creditValueEur)
      // the value known when the job was created still prices what was captured
      if (eur === null && row.amount_eur !== null && row.credits) eur = euros(credits, row.amount_eur / row.credits)
    }
    const r = this.db
      .prepare(`UPDATE ledger SET status = ?, credits = ?, amount_eur = ?, settled_at = ? WHERE id = ? AND status = 'reserved'`)
      .run(job.state === 'succeeded' ? 'settled' : 'refunded', credits, eur, this.now().toISOString(), row.id)
    return Number(r.changes)
  }

  /** Credits a video has committed on the Cloud: held by its open jobs plus captured by its finished ones. */
  committedFor(videoId: number): number {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(credits), 0) AS n FROM ledger
         WHERE cloud_job_id IS NOT NULL AND video_id = ? AND status IN ('reserved', 'settled')`
      )
      .get(videoId) as { n: number }
    return r.n
  }

  /** The Cloud jobs whose row is still open. */
  openJobs(): { ledgerId: number; jobId: string }[] {
    return this.db
      .prepare(`SELECT id AS ledgerId, cloud_job_id AS jobId FROM ledger WHERE cloud_job_id IS NOT NULL AND status = 'reserved' ORDER BY id`)
      .all() as unknown as { ledgerId: number; jobId: string }[]
  }

  /** Asks the Cloud about every open row: a finished job is closed, an unreachable Cloud leaves the rest open. */
  async reconcile(api: { job(id: string): Promise<CloudJob> }): Promise<{ closed: number; open: number }> {
    let closed = 0
    let open = 0
    const rows = this.openJobs()
    for (let i = 0; i < rows.length; i++) {
      try {
        const job = await api.job((rows[i] as { jobId: string }).jobId)
        const n = TERMINAL_JOB_STATES.includes(job.state) ? this.close({ phase: 'ended', job }) : 0
        closed += n
        open += 1 - n
      } catch (e) {
        // signed out or unreachable: nothing more can be learnt now, the rest stays open
        if (e instanceof EngineError && (e.code === 'missing_tool' || e.code === 'transient')) {
          open += rows.length - i
          break
        }
        open++
      }
    }
    if (closed > 0) this.notify()
    return { closed, open }
  }

  summary(month: string = monthOf(this.now())): CloudSpendSummary {
    const { start, end } = monthBounds(month)
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN credits ELSE 0 END), 0) AS reserved,
                COALESCE(SUM(CASE status WHEN 'settled' THEN credits ELSE 0 END), 0) AS spent,
                COALESCE(SUM(CASE status WHEN 'settled' THEN amount_eur ELSE 0 END), 0) AS eur,
                COUNT(*) AS jobs
         FROM ledger WHERE cloud_job_id IS NOT NULL AND created_at >= ? AND created_at < ?`
      )
      .get(start, end) as { reserved: number; spent: number; eur: number; jobs: number }
    return { month, reservedCredits: r.reserved, spentCredits: r.spent, spentEur: Math.round(r.eur * 1e6) / 1e6, jobs: r.jobs }
  }
}
