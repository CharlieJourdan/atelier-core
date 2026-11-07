// The providers that need the founder's hand (production-10): an adapter raises its alert when it cannot go on by itself (HeyGen's
// MCP sign-in expired and its refresh failed) and clears it when a call works again. The founder console and `providers status`
// list them. A message never holds a secret: it is masked with the vault before it is stored.
import type { CloudDb } from './db/index.ts'
import type { Clock } from './clock.ts'

export interface ProviderAlert {
  provider: string
  message: string
  raisedAt: string
}

export class ProviderAlerts {
  private readonly db: CloudDb
  private readonly clock: Clock
  private readonly mask: (s: string) => string
  constructor(db: CloudDb, clock: Clock, mask: (s: string) => string) {
    this.db = db
    this.clock = clock
    this.mask = mask
  }

  /** Raises (or replaces) the alert of `provider`; null clears it. */
  set(provider: string, message: string | null): void {
    if (message === null) {
      this.db.prepare('DELETE FROM provider_alerts WHERE provider = ?').run(provider)
      return
    }
    const text = this.mask(message).slice(0, 300)
    this.db
      .prepare('INSERT INTO provider_alerts (provider, message, raised_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET message = excluded.message, raised_at = excluded.raised_at')
      .run(provider, text, new Date(this.clock.now()).toISOString())
  }

  list(): ProviderAlert[] {
    const rows = this.db.prepare('SELECT provider, message, raised_at FROM provider_alerts ORDER BY raised_at DESC').all() as { provider: string; message: string; raised_at: string }[]
    return rows.map((r) => ({ provider: r.provider, message: r.message, raisedAt: r.raised_at }))
  }
}
