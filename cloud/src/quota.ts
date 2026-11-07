// Daily quotas of providers that have one of their own (the YouTube Data API: 10 000 units a day, free). The count is kept in
// `provider_quota` (migration 008), per provider and per day, so a restart does not forget what the day has used.
// The day is the provider's: the YouTube quota resets at midnight Pacific time.
import type { Clock } from './clock.ts'
import type { CloudDb } from './db/index.ts'
import { tx } from './db/index.ts'
import type { QuotaMeter } from './providers/types.ts'

/** The calendar day (YYYY-MM-DD) of an instant in Pacific time, where YouTube's daily quota is reset. */
export function pacificDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

export class QuotaLedger {
  private readonly db: CloudDb
  private readonly clock: Clock
  constructor(db: CloudDb, clock: Clock) {
    this.db = db
    this.clock = clock
  }

  /** The meter of one provider for "today" (read again at every call, so a long-lived adapter crosses midnight correctly). */
  meter(provider: string): QuotaMeter {
    return {
      used: () => this.used(provider),
      add: (units) => this.add(provider, units)
    }
  }

  used(provider: string, day = pacificDay(this.clock.now())): number {
    const row = this.db.prepare('SELECT units FROM provider_quota WHERE provider = ? AND day = ?').get(provider, day) as { units: number } | undefined
    return row?.units ?? 0
  }

  add(provider: string, units: number): void {
    if (!Number.isInteger(units) || units < 0) throw new Error('quota units must be a whole number of units')
    const day = pacificDay(this.clock.now())
    tx(this.db, () => {
      this.db
        .prepare('INSERT INTO provider_quota (provider, day, units) VALUES (?, ?, ?) ON CONFLICT(provider, day) DO UPDATE SET units = units + excluded.units')
        .run(provider, day, units)
    })
  }
}
