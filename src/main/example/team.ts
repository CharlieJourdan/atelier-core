// Example workspace rows of the "team" area (lot Z1): two members (one active admin, one invited member), one extra
// device and two Claude profiles (a Claude Code subscription limited until the next 14:30, and an API profile with no key
// yet). Rows are marked example = 1; `clear` deletes them (routing rows follow through the foreign key).
import type { ExampleArea } from './types'

/** The next 14:30 local time, at least a minute from now. */
export function next1430(now: Date): Date {
  const d = new Date(now)
  d.setHours(14, 30, 0, 0)
  if (d.getTime() <= now.getTime() + 60_000) d.setDate(d.getDate() + 1)
  return d
}

export const teamExample: ExampleArea = {
  name: 'team',
  seed: (db) => {
    const member = db.prepare("INSERT INTO team_members (name, email, role, status, monthly_cap, example) VALUES (?, ?, ?, ?, ?, 1)")
    member.run('Léa Martin (exemple)', 'lea.martin@exemple.fr', 'admin', 'active', 8000)
    member.run('Hugo Bernard (exemple)', 'hugo.bernard@exemple.fr', 'member', 'invited', 3000)
    const now = new Date()
    db.prepare("INSERT INTO team_devices (name, os, last_seen_at, is_current, example) VALUES (?, ?, ?, 0, 1)").run(
      'MacBook Air de Léa (exemple)',
      'macOS',
      new Date(now.getTime() - 2 * 3_600_000).toISOString()
    )
    const profile = db.prepare('INSERT INTO claude_profiles (name, kind, limited_until, example) VALUES (?, ?, ?, 1)')
    profile.run('Abonnement Max de Léa (exemple)', 'cli', next1430(now).toISOString())
    profile.run('Clé API de l’équipe (exemple)', 'api', null)
  },
  clear: (db) => {
    db.prepare('DELETE FROM team_members WHERE example = 1').run()
    db.prepare('DELETE FROM team_devices WHERE example = 1').run()
    // Their API keys live in `secrets` (claude.profile.<id>.key): delete them with the rows.
    const ids = db.prepare('SELECT id FROM claude_profiles WHERE example = 1').all() as { id: number }[]
    for (const { id } of ids) db.prepare('DELETE FROM secrets WHERE name = ?').run(`claude.profile.${id}.key`)
    db.prepare('DELETE FROM claude_profiles WHERE example = 1').run()
  }
}
