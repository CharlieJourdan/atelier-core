// Outlier detection on a channel's videos (lot "eyes"): a video is an outlier when its views are far above what the channel's
// other videos of about the same age get. Pure functions, no clock of their own (the caller gives `now`), shared by the main
// process (competitor outliers, topic inspiration) and the tests. The numbers come from the YouTube Data API through the Cloud
// (`channelData`): views, publish date, duration, likes, comments.
//
// Method. Views grow with age, so a video is compared with its neighbours IN AGE, not with the whole channel: the baseline of a
// video is the median views of the `neighbours` other videos closest to it in age (at least 3 of them; else the median of all the
// others; else none). The score is views / baseline. A video younger than `minAgeDays` is not judged (its views have not settled).
// An outlier has a score of at least `threshold` and at least `minViews` views (a channel of a hundred viewers has no outliers).
// Limit: the very freshest videos are compared with older ones (they have no younger neighbours), so their score reads low and an
// outlier among them shows up only once it has aged a little: the method errs on the side of not crying wolf.

export interface VideoStat {
  id: string
  title: string
  views: number
  /** ISO date-time. */
  publishedAt: string
  durationS?: number
  likes?: number | null
  comments?: number | null
}

export interface OutlierOptions {
  /** The instant the ages are counted from, in ms. */
  now: number
  minAgeDays?: number
  neighbours?: number
  threshold?: number
  minViews?: number
}

export const OUTLIER_DEFAULTS = { minAgeDays: 2, neighbours: 9, threshold: 2, minViews: 500 } as const
const MIN_NEIGHBOURS = 3
const DAY_MS = 86_400_000

export interface ScoredVideo extends VideoStat {
  ageDays: number
  /** Median views of the comparable videos; null when there are too few to compare. */
  baseline: number | null
  /** views / baseline; null when the video is too young or has no baseline. */
  score: number | null
  outlier: boolean
  tooYoung: boolean
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/** Whole and fractional days since the video was published (0 when the date is unreadable or in the future). */
export function ageDaysOf(publishedAt: string, now: number): number {
  const at = Date.parse(publishedAt)
  return Number.isFinite(at) ? Math.max(0, (now - at) / DAY_MS) : 0
}

export function scoreVideos(videos: readonly VideoStat[], options: OutlierOptions): ScoredVideo[] {
  const o = { ...OUTLIER_DEFAULTS, ...options }
  const aged = videos.map((v) => ({ v, age: ageDaysOf(v.publishedAt, o.now) }))
  const settled = aged.filter((a) => a.age >= o.minAgeDays)
  return aged.map(({ v, age }) => {
    const tooYoung = age < o.minAgeDays
    let baseline: number | null = null
    if (!tooYoung) {
      const others = settled.filter((a) => a.v.id !== v.id)
      const near = [...others].sort((a, b) => Math.abs(a.age - age) - Math.abs(b.age - age)).slice(0, o.neighbours)
      if (near.length >= MIN_NEIGHBOURS) baseline = median(near.map((a) => a.v.views))
    }
    const score = baseline !== null && baseline > 0 ? v.views / baseline : null
    return { ...v, ageDays: age, baseline, score, tooYoung, outlier: score !== null && score >= o.threshold && v.views >= o.minViews }
  })
}

/** The outliers among the videos, the strongest first. */
export function outliersOf(videos: readonly VideoStat[], options: OutlierOptions): ScoredVideo[] {
  return scoreVideos(videos, options)
    .filter((v) => v.outlier)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

const locale = (lang: 'fr' | 'en'): string => (lang === 'fr' ? 'fr-FR' : 'en-US')
const fmt = (n: number, lang: 'fr' | 'en'): string => Math.round(n).toLocaleString(locale(lang))
/** A ratio with at most one decimal, in the language's own notation (5,6 in French, 5.6 in English). */
const ratio1 = (n: number, lang: 'fr' | 'en'): string => n.toLocaleString(locale(lang), { maximumFractionDigits: 1 })

/**
 * Why an outlier worked, from the numbers alone (never invented): how far above its comparable videos it is, how its engagement
 * and its length compare with the channel's median. The text feeds the ideas prompt and the topic brief, in the prompt's language.
 */
export function whyItWorked(video: ScoredVideo, channel: readonly VideoStat[], lang: 'fr' | 'en' = 'fr'): string {
  if (video.score === null || video.baseline === null) return ''
  const parts: string[] =
    lang === 'fr'
      ? [`${ratio1(video.score, lang)} fois les vues des vidéos de même âge de la chaîne (${fmt(video.views, lang)} vues contre ${fmt(video.baseline, lang)})`]
      : [`${ratio1(video.score, lang)}x the views of the channel's videos of the same age (${fmt(video.views, lang)} views against ${fmt(video.baseline, lang)})`]
  const rate = (v: VideoStat): number | null => (v.likes !== null && v.likes !== undefined && v.views > 0 ? v.likes / v.views : null)
  const rates = channel.map(rate).filter((r): r is number => r !== null)
  const own = rate(video)
  if (own !== null && rates.length >= MIN_NEIGHBOURS) {
    const ratio = own / Math.max(median(rates), 1e-9)
    if (ratio >= 1.3) parts.push(lang === 'fr' ? `plus de mentions « j’aime » que d’habitude (${ratio1(ratio, lang)} fois)` : `more likes than usual (${ratio1(ratio, lang)}x)`)
  }
  const lengths = channel.map((v) => v.durationS ?? 0).filter((d) => d > 0)
  if ((video.durationS ?? 0) > 0 && lengths.length >= MIN_NEIGHBOURS) {
    const ratio = (video.durationS as number) / median(lengths)
    if (ratio >= 1.4) parts.push(lang === 'fr' ? 'plus longue que d’habitude' : 'longer than usual')
    else if (ratio <= 0.7) parts.push(lang === 'fr' ? 'plus courte que d’habitude' : 'shorter than usual')
  }
  return parts.join(lang === 'fr' ? ' ; ' : '; ')
}
