import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, schemaVersion } from '../../src/main/db'
import { MIGRATIONS, type Migration } from '../../src/main/db/migrations'
import { DatabaseSync } from 'node:sqlite'

// Every table named in archived doc SPEC (old repository) § Données, plus `secrets` (encrypted keys).
const SPEC_TABLES = [
  'settings', 'providers', 'routes', 'prices',
  'channels', 'videos', 'deliverables', 'deliverable_edges', 'versions', 'version_checks', 'approvals',
  'tasks', 'conversations', 'messages', 'proposals', 'ledger',
  'agents', 'custom_agents', 'agent_memory', 'custom_routines', 'routine_runs', 'goals',
  'script_samples', 'notifications', 'connectors', 'audit'
]

function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as {
    name: string
  }[]).map((r) => r.name)
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('migrations', () => {
  it('creates every SPEC table on a fresh database', () => {
    const db = openDatabase(':memory:')
    const names = tables(db)
    for (const t of SPEC_TABLES) expect(names, `missing table ${t}`).toContain(t)
    expect(names).toContain('secrets')
    expect(names).toContain('schema_migrations')
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })

  it('declares foreign keys and enforces them', () => {
    const db = openDatabase(':memory:')
    const fks = (t: string) => (db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[]).map((r) => r.table)
    expect(fks('videos')).toEqual(expect.arrayContaining(['channels', 'goals']))
    expect(fks('deliverables')).toEqual(expect.arrayContaining(['videos', 'versions']))
    expect(fks('deliverable_edges')).toEqual(['deliverables', 'deliverables'])
    expect(fks('versions')).toEqual(expect.arrayContaining(['deliverables', 'tasks']))
    expect(fks('approvals')).toEqual(expect.arrayContaining(['deliverables', 'versions']))
    expect(fks('messages')).toEqual(['conversations'])
    expect(fks('ledger')).toEqual(expect.arrayContaining(['channels', 'videos', 'tasks']))
    expect(fks('routine_runs')).toEqual(['custom_routines'])
    expect(() => db.prepare("INSERT INTO videos (channel_id, title) VALUES (999, 'x')").run()).toThrow(/FOREIGN KEY/)
  })

  it('creates the indexes and cascades deletes', () => {
    const db = openDatabase(':memory:')
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all() as {
      name: string
    }[]).map((r) => r.name)
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_videos_channel', 'idx_tasks_status', 'idx_messages_conversation', 'idx_ledger_created'])
    )
    const ch = db.prepare("INSERT INTO channels (name) VALUES ('History')").run().lastInsertRowid
    const vid = db.prepare('INSERT INTO videos (channel_id, title) VALUES (?, ?)').run(ch, 'Ys').lastInsertRowid
    db.prepare("INSERT INTO deliverables (video_id, type) VALUES (?, 'research')").run(vid)
    expect(() => db.prepare("INSERT INTO deliverables (video_id, type) VALUES (?, 'research')").run(vid)).toThrow(/UNIQUE/)
    expect(() => db.prepare("INSERT INTO deliverables (video_id, type) VALUES (?, 'trailer')").run(vid)).toThrow(/CHECK/)
    db.prepare('DELETE FROM channels WHERE id = ?').run(ch)
    expect(db.prepare('SELECT COUNT(*) AS n FROM deliverables').get()).toEqual({ n: 0 })
  })

  it('is idempotent: a second run applies nothing', () => {
    const db = openDatabase(':memory:')
    expect(migrate(db)).toEqual([])
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })

  it('applies only pending migrations, in order', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db, MIGRATIONS.slice(0, 1))).toEqual([1])
    expect(migrate(db)).toEqual(MIGRATIONS.slice(1).map((m) => m.version))
  })

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = new DatabaseSync(':memory:')
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: MIGRATIONS.length + 1, name: 'broken', up: (d) => d.exec('CREATE TABLE half (x); SELECT nope FROM nothing;') }
    ]
    expect(() => migrate(db, broken)).toThrow()
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect(tables(db)).not.toContain('half')
  })

  it('refuses gaps and databases newer than the app', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => migrate(db, [MIGRATIONS[1] as Migration])).toThrow(/without gaps/)
    migrate(db)
    expect(() => migrate(db, MIGRATIONS.slice(0, 1))).toThrow(/newer than this app/)
  })

  it('opens a file database in WAL mode with foreign keys on', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atelier-test-'))
    dirs.push(dir)
    const db = openDatabase(path.join(dir, 'atelier.db'))
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.close()
    const again = openDatabase(path.join(dir, 'atelier.db'))
    expect(schemaVersion(again)).toBe(MIGRATIONS.length)
    again.close()
  })
})

describe('003_real_prices on an existing database', () => {
  it('replaces edited placeholder prices with the list prices and keeps other rows', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 2))
    db.prepare('UPDATE prices SET input_per_mtok = 9, is_placeholder = 0 WHERE model = ?').run('claude-haiku-5-5')
    db.prepare(
      `INSERT INTO prices (model, provider_id, tier, input_per_mtok, output_per_mtok) VALUES ('custom-x', 'anthropic', NULL, 1, 2)`
    ).run()
    expect(migrate(db)).toEqual(MIGRATIONS.slice(2).map((m) => m.version))
    const rows = db.prepare('SELECT model, tier, input_per_mtok AS i, is_placeholder AS p FROM prices ORDER BY model').all()
    expect(rows).toEqual([
      { model: 'claude-fable-5-1', tier: 'max', i: 10, p: 0 },
      { model: 'claude-haiku-5-5', tier: 'fast', i: 0.1, p: 0 },
      { model: 'claude-opus-5-5', tier: 'best', i: 4, p: 0 },
      { model: 'claude-sonnet-5-5', tier: 'balanced', i: 2, p: 0 },
      { model: 'custom-x', tier: null, i: 1, p: 0 }
    ])
    expect(() => db.prepare("UPDATE prices SET tier = 'turbo' WHERE model = 'custom-x'").run()).toThrow(/CHECK/)
  })
})
