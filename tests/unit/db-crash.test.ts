// Crash proofs for the database file (app-ux-robustesse-2): a power cut in the middle of a write transaction, a full disk,
// and a leftover WAL. After each, the file opens, passes integrity_check, keeps what was committed and nothing else.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, transaction } from '../../src/main/db'
import { friendlyMessage } from '../../src/shared/friendly-error'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'atelier-dbcrash-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const settingCount = (db: ReturnType<typeof openDatabase>, prefix: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM settings WHERE key LIKE ?').get(`${prefix}%`) as { n: number }).n

describe('power cut', () => {
  it('kill -9 in the middle of a write transaction: the file opens clean, committed rows stay, the half transaction is gone', async () => {
    const dir = tmp()
    const file = path.join(dir, 'atelier.db')
    openDatabase(file).close()
    // A separate plain-Node process writes, then hangs inside an open transaction until it is killed.
    const script = path.join(dir, 'writer.cjs')
    writeFileSync(
      script,
      `const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.argv[2])
db.exec('PRAGMA journal_mode = WAL')
const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, '1')")
for (let i = 0; i < 50; i++) put.run('committed.' + i)
db.exec('BEGIN IMMEDIATE')
for (let i = 0; i < 5000; i++) put.run('halfway.' + i)
console.log('INFLIGHT')
setInterval(() => {}, 1000)
`
    )
    const child = spawn(process.execPath, [script, file], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (b: Buffer) => b.toString().includes('INFLIGHT') && resolve())
      child.once('error', reject)
      child.once('exit', () => reject(new Error('writer exited early')))
    })
    child.removeAllListeners('exit')
    const exited = new Promise((r) => child.once('exit', r))
    child.kill('SIGKILL')
    await exited
    await new Promise((r) => setTimeout(r, 300))

    const db = openDatabase(file)
    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(settingCount(db, 'committed.')).toBe(50)
    expect(settingCount(db, 'halfway.')).toBe(0)
    // and it is writable again, with the WAL checkpointed cleanly
    db.prepare("INSERT INTO settings (key, value) VALUES ('after', '1')").run()
    expect(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()).toMatchObject({ busy: 0 })
    db.close()
  }, 30_000)

  it('a copy of the file taken with its leftover WAL (what a restore sees) opens clean too', () => {
    const dir = tmp()
    const file = path.join(dir, 'a.db')
    const db = openDatabase(file)
    db.prepare("INSERT INTO settings (key, value) VALUES ('k', '1')").run()
    // The WAL has not been checkpointed: copy main file and -wal while the connection is still open (a crash snapshot).
    const copy = path.join(dir, 'b.db')
    copyFileSync(file, copy)
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
    db.close()
    const restored = openDatabase(copy)
    expect((restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    expect(settingCount(restored, 'k')).toBe(1)
    restored.close()
  })
})

describe('disk full', () => {
  it('SQLITE_FULL rolls the whole transaction back, says so in French with a next step, and works again once there is room', () => {
    const db = openDatabase(path.join(tmp(), 'full.db'))
    const pages = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
    db.exec(`PRAGMA max_page_count = ${pages + 20}`) // a real « database or disk is full » after 20 pages
    const big = 'x'.repeat(8000)
    let caught: unknown
    try {
      transaction(db, () => {
        for (let i = 0; i < 500; i++) db.prepare("INSERT INTO settings (key, value) VALUES (?, json_quote(?))").run(`full.${i}`, big)
      })
    } catch (e) {
      caught = e
    }
    expect(caught, 'the write fails').toBeInstanceOf(Error)
    const message = friendlyMessage((caught as Error).message, (caught as { code?: string }).code)
    expect(message).toMatch(/disque est plein/)
    expect(message).toMatch(/Libère de la place/)
    expect(db.isTransaction, 'no transaction left open').toBe(false)
    expect(settingCount(db, 'full.')).toBe(0)
    db.exec('PRAGMA max_page_count = 1073741823') // room again
    db.prepare("INSERT INTO settings (key, value) VALUES ('full.ok', '1')").run()
    expect(settingCount(db, 'full.')).toBe(1)
    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    expect(statSync(path.join(dirs[0]!, 'full.db')).size).toBeGreaterThan(0)
    db.close()
  })
})
