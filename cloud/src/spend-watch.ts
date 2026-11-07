// Unusual spend (decision 0076): a team that bought many credits may spend them, so nothing here ever blocks. When a team
// spends far more in a day than it usually does, the Cloud tells the founder (a console alert and the audit log) and the
// team (« if this is not you, contact support »), once per team and day. Hard stops stay where they are: an empty balance,
// a member's own caps, the per-job maximum.
import type { Audit } from './audit.ts'
import { iso, type Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import type { ProviderAlerts } from './provider-alerts.ts'

/** Below this, a day's spend is never unusual (500 €, credits at 100 for 1 €). */
export const UNUSUAL_MIN_CREDITS = 50_000
/** A day is unusual past this many times the team's average day of the last 30. */
export const UNUSUAL_RATIO = 5
const DAY_MS = 86_400_000

export interface SpendWatchOptions {
  db: CloudDb
  clock: Clock
  audit: Audit
  alerts?: ProviderAlerts
  /** Tells the team (an e-mail to its owner and admins). */
  tell?: (teamId: string, credits: number, usual: number, day: string) => void
}

export class SpendWatch {
  private readonly o: SpendWatchOptions
  constructor(o: SpendWatchOptions) {
    this.o = o
  }

  /** The alert's key in the founder console's alert list. */
  static alertKey(teamId: string): string {
    return `spend:${teamId}`
  }

  /** After a capture: raises the day's alert when the last 24 hours are unusual. Returns true when it raised one now. */
  check(teamId: string): boolean {
    const now = this.o.clock.now()
    const spent = (since: number, until: number): number =>
      (this.o.db
        .prepare(`SELECT COALESCE(-SUM(delta), 0) AS s FROM wallet_entries WHERE team_id = ? AND kind = 'capture' AND created_at >= ? AND created_at < ?`)
        .get(teamId, iso(since), iso(until)) as { s: number }).s
    const today = spent(now - DAY_MS, now + 1)
    const usual = spent(now - 31 * DAY_MS, now - DAY_MS) / 30
    if (today < Math.max(UNUSUAL_MIN_CREDITS, UNUSUAL_RATIO * usual)) return false
    const day = iso(now).slice(0, 10)
    const seen = this.o.db.prepare(`SELECT 1 FROM audit_log WHERE action = 'spend.unusual' AND target = ? AND at >= ?`).get(teamId, `${day}T00:00:00`)
    if (seen) return false
    const rounded = Math.round(usual)
    this.o.audit.record('spend-watch', 'spend.unusual', teamId, { credits: today, usualPerDay: rounded })
    this.o.alerts?.set(SpendWatch.alertKey(teamId), `Dépense inhabituelle : ${today} crédits en 24 h (d'habitude ≈ ${rounded} par jour). Rien n'est bloqué.`)
    this.o.tell?.(teamId, today, rounded, day)
    return true
  }
}
