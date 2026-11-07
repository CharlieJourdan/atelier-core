// Example workspace rows of the "home" area (lot Z1): one H1 machine and one browser session, marked example.
import type { ExampleArea } from './types'

export const homeExample: ExampleArea = {
  name: 'home',
  seed: (db) => {
    const seen = new Date(Date.now() - 2 * 3_600_000).toISOString()
    db.prepare(
      "INSERT INTO machines (name, os, host, port, status, last_seen_at, last_checked_at, example) VALUES ('H1 (exemple)', 'windows', '192.168.1.42', 22, 'reachable', ?, ?, 1)"
    ).run(seen, seen)
    db.prepare("INSERT INTO browser_sessions (role, start_url, status, example) VALUES ('researcher', 'https://fr.wikipedia.org/wiki/B%C3%AAte_du_G%C3%A9vaudan', 'open', 1)").run()
  },
  clear: (db) => {
    db.prepare('DELETE FROM browser_sessions WHERE example = 1').run()
    db.prepare('DELETE FROM machines WHERE example = 1').run()
  }
}
