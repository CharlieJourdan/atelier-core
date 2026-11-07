// The team computer stays up (docs/BRAIN-HEADLESS.md §10): the keeper restarts a brain that died with a growing delay
// (reset after 10 minutes of good run), stops for good on a clean stop or on an error a retry cannot fix (bad options,
// port taken), and passes its restart count to the brain. The nightly backup runs at its hour, catches up after a start
// when the last good one is too old, and retries an hour after a failure. The brain's options for both.
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BackupState } from '../../src/main/headless/backup'
import { BackupScheduler, CATCH_UP_AFTER_MS, firstBackupAt, nextNightly, parseBackupAt, RETRY_MS, START_DELAY_MS } from '../../src/main/headless/backup-schedule'
import { ConfigError, parseHeadlessArgs } from '../../src/main/headless/config'
import { Keeper, splitKeeperArgs, type BrainChild } from '../../src/main/headless/keeper'
import { REPO, tempDir } from './headless-helpers'

class FakeChild extends EventEmitter implements BrainChild {
  killed: NodeJS.Signals | null = null
  constructor(readonly env: Record<string, string>) {
    super()
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM'
    setImmediate(() => this.emit('exit', 0, null))
    return true
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('the keeper', () => {
  it('restarts a crashed brain with growing delays, resets them after a long run, passes the count, stops on SIGTERM', async () => {
    let now = 0
    const children: FakeChild[] = []
    const waits: number[] = []
    const lines: string[] = []
    const keeper = new Keeper({
      spawnBrain: (env) => {
        const c = new FakeChild(env)
        children.push(c)
        return c
      },
      log: (l) => lines.push(l),
      delaysMs: [1000, 5000, 60_000],
      stableMs: 600_000,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms)
        now += ms
      }
    })
    const done = keeper.run()
    await tick()
    // three quick crashes: 1 s, 5 s, 60 s
    for (const code of [1, null, 1]) {
      now += 2000
      children.at(-1)!.emit('exit', code, code === null ? 'SIGKILL' : null)
      await tick()
      await tick()
    }
    expect(waits).toEqual([1000, 5000, 60_000])
    expect(children.map((c) => c.env.ATELIER_BRAIN_RESTARTS)).toEqual(['0', '1', '2', '3'])
    expect(lines.join('\n')).toMatch(/signal SIGKILL/)
    // this one ran 20 minutes before dying: the delays start over
    now += 20 * 60_000
    children.at(-1)!.emit('exit', 1, null)
    await tick()
    await tick()
    expect(waits.at(-1)).toBe(1000)
    keeper.stop()
    expect(children.at(-1)!.killed).toBe('SIGTERM')
    expect(await done).toBe(0)
    expect(keeper.restarts).toBe(4)
  })

  it('does not retry bad options (2) or a port already taken (3), nor a clean exit', async () => {
    for (const [code, expected] of [
      [2, 2],
      [3, 3],
      [0, 0]
    ] as const) {
      const children: FakeChild[] = []
      const keeper = new Keeper({ spawnBrain: (env) => children[children.push(new FakeChild(env)) - 1]!, sleep: async () => undefined })
      const done = keeper.run()
      await tick()
      children[0]!.emit('exit', code, null)
      expect(await done).toBe(expected)
      expect(children).toHaveLength(1)
    }
  })
})

const ok = (at: number): BackupState => ({ at: new Date(at).toISOString(), ok: true, sizeBytes: 1, files: 1, cloud: 'sent', cloudId: 'bkp_x', localFile: null, error: null })

describe('the nightly backup schedule', () => {
  const AT = { hour: 3, minute: 30 }
  it('parses HH:MM and finds the next nightly time, local', () => {
    expect(parseBackupAt('03:30')).toEqual(AT)
    expect(parseBackupAt('23:05')).toEqual({ hour: 23, minute: 5 })
    for (const bad of ['24:00', '3h30', '12:60', '']) expect(parseBackupAt(bad), bad).toBeNull()
    const evening = new Date(2026, 9, 31, 22, 0).getTime()
    expect(nextNightly(evening, AT)).toBe(new Date(2026, 10, 1, 3, 30).getTime())
    const before = new Date(2026, 9, 31, 2, 0).getTime()
    expect(nextNightly(before, AT)).toBe(new Date(2026, 9, 31, 3, 30).getTime())
  })

  it('catches up soon after a start when the last good backup is too old (or none), else waits for the night', () => {
    const now = new Date(2026, 9, 31, 12, 0).getTime()
    expect(firstBackupAt(now, AT, null)).toBe(now + START_DELAY_MS)
    expect(firstBackupAt(now, AT, ok(now - CATCH_UP_AFTER_MS - 1))).toBe(now + START_DELAY_MS)
    expect(firstBackupAt(now, AT, { ...ok(now - 3_600_000), ok: false })).toBe(now + START_DELAY_MS)
    expect(firstBackupAt(now, AT, ok(now - 3_600_000))).toBe(nextNightly(now, AT))
  })

  it('runs when due, plans the next night, retries an hour after a failure', async () => {
    let now = new Date(2026, 9, 31, 12, 0).getTime()
    const timers: { fn: () => void; ms: number }[] = []
    const results: BackupState[] = [{ ...ok(0), ok: false, error: 'disque plein' }, ok(0)]
    let runs = 0
    const s = new BackupScheduler({
      at: AT,
      last: () => null,
      now: () => now,
      run: async () => results[runs++] as BackupState,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined
    })
    s.start()
    expect(s.nextAt).toBe(now + START_DELAY_MS)
    now += START_DELAY_MS
    timers.at(-1)!.fn()
    await tick()
    expect(runs).toBe(1)
    expect(s.nextAt).toBe(now + RETRY_MS)
    now += RETRY_MS
    timers.at(-1)!.fn()
    await tick()
    expect(runs).toBe(2)
    expect(s.nextAt).toBe(nextNightly(now, AT))
    s.close()
    expect(s.nextAt).toBeNull()
  })
})

describe('the brain options for keeping and backing up', () => {
  it('backups are on at 03:30 by default; --no-backup, --backup-at, env; one command at a time', () => {
    expect(parseHeadlessArgs([], {})).toMatchObject({ backup: true, backupAt: { hour: 3, minute: 30 }, backupNow: false, listBackups: false, restore: null })
    expect(parseHeadlessArgs(['--no-backup', '--backup-at', '01:15'], {})).toMatchObject({ backup: false, backupAt: { hour: 1, minute: 15 } })
    expect(parseHeadlessArgs([], { ATELIER_BACKUP: 'off', ATELIER_BACKUP_AT: '04:00' })).toMatchObject({ backup: false, backupAt: { hour: 4, minute: 0 } })
    expect(parseHeadlessArgs(['--restore', 'latest'], {}).restore).toBe('latest')
    expect(() => parseHeadlessArgs(['--backup-at', '25:00'], {})).toThrow(ConfigError)
    expect(() => parseHeadlessArgs(['--backup-now', '--restore', 'latest'], {})).toThrow(ConfigError)
    expect(() => parseHeadlessArgs(['--restore'], {})).toThrow(ConfigError)
  })
})

describe('the real keeper process', () => {
  it('keeps its own options, gives the rest to the brain', () => {
    expect(splitKeeperArgs(['--keeper-log', 'L', '--data', 'D', '--keeper-pid', 'P', '--port', '8795'])).toEqual({ logDir: 'L', pidFile: 'P', brain: ['--data', 'D', '--port', '8795'] })
  })

  it('a brain whose port is taken exits 3 and the keeper stops at once, logs it and forgets its pid', async () => {
    const holder = createServer()
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', () => r()))
    const port = (holder.address() as AddressInfo).port
    const dir = tempDir('atb-keeper-')
    const pidFile = path.join(dir, 'pid.json')
    try {
      const child = spawn(
        process.execPath,
        [
          '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          '--disable-warning=ExperimentalWarning',
          '--import',
          pathToFileURL(path.join(REPO, 'scripts', 'ts-transpile.mjs')).href,
          path.join(REPO, 'src', 'main', 'headless', 'keeper-main.ts'),
          '--keeper-log',
          path.join(dir, 'logs'),
          '--keeper-pid',
          pidFile,
          '--data',
          path.join(dir, 'data'),
          '--key-file',
          path.join(dir, 'key', 'machine.key'),
          '--port',
          String(port),
          '--no-cloud',
          '--no-backup',
          '--no-mcp'
        ],
        { cwd: REPO, stdio: 'ignore', env: { ...process.env, ATELIER_FAKE_LLM: '1', ATELIER_RUNNER: 'off', ATELIER_AUTOMATIONS: 'off' } }
      )
      const code = await new Promise<number | null>((r) => child.once('exit', (c) => r(c)))
      expect(code).toBe(3)
      const logs = readdirSync(path.join(dir, 'logs'))
      expect(logs).toHaveLength(1)
      const text = readFileSync(path.join(dir, 'logs', logs[0] as string), 'utf8')
      expect(text).toMatch(/déjà pris/)
      expect(text).toMatch(/ne peut pas démarrer \(code 3\)/)
      expect(existsSync(pidFile)).toBe(false)
      // the port was refused before the database was opened
      expect(existsSync(path.join(dir, 'data', 'atelier.db'))).toBe(false)
    } finally {
      holder.close()
    }
  }, 60_000)
})
