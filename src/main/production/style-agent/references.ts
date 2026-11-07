// The references of a style study (production-15): 1 to 5 public YouTube links (a video, or a channel whose two most viewed
// videos of its best-viewed format stand for it, insight.ts), measured by the eyes through Atelier Cloud (`channelData`,
// `analyseVideo`: read-only, never a write to YouTube). Only the first minutes of each video are watched (`WATCH_MIN`), which is
// what the measures need and keeps the cost to a few credits. Without Atelier Cloud the eyes' demonstration measures stand in,
// marked `demo`. A channel read but whose videos the eyes could not watch keeps its insight (formats, reach): the study goes on
// from it and the owner's words, and the problem is said in plain French (never a provider's name or an HTTP code).
import { createHash } from 'node:crypto'
import type { VideoMeasure } from '../../../engine/technologies/fit'
import { baseForReferences } from '../../../engine/technologies/style-propose'
import { isYoutubeUrl } from '../../../shared/cloud-api'
import { STYLE_MAX_LINKS, type ChannelFormatId, type ChannelInsightView } from '../../../shared/style-agent'
import { logDigest } from '../../../shared/shot-log'
import { withWholeLog } from '../../eyes/refine'
import type { AnalysisResult } from '../../../shared/video-analysis'
import type { ChannelIntelPort } from '../../eyes/port'
import type { VideoMeta, YoutubeMetaPort } from '../../eyes/youtube-meta'
import { measureVideo } from '../estimates/measure'
import { channelInsight, formatOf, mixedStyles, videosToMeasure } from './insight'

/** Minutes of each reference video the eyes watch. */
export const WATCH_MIN = 5
/** Videos of a channel link the eyes measure (the most viewed of its best-viewed format). */
export const VIDEOS_PER_CHANNEL = 2

export interface ParsedLink {
  url: string
  kind: 'video' | 'channel'
}

/** A video (`watch?v=`, `youtu.be/`, `shorts/`) or a channel (`@handle`, `channel/`, `c/`, `user/`) link, else null. */
export function parseLink(raw: string): ParsedLink | null {
  const value = raw.trim()
  if (!isYoutubeUrl(value)) return null
  const u = new URL(value)
  const path = u.pathname.replace(/\/+$/, '')
  if (u.hostname.toLowerCase() === 'youtu.be') return /^\/[\w-]{6,}$/.test(path) ? { url: value, kind: 'video' } : null
  if (path === '/watch' && u.searchParams.get('v')) return { url: value, kind: 'video' }
  if (/^\/shorts\/[\w-]{6,}$/.test(path)) return { url: value, kind: 'video' }
  // a handle may carry accents (« @lemondedécrypté-p5l »): the URL's path holds them percent-encoded
  if (/^\/(@[\w.%-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(\/(videos|featured|shorts))?$/.test(path)) return { url: value, kind: 'channel' }
  return null
}

/** The pasted links, checked: 1 to 5 YouTube videos or channels, each once. */
export function checkLinks(raw: unknown): ParsedLink[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/) : []
  const texts = list.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
  if (texts.length === 0) throw new Error('Colle au moins un lien YouTube (une vidéo ou une chaîne).')
  if (texts.length > STYLE_MAX_LINKS) throw new Error(`${STYLE_MAX_LINKS} liens au plus.`)
  const out: ParsedLink[] = []
  for (const t of texts) {
    const p = parseLink(t)
    if (!p) throw new Error(`Ce n’est pas un lien de vidéo ou de chaîne YouTube : ${t.slice(0, 120)}`)
    if (!out.some((o) => o.url === p.url)) out.push(p)
  }
  return out
}

export interface MeasuredReference {
  url: string
  kind: 'video' | 'channel'
  title: string
  measures: VideoMeasure[]
  /** What the videos are about (the eyes' summaries), for the sample's narration. */
  subjects: string[]
  demo: boolean
  problem: string | null
  /** Minutes the eyes watched (billed). */
  watched: number
  /** Per video, plain French: read whole, or which part only and why (« watch a whole video »). */
  coverage?: string[]
  /** Per video read whole: the digest of its shot log (hook shot by shot, cadence curve) for the agent. */
  logs?: string[]
  /** A channel link: what its public numbers say (formats, reach); absent for a video link. */
  insight?: ChannelInsightView
  /** What the pages and the eyes say in words (titles, description, category, summary, shot types): read for the feasibility. */
  words?: string
  /** What the eyes did not watch (« les 5 premières minutes sur 47 »), null: whole. */
  unread?: string | null
  /** A video link taken for its channel's style: the video it came from. */
  fromVideo?: string
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`
const shortsUrl = (id: string): string => `https://www.youtube.com/shorts/${id}`

/** A channel's name from its link alone (« @MarketsofthePast » → « MarketsofthePast »), when its numbers cannot be read. */
export function titleOfLink(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)
    const h = seg[0] === 'channel' || seg[0] === 'c' || seg[0] === 'user' ? (seg[1] ?? '') : (seg[0] ?? '')
    return decodeURIComponent(h).replace(/^@/, '').slice(0, 80) || url
  } catch {
    return url.slice(0, 80)
  }
}

/** A problem as the owner reads it: what happened and what to do, never a provider's name, a key or an HTTP code. */
export function plainProblem(e: unknown): string {
  const raw = errText(e)
  if (/\b(401|403)\b|PERMISSION_DENIED|key is refused|cl[ée] (?:refus|invalide)/i.test(raw)) return 'les yeux d’Atelier ne peuvent pas regarder de vidéo en ce moment (service indisponible côté Atelier Cloud) : réessaie plus tard'
  if (/\bconflict\b|\b409\b/i.test(raw)) return 'Atelier Cloud a déjà refusé cette vidéo une fois : réessaie plus tard, ou avec une autre vidéo de la chaîne'
  if (/\b429\b|quota|rate limit/i.test(raw)) return 'les yeux d’Atelier sont saturés en ce moment : réessaie dans quelques minutes'
  if (/\b5\d\d\b|timeout|timed out|ECONN|fetch failed|network/i.test(raw)) return 'Atelier Cloud ne répond pas : vérifie ta connexion, puis réessaie'
  if (/cut at \d+ tokens|max(?:imum)? tokens|truncat/i.test(raw)) return 'la vidéo a été regardée mais sa lecture a été coupée : relance l’analyse, ou prends une vidéo plus courte de la chaîne'
  if (/private|unavailable|not found|introuvable|\b404\b/i.test(raw)) return 'vidéo privée, supprimée ou introuvable'
  return raw.replace(/\b(Gemini|OpenAI|Anthropic|fal|kie|Vertex)\b[^:]*:\s*/gi, '').replace(/^Le fournisseur a échoué\s*:\s*/i, '').slice(0, 200)
}

export interface MeasureOptions {
  /** The links are the owner's own channel (the verdict says « tes vidéos »). */
  own?: boolean
  /** Measure this format of a channel instead of its best-viewed one. */
  format?: ChannelFormatId
  /** The public pages read on the owner's machine (titles, length, channel, description; a channel's videos when the Cloud cannot). */
  meta?: YoutubeMetaPort
  /** A video link stands for its channel's style (« le style de sa chaîne »). */
  scope?: 'video' | 'channel'
}

const wordsOf = (m: VideoMeta): string => [m.title, m.channel ?? '', m.categories.join(' '), m.description].filter(Boolean).join('\n')
const minutesFr = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',')

function measured(url: string, title: string, durationS: number | null, analysis: AnalysisResult, demo: boolean): VideoMeasure {
  const m = measureVideo({ channelId: 0, sourceKey: 1, videoId: url, url, title, durationS, outlier: false, analysis, demo, analysedAt: '' })
  // only the first minutes were watched: without the video's own length, its length is unknown (never the window's)
  const shaped = /\/shorts\//.test(url) ? { ...m, vertical: true } : m
  return durationS === null ? { ...shaped, minutes: null } : shaped
}

/** Measures every link with the eyes; a link that fails is kept with its problem (the others still count). */
export async function measureReferences(links: readonly ParsedLink[], intel: ChannelIntelPort, signal: AbortSignal, o: MeasureOptions = {}): Promise<MeasuredReference[]> {
  const out: MeasuredReference[] = []
  for (const pasted of links) {
    let link = pasted
    const words: string[] = []
    const unread: string[] = []
    let videoMeta: VideoMeta | null = null
    if (pasted.kind === 'video' && o.meta) {
      videoMeta = await o.meta.video(pasted.url, signal)
      if (videoMeta) words.push(wordsOf(videoMeta))
      // « le style de sa chaîne » : the video's page names its channel, which is then read as a channel link
      if (o.scope === 'channel' && videoMeta?.channelUrl) link = { url: videoMeta.channelUrl, kind: 'channel' }
    }
    const ref: MeasuredReference = { url: link.url, kind: link.kind, title: link.url, measures: [], subjects: [], demo: false, problem: null, watched: 0, ...(link !== pasted ? { fromVideo: pasted.url } : {}) }
    try {
      const videos: { url: string; title: string; durationS: number | null }[] = []
      if (link.kind === 'channel') {
        const cloud = await intel.channelData(link.url, 12, signal, `Style : ${link.url.slice(0, 80)}`)
        // Atelier Cloud cannot read YouTube right now (its demonstration): the channel's public pages, read on this machine
        const local = cloud.demo && o.meta ? await o.meta.channel(link.url, 12, signal) : null
        const { data, demo } = local ? { data: local, demo: false } : cloud
        // a demonstration answer (Atelier Cloud cannot read YouTube right now) is not this channel: its numbers are never shown as
        // the channel's, and the channel keeps its own name (its handle), never « Chaîne de démonstration »
        ref.title = demo ? titleOfLink(link.url) : data.title
        ref.demo = demo
        if (!demo) {
          const insight = channelInsight(data, o.own === true)
          ref.insight = o.format && insight.formats.some((f) => f.id === o.format) ? { ...insight, best: o.format } : insight
        }
        for (const v of videosToMeasure(data.videos, ref.insight ?? channelInsight(data), VIDEOS_PER_CHANNEL)) {
          videos.push({ url: formatOf(v.durationS) === 'short' ? shortsUrl(v.id) : watchUrl(v.id), title: v.title, durationS: v.durationS || null })
        }
        // the titles say what the channel is about even when the eyes cannot watch (the agent reads them)
        if (!demo) ref.subjects.push(...data.videos.slice(0, 6).map((v) => v.title))
        if (!demo) words.push(data.title, ...data.videos.slice(0, 12).map((v) => v.title))
        if (videos.length === 0) throw new Error('aucune vidéo publique sur cette chaîne')
      } else videos.push({ url: link.url, title: videoMeta?.title ?? link.url, durationS: videoMeta?.durationS ?? null })
      for (const v of videos) {
        const minutes = Math.min(WATCH_MIN, Math.max(0.5, (v.durationS ?? WATCH_MIN * 60) / 60))
        const { analysis, demo } = await intel.analyseVideo(v.url, minutes, signal, `Style : ${v.title.slice(0, 60)}`)
        ref.watched += minutes
        ref.demo = ref.demo || demo
        // the whole video, densely, whenever it can be read; else the analysis says plainly it covers only the first minutes
        const whole = !demo && intel.watchWhole ? await intel.watchWhole(v.url, { title: v.title, durationS: v.durationS }, signal) : null
        const m = measured(v.url, v.title, v.durationS, whole ? withWholeLog(analysis, whole.log) : analysis, demo)
        ref.measures.push(whole && m.minutes === null ? { ...m, minutes: Math.round((whole.log.coverage.durationS / 60) * 10) / 10 } : m)
        ;(ref.coverage ??= []).push(whole ? whole.line : demo ? 'Démonstration : aucune vidéo lue.' : `Vidéo regardée sur ses ${minutes} premières minutes seulement : la lecture entière n’a pas été possible, le rythme et la structure ne valent que pour ce début.`)
        if (whole) (ref.logs ??= []).push(logDigest(whole.log))
        ref.subjects.splice(ref.measures.length - 1, 0, [analysis.hook.text, analysis.summary].filter(Boolean).join(' '))
        // the video's real title (its page), never the eyes' English description of it
        if (link.kind === 'video') ref.title = videoMeta?.title ?? (analysis.summary.split(/[.!?]/)[0]?.slice(0, 80) || link.url)
        if (!demo) words.push(analysis.summary, analysis.shotTypes.join(', '))
        if (!demo && v.durationS !== null && v.durationS > minutes * 60 + 30) unread.push(`${minutesFr(minutes)} premières minutes sur ${Math.round(v.durationS / 60)}`)
      }
      // two videos of one channel that ask for different bases: it has more than one style (the owner is told what is kept)
      if (ref.insight && !ref.demo && ref.measures.length >= 2 && mixedStyles(ref.measures.map((m) => baseForReferences([m]).baseId))) {
        ref.insight = { ...ref.insight, heterogeneous: true, lines: [...ref.insight.lines, 'Ses vidéos les plus vues n’ont pas toutes le même style : la pipeline suit ce qu’elles ont en commun ; dis-moi si tu veux en suivre une seule.'] }
      }
    } catch (e) {
      if (signal.aborted) throw e
      // a channel Atelier Cloud could not read for real: its demonstration videos are not the channel's, say what to do instead
      ref.problem = ref.demo && link.kind === 'channel' && ref.measures.length === 0 ? 'Atelier Cloud ne peut pas lire les chaînes YouTube en ce moment : colle plutôt les liens de 2 ou 3 de ses vidéos, ou réessaie plus tard' : plainProblem(e)
    }
    if (words.length > 0) ref.words = words.filter(Boolean).join('\n').slice(0, 4000)
    if (unread.length > 0) ref.unread = `J’ai regardé ${unread.join(', puis ')} : la suite (structure, fin, promos) n’est pas lue`
    out.push(ref)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ demonstration eyes

const hash = (s: string): number => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 6), 16)

/** Three demonstration styles (an avatar channel, a voice-over on stock, a fast avatar with captions), picked by the link. */
const DEMO_STYLES: readonly NonNullable<AnalysisResult['measures']>[] = [
  { presenterShare: 0.28, hookPresenterShare: 0.5, layouts: ['full', 'split'], pictures: { aiImage: 0.7, aiClip: 0.3, stock: 0, archive: 0, motion: 0 }, shotS: 4.2, look: 'photoreal', captions: 'none', labelsPerMinute: 1.2, wordsPerMinute: 178, offer: { atS: 95, durationS: 22, card: true } },
  { presenterShare: 0, hookPresenterShare: 0, layouts: [], pictures: { aiImage: 0.25, aiClip: 0.05, stock: 0.7, archive: 0, motion: 0 }, shotS: 6.5, look: 'stock', captions: 'sentences', labelsPerMinute: 0.5, wordsPerMinute: 150, offer: null },
  { presenterShare: 0.4, hookPresenterShare: 0.45, layouts: ['full'], pictures: { aiImage: 0.5, aiClip: 0.5, stock: 0, archive: 0, motion: 0 }, shotS: 3, look: 'photoreal', captions: 'words', labelsPerMinute: 2, wordsPerMinute: 195, offer: null }
]

/** The style the demonstration eyes give a link (the same link always gives the same style). */
export const demoStyleOf = (url: string): number => hash(url) % DEMO_STYLES.length

/** The eyes' demonstration when Atelier Cloud is not connected: fixed measures, nothing spent, every result marked `demo`. */
export function demoIntel(): ChannelIntelPort {
  return {
    connected: () => true,
    async channelData(url) {
      const n = hash(url)
      const videos = [0, 1, 2].map((i) => ({ id: `demo${(n + i).toString(36)}`, title: `Vidéo de démonstration ${i + 1}`, views: 10_000 * (3 - i), likes: null, comments: null, durationS: 720, publishedAt: '2026-10-01T00:00:00Z', thumbnailUrl: null }))
      return { data: { url, channelId: '', title: `Chaîne de démonstration ${(n % 90) + 10}`, subscribers: null, totalViews: null, videoCount: 3, videos, quotaUnits: 0 }, demo: true }
    },
    async analyseVideo(url, minutes) {
      const m = DEMO_STYLES[demoStyleOf(url)] as NonNullable<AnalysisResult['measures']>
      const total = Math.round(minutes * 60)
      const analysis: AnalysisResult = {
        summary: 'Une astuce de la maison expliquée pas à pas : pourquoi on se trompe, puis la bonne méthode et ce qu’elle change au quotidien.',
        hook: { text: 'Presque tout le monde fait cette erreur sans le savoir.', endsAtS: 12, technique: 'promise' },
        structure: [
          { fromS: 0, toS: 12, kind: 'hook', summary: 'L’erreur courante.' },
          { fromS: 12, toS: total, kind: 'body', summary: 'La méthode, étape par étape.' }
        ],
        pacing: { cutsPerMinute: Math.round(60 / m.shotS), tempo: 'medium', notes: 'Démonstration.' },
        shotTypes: m.presenterShare > 0 ? ['talking head', 'ai image', 'ai clip'] : ['stock footage', 'ai image'],
        onScreenText: [],
        music: { present: true, mood: 'calme', notes: '' },
        callsToAction: [],
        measures: m
      }
      return { analysis, demo: true }
    }
  }
}
