// P1 — Corpus (spec §2 P1): the asked video alone, or a channel's latest and best performing videos, enough to see the
// invariants and the variations; each with why it was chosen. A mix or inspiration brief reads EVERY reference (each
// video tagged with its reference). Chantier A owns it.
import { Corpus, MIN_CHANNEL_CORPUS, type Brief, type CorpusVideo } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'
import type { ChannelVideo } from './services'

export const CORPUS_LATEST = 3
export const CORPUS_TOP = 2
/** A video shorter than this is short-form (a Short, a trailer): another format than a long-form channel's. */
export const SHORT_FORM_S = 180

const isShort = (v: ChannelVideo): boolean => v.durationS !== null && v.durationS > 0 && v.durationS < SHORT_FORM_S

/** The channel's name from its link (`…/@Finary` → `Finary`), null when the link has no handle. */
export function channelNameOf(url: string): string | null {
  const m = /youtube\.com\/(?:@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i.exec(url)
  return m ? decodeURIComponent(m[1] ?? m[2] ?? m[3]!) : null
}

export async function runP1(ctx: PhaseContext, brief: Brief): Promise<Corpus> {
  const videos: CorpusVideo[] = []
  let channelVideoCount: number | null = null
  let channelName: string | null = null
  const multi = brief.references.length > 1
  for (const [reference, ref] of brief.references.entries()) {
    const tag = multi ? { reference } : {}
    if (ref.kind === 'video') {
      videos.push({ id: `v${videos.length + 1}`, url: ref.url, title: '', publishedAt: null, views: null, durationS: null, why: 'asked', note: multi ? `reference ${reference + 1}` : '', ...tag })
      continue
    }
    const all = await ctx.services.channel.videos(ref.url)
    const picked = pickCorpus(all)
    channelVideoCount = (channelVideoCount ?? 0) + all.length
    channelName ??= channelNameOf(ref.url)
    for (const v of picked) videos.push({ ...v, id: `v${videos.length + 1}`, ...tag })
    ctx.decide('p1', `${picked.length} videos of ${all.length} from ${ref.url}`, picked.map((v) => `${v.why}: ${v.note}`).join(' | '))
  }
  const mode = videos.every((v) => v.why === 'asked') && videos.length === 1 ? 'single' : 'channel'
  return { ...artefactHead(ctx, 'corpus'), mode, channelVideoCount: mode === 'single' ? null : channelVideoCount, channelName: mode === 'single' ? null : channelName, videos }
}

/**
 * The latest videos then the most viewed ones not already taken, in the channel's main format (long or short form), filled
 * up to MIN_CHANNEL_CORPUS with the next latest; plus ONE video of the other format when the channel also publishes it
 * (a style variant: the synthesis sees it and keeps it apart). A listing without dates keeps its own order (newest first).
 * Pure.
 */
export function pickCorpus(all: readonly ChannelVideo[]): CorpusVideo[] {
  const shorts = all.filter(isShort)
  // long form is the main format as soon as there are enough long videos to see the style (Shorts and trailers are
  // listed beside them on most channels and are not what a clone makes)
  const mainIsShort = all.length - shorts.length < Math.min(MIN_CHANNEL_CORPUS, shorts.length) && shorts.length > all.length / 2
  const main = all.filter((v) => isShort(v) === mainIsShort)
  const other = all.filter((v) => isShort(v) !== mainIsShort)
  const byDate = [...main].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  const byViews = [...main].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const out: CorpusVideo[] = []
  const add = (v: ChannelVideo, why: CorpusVideo['why'], note: string): void => {
    if (out.some((o) => o.url === v.url)) return
    out.push({ id: `v${out.length + 1}`, url: v.url, title: v.title, publishedAt: v.publishedAt, views: v.views, durationS: v.durationS, why, note })
  }
  const rankOf = (v: ChannelVideo): number => byDate.indexOf(v) + 1
  byDate.slice(0, CORPUS_LATEST).forEach((v) => add(v, 'latest', `latest #${rankOf(v)}`))
  for (const v of byViews) {
    if (out.filter((o) => o.why === 'top').length >= CORPUS_TOP) break
    add(v, 'top', `${v.views ?? 0} views, #${byViews.indexOf(v) + 1} by views`)
  }
  for (const v of byDate) { if (out.length >= MIN_CHANNEL_CORPUS) break; add(v, 'latest', `latest #${rankOf(v)} (fills the corpus)`) }
  // one video of the other format (a variant the synthesis keeps apart), more when the main format has fewer than 5
  const variants = [...other].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const want = Math.max(1, MIN_CHANNEL_CORPUS - out.length)
  for (const v of variants.slice(0, want)) add(v, 'style-variant', `${mainIsShort ? 'long' : 'short'}-form video of a ${mainIsShort ? 'short' : 'long'}-form channel (${other.length} such)`)
  return out
}

/** Refuses a corpus too small to see the style (unless the channel has fewer videos), or with duplicate ids. */
export function checkP1(corpus: Corpus, brief: Brief): ExitCheck {
  const p = schemaProblems(Corpus, corpus)
  if (p.length) return verdict(p)
  const ids = new Set(corpus.videos.map((v) => v.id))
  if (ids.size !== corpus.videos.length) p.push('corpus video ids are not unique')
  const urls = new Set(corpus.videos.map((v) => v.url))
  if (urls.size !== corpus.videos.length) p.push('a video is twice in the corpus')
  const single = brief.references.length === 1 && brief.references[0]?.kind === 'video'
  if (single && (corpus.mode !== 'single' || corpus.videos.length !== 1)) p.push('a single video was asked: the corpus is that video only')
  if (brief.references.length > 1) {
    brief.references.forEach((r, i) => { if (!corpus.videos.some((v) => v.reference === i)) p.push(`reference ${i + 1} (${r.url}) has no video in the corpus`) })
  }
  if (corpus.mode === 'channel') {
    const channels = brief.references.filter((r) => r.kind === 'channel').length
    const available = corpus.channelVideoCount ?? 0
    const needed = Math.min(MIN_CHANNEL_CORPUS * Math.max(1, channels), available)
    const fromChannels = corpus.videos.filter((v) => v.why !== 'asked').length
    if (fromChannels < needed) p.push(`channel corpus has ${fromChannels} videos, needs ${needed}`)
  }
  return verdict(p)
}
