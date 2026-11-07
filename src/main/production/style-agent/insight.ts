// What a reference channel's public numbers say before any video is watched (parcours-utilisateur, Charlie 02/11: « si la chaîne
// mélange des formats, prendre celui qui fait le plus de vues », « dire clairement quand les vidéos ne sont pas ouf, et proposer une
// meilleure pipeline »). From `channelData` (the latest videos, their length and views, the subscribers): the formats the channel
// publishes (short, medium, long), whether it mixes them, the format whose videos are the most viewed (the one the eyes then
// measure), and an honest verdict on its videos' reach. Pure: no I/O; the verdict's words are French, for the owner.
import type { ChannelDataResult } from '../../../shared/cloud-api'
import type { ChannelFormatId, ChannelInsightView } from '../../../shared/style-agent'

/** A Short is 3 minutes at most (YouTube's own limit); a long video is 8 minutes or more. */
export const SHORT_MAX_S = 180
export const LONG_MIN_S = 480
/** A format counts in the mix when it holds at least this share of the latest videos. */
export const FORMAT_SHARE = 0.25
/** Under this median of views on the latest videos, the channel's videos do not take off. */
export const WEAK_MEDIAN_VIEWS = 1_000
/** Over this median, the channel works. */
export const STRONG_MEDIAN_VIEWS = 20_000

export const formatOf = (durationS: number): ChannelFormatId => (durationS <= SHORT_MAX_S ? 'short' : durationS >= LONG_MIN_S ? 'long' : 'medium')

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

const views = (n: number): string => new Intl.NumberFormat('fr-FR').format(Math.round(n))
const FORMAT_FR: Readonly<Record<ChannelFormatId, string>> = { short: 'Shorts', medium: 'vidéos moyennes (3 à 8 min)', long: 'vidéos longues' }

/** The channel's formats, its best-viewed one, and the verdict on its reach. */
export function channelInsight(data: Pick<ChannelDataResult, 'title' | 'subscribers' | 'videos'>, own = false): ChannelInsightView {
  const videos = data.videos.filter((v) => v.durationS > 0)
  const ids: ChannelFormatId[] = ['short', 'medium', 'long']
  const formats = ids
    .map((id) => {
      const of = videos.filter((v) => formatOf(v.durationS) === id)
      return { id, count: of.length, medianViews: median(of.map((v) => v.views)) }
    })
    .filter((f) => f.count > 0)
  const counted = formats.filter((f) => f.count >= Math.max(2, videos.length * FORMAT_SHARE))
  const heterogeneous = counted.length >= 2
  const best = [...(counted.length > 0 ? counted : formats)].sort((a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0))[0]?.id ?? null
  const medianViews = median(videos.map((v) => v.views))
  const lines: string[] = []
  if (heterogeneous && best) {
    const parts = counted.map((f) => `${f.count} ${FORMAT_FR[f.id]} (${views(f.medianViews ?? 0)} vues en médiane)`).join(', ')
    lines.push(`${own ? 'Ta chaîne' : 'Cette chaîne'} mélange plusieurs formats : ${parts}. Je pars des ${FORMAT_FR[best]}, ceux qui font le plus de vues.`)
  }
  let verdict: ChannelInsightView['verdict'] = 'unknown'
  if (medianViews !== null && videos.length >= 3) {
    const subs = data.subscribers
    // a channel whose latest videos reach under 2 % of its subscribers has stalled, whatever its size
    const stalled = subs !== null && subs >= 10_000 && medianViews < subs * 0.02
    verdict = medianViews < WEAK_MEDIAN_VIEWS || stalled ? 'weak' : medianViews >= STRONG_MEDIAN_VIEWS ? 'strong' : 'ok'
    const reach = `${views(medianViews)} vues en médiane sur ses ${videos.length} dernières vidéos${subs !== null ? ` (${views(subs)} abonnés)` : ''}`
    if (verdict === 'weak') {
      lines.push(
        own
          ? `Honnêtement, tes vidéos décollent peu : ${reach}. La copier à l’identique gardera ce résultat ; je te propose aussi des améliorations, en tête de liste.`
          : `Honnêtement, les vidéos de cette chaîne ne sont pas ouf : ${reach}. La copier telle quelle ne te servira pas beaucoup ; je te propose une pipeline meilleure, avec les améliorations en tête de liste.`
      )
    } else if (verdict === 'strong') lines.push(`${own ? 'Ta chaîne' : 'Cette chaîne'} marche : ${reach}.`)
    else lines.push(`${own ? 'Ta chaîne' : 'Cette chaîne'} : ${reach}.`)
  }
  return { title: data.title, videos: videos.length, formats, heterogeneous, best, medianViews, subscribers: data.subscribers, verdict, lines }
}

/** The videos the eyes should measure: the most viewed of the best format (a Short is measured as a Short). */
export function videosToMeasure<T extends { durationS: number; views: number }>(videos: readonly T[], insight: ChannelInsightView, n: number): T[] {
  const of = insight.best ? videos.filter((v) => v.durationS > 0 && formatOf(v.durationS) === insight.best) : []
  return [...(of.length > 0 ? of : videos)].sort((a, b) => b.views - a.views).slice(0, n)
}

/** Two measured videos of one channel that ask for different bases: the channel has more than one style. */
export function mixedStyles(bases: readonly string[]): boolean {
  return new Set(bases).size > 1
}
