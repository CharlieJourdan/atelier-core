// The eyes service (src/main/eyes): competitors, reads, outliers, analyses and the style profile versions, against an in-memory
// database and a fake Cloud port (nothing paid, nothing on the network).
import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db'
import { ownChannelUrl, EyesService, ANALYSE_CAP_MIN } from '../../src/main/eyes/service'
import type { ChannelIntelPort } from '../../src/main/eyes/port'
import { cleanCompetitorUrl } from '../../src/main/eyes/store'
import type { ChannelDataResult, ChannelVideo } from '../../src/shared/cloud-api'
import { t } from '../../src/shared/fr'
import type { AnalysisResult } from '../../src/shared/video-analysis'
import { analysis } from './fixtures/eyes-analyses'

const NOW = new Date(Date.UTC(2026, 9, 25, 12, 0, 0))
const DAY = 86_400_000
const UC = 'UCabcdefghijklmnopqrstuv'

/** 20 videos, one a week, views rising with age and flat after, plus an optional spike. */
function channelVideos(prefix: string, spikeAt: number | null, base = 100_000): ChannelVideo[] {
  return Array.from({ length: 20 }, (_, i) => {
    const age = 7 * (i + 1)
    const views = Math.round(base * (1 - Math.exp(-age / 30)))
    return {
      id: `${prefix}${String(i).padStart(2, '0')}`,
      title: `${prefix} titre ${i}`,
      views: i === spikeAt ? views * 6 : views,
      likes: null,
      comments: null,
      durationS: 600,
      publishedAt: new Date(NOW.getTime() - age * DAY).toISOString(),
      thumbnailUrl: null
    }
  })
}

class FakeIntel implements ChannelIntelPort {
  online = true
  demo = false
  failFor = new Set<string>()
  readonly reads: { url: string; max: number; label: string }[] = []
  readonly analyses: { url: string; minutes: number; label: string }[] = []
  readonly data = new Map<string, ChannelDataResult>()
  connected(): boolean {
    return this.online
  }
  serve(url: string, title: string, videos: ChannelVideo[], subscribers: number | null = 5000): void {
    this.data.set(url, { url, channelId: UC, title, subscribers, totalViews: null, videoCount: videos.length, videos, quotaUnits: 3 })
  }
  async channelData(url: string, max: number, _s: AbortSignal, label: string) {
    this.reads.push({ url, max, label })
    if (this.failFor.has(url)) throw new Error('YouTube a refusé la lecture')
    const data = this.data.get(url)
    if (!data) throw new Error('chaîne introuvable')
    return { data, demo: this.demo }
  }
  async analyseVideo(url: string, minutes: number, _s: AbortSignal, label: string): Promise<{ analysis: AnalysisResult; demo: boolean }> {
    this.analyses.push({ url, minutes, label })
    if (this.failFor.has(url)) throw new Error('analyse refusée')
    return { analysis: analysis(), demo: this.demo }
  }
}

const OWN_URL = `https://www.youtube.com/channel/${UC}`
const RIVAL_A = 'https://www.youtube.com/@rivala'
const RIVAL_B = 'https://www.youtube.com/@rivalb'

function setup(o: { youtubeId?: string | null; sheet?: string } = {}) {
  const db: Db = openDatabase(':memory:')
  db.prepare('INSERT INTO channels (name, niche, youtube_channel_id, thumbnail_style) VALUES (?, ?, ?, ?)').run('Ma chaîne', 'histoire', o.youtubeId === undefined ? UC : o.youtubeId, o.sheet ?? '')
  const intel = new FakeIntel()
  let changes = 0
  const svc = new EyesService({ db, intel, now: () => NOW, notify: () => void changes++ })
  return { db, intel, svc, changes: () => changes }
}

describe('the YouTube address of the channel itself', () => {
  it('is built from the channel id, a handle or a full link; nothing from nothing', () => {
    expect(ownChannelUrl(UC)).toBe(OWN_URL)
    expect(ownChannelUrl('@maChaine')).toBe('https://www.youtube.com/@maChaine')
    expect(ownChannelUrl('maChaine')).toBe('https://www.youtube.com/@maChaine')
    expect(ownChannelUrl('https://www.youtube.com/@x/videos')).toBe('https://www.youtube.com/@x/videos')
    expect(ownChannelUrl('')).toBeNull()
    expect(ownChannelUrl(null)).toBeNull()
    expect(ownChannelUrl('a b')).toBeNull()
  })
})

describe('competitors', () => {
  it('keeps a clean YouTube link, once, and refuses anything else', () => {
    expect(cleanCompetitorUrl('www.youtube.com/@RivalA/')).toBe('https://www.youtube.com/@RivalA')
    expect(cleanCompetitorUrl('https://www.youtube.com/@a?si=tracking#x')).toBe('https://www.youtube.com/@a')
    expect(cleanCompetitorUrl('https://www.youtube.com/watch?v=abc&list=zzz')).toBe('https://www.youtube.com/watch?v=abc')
    for (const bad of ['https://example.com/@a', 'http://www.youtube.com/@a', '', 42, 'https://user:pw@www.youtube.com/@a', 'https://youtube.com.evil.io/@a']) {
      expect(() => cleanCompetitorUrl(bad), String(bad)).toThrow(t('eyes.err.badUrl'))
    }
  })

  it('adds, lists, watches, unwatches and removes, and does not add the same link twice', () => {
    const { svc, changes } = setup()
    const a = svc.addCompetitor(1, RIVAL_A)
    expect(a.competitors).toHaveLength(1)
    expect(svc.addCompetitor(1, `${RIVAL_A}/`).competitors).toHaveLength(1)
    const b = svc.addCompetitor(1, RIVAL_B)
    expect(b.competitors.map((c) => c.url)).toEqual([RIVAL_A, RIVAL_B])
    expect(b.competitors.every((c) => c.watched && c.lastReadAt === null)).toBe(true)
    const id = b.competitors[0]!.id
    expect(svc.setWatched(id, false).competitors[0]?.watched).toBe(false)
    expect(svc.removeCompetitor(id).competitors.map((c) => c.url)).toEqual([RIVAL_B])
    expect(changes()).toBeGreaterThanOrEqual(4)
    expect(() => svc.addCompetitor(99, RIVAL_A)).toThrow('Chaîne inconnue.')
    expect(() => svc.removeCompetitor(999)).toThrow('Concurrent inconnu.')
  })

  it('removing a competitor removes what was read and analysed from it', async () => {
    const { svc, intel } = setup()
    intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    const id = svc.addCompetitor(1, RIVAL_A).competitors[0]!.id
    await svc.read(1)
    await svc.analyse(1, 5)
    expect(svc.store.reads(1).map((r) => r.sourceKey).sort()).toEqual([0, id])
    svc.removeCompetitor(id)
    expect(svc.store.reads(1).map((r) => r.sourceKey)).toEqual([0])
    expect(svc.store.analyses(1).every((a) => a.sourceKey === 0)).toBe(true)
  })
})

describe('reading the channels', () => {
  it('needs Atelier Cloud, and says so in French', async () => {
    const { svc, intel } = setup()
    intel.online = false
    svc.addCompetitor(1, RIVAL_A)
    await expect(svc.read(1)).rejects.toThrow(t('eyes.err.notConnected'))
    await expect(svc.analyse(1)).rejects.toThrow(t('eyes.err.notConnected'))
    expect(svc.detail(1).cloudConnected).toBe(false)
    expect(intel.reads).toEqual([])
  })

  it('reads the channel itself and the watched competitors only, 30 videos each, and names them', async () => {
    const { svc, intel } = setup()
    intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5), 120_000)
    intel.serve(RIVAL_B, 'Rival B', channelVideos('rb', null))
    const a = svc.addCompetitor(1, RIVAL_A).competitors[0]!
    const b = svc.addCompetitor(1, RIVAL_B).competitors[1]!
    svc.setWatched(b.id, false)
    const r = await svc.read(1)
    expect(r).toMatchObject({ channelsRead: 2, videos: 40, outliers: 1, quotaUnits: 6, demo: false, problems: [] })
    expect(intel.reads.map((x) => [x.url, x.max])).toEqual([[OWN_URL, 30], [RIVAL_A, 30]])
    expect(intel.reads[1]?.label).toBe(t('eyes.ledger.read', { name: RIVAL_A }))
    const rows = svc.detail(1).competitors
    expect(rows.find((c) => c.id === a.id)).toMatchObject({ name: 'Rival A', subscribers: 120_000, videos: 20, outliers: 1, watched: true, demo: false })
    expect(rows.find((c) => c.id === b.id)).toMatchObject({ videos: 0, lastReadAt: null })
    expect(rows.find((c) => c.id === a.id)?.lastReadAt).toBe(NOW.toISOString())
  })

  it('a second read replaces the first, and a channel that fails is reported while the others go on', async () => {
    const { svc, intel } = setup()
    intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    svc.addCompetitor(1, RIVAL_A)
    svc.addCompetitor(1, RIVAL_B) // not served: the Cloud does not know it
    const r = await svc.read(1)
    expect(r.channelsRead).toBe(2)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain(RIVAL_B)
    expect(r.problems[0]).toContain('chaîne introuvable')
    await svc.read(1)
    expect(svc.store.reads(1)).toHaveLength(2)
  })

  it('when every read fails, it throws the reasons', async () => {
    const { svc, intel } = setup({ youtubeId: null })
    svc.addCompetitor(1, RIVAL_A)
    intel.failFor.add(RIVAL_A)
    await expect(svc.read(1)).rejects.toThrow(/YouTube a refusé la lecture/)
  })

  it('has nothing to read without a competitor and without a YouTube id', async () => {
    const { svc } = setup({ youtubeId: null })
    await expect(svc.read(1)).rejects.toThrow(t('eyes.err.nothingToRead'))
  })

  it('flags a read that came from the Cloud’s demonstration', async () => {
    const { svc, intel } = setup()
    intel.demo = true
    intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    expect((await svc.read(1)).demo).toBe(true)
  })
})

describe('the outliers', () => {
  it('lists the videos far above their channel’s norm, the strongest first, with why and whether they were analysed', async () => {
    const { svc, intel } = setup()
    intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    intel.serve(RIVAL_B, 'Rival B', channelVideos('rb', 10))
    svc.addCompetitor(1, RIVAL_A)
    svc.addCompetitor(1, RIVAL_B)
    await svc.read(1)
    const rows = svc.outliers(1)
    expect(rows.map((o) => o.videoId).sort()).toEqual(['ra05', 'rb10'])
    expect(rows[0]!.score).toBeGreaterThanOrEqual(rows[1]!.score)
    expect(rows[0]).toMatchObject({ url: expect.stringContaining('https://www.youtube.com/watch?v='), analysed: false, demo: false })
    expect(rows[0]!.why).toMatch(/fois les vues des vidéos de même âge/)
    expect(rows.map((o) => o.channelName).sort()).toEqual(['Rival A', 'Rival B'])
    await svc.analyse(1, 5)
    expect(svc.outliers(1).every((o) => o.analysed)).toBe(true)
  })
})

describe('analysing the best videos', () => {
  async function ready() {
    const s = setup()
    s.intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    s.intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    s.intel.serve(RIVAL_B, 'Rival B', channelVideos('rb', 10))
    s.svc.addCompetitor(1, RIVAL_A)
    s.svc.addCompetitor(1, RIVAL_B)
    await s.svc.read(1)
    return s
  }

  it('analyses the outliers and the channel’s two most viewed videos (it has no outlier), once each', async () => {
    const { svc, intel } = await ready()
    const r = await svc.analyse(1, 10)
    expect(r).toMatchObject({ analysed: 4, alreadyDone: 0, demo: false, problems: [] })
    const urls = intel.analyses.map((a) => new URL(a.url).searchParams.get('v'))
    expect(urls).toContain('ra05')
    expect(urls).toContain('rb10')
    expect(urls.filter((v) => v?.startsWith('own'))).toHaveLength(2)
    expect(intel.analyses.every((a) => a.minutes === 10)).toBe(true) // 600 s videos
    const again = await svc.analyse(1, 10)
    expect(again).toMatchObject({ analysed: 0, alreadyDone: 4 })
    expect(intel.analyses).toHaveLength(4)
    expect(svc.detail(1).analysed).toEqual({ own: 2, competitors: 2, demo: false })
  })

  it('analyses at most `max` videos, strongest first', async () => {
    const { svc, intel } = await ready()
    const r = await svc.analyse(1, 1)
    expect(r.analysed).toBe(1)
    expect(intel.analyses).toHaveLength(1)
    const best = svc.outliers(1)[0]!
    expect(intel.analyses[0]?.url).toBe(best.url)
  })

  it('refuses a silly count, and has nothing to analyse before a read', async () => {
    const { svc } = await ready()
    await expect(svc.analyse(1, 0)).rejects.toThrow(t('eyes.err.badMax', { n: 10 }))
    await expect(svc.analyse(1, 11)).rejects.toThrow(t('eyes.err.badMax', { n: 10 }))
    const fresh = setup()
    await expect(fresh.svc.analyse(1)).rejects.toThrow(t('eyes.err.nothingToAnalyse'))
  })

  it('never watches more than the cap of a long video (the quote would cut it)', async () => {
    const s = setup()
    s.intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5).map((v) => ({ ...v, durationS: 5400 })))
    s.svc.addCompetitor(1, RIVAL_A)
    await s.svc.read(1)
    await s.svc.analyse(1, 1)
    expect(s.intel.analyses[0]?.minutes).toBe(ANALYSE_CAP_MIN)
  })

  it('reports a video that fails and goes on; all failing throws', async () => {
    const { svc, intel } = await ready()
    intel.failFor.add('https://www.youtube.com/watch?v=ra05')
    const r = await svc.analyse(1, 10)
    expect(r.analysed).toBe(3)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('analyse refusée')
    const s2 = setup({ youtubeId: null })
    s2.intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    s2.svc.addCompetitor(1, RIVAL_A)
    await s2.svc.read(1)
    s2.intel.failFor.add('https://www.youtube.com/watch?v=ra05')
    await expect(s2.svc.analyse(1, 5)).rejects.toThrow(/analyse refusée/)
  })
})

describe('the profile', () => {
  async function analysed(o: { demo?: boolean; sheet?: string } = {}) {
    const s = setup({ sheet: o.sheet })
    s.intel.demo = o.demo ?? false
    s.intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', null))
    s.intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    s.svc.addCompetitor(1, RIVAL_A)
    await s.svc.read(1)
    await s.svc.analyse(1, 5)
    return s
  }

  it('has none before it is built, and a run then starts as it always did', async () => {
    const { svc } = setup()
    expect(svc.profileFor(1)).toBeNull()
    expect(svc.detail(1)).toMatchObject({ current: null, currentVersion: null, versions: [] })
    expect(() => svc.build(1)).toThrow(t('eyes.err.nothingToBuild'))
  })

  it('is built from the analyses kept as version 1, with the number of videos it comes from', async () => {
    const { svc } = await analysed()
    const d = svc.build(1)
    expect(d.currentVersion).toBe(1)
    expect(d.current?.source).toMatchObject({ ownVideos: 2, competitorVideos: 1, demo: false })
    expect(d.versions).toEqual([{ version: 1, note: t('eyes.note.built', { n: 3 }), origin: 'built', createdAt: expect.any(String) }])
    expect(svc.profileFor(1)).toEqual(d.current)
  })

  it('takes the thumbnail traits from the channel sheet the first time, then keeps the owner’s', async () => {
    const { svc } = await analysed({ sheet: 'fond jaune, visage surpris' })
    const first = svc.build(1)
    expect(first.current?.thumbnail).toMatchObject({ traits: ['fond jaune', 'visage surpris'], face: true })
    const edited = { ...first.current!, pace: { ...first.current!.pace, cutsPerMinute: 9 }, thumbnail: { ...first.current!.thumbnail, traits: ['texte énorme'] } }
    svc.save(1, edited, 'Mes miniatures')
    const rebuilt = svc.build(1, 'Reconstruit')
    expect(rebuilt.currentVersion).toBe(3)
    expect(rebuilt.current?.thumbnail.traits).toEqual(['texte énorme'])
    expect(rebuilt.current?.pace.cutsPerMinute).toBe(first.current?.pace.cutsPerMinute) // the analyses speak again
    // nothing new to read: a second rebuild would be the same profile, so it is refused instead of piling up versions
    expect(() => svc.build(1)).toThrow(t('eyes.err.sameProfile'))
    expect(rebuilt.versions.map((v) => [v.version, v.origin])).toEqual([[3, 'built'], [2, 'edited'], [1, 'built']])
  })

  it('a profile built from demonstration analyses says so', async () => {
    const { svc } = await analysed({ demo: true })
    const d = svc.build(1)
    expect(d.current?.source.demo).toBe(true)
    expect(d.analysed.demo).toBe(true)
  })

  it('saves the owner’s edit as a new version, with a note, and refuses an empty note, an invalid value or no change', async () => {
    const { svc } = await analysed()
    const p = svc.build(1).current!
    expect(() => svc.save(1, p, '  ')).toThrow(t('eyes.err.noteNeeded'))
    expect(() => svc.save(1, { ...p, pace: { ...p.pace, cutsPerMinute: 500 } }, 'trop vite')).toThrow(/Profil invalide \(pace\.cutsPerMinute\)/)
    expect(() => svc.save(1, p, 'identique')).toThrow('Rien n’a changé')
    const d = svc.save(1, { ...p, pace: { ...p.pace, cutsPerMinute: 10 } }, 'Plus posé')
    expect(d.currentVersion).toBe(2)
    expect(d.current?.pace.cutsPerMinute).toBe(10)
    expect(svc.profileFor(1)?.pace.cutsPerMinute).toBe(10)
    expect(svc.version(1, 1).pace.cutsPerMinute).toBe(p.pace.cutsPerMinute)
    expect(() => svc.version(1, 9)).toThrow('Version de profil inconnue.')
  })
})

describe('inspiration for a topic or for ideas', () => {
  async function followed(demo = false) {
    const s = setup()
    s.intel.demo = demo
    s.intel.serve(OWN_URL, 'Ma chaîne', channelVideos('own', 3))
    s.intel.serve(RIVAL_A, 'Rival A', channelVideos('ra', 5))
    s.intel.serve(RIVAL_B, 'Rival B', channelVideos('rb', 10))
    const a = s.svc.addCompetitor(1, RIVAL_A).competitors[0]!
    const b = s.svc.addCompetitor(1, RIVAL_B).competitors[1]!
    await s.svc.read(1)
    return { ...s, a, b }
  }

  it('lists the competitors’ outliers (never the channel’s own), strongest first, with the title and why', async () => {
    const { svc } = await followed()
    const items = svc.inspirationFor(1)
    expect(items.map((i) => i.title).sort()).toEqual(['ra titre 5', 'rb titre 10'])
    expect(items.every((i) => i.channel.startsWith('Rival') && i.why.length > 0)).toBe(true)
    expect(items[0]!.why).toMatch(/x the views of the channel's videos of the same age/)
    expect(svc.inspirationFor(1, { lang: 'fr' })[0]!.why).toMatch(/fois les vues/)
    expect(svc.inspirationFor(1, { limit: 1 })).toHaveLength(1)
  })

  it('leaves out a competitor that is not watched, and a channel with none', async () => {
    const { svc, b } = await followed()
    svc.setWatched(b.id, false)
    expect(svc.inspirationFor(1).map((i) => i.title)).toEqual(['ra titre 5'])
    expect(setup().svc.inspirationFor(1)).toEqual([])
    expect(svc.inspirationFor(1.5)).toEqual([])
  })

  it('leaves out reads from the Cloud’s demonstration unless the caller is a demo too', async () => {
    const { svc } = await followed(true)
    expect(svc.inspirationFor(1)).toEqual([])
    expect(svc.inspirationFor(1, { includeDemo: true })).toHaveLength(2)
  })
})
