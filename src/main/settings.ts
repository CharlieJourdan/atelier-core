// Key/value settings stored as JSON text in the `settings` table.
import type { JsonValue } from '../shared/api'
import type { Db } from './db'

const KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/

export class SettingsStore {
  constructor(private readonly db: Db) {}

  get<T extends JsonValue>(key: string): T | null
  get<T extends JsonValue>(key: string, fallback: T): T
  get<T extends JsonValue>(key: string, fallback: T | null = null): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }

  set(key: string, value: JsonValue): void {
    assertKey(key)
    if (value === undefined) throw new Error('Setting value must be JSON (use null to clear)')
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }

  all(): Record<string, JsonValue> {
    const rows = this.db.prepare('SELECT key, value FROM settings ORDER BY key').all() as {
      key: string
      value: string
    }[]
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as JsonValue]))
  }
}

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`Invalid setting key: ${JSON.stringify(key)}`)
}
