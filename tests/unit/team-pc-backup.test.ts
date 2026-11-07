// The team computer's backup and restore (docs/BRAIN-HEADLESS.md §10), on the real headless brain over temp folders and
// the fake team: the archive is encrypted (another machine key reads nothing, a flipped byte is refused), a backup taken
// while the brain runs restores into an empty folder with the same agents, queue, goals, channels and team files, and
// without what must stay on the machine (account logins, renders, the Cloud credential); the last 3 stay on the machine;
// a restore never overwrites a database; `app.machine` carries the brain's uptime and last backup.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MachineStats } from '../../src/shared/api/app'
import { openDatabase } from '../../src/main/db'
import { backupKey, BackupError, isSafeEntryPath, packArchive, unpackArchive } from '../../src/main/headless/backup-archive'
import { collectTeamFiles, keepLocal, LOCAL_KEEP, makeBackup, readBackupState, restoreBackup, runBackup } from '../../src/main/headless/backup'
import { loadMachineKey } from '../../src/main/headless/cipher'
import { startTestBrain, tempDir, type TestBrain } from './headless-helpers'

const brains: TestBrain[] = []
afterEach(async () => {
  for (const b of brains.splice(0)) await b.stop()
})

const KEY = backupKey(randomBytes(32))
const HEAD = { v: 1 as const, createdAt: '2026-10-31T03:30:00.000Z', host: 'pc', appVersion: '0.1.0', schemaVersion: 1, skipped: [] }

describe('the backup archive', () => {
  it('round-trips files, and refuses another key, a flipped byte and unsafe paths', () => {
    const files = [
      { path: 'atelier.db', bytes: randomBytes(5000) },
      { path: 'orchestra/files/channel-1/scripts/vol-19.md', bytes: Buffer.from('Le 5 décembre 1945…') },
      { path: 'orchestra/files/vide.txt', bytes: Buffer.alloc(0) }
    ]
    const blob = packArchive(HEAD, files, KEY)
    expect(blob.subarray(0, 4).toString()).toBe('ATB1')
    // nothing readable in the encrypted file
    expect(blob.includes(Buffer.from('décembre'))).toBe(false)
    const { manifest, files: got } = unpackArchive(blob, KEY)
    expect(manifest.files.map((f) => f.path)).toEqual(files.map((f) => f.path))
    for (const f of files) expect(Buffer.compare(got.get(f.path) as Buffer, f.bytes)).toBe(0)
    expect(() => unpackArchive(blob, backupKey(randomBytes(32)))).toThrow(expect.objectContaining({ code: 'WRONG_KEY' }))
    const flipped = Buffer.from(blob)
    flipped[blob.length - 3] = (flipped[blob.length - 3] as number) ^ 1
    expect(() => unpackArchive(flipped, KEY)).toThrow(BackupError)
    expect(() => unpackArchive(Buffer.from('pas une sauvegarde'), KEY)).toThrow(expect.objectContaining({ code: 'BAD_ARCHIVE' }))
    expect(() => packArchive(HEAD, [{ path: '../evil', bytes: Buffer.alloc(1) }], KEY)).toThrow(BackupError)
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', '', 'a//b', './a']) expect(isSafeEntryPath(bad), bad).toBe(false)
    expect(isSafeEntryPath('orchestra/files/a b.md')).toBe(true)
  })

  it('the archive key is derived from the machine key: the same key twice, never the machine key itself', () => {
    const machine = randomBytes(32)
    expect(backupKey(machine).equals(backupKey(machine))).toBe(true)
    expect(backupKey(machine).equals(machine)).toBe(false)
  })
})

/** A brain with a workspace: 2 channels (their teams, goals and the goals analysis tasks), a task, team files. */
async function busyBrain(): Promise<TestBrain> {
  const brain = await startTestBrain()
  brains.push(brain)
  const core = brain.core
  core.orchestra.seed()
  for (const name of ['Histoire', 'Mystères']) await core.api['channels.create']({ name, niche: name.toLowerCase(), standards: '' })
  const principal = core.orchestra.parts.tree.bySlug('principal')
  if (!principal) throw new Error('no principal')
  core.orchestra.parts.queue.enqueue({ kind: 'task', title: 'Préparer la semaine', assigneeId: principal.id, payload: { brief: 'trois sujets' }, priority: 3, channelId: null })
  const data = path.dirname(core.context.appInfo().dbPath)
  mkdirSync(path.join(data, 'orchestra', 'files', 'channel-1', 'scripts'), { recursive: true })
  writeFileSync(path.join(data, 'orchestra', 'files', 'channel-1', 'scripts', 'vol-19.md'), 'Le 5 décembre 1945, cinq avions décollent.')
  // what must NOT travel: an account login, a render, the Cloud credential
  mkdirSync(path.join(data, 'orchestra', 'accounts', 'compte-2'), { recursive: true })
  writeFileSync(path.join(data, 'orchestra', 'accounts', 'compte-2', '.credentials.json'), '{"secret":"x"}')
  mkdirSync(path.join(data, 'production', 'runs', '1'), { recursive: true })
  writeFileSync(path.join(data, 'production', 'runs', '1', 'final.mp4'), randomBytes(1024))
  writeFileSync(path.join(data, 'cloud-machine.json'), '{}')
  return brain
}

function snapshot(dbFile: string): Record<string, unknown[]> {
  const db = openDatabase(dbFile)
  try {
    return {
      agents: db.prepare('SELECT slug, role, channel_id FROM orch_agents ORDER BY id').all(),
      tasks: db.prepare('SELECT id, kind, title, status, assignee_id FROM orch_tasks ORDER BY id').all(),
      goals: db.prepare('SELECT * FROM channel_goals ORDER BY channel_id').all(),
      channels: db.prepare('SELECT id, name FROM channels ORDER BY id').all()
    }
  } finally {
    db.close()
  }
}

describe('backup and restore of a running team computer', () => {
  it('a hot backup restores into an empty folder with the same agents, queue, goals, channels and team files', async () => {
    const brain = await busyBrain()
    const data = path.dirname(brain.core.context.appInfo().dbPath)
    const key = backupKey(loadMachineKey(path.join(brain.dir, 'key', 'machine.key')))
    const state = await runBackup({ dataDir: data, key, appVersion: '0.1.0', link: () => null })
    expect(state).toMatchObject({ ok: true, cloud: 'off', error: null })
    expect(readBackupState(data)).toEqual(state)
    const archive = readFileSync(state.localFile as string)
    // the brain keeps writing after the snapshot: not in the backup
    brain.core.orchestra.parts.queue.enqueue({ kind: 'task', title: 'Après la sauvegarde', assigneeId: brain.core.orchestra.parts.tree.bySlug('principal')!.id, payload: {}, priority: 3, channelId: null })
    const target = path.join(tempDir('atb-restore-'), 'data')
    const r = restoreBackup({ bytes: archive, key, dataDir: target })
    expect(r.agents).toBeGreaterThanOrEqual(2 * 5)
    expect(r.goals).toBe(2)
    expect(r.channels).toBe(2)
    const before = snapshot(path.join(data, 'atelier.db'))
    const after = snapshot(path.join(target, 'atelier.db'))
    expect(after.agents).toEqual(before.agents)
    expect(after.goals).toEqual(before.goals)
    expect(after.channels).toEqual(before.channels)
    expect(after.tasks).toEqual((before.tasks as { title: string }[]).filter((t) => t.title !== 'Après la sauvegarde'))
    expect(readFileSync(path.join(target, 'orchestra', 'files', 'channel-1', 'scripts', 'vol-19.md'), 'utf8')).toContain('cinq avions')
    for (const absent of ['orchestra/accounts', 'production', 'cloud-machine.json', 'backups', 'brain-token.json']) expect(existsSync(path.join(target, absent)), absent).toBe(false)
    // never over a database, never with another machine's key
    expect(() => restoreBackup({ bytes: archive, key, dataDir: target })).toThrow(expect.objectContaining({ code: 'NOT_EMPTY' }))
    expect(() => restoreBackup({ bytes: archive, key: backupKey(randomBytes(32)), dataDir: path.join(tempDir('atb-x-'), 'd') })).toThrow(expect.objectContaining({ code: 'WRONG_KEY' }))
    // the restored folder runs: a brain starts on it and sees the same team
    const again = await startTestBrain({ dataDir: target, keyFile: path.join(brain.dir, 'key', 'machine.key') })
    brains.push(again)
    expect(again.core.orchestra.agents().length).toBe(brain.core.orchestra.agents().length)
  })

  it('keeps the last 3 archives on the machine and takes only the team folders', async () => {
    const dir = tempDir('atb-keep-')
    for (let i = 0; i < LOCAL_KEEP + 2; i++) keepLocal(dir, Buffer.from(`a${i}`), new Date(Date.UTC(2026, 9, 20 + i, 3, 30)))
    expect(readdirSync(path.join(dir, 'backups')).sort()).toEqual(['atelier-20261022-033000.atb', 'atelier-20261023-033000.atb', 'atelier-20261024-033000.atb'])
    mkdirSync(path.join(dir, 'orchestra', 'files'), { recursive: true })
    mkdirSync(path.join(dir, 'orchestra', 'eyes'), { recursive: true })
    writeFileSync(path.join(dir, 'orchestra', 'files', 'a.md'), 'a')
    writeFileSync(path.join(dir, 'orchestra', 'eyes', 'cache.bin'), 'b')
    expect(collectTeamFiles(dir).files.map((f) => f.path)).toEqual(['orchestra/files/a.md'])
  })

  it('refuses a folder without a database and says so in the state', async () => {
    const dir = tempDir('atb-empty-')
    expect(() => makeBackup({ dataDir: dir, key: KEY, appVersion: '0' })).toThrow(expect.objectContaining({ code: 'NO_SOURCE' }))
    const s = await runBackup({ dataDir: dir, key: KEY, appVersion: '0', link: () => null })
    expect(s.ok).toBe(false)
    expect(s.error).toMatch(/Pas de base/)
  })

  it('app.machine of a headless brain carries its uptime and its last backup', async () => {
    const brain = await startTestBrain({ backup: { at: { hour: 3, minute: 30 } } })
    brains.push(brain)
    const first = (await brain.rpc('app.machine')).body as { ok: true; value: MachineStats }
    expect(first.value.brain).toMatchObject({ restarts: 0, backup: null })
    expect(Date.parse(first.value.brain?.nextBackupAt ?? '')).toBeGreaterThan(Date.now())
    await brain.backups?.runNow()
    const after = ((await brain.rpc('app.machine')).body as { value: MachineStats }).value.brain
    expect(after?.backup).toMatchObject({ ok: true, cloud: 'off', error: null })
    expect(after?.backup?.sizeBytes).toBeGreaterThan(0)
  })
})
