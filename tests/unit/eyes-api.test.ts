// The eyes through the app’s IPC methods against an in-process Atelier Cloud on the loopback (its fake providers: nothing paid,
// nothing on the network): competitors, a read, the outliers, the analysis of the best videos (quoted, held, captured, in the
// ledger), the profile, and the ideas agent seeing the competitors’ outliers.
import { describe, expect, it } from 'vitest'
import { EYES_METHODS } from '../../src/shared/api'
import { FakeProvider } from '../../src/main/llm'
import { t } from '../../src/shared/fr'
import { appCore, connect, startCloud } from './cloud-app-helpers'

const AT = Date.UTC(2026, 9, 25, 12, 0, 0)
const UC = 'UCabcdefghijklmnopqrstuv'
const RIVAL = 'https://www.youtube.com/@rival'

/** Handlers may throw before returning a promise; the IPC layer awaits them either way. */
const fails = (fn: () => unknown, message: string | RegExp): Promise<void> => expect((async () => fn())()).rejects.toThrow(message)

describe('the eyes module', () => {
  it('lists its methods one by one', () => {
    expect([...EYES_METHODS]).toEqual([
      'eyes.get', // competitors, outliers count, profile and its versions, whether the Cloud is connected
      'eyes.addCompetitor', // a followed channel (a YouTube link)
      'eyes.setWatched', // follow / stop following without removing
      'eyes.removeCompetitor', // forget a competitor and what was read from it
      'eyes.read', // the public numbers of the channel and its watched competitors, through the Cloud
      'eyes.outliers', // the videos far above their channel’s norm
      'eyes.analyse', // the eyes watch the best of them (billed by the Cloud)
      'eyes.build', // a new profile version from the analyses
      'eyes.save', // the owner’s edit as a new version
      'eyes.version', // one stored version
      'eyes.watchVideo' // read a whole video: shot log, hook, cadence (chantier regarder-videos)
    ])
  })

  it('refuses malformed arguments in French', async () => {
    const app = appCore()
    const api = app.core.api
    const ch = await api['channels.create']({ name: 'Histoire' })
    await fails(() => api['eyes.get'](0), t('eyes.err.unknownChannel'))
    await fails(() => api['eyes.get'](1.5), t('eyes.err.unknownChannel'))
    await fails(() => api['eyes.get'](999), 'Chaîne inconnue.')
    await fails(() => api['eyes.addCompetitor'](ch.id, 'https://example.com/x'), t('eyes.err.badUrl'))
    await fails(() => api['eyes.setWatched'](-1, true), t('eyes.err.unknownCompetitor'))
    await fails(() => api['eyes.removeCompetitor'](77), 'Concurrent inconnu.')
    await fails(() => api['eyes.version'](ch.id, 3), 'Version de profil inconnue.')
    await fails(() => api['eyes.save'](ch.id, {} as never, 'note'), /Profil invalide/)
    app.core.close()
  })

  it('without a Cloud connection a read and an analysis say so, and nothing is invented', async () => {
    const app = appCore()
    const api = app.core.api
    const ch = await api['channels.create']({ name: 'Histoire' })
    const d = await api['eyes.addCompetitor'](ch.id, RIVAL)
    expect(d).toMatchObject({ cloudConnected: false, current: null, competitors: [{ url: RIVAL, lastReadAt: null }] })
    await fails(() => api['eyes.read'](ch.id), t('eyes.err.notConnected'))
    await fails(() => api['eyes.analyse'](ch.id), t('eyes.err.notConnected'))
    expect(await api['eyes.outliers'](ch.id)).toEqual([])
    app.core.close()
  })
})

describe('reading, analysing and building through Atelier Cloud', () => {
  // (the cores are left open like in the other Cloud tests: the background blueprint fetch of a connected app would race a close)
  async function connected() {
    const rig = await startCloud(5000)
    const provider = new FakeProvider(['```atelier-ideas\n[{"title":"Une idée","angle":"un angle"}]\n```'])
    const app = appCore({ chatProvider: () => provider })
    app.clock.now = AT
    await connect(app, rig)
    const api = app.core.api
    const ch = await api['channels.create']({ name: 'Histoire', niche: 'mystères' })
    app.core.db.prepare('UPDATE channels SET youtube_channel_id = ? WHERE id = ?').run(UC, ch.id)
    return { rig, app, api, ch, provider }
  }
  const balance = (rig: Awaited<ReturnType<typeof startCloud>>): number => rig.t.cloud.wallet.state(rig.teamId).balance

  it('reads the channel and a competitor, finds the spikes, analyses them, builds a profile, and feeds the ideas agent', async () => {
    const { rig, app, api, ch, provider } = await connected()
    await api['eyes.addCompetitor'](ch.id, RIVAL)

    // the read: one job per channel (the Cloud’s demonstration data), free since decision 0105 (YouTube reads cost us nothing), and written in the ledger
    const before = balance(rig)
    const read = await api['eyes.read'](ch.id)
    expect(read).toMatchObject({ channelsRead: 2, videos: 24, demo: true, problems: [], quotaUnits: 0 })
    expect(read.outliers).toBeGreaterThanOrEqual(2)
    expect(before - balance(rig)).toBe(0)
    const d = await api['eyes.get'](ch.id)
    expect(d).toMatchObject({ ownUrl: `https://www.youtube.com/channel/${UC}`, cloudConnected: true, current: null })
    expect(d.competitors[0]).toMatchObject({ name: 'Chaîne de démonstration', subscribers: 12_345, videos: 12, demo: true })
    expect(d.competitors[0]?.outliers).toBeGreaterThanOrEqual(1)

    // reading again the same day replays the same jobs: nothing more is paid
    const afterRead = balance(rig)
    await api['eyes.read'](ch.id)
    expect(balance(rig)).toBe(afterRead)

    const outliers = await api['eyes.outliers'](ch.id)
    expect(outliers.length).toBeGreaterThanOrEqual(2)
    expect(outliers.every((o) => o.demo && !o.analysed && o.score >= 2)).toBe(true)
    expect(outliers[0]?.why).toMatch(/fois les vues des vidéos de même âge/)

    // the analysis: quoted and billed by the Cloud, one row in the ledger each
    const analysed = await api['eyes.analyse'](ch.id, 3)
    expect(analysed).toMatchObject({ analysed: 3, demo: true, problems: [] })
    expect(afterRead - balance(rig)).toBeGreaterThan(0)
    const labels = (app.core.db.prepare(`SELECT model FROM ledger WHERE cloud_job_id IS NOT NULL ORDER BY id`).all() as { model: string }[]).map((r) => r.model)
    expect(labels.filter((l) => l.startsWith('Analyse de la vidéo'))).toHaveLength(3)
    expect(labels.filter((l) => l.startsWith('Lecture de la chaîne'))).toHaveLength(2)

    // the profile, from what the (fake) eyes saw
    const built = await api['eyes.build'](ch.id)
    expect(built.currentVersion).toBe(1)
    expect(built.current).toMatchObject({
      pace: { cutsPerMinute: 14, tempo: 'medium' },
      hook: { pattern: expect.any(String) },
      script: { structure: ['hook', 'body', 'outro'] },
      source: { demo: true }
    })
    expect(built.analysed.demo).toBe(true)
    const edited = await api['eyes.save'](ch.id, { ...built.current!, pace: { ...built.current!.pace, cutsPerMinute: 9 } }, 'Plus posé')
    expect(edited.versions.map((v) => [v.version, v.origin])).toEqual([[2, 'edited'], [1, 'built']])
    expect((await api['eyes.version'](ch.id, 1)).pace.cutsPerMinute).toBe(14)

    // Cerveau: the ideas agent is shown the competitors’ outliers (title and why), as inspiration only
    await api['ideas.generate'](ch.id, 1)
    const prompt = provider.calls[0]?.prompt ?? ''
    expect(prompt).toContain('Vidéos qui ont très bien marché chez les concurrents que la chaîne suit')
    expect(prompt).toContain('jamais à copier')
    expect(prompt).toMatch(/- « Vidéo de démonstration n° \d+ » \(Chaîne de démonstration\) : [\d,]+ fois les vues/)
  })

  it('the ideas agent is not told anything when no competitor was read', async () => {
    const { api, ch, provider } = await connected()
    await api['ideas.generate'](ch.id, 1)
    expect(provider.calls[0]?.prompt).not.toContain('concurrents que la chaîne suit')
  })
})
