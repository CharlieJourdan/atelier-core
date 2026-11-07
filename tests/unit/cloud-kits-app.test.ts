// The publication kit on the platform, app side, against an in-process Atelier Cloud (loopback, fakes, nothing paid): a
// finished run sends its package by itself, the kit is read back with fresh links, saved in the Downloads folder, a team
// computer sends with its own credential, and every « cannot » case says why (not connected, Cloud down, turned off).
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { textsFromMetadata, uploadPackage, KIT_UPLOAD_SETTING } from '../../src/main/cloud/kits'
import type { RunDetail, RunStartInput } from '../../src/shared/api'
import { appCore, connect, startCloud, type AppRig, type CloudRig } from './cloud-app-helpers'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

/** The parts of the Cloud object this test looks at (the Cloud's sources are not part of the app's typecheck). */
interface CloudInternals {
  kits: { latest(teamId: string, videoId: string): { title: string; tags: string[]; files: { name: string }[] } }
  db: { prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown } }
  machines(): { provision(teamId: string, plan: string, actor: string): Promise<{ id: string }[]>; newEnrolToken(machineId: string, actor: string): string }
}
const internals = (c: CloudRig): CloudInternals => c.t.cloud as unknown as CloudInternals

interface Rig {
  cloud: CloudRig
  app: AppRig
  fx: Fixture
  downloads: string
  opened: string[]
  channelId: number
}

/** The team's plan: storing kits on the platform needs one (or an enrolled team computer). */
function givePlan(c: CloudRig): void {
  internals(c)
    .db.prepare(`INSERT INTO billing_subscriptions (team_id, plan, period, status, since, updated_at) VALUES (?, 'starter', 'month', 'active', ?, ?)`)
    .run(c.teamId, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
}

async function rig(extra: Parameters<typeof appCore>[0] = {}): Promise<Rig> {
  const cloud = await startCloud(0)
  givePlan(cloud)
  const fx = fixture()
  const downloads = mkdtempSync(path.join(os.tmpdir(), 'kit-downloads-'))
  const opened: string[] = []
  const app = appCore({
    productionRuns: { ...fx.productionRuns, opener: async (dir: string) => {
        opened.push(dir)
        return ''
      }
    },
    kits: { downloadsDir: () => downloads },
    ...extra
  })
  cleanups.push(
    () => app.core.close(),
    () => fx.cleanup(),
    () => rmSync(downloads, { recursive: true, force: true })
  )
  const channel = await app.core.api['channels.create']({ name: 'Chaîne de test' })
  return { cloud, app, fx, downloads, opened, channelId: channel.id }
}

const input = (channelId: number): RunStartInput => ({ channelId, title: 'Ma vidéo', topic: 'Les templiers', minutes: 1, budgetMode: 'usage_max', gateMode: 'all' })

/** Starts a run and approves its package: the run ends `succeeded` with a package folder. */
async function finishedRun(r: Rig): Promise<RunDetail> {
  const api = r.app.core.api
  const started = await api['production.start'](input(r.channelId))
  await waitFor(async () => ((await api['production.get'](started.id)).status === 'waiting' ? true : null), 8_000, 'waiting')
  await api['production.approve'](started.id, 'package')
  return waitFor(async () => {
    const run = await api['production.get'](started.id)
    return run.status === 'succeeded' ? run : null
  }, 8_000, 'succeeded')
}

describe('a finished run', () => {
  it('sends its package to the platform by itself, and the kit comes back with links that save the exact files', async () => {
    const r = await rig()
    await connect(r.app, r.cloud)
    const run = await finishedRun(r)
    const api = r.app.core.api
    const ready = await waitFor(async () => {
      const s = await api['cloud.kit'](run.videoId)
      return s.status === 'ok' ? s : null
    }, 8_000, 'kit on the platform')
    // the kit's reference carries this database's own id (a team computer's video of the same id is another video)
    const ref = await api['cloud.kitRef'](run.videoId)
    expect(ref).toMatch(new RegExp(`^[a-f0-9]{16}-${run.videoId}$`))
    expect(await api['cloud.kitRef'](run.videoId)).toBe(ref) // made once, kept in the settings
    expect(ready.kit).toMatchObject({ videoId: ref, title: 'Ma vidéo' })
    expect(ready.kit.files.map((f) => f.name)).toEqual(['description.txt', 'video.mp4'])
    expect(ready.kit.files.every((f) => f.url.length > 0)).toBe(true)
    // the Cloud holds it for the team
    expect(internals(r.cloud).kits.latest(r.cloud.teamId, ref).files).toHaveLength(2)

    // one file saved under Downloads/Atelier/<title>/, the folder shown
    const one = await api['cloud.kitDownload'](run.videoId, 'video.mp4')
    expect(one).toEqual({ saved: ['video.mp4'], dir: path.join(r.downloads, 'Atelier', 'Ma vidéo') })
    expect(readFileSync(path.join(one.dir!, 'video.mp4'), 'utf8')).toBe('MP4DATA')
    expect(r.opened).toEqual([one.dir])
    // everything at once
    const all = await api['cloud.kitDownload'](run.videoId)
    expect(all.saved).toEqual(['description.txt', 'video.mp4'])
    expect(readFileSync(path.join(all.dir!, 'description.txt'), 'utf8')).toBe('Desc')
    await expect(api['cloud.kitDownload'](run.videoId, 'nope.mp4')).rejects.toThrow('Ce fichier n’est pas dans le kit.')
    await expect(api['cloud.kitDownload'](run.videoId, '../escape')).rejects.toThrow('Ce fichier n’est pas dans le kit.')
  })

  it('does not send when turned off, and « Envoyer sur la plateforme » sends it on demand', async () => {
    const r = await rig()
    await connect(r.app, r.cloud)
    r.app.core.context.settings.set(KIT_UPLOAD_SETTING, false)
    const run = await finishedRun(r)
    const api = r.app.core.api
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await api['cloud.kit'](run.videoId)).toEqual({ status: 'none' })
    expect(await api['cloud.kitPublish'](run.id)).toEqual({ files: 2, bytes: 'MP4DATA'.length + 'Desc'.length })
    expect((await api['cloud.kit'](run.videoId)).status).toBe('ok')
    // sending again replaces the kit with the same content (one kit per video)
    await api['cloud.kitPublish'](run.id)
    expect(internals(r.cloud).db.prepare('SELECT COUNT(*) AS n FROM video_kits WHERE video_id = ?').get(await api['cloud.kitRef'](run.videoId))).toEqual({ n: 1 })
    await expect(api['cloud.kitPublish'](99_999)).rejects.toThrow('Cette fabrication n’a pas encore de paquet.')
  })

  it('says why there is no kit to show: not connected, the Cloud is down, nothing sent yet', async () => {
    const r = await rig()
    const api = r.app.core.api
    const run = await finishedRun(r) // not connected: nothing is sent
    expect(await api['cloud.kit'](run.videoId)).toEqual({ status: 'not-connected' })
    await expect(api['cloud.kitPublish'](run.id)).rejects.toThrow('Ni connexion à Atelier Cloud ni ordinateur d’équipe relié')
    await expect(api['cloud.kitDownload'](run.videoId)).rejects.toThrow()
    await connect(r.app, r.cloud)
    expect(await api['cloud.kit'](run.videoId)).toEqual({ status: 'none' })
    r.app.net.down = true
    expect(await api['cloud.kit'](run.videoId)).toEqual({ status: 'unreachable' })
    await expect(api['cloud.kitPublish'](run.id)).rejects.toThrow('Atelier Cloud est injoignable')
    await expect(api['cloud.kit']('7' as unknown as number)).rejects.toThrow('videoId must be an integer')
  })

  it('a team computer (no person’s session) sends with its own credential, for its team', async () => {
    const r = await rig()
    // the machine's credential, made the way a real enrolment makes it
    const cloud = internals(r.cloud)
    const [m] = await cloud.machines().provision(r.cloud.teamId, 'starter', 'test')
    const enrol = await r.cloud.t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: cloud.machines().newEnrolToken(m!.id, 'test') } })
    const { credential } = enrol.json() as { credential: string }
    const brain = await rig({ kits: { machine: () => ({ baseUrl: r.cloud.baseUrl, credential }) } })
    const run = await finishedRun(brain)
    const ref = await brain.app.core.api['cloud.kitRef'](run.videoId)
    await vi.waitFor(() => expect(internals(r.cloud).kits.latest(r.cloud.teamId, ref).title).toBe('Ma vidéo'), { timeout: 8_000 })
    // it holds no person's token: asking for the kit is the app's business
    expect(await brain.app.core.api['cloud.kit'](run.videoId)).toEqual({ status: 'not-connected' })
    await expect(brain.app.core.api['cloud.kitDownload'](run.videoId)).rejects.toThrow()
  })
})

describe('two brains of one team', () => {
  it('never replace each other’s kits: the reference carries each database’s id; an older kit (bare id) stays readable', async () => {
    const r = await rig()
    await connect(r.app, r.cloud)
    const cloud = internals(r.cloud)
    const [m] = await cloud.machines().provision(r.cloud.teamId, 'starter', 'test')
    const enrol = await r.cloud.t.app.inject({ method: 'POST', url: '/v1/machines/enrol', payload: { enrolToken: cloud.machines().newEnrolToken(m!.id, 'test') } })
    const { credential } = enrol.json() as { credential: string }
    const brain = await rig({ kits: { machine: () => ({ baseUrl: r.cloud.baseUrl, credential }) } })
    // the app's run and the team computer's run: each database numbers its videos from 1
    const mine = await finishedRun(r)
    const theirs = await finishedRun(brain)
    expect(theirs.videoId).toBe(mine.videoId)
    const myRef = await r.app.core.api['cloud.kitRef'](mine.videoId)
    const theirRef = await brain.app.core.api['cloud.kitRef'](theirs.videoId)
    expect(myRef).not.toBe(theirRef)
    await vi.waitFor(() => {
      expect(cloud.kits.latest(r.cloud.teamId, myRef).files.length).toBeGreaterThan(0)
      expect(cloud.kits.latest(r.cloud.teamId, theirRef).files.length).toBeGreaterThan(0)
    }, { timeout: 8_000 })
    const api = r.app.core.api
    // the app reads its own video's kit, and the team computer's with the reference that computer gives
    expect(await api['cloud.kit'](mine.videoId)).toMatchObject({ status: 'ok', kit: { videoId: myRef } })
    expect(await api['cloud.kit'](theirs.videoId, theirRef)).toMatchObject({ status: 'ok', kit: { videoId: theirRef } })
    expect((cloud.db.prepare('SELECT COUNT(*) AS n FROM video_kits WHERE team_id = ?').get(r.cloud.teamId) as { n: number }).n).toBe(2)

    // a kit sent by an older app (ref = the bare id) is still found
    const kits = r.cloud.t.cloud as unknown as {
      kits: {
        start(team: string, video: string, texts: object, by: string): { kitId: string }
        addFile(team: string, video: string, kit: string, f: { name: string; bytes: Uint8Array; sha256: string }): Promise<unknown>
        complete(team: string, video: string, kit: string, by: string): Promise<unknown>
      }
    }
    const old = kits.kits.start(r.cloud.teamId, '777', { title: 'Ancien kit', alternatives: [], description: '', tags: [], chapters: [], language: 'fr', demo: false }, 'test')
    const bytes = Buffer.from('OLD')
    await kits.kits.addFile(r.cloud.teamId, '777', old.kitId, { name: 'video.mp4', bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
    await kits.kits.complete(r.cloud.teamId, '777', old.kitId, 'test')
    expect(await api['cloud.kit'](777)).toMatchObject({ status: 'ok', kit: { videoId: '777', title: 'Ancien kit' } })
  })
})

describe('the package folder', () => {
  const folder = (files: Record<string, string>): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-package-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body)
    return dir
  }

  it('reads the texts of metadata.json and tolerates a missing or odd one', () => {
    const meta = { title: 'Titre', alternatives: ['A', 3, 'B'], description: 'D', tags: ['x', ''], chapters: [{ at: 0, title: 'Intro' }, { at: 'bad' }], language: 'en', demo: true }
    expect(textsFromMetadata(meta, 'Repli')).toMatchObject({ title: 'Titre', alternatives: ['A', 'B'], description: 'D', tags: ['x'], chapters: [{ at: 0, title: 'Intro' }], language: 'en', demo: true })
    expect(textsFromMetadata(null, 'Repli')).toMatchObject({ title: 'Repli', description: '', tags: [], language: 'fr', demo: false })
    expect(textsFromMetadata({ title: 'x'.repeat(500), description: 'y'.repeat(9000) }, 'Repli').title).toHaveLength(200)
  })

  it('refuses a package without a video, and a folder that is gone', async () => {
    const endpoint = { baseUrl: 'http://127.0.0.1:1', token: () => 'amc_x', machine: true }
    await expect(uploadPackage(endpoint, '1', folder({ 'description.txt': 'x' }), 'T')).rejects.toThrow('Le paquet ne contient pas de vidéo à envoyer.')
    await expect(uploadPackage(endpoint, '1', path.join(os.tmpdir(), 'kit-package-gone'), 'T')).rejects.toThrow('Le dossier du paquet n’existe plus sur ce disque.')
  })

  it('sends only plain files, the publishable ones first, and never a sub-folder', async () => {
    const r = await rig()
    await connect(r.app, r.cloud)
    const dir = folder({ 'video.mp4': 'V', 'thumbnail.png': 'P', 'metadata.json': JSON.stringify({ title: 'Depuis le dossier', tags: ['t'] }), 'notes perso.txt': 'espace refusé', '.hidden': 'x' })
    mkdirSync(path.join(dir, 'sous-dossier'))
    writeFileSync(path.join(dir, 'sous-dossier', 'a.txt'), 'x')
    const session = r.app.core.cloud.session
    const out = await uploadPackage({ baseUrl: session.baseUrl(), token: () => session.token(), machine: false }, '4242', dir, 'Repli')
    expect(out).toEqual({ files: 3, bytes: 'V'.length + 'P'.length + JSON.stringify({ title: 'Depuis le dossier', tags: ['t'] }).length })
    const kit = internals(r.cloud).kits.latest(r.cloud.teamId, '4242')
    expect(kit.title).toBe('Depuis le dossier')
    expect(kit.tags).toEqual(['t'])
    expect(kit.files.map((f) => f.name)).toEqual(['metadata.json', 'thumbnail.png', 'video.mp4'])
  })
})
