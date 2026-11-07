// "The eyes" of a channel (lot "eyes"): the competitors it follows, their public numbers read through Atelier Cloud (YouTube
// Data API, read-only), the outliers among their videos, the analysis of the best of those by the eyes (billed in credits by the
// Cloud, only when asked), and the channel's STYLE PROFILE built from what was seen. Production reads the profile
// (`profileFor`) and the outliers (`inspirationFor`) when a run starts or ideas are asked for.
import type { ChannelVideo } from '../../shared/cloud-api'
import type { CompetitorRow, EyesAnalyseResult, EyesDetail, EyesReadResult, OutlierRow } from '../../shared/api/eyes'
import { t } from '../../shared/fr'
import { outliersOf, scoreVideos, whyItWorked, type ScoredVideo, type VideoStat } from '../../shared/outliers'
import { buildStyleProfile, type AnalysedVideo, type StyleProfile, type ThumbnailHints } from '../../shared/style-profile'
import type { Db } from '../db'
import type { ChannelIntelPort } from './port'
import { withWholeLog } from './refine'
import { EyesStore, type ReadRecord } from './store'

/** Videos read per channel: three quota units at the YouTube Data API, one 1-credit job at the Cloud. */
export const READ_VIDEOS = 30
/** The eyes watch at most this long of a video (a longer one is cut by the quote: the cost cannot pass what was announced). */
export const ANALYSE_CAP_MIN = 15
const DEFAULT_ANALYSES = 5
const MAX_ANALYSES = 10
const ROW_WHY_LIMIT = 400

export interface EyesServiceOptions {
  db: Db
  /** Null without a Cloud (tests of the pure parts); then every read and analysis refuses with the "connect the Cloud" message. */
  intel: ChannelIntelPort | null
  now?: () => Date
  /** Told when something the screens show changed. */
  notify?: () => void
  /** Told when a channel gets a new style profile version (the agent runtime writes its summary in the channel memory). */
  onProfile?: (channelId: number, profile: StyleProfile, version: number | null) => void
}

export interface Inspiration {
  title: string
  why: string
  channel: string
}

const toStat = (v: ChannelVideo): VideoStat => ({ id: v.id, title: v.title, views: v.views, publishedAt: v.publishedAt, durationS: v.durationS, likes: v.likes, comments: v.comments })
const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

/** The YouTube address of a channel from the id or handle kept on its sheet; null when there is none. */
export function ownChannelUrl(youtubeId: string | null): string | null {
  const id = youtubeId?.trim()
  if (!id) return null
  if (/^https:\/\/(www\.)?youtube\.com\//i.test(id)) return id
  if (/^UC[\w-]{20,}$/.test(id)) return `https://www.youtube.com/channel/${id}`
  const handle = id.replace(/^@/, '')
  return /^[\w.-]{3,}$/.test(handle) ? `https://www.youtube.com/@${handle}` : null
}

/** The few words the owner wrote about the channel's thumbnails, as profile traits. */
function hintsFromSheet(text: string): ThumbnailHints {
  const traits = text
    .split(/[,;\n]+/)
    .map((s) => s.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
  return { traits, face: /visage|\bface\b|expression/i.test(text) }
}

export class EyesService {
  readonly store: EyesStore
  private readonly now: () => Date

  constructor(private readonly o: EyesServiceOptions) {
    this.store = new EyesStore(o.db)
    this.now = o.now ?? (() => new Date())
  }

  private changed(): void {
    this.o.notify?.()
  }

  private intel(): ChannelIntelPort {
    if (!this.o.intel || !this.o.intel.connected()) throw new Error(t('eyes.err.notConnected'))
    return this.o.intel
  }

  // ---------------------------------------------------------------------------------------------------- what is shown

  private competitorRows(channelId: number): CompetitorRow[] {
    const reads = new Map(this.store.reads(channelId).map((r) => [r.sourceKey, r]))
    const nowMs = this.now().getTime()
    return this.store.competitors(channelId).map((c) => {
      const read = reads.get(c.id)
      return {
        id: c.id,
        channelId,
        url: c.url,
        name: c.name || read?.title || '',
        subscribers: read?.subscribers ?? null,
        watched: c.watched,
        lastReadAt: read?.readAt ?? null,
        videos: read?.videos.length ?? 0,
        outliers: read ? outliersOf(read.videos.map(toStat), { now: nowMs }).length : 0,
        demo: read?.demo ?? false
      }
    })
  }

  detail(channelId: number): EyesDetail {
    this.store.assertChannel(channelId)
    const latest = this.store.latestProfile(channelId)
    const analyses = this.store.analyses(channelId)
    return {
      channelId,
      ownUrl: ownChannelUrl(this.store.channelYoutubeId(channelId)),
      current: latest?.profile ?? null,
      currentVersion: latest?.version ?? null,
      versions: this.store.versions(channelId),
      competitors: this.competitorRows(channelId),
      analysed: {
        own: analyses.filter((a) => a.sourceKey === 0).length,
        competitors: analyses.filter((a) => a.sourceKey !== 0).length,
        demo: analyses.some((a) => a.demo)
      },
      cloudConnected: !!this.o.intel && this.o.intel.connected()
    }
  }

  addCompetitor(channelId: number, url: string): EyesDetail {
    this.store.addCompetitor(channelId, url)
    this.changed()
    return this.detail(channelId)
  }

  setWatched(competitorId: number, watched: boolean): EyesDetail {
    const c = this.store.setWatched(competitorId, watched)
    this.changed()
    return this.detail(c.channelId)
  }

  removeCompetitor(competitorId: number): EyesDetail {
    const c = this.store.removeCompetitor(competitorId)
    this.changed()
    return this.detail(c.channelId)
  }

  // ------------------------------------------------------------------------------------------------------ the reads

  /** The channel itself and its watched competitors, as (source key, address, label) to read. */
  private sources(channelId: number): { key: number; url: string; name: string }[] {
    const own = ownChannelUrl(this.store.channelYoutubeId(channelId))
    return [
      ...(own ? [{ key: 0, url: own, name: '' }] : []),
      ...this.store.competitors(channelId).filter((c) => c.watched).map((c) => ({ key: c.id, url: c.url, name: c.name }))
    ]
  }

  async read(channelId: number, signal: AbortSignal = new AbortController().signal): Promise<EyesReadResult> {
    this.store.assertChannel(channelId)
    const intel = this.intel()
    const sources = this.sources(channelId)
    if (sources.length === 0) throw new Error(t('eyes.err.nothingToRead'))
    const out: EyesReadResult = { channelsRead: 0, videos: 0, outliers: 0, quotaUnits: 0, demo: false, problems: [] }
    const nowMs = this.now().getTime()
    for (const s of sources) {
      try {
        const { data, demo } = await intel.channelData(s.url, READ_VIDEOS, signal, t('eyes.ledger.read', { name: s.name || s.url }))
        const read: ReadRecord = {
          channelId,
          sourceKey: s.key,
          url: s.url,
          title: data.title,
          subscribers: data.subscribers,
          videos: data.videos,
          quotaUnits: data.quotaUnits,
          demo,
          readAt: this.now().toISOString()
        }
        this.store.saveRead(read)
        if (s.key !== 0 && !s.name && data.title) this.store.setCompetitorName(s.key, data.title)
        out.channelsRead += 1
        out.videos += data.videos.length
        out.outliers += outliersOf(data.videos.map(toStat), { now: nowMs }).length
        out.quotaUnits += data.quotaUnits
        out.demo = out.demo || demo
      } catch (e) {
        if (signal.aborted) throw e
        out.problems.push(`${s.name || s.url} : ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (out.channelsRead === 0 && out.problems.length > 0) throw new Error(out.problems.join(' ; '))
    this.changed()
    return out
  }

  /** Every outlier of the latest reads, the strongest first. */
  outliers(channelId: number): OutlierRow[] {
    this.store.assertChannel(channelId)
    const nowMs = this.now().getTime()
    const rows: OutlierRow[] = []
    const names = new Map(this.store.competitors(channelId).map((c) => [c.id, c.name]))
    for (const read of this.store.reads(channelId)) {
      const stats = read.videos.map(toStat)
      const byId = new Map(read.videos.map((v) => [v.id, v]))
      for (const v of outliersOf(stats, { now: nowMs })) {
        rows.push({
          videoId: v.id,
          url: watchUrl(v.id),
          title: v.title,
          sourceKey: read.sourceKey,
          channelName: read.sourceKey === 0 ? read.title : names.get(read.sourceKey) || read.title,
          views: v.views,
          score: Math.round((v.score ?? 0) * 10) / 10,
          why: whyItWorked(v, stats, 'fr').slice(0, ROW_WHY_LIMIT),
          publishedAt: byId.get(v.id)?.publishedAt ?? v.publishedAt,
          analysed: this.store.hasAnalysis(channelId, read.sourceKey, v.id),
          demo: read.demo
        })
      }
    }
    return rows.sort((a, b) => b.score - a.score)
  }

  /** The videos worth the eyes: every outlier, and, for the channel itself when it has none, its two most viewed settled videos. */
  private candidates(channelId: number): { sourceKey: number; video: ScoredVideo; outlier: boolean; durationS: number | null }[] {
    const nowMs = this.now().getTime()
    const out: { sourceKey: number; video: ScoredVideo; outlier: boolean; durationS: number | null }[] = []
    for (const read of this.store.reads(channelId)) {
      const durations = new Map(read.videos.map((v) => [v.id, v.durationS]))
      const scored = scoreVideos(read.videos.map(toStat), { now: nowMs })
      const outliers = scored.filter((v) => v.outlier).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      const picks =
        outliers.length > 0 || read.sourceKey !== 0
          ? outliers.map((v) => ({ v, outlier: true }))
          : scored
              .filter((v) => !v.tooYoung)
              .sort((a, b) => b.views - a.views)
              .slice(0, 2)
              .map((v) => ({ v, outlier: false }))
      for (const p of picks) out.push({ sourceKey: read.sourceKey, video: p.v, outlier: p.outlier, durationS: durations.get(p.v.id) ?? null })
    }
    return out.sort((a, b) => (b.video.score ?? 0) - (a.video.score ?? 0))
  }

  async analyse(channelId: number, max: number = DEFAULT_ANALYSES, signal: AbortSignal = new AbortController().signal): Promise<EyesAnalyseResult> {
    this.store.assertChannel(channelId)
    const intel = this.intel()
    if (!Number.isInteger(max) || max < 1 || max > MAX_ANALYSES) throw new Error(t('eyes.err.badMax', { n: MAX_ANALYSES }))
    const all = this.candidates(channelId)
    if (all.length === 0) throw new Error(t('eyes.err.nothingToAnalyse'))
    const todo = all.filter((c) => !this.store.hasAnalysis(channelId, c.sourceKey, c.video.id))
    const out: EyesAnalyseResult = { analysed: 0, alreadyDone: all.length - todo.length, demo: false, problems: [], coverage: [] }
    for (const c of todo.slice(0, max)) {
      const minutes = Math.min(ANALYSE_CAP_MIN, Math.max(0.5, (c.durationS ?? 600) / 60))
      try {
        const read = await intel.analyseVideo(watchUrl(c.video.id), minutes, signal, t('eyes.ledger.analyse', { title: c.video.title.slice(0, 60) }))
        const demo = read.demo
        // the whole video when it can be read (its counted cadence replaces the guess); else it is said that only the start was seen
        const whole = !demo && intel.watchWhole ? await intel.watchWhole(watchUrl(c.video.id), { title: c.video.title, durationS: c.durationS }, signal) : null
        const analysis = whole ? withWholeLog(read.analysis, whole.log) : read.analysis
        if (!demo) out.coverage.push(`${c.video.title.slice(0, 60)} : ${whole ? whole.line : t('eyes.partial', { min: Math.round(minutes * 10) / 10 })}`)
        this.store.saveAnalysis({
          channelId,
          sourceKey: c.sourceKey,
          videoId: c.video.id,
          url: watchUrl(c.video.id),
          title: c.video.title,
          durationS: c.durationS,
          outlier: c.outlier,
          analysis,
          demo,
          analysedAt: this.now().toISOString()
        })
        out.analysed += 1
        out.demo = out.demo || demo
      } catch (e) {
        if (signal.aborted) throw e
        out.problems.push(`${c.video.title.slice(0, 60)} : ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (out.analysed === 0 && out.problems.length > 0) throw new Error(out.problems.join(' ; '))
    this.changed()
    return out
  }

  // ---------------------------------------------------------------------------------------------------- the profile

  /** A new profile version from the analyses kept. The thumbnail traits stay the owner's (the eyes do not describe thumbnails yet). */
  build(channelId: number, note = ''): EyesDetail {
    this.store.assertChannel(channelId)
    const kept = this.store.analyses(channelId)
    const videos: AnalysedVideo[] = kept.map((a) => ({
      origin: a.sourceKey === 0 ? 'own' : 'competitor',
      outlier: a.outlier,
      durationS: a.durationS,
      demo: a.demo,
      analysis: a.analysis
    }))
    const previous = this.store.latestProfile(channelId)?.profile.thumbnail
    const sheet = (this.o.db.prepare('SELECT thumbnail_style AS s FROM channels WHERE id = ?').get(channelId) as { s: string } | undefined)?.s ?? ''
    const profile = buildStyleProfile(videos, {
      now: this.now().toISOString(),
      thumbnail: previous ?? hintsFromSheet(sheet)
    })
    if (!profile) throw new Error(t('eyes.err.nothingToBuild'))
    // the analyses kept give the very profile already saved: a new version would only differ by its date
    const last = this.store.latestProfile(channelId)?.profile
    if (last && JSON.stringify({ ...last, source: { ...last.source, builtAt: null } }) === JSON.stringify({ ...profile, source: { ...profile.source, builtAt: null } })) {
      throw new Error(t('eyes.err.sameProfile'))
    }
    this.store.saveProfile(channelId, profile, note.trim() || t('eyes.note.built', { n: videos.length }), 'built')
    this.profileChanged(channelId)
    this.changed()
    return this.detail(channelId)
  }

  save(channelId: number, profile: unknown, note: string): EyesDetail {
    if (!note.trim()) throw new Error(t('eyes.err.noteNeeded'))
    this.store.saveProfile(channelId, profile, note, 'edited')
    this.profileChanged(channelId)
    this.changed()
    return this.detail(channelId)
  }

  private profileChanged(channelId: number): void {
    const latest = this.store.latestProfile(channelId)
    if (!latest || !this.o.onProfile) return
    try {
      this.o.onProfile(channelId, latest.profile, latest.version)
    } catch {
      // the channel memory is a convenience: a failure never undoes the profile
    }
  }

  /** The version number of the channel's latest profile (null without one). */
  profileVersion(channelId: number): number | null {
    return Number.isInteger(channelId) ? (this.store.latestProfile(channelId)?.version ?? null) : null
  }

  version(channelId: number, version: number): StyleProfile {
    this.store.assertChannel(channelId)
    return this.store.profile(channelId, version)
  }

  // ------------------------------------------------------------------------------------------------ for production

  /** The profile a run for this channel starts from; null when the channel has none (the run then behaves as it always did). */
  profileFor(channelId: number): StyleProfile | null {
    if (!Number.isInteger(channelId)) return null
    return this.store.latestProfile(channelId)?.profile ?? null
  }

  /**
   * The outliers of the competitors this channel watches, as inspiration for a topic or for ideas: title and why it worked,
   * the strongest first. Reads that came from the Cloud's demonstration are left out unless `includeDemo` (a demo run, or the
   * ideas agent when it was told they are examples).
   */
  inspirationFor(channelId: number, opts: { includeDemo?: boolean; limit?: number; lang?: 'fr' | 'en' } = {}): Inspiration[] {
    if (!Number.isInteger(channelId)) return []
    const nowMs = this.now().getTime()
    const watched = new Map(this.store.competitors(channelId).filter((c) => c.watched).map((c) => [c.id, c.name]))
    const items: (Inspiration & { score: number })[] = []
    for (const read of this.store.reads(channelId)) {
      if (read.sourceKey === 0 || !watched.has(read.sourceKey)) continue
      if (read.demo && !opts.includeDemo) continue
      const stats = read.videos.map(toStat)
      for (const v of outliersOf(stats, { now: nowMs })) {
        items.push({ title: v.title, why: whyItWorked(v, stats, opts.lang ?? 'en'), channel: (watched.get(read.sourceKey) || read.title).slice(0, 120), score: v.score ?? 0 })
      }
    }
    return items
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 5)
      .map(({ title, why, channel }) => ({ title: title.slice(0, 200), why: why.slice(0, 400), channel }))
  }
}
