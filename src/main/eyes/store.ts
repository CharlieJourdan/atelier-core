// SQLite access of the eyes (migration 021): competitors, the latest read of each channel, the analyses kept, the style
// profile versions. No network, no model: the service (service.ts) decides what to read and when.
import { isYoutubeUrl, type ChannelVideo } from '../../shared/cloud-api'
import { t } from '../../shared/fr'
import { StyleProfileSchema, type StyleProfile } from '../../shared/style-profile'
import { AnalysisResult } from '../../shared/video-analysis'
import { nowIso, type Db } from '../db'

export interface CompetitorRecord {
  id: number
  channelId: number
  url: string
  name: string
  watched: boolean
}

export interface ReadRecord {
  channelId: number
  /** 0 = the channel itself, else the competitor's id. */
  sourceKey: number
  url: string
  title: string
  subscribers: number | null
  videos: ChannelVideo[]
  quotaUnits: number
  demo: boolean
  readAt: string
}

export interface AnalysisRecord {
  channelId: number
  sourceKey: number
  videoId: string
  url: string
  title: string
  durationS: number | null
  outlier: boolean
  analysis: AnalysisResult
  demo: boolean
  analysedAt: string
}

export interface ProfileVersion {
  version: number
  note: string
  origin: 'built' | 'edited'
  createdAt: string
}

/** A YouTube link kept as the competitor's address: https only, no query or fragment except a video id never needed here. */
export function cleanCompetitorUrl(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    throw new Error(t('eyes.err.badUrl'))
  }
  if (!isYoutubeUrl(url.toString())) throw new Error(t('eyes.err.badUrl'))
  // a channel, a handle or a video link: nothing else is kept (no query but the video id, no fragment)
  const v = url.searchParams.get('v')
  url.search = ''
  if (v) url.searchParams.set('v', v)
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

interface CompetitorSql {
  id: number
  channel_id: number
  url: string
  name: string
  watched: number
}
interface ReadSql {
  channel_id: number
  source_key: number
  url: string
  title: string
  subscribers: number | null
  videos_json: string
  quota_units: number
  demo: number
  read_at: string
}
interface AnalysisSql {
  channel_id: number
  source_key: number
  video_id: string
  url: string
  title: string
  duration_s: number | null
  outlier: number
  analysis_json: string
  demo: number
  analysed_at: string
}

export class EyesStore {
  constructor(private readonly db: Db) {}

  assertChannel(channelId: number): void {
    if (!Number.isInteger(channelId) || !this.db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)) throw new Error('Chaîne inconnue.')
  }

  channelYoutubeId(channelId: number): string | null {
    const r = this.db.prepare('SELECT youtube_channel_id AS y FROM channels WHERE id = ?').get(channelId) as { y: string | null } | undefined
    return r?.y?.trim() || null
  }

  // ------------------------------------------------------------------------------------------------ competitors

  competitors(channelId: number): CompetitorRecord[] {
    const rows = this.db.prepare('SELECT * FROM channel_competitors WHERE channel_id = ? ORDER BY id').all(channelId) as unknown as CompetitorSql[]
    return rows.map((r) => ({ id: r.id, channelId: r.channel_id, url: r.url, name: r.name, watched: r.watched === 1 }))
  }

  competitor(id: number): CompetitorRecord {
    const r = this.db.prepare('SELECT * FROM channel_competitors WHERE id = ?').get(id) as unknown as CompetitorSql | undefined
    if (!r) throw new Error('Concurrent inconnu.')
    return { id: r.id, channelId: r.channel_id, url: r.url, name: r.name, watched: r.watched === 1 }
  }

  addCompetitor(channelId: number, url: string): number {
    this.assertChannel(channelId)
    const clean = cleanCompetitorUrl(url)
    const found = this.db.prepare('SELECT id FROM channel_competitors WHERE channel_id = ? AND url = ?').get(channelId, clean) as { id: number } | undefined
    if (found) return found.id
    return Number(this.db.prepare('INSERT INTO channel_competitors (channel_id, url, created_at) VALUES (?, ?, ?)').run(channelId, clean, nowIso()).lastInsertRowid)
  }

  setWatched(id: number, watched: boolean): CompetitorRecord {
    this.competitor(id)
    this.db.prepare('UPDATE channel_competitors SET watched = ? WHERE id = ?').run(watched ? 1 : 0, id)
    return this.competitor(id)
  }

  setCompetitorName(id: number, name: string): void {
    this.db.prepare('UPDATE channel_competitors SET name = ? WHERE id = ?').run(name.slice(0, 200), id)
  }

  /** Removes a competitor with what was read and analysed from it. */
  removeCompetitor(id: number): CompetitorRecord {
    const c = this.competitor(id)
    this.db.prepare('DELETE FROM channel_reads WHERE channel_id = ? AND source_key = ?').run(c.channelId, id)
    this.db.prepare('DELETE FROM video_analyses WHERE channel_id = ? AND source_key = ?').run(c.channelId, id)
    this.db.prepare('DELETE FROM channel_competitors WHERE id = ?').run(id)
    return c
  }

  // ------------------------------------------------------------------------------------------------------ reads

  saveRead(r: ReadRecord): void {
    this.db
      .prepare(
        `INSERT INTO channel_reads (channel_id, source_key, url, title, subscribers, videos_json, quota_units, demo, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, source_key) DO UPDATE SET url = excluded.url, title = excluded.title, subscribers = excluded.subscribers,
           videos_json = excluded.videos_json, quota_units = excluded.quota_units, demo = excluded.demo, read_at = excluded.read_at`
      )
      .run(r.channelId, r.sourceKey, r.url, r.title, r.subscribers, JSON.stringify(r.videos), r.quotaUnits, r.demo ? 1 : 0, r.readAt)
  }

  reads(channelId: number): ReadRecord[] {
    const rows = this.db.prepare('SELECT * FROM channel_reads WHERE channel_id = ? ORDER BY source_key').all(channelId) as unknown as ReadSql[]
    return rows.map((r) => ({
      channelId: r.channel_id,
      sourceKey: r.source_key,
      url: r.url,
      title: r.title,
      subscribers: r.subscribers,
      videos: JSON.parse(r.videos_json) as ChannelVideo[],
      quotaUnits: r.quota_units,
      demo: r.demo === 1,
      readAt: r.read_at
    }))
  }

  // -------------------------------------------------------------------------------------------------- analyses

  hasAnalysis(channelId: number, sourceKey: number, videoId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM video_analyses WHERE channel_id = ? AND source_key = ? AND video_id = ?').get(channelId, sourceKey, videoId)
  }

  saveAnalysis(a: AnalysisRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO video_analyses (channel_id, source_key, video_id, url, title, duration_s, outlier, analysis_json, demo, analysed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(a.channelId, a.sourceKey, a.videoId, a.url, a.title.slice(0, 300), a.durationS, a.outlier ? 1 : 0, JSON.stringify(a.analysis), a.demo ? 1 : 0, a.analysedAt)
  }

  analyses(channelId: number): AnalysisRecord[] {
    const rows = this.db.prepare('SELECT * FROM video_analyses WHERE channel_id = ? ORDER BY analysed_at, video_id').all(channelId) as unknown as AnalysisSql[]
    return rows.flatMap((r) => {
      const analysis = AnalysisResult.safeParse(JSON.parse(r.analysis_json))
      // a row whose shape no longer matches (an older schema) is left out rather than breaking the profile
      if (!analysis.success) return []
      return [
        {
          channelId: r.channel_id,
          sourceKey: r.source_key,
          videoId: r.video_id,
          url: r.url,
          title: r.title,
          durationS: r.duration_s,
          outlier: r.outlier === 1,
          analysis: analysis.data,
          demo: r.demo === 1,
          analysedAt: r.analysed_at
        }
      ]
    })
  }

  // --------------------------------------------------------------------------------------------------- profiles

  versions(channelId: number): ProfileVersion[] {
    const rows = this.db.prepare('SELECT version, note, origin, created_at FROM style_profiles WHERE channel_id = ? ORDER BY version DESC').all(channelId) as unknown as {
      version: number
      note: string
      origin: 'built' | 'edited'
      created_at: string
    }[]
    return rows.map((r) => ({ version: r.version, note: r.note, origin: r.origin, createdAt: r.created_at }))
  }

  profile(channelId: number, version: number): StyleProfile {
    const r = this.db.prepare('SELECT json FROM style_profiles WHERE channel_id = ? AND version = ?').get(channelId, version) as { json: string } | undefined
    if (!r) throw new Error('Version de profil inconnue.')
    return StyleProfileSchema.parse(JSON.parse(r.json))
  }

  latestProfile(channelId: number): { version: number; profile: StyleProfile } | null {
    const r = this.db.prepare('SELECT version, json FROM style_profiles WHERE channel_id = ? ORDER BY version DESC LIMIT 1').get(channelId) as { version: number; json: string } | undefined
    if (!r) return null
    const parsed = StyleProfileSchema.safeParse(JSON.parse(r.json))
    return parsed.success ? { version: r.version, profile: parsed.data } : null
  }

  /** Validates and stores the next version. Refused when nothing changed from the last one (an edit identical to it). */
  saveProfile(channelId: number, profile: unknown, note: string, origin: 'built' | 'edited'): number {
    this.assertChannel(channelId)
    const parsed = StyleProfileSchema.safeParse(profile)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      throw new Error(`Profil invalide (${first ? first.path.join('.') : '?'}) : vérifie les valeurs du formulaire.`)
    }
    const json = JSON.stringify(parsed.data)
    const last = this.db.prepare('SELECT version, json FROM style_profiles WHERE channel_id = ? ORDER BY version DESC LIMIT 1').get(channelId) as { version: number; json: string } | undefined
    if (last && last.json === json) throw new Error('Rien n’a changé depuis la dernière version du profil.')
    const version = (last?.version ?? 0) + 1
    this.db
      .prepare('INSERT INTO style_profiles (channel_id, version, json, note, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(channelId, version, json, note.trim().slice(0, 300), origin, nowIso())
    return version
  }
}
