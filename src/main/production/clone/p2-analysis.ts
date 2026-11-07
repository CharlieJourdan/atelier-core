// P2 — Full analysis of every corpus video, then the cross-video synthesis (spec §2 P2). Whole video, never a part
// passed off as the whole; every number with its evidence. Chantier A owns it (eyes 0085 behind services.eyes).
import { z } from 'zod'
import { Synthesis, VideoAnalysis, atPath, isSourced, type Brief, type Corpus, type CorpusVideo, type Evidence } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { definitionDefaults } from './definition-defaults'
import { schemaProblems, verdict, ExitRefused, type ExitCheck } from './exit-check'
import { ARTEFACTS } from './store'

/** The decision P2 logs when the channel holds several styles: `style picked <id>: named|dominant` (never a pause). */
export const STYLE_PICKED = 'style picked'

/** A video counts as read whole when at least this share of it was read. */
export const WHOLE_READ_SHARE = 0.98
/** A channel listing gives whole seconds (a Short's sometimes rounded): durations agree within this many seconds. */
export const LISTED_DURATION_SLACK_S = 3
/** Shots must reach the end of what was read, within this slack (seconds). */
export const SHOTS_END_SLACK_S = 2

/** Free disk (GB) under which P2 stops before downloading another video (spec §3). */
export const P2_DISK_FLOOR_GB = 15

/** An eyes service that can price a video before reading it (the real one; the contract's fake cannot). */
export interface QuotingEyes { quoteUsd(video: CorpusVideo): Promise<number> }
const quoting = (eyes: unknown): eyes is QuotingEyes => typeof (eyes as Partial<QuotingEyes>).quoteUsd === 'function'

/** Analyse every corpus video not yet saved (resumable), then synthesise. Before each video: the disk floor and, when the
 *  eyes can price it, the quote against the budget left (never spend before quoting). */
/** A corpus video whose analysis did not pass its check (moteur-pov-2): kept as evidence, left out of the synthesis. */
export const SetAside = z.object({ videoId: z.string().min(1), problems: z.array(z.string()) })
export const setAsideName = (videoId: string): string => `p2-set-aside-${videoId}.json`
/** The share of the corpus that must stay analysed when videos are set aside (below it, the clone stops as before). */
export const P2_KEEP_SHARE = 0.6

/** The corpus videos set aside by an earlier P2 (their files in the clone folder). */
export function setAsideIds(ctx: Pick<PhaseContext, 'store'>, corpus: Corpus): string[] {
  return corpus.videos.filter((v) => ctx.store.load(setAsideName(v.id), SetAside)).map((v) => v.id)
}

/** The videos P2 left out: set aside for good, or not read because the platform refused the download (no analysis saved). */
export function leftOutIds(ctx: Pick<PhaseContext, 'store'>, corpus: Corpus): string[] {
  const aside = setAsideIds(ctx, corpus)
  return [...aside, ...corpus.videos.filter((v) => !aside.includes(v.id) && !ctx.store.has(ARTEFACTS.analysis(v.id))).map((v) => v.id)]
}

/** The corpus without the videos set aside: what every later phase works from. Pure. */
/** A download the platform refused (YouTube's bot check, a rate limit): passing, retried on resume. */
export const DOWNLOAD_REFUSED = /confirm you.?re not a bot|Sign in to confirm|HTTP Error 429|Too Many Requests/i
export const DOWNLOADS_REFUSED_WHY = 'the platform refused the downloads (bot check or rate limit): the analysis waits; resume later'

export const keptCorpus = (corpus: Corpus, aside: readonly string[]): Corpus => ({ ...corpus, videos: corpus.videos.filter((v) => !aside.includes(v.id)) })

export async function runP2(ctx: PhaseContext, corpus: Corpus, brief: Brief): Promise<{ analyses: VideoAnalysis[]; synthesis: Synthesis }> {
  const analyses: VideoAnalysis[] = []
  const refused: string[] = []
  const aside = setAsideIds(ctx, corpus)
  for (const video of corpus.videos) {
    if (aside.includes(video.id)) continue
    const name = ARTEFACTS.analysis(video.id)
    let a = ctx.store.load(name, VideoAnalysis)
    if (!a) {
      const free = await ctx.services.disk.freeGb()
      if (free < P2_DISK_FLOOR_GB) {
        ctx.decide('p2', 'stop', `${free} GB free before ${video.id}`)
        throw new ExitRefused(`p2 ${video.id}`, [`disk under the floor: ${free} GB free (needs ${P2_DISK_FLOOR_GB})`])
      }
      if (quoting(ctx.services.eyes)) {
        const quote = await ctx.services.eyes.quoteUsd(video)
        if (quote > ctx.remainingUsd()) {
          ctx.decide('p2', 'stop', `${video.id} quoted ${quote.toFixed(2)} $, ${ctx.remainingUsd().toFixed(2)} $ left`)
          throw new ExitRefused(`p2 ${video.id}`, [`the analysis of ${video.id} is quoted ${quote.toFixed(2)} $ and only ${ctx.remainingUsd().toFixed(2)} $ are left`])
        }
      }
      try {
        a = await ctx.services.eyes.analyse(video, ctx.store.folder(`p2-${video.id}`))
      } catch (e) {
        // one video the eyes could not read (a cost cap, a download refused, a model error) is set aside like a failed check:
        // it never aborts P2; only a corpus where no video is left analysed fails (after the loop)
        const why = e instanceof Error ? e.message : String(e)
        const paid = (e as { costUsd?: unknown }).costUsd
        if (typeof paid === 'number' && paid > 0) ctx.spend({ usd: paid, seconds: 0, what: `p2 analyse ${video.id} (failed)` })
        const problems = [`${video.id}: the analysis failed: ${why.slice(0, 400)}`]
        // a download the platform refused (a bot check, a rate limit) is a passing blocker, not this video's fault: it is
        // not set aside for good, a resume tries it again (the reverse proofs of 2026-11-06: 4 of 5 Markets videos refused)
        if (DOWNLOAD_REFUSED.test(why)) {
          refused.push(video.id)
          ctx.decide('p2', `${video.id} not read now`, `${problems[0]} — left out (a resume tries it again while too few videos are read)`)
          continue
        }
        ctx.store.save(setAsideName(video.id), { videoId: video.id, problems })
        aside.push(video.id)
        ctx.decide('p2', `${video.id} set aside`, `${problems[0]} — the synthesis uses the other videos`)
        continue
      }
      ctx.spend({ usd: a.costUsd, seconds: 0, what: `p2 analyse ${video.id}` })
      const check = checkP2Video(a)
      const frames = framesOnDisk(a, ctx.exists)
      if (!check.ok || !frames.ok) {
        // one video's gap does not stop the clone: it is set aside (said, kept as evidence) while enough of the corpus stays
        const problems = [...check.problems, ...frames.problems]
        const left = corpus.videos.length - aside.length - 1
        if (left < Math.max(1, Math.ceil(corpus.videos.length * P2_KEEP_SHARE))) throw new ExitRefused(`p2 ${video.id}`, problems)
        ctx.store.save(setAsideName(video.id), { videoId: video.id, problems })
        aside.push(video.id)
        ctx.decide('p2', `${video.id} set aside`, `${problems.join('; ')} — the synthesis uses the ${left} other videos`)
        continue
      }
      ctx.store.save(name, a)
    }
    analyses.push(a)
  }
  // too few videos read because the platform refused the downloads: a pipeline is never built from one video of a channel
  // that has five; the analysis waits (resumable, nothing lost) instead of guessing the style from what little was read
  if (refused.length > 0 && analyses.length < Math.max(1, Math.ceil(corpus.videos.length * P2_KEEP_SHARE))) {
    ctx.decide('p2', 'stop', `${refused.length} of ${corpus.videos.length} downloads refused by the platform, ${analyses.length} video(s) read: too few for the style`)
    throw new ExitRefused('p2', [`${DOWNLOADS_REFUSED_WHY} (${refused.join(', ')} refused, ${analyses.length} of ${corpus.videos.length} read)`])
  }
  if (analyses.length === 0) {
    const why = corpus.videos.flatMap((v) => ctx.store.load(setAsideName(v.id), SetAside)?.problems ?? [])
    ctx.decide('p2', 'refused', `no corpus video could be analysed: ${why.join('; ')}`)
    throw new ExitRefused('p2', [`no corpus video could be analysed (${corpus.videos.length} tried): ${why.join('; ') || 'nothing analysed'}`])
  }
  let body = await ctx.services.synthesiser.synthesise(analyses, brief)
  if (body.styles.length > 1) body = await pickStyle(ctx, analyses, brief, body, corpus)
  return { analyses, synthesis: { ...artefactHead(ctx, 'synthesis'), ...body } }
}

type SynthesisBody = Awaited<ReturnType<PhaseContext['services']['synthesiser']['synthesise']>>

/**
 * Several styles on the channel never pause the clone (decision 0110): the one the user's words name (`brief.style`, matched
 * by the synthesis), else the dominant one — the style holding the most videos (the first on a tie) — made again as the
 * chosen style so its constants come from its own videos. The pick and why are logged (the progress shows them).
 */
export async function pickStyle(ctx: PhaseContext, analyses: readonly VideoAnalysis[], brief: Brief, body: SynthesisBody, corpus?: Corpus): Promise<SynthesisBody> {
  const list = body.styles.map((s) => `${s.id} « ${s.description} » (${s.videos.length} videos)`).join('; ')
  const named = body.chosenStyle ? body.styles.find((s) => s.id === body.chosenStyle) : undefined
  if (named) {
    const how = brief.style ? 'named' : 'dominant'
    ctx.decide('p2', `${STYLE_PICKED} ${named.id}: ${how}`, `${brief.style ? `the user's words « ${brief.style} » name it` : `it holds ${named.videos.length} of ${analyses.length} videos`}; styles found: ${list}`)
    return body
  }
  // the channel's best-performing videos weigh more than its latest ones (a trailer or a one-off reaction video among the
  // latest must not outvote the format its audience watches: Yarnhub, 2026-11-06): a top video counts 1.5
  const top = new Set((corpus?.videos ?? []).filter((v) => v.why === 'top').map((v) => v.id))
  const weight = (st: SynthesisBody['styles'][number]): number => st.videos.reduce((t, id) => t + (top.has(id) ? 1.5 : 1), 0)
  const dominant = body.styles.reduce((best, st) => (weight(st) > weight(best) ? st : best), body.styles[0]!)
  const unmatched = brief.style ? `the user's words « ${brief.style} » name none of them; ` : ''
  let again = await ctx.services.synthesiser.synthesise(analyses, { ...brief, style: dominant.id })
  // a synthesiser that ignores the pick still gets it (its constants are then the whole corpus's, said in the decision)
  const whole = again.chosenStyle !== dominant.id || !again.styles.some((s) => s.id === dominant.id)
  if (whole) again = { ...body, chosenStyle: dominant.id }
  ctx.decide('p2', `${STYLE_PICKED} ${dominant.id}: dominant`, `${unmatched}the dominant style holds ${dominant.videos.length} of ${analyses.length} videos (weight ${weight(dominant)}, a best-performing video counts 1.5)${whole ? ' (constants over the whole corpus: the synthesis could not narrow to it)' : ''}; styles found: ${list}`)
  return again
}

/** Refuses an analysis that covers part of a video without saying so, or whose shots stop before what was read. */
export function checkP2Video(a: VideoAnalysis): ExitCheck {
  const p = schemaProblems(VideoAnalysis, a)
  if (p.length) return verdict(p)
  const c = a.coverage
  const readWhole = c.readS >= c.durationS * WHOLE_READ_SHARE && c.gaps.length === 0 && c.unreadAxes.length === 0
  if (c.complete && !readWhole) p.push(`${a.videoId}: marked complete but read ${c.readS}/${c.durationS}s with ${c.gaps.length} gaps and ${c.unreadAxes.length} unread axes`)
  if (!c.complete && !(c.said ?? '').trim()) p.push(`${a.videoId}: read only partly without saying so`)
  if (!c.complete && c.gaps.length === 0 && c.unreadAxes.length === 0 && c.readS >= c.durationS * WHOLE_READ_SHARE) p.push(`${a.videoId}: marked partial without saying what is missing`)
  const last = a.shots[a.shots.length - 1]
  if (last && last.startS + last.lengthS < c.readS - SHOTS_END_SLACK_S) p.push(`${a.videoId}: the shot log stops at ${last.startS + last.lengthS}s but ${c.readS}s were read`)
  a.shots.forEach((s, i) => { if (s.n !== i + 1) p.push(`${a.videoId}: shot ${i + 1} is numbered ${s.n}`) })
  if (a.presenter.kind !== 'none' && !a.presenter.identity) p.push(`${a.videoId}: a ${a.presenter.kind} presenter without identity descriptors`)
  if (a.presenter.kind !== 'none' && a.presenter.angles.length === 0) p.push(`${a.videoId}: a presenter without his angles`)
  const hook = a.parts.find((x) => x.part === 'hook')
  if (!hook) p.push(`${a.videoId}: no hook part`)
  else if (!a.coverage.unreadAxes.includes('frames') && !a.denseFrames.some((d) => d.atS >= hook.fromS && d.atS <= hook.toS)) p.push(`${a.videoId}: no dense frame on the hook`)
  for (const [i, part] of a.parts.entries()) if (part.toS <= part.fromS) p.push(`${a.videoId}: part ${i + 1} (${part.part}) is empty`)
  for (const [path, ev] of measuredEvidence(a)) if (!ev.some((e) => e.atS !== undefined || e.fromS !== undefined || e.frames.length > 0)) p.push(`${a.videoId}: ${path} has only a note as evidence (needs frames or times)`)
  return verdict(p)
}

/** Every MeasuredNumber of an analysis with its evidence (`voice.wordsPerMinute` → [...]). */
export function measuredEvidence(tree: unknown, prefix = ''): [string, Evidence[]][] {
  if (tree === null || typeof tree !== 'object') return []
  const o = tree as Record<string, unknown>
  if (Array.isArray(o['evidence']) && 'value' in o && typeof o['value'] === 'number') return [[prefix, o['evidence'] as Evidence[]]]
  return Object.entries(o).flatMap(([k, v]) => (k === 'shots' || k === 'denseFrames' ? [] : measuredEvidence(v, prefix ? `${prefix}.${k}` : k)))
}

/**
 * The evidence frames are on disk, and the dense frames cover every part change (+-2 s). Always applied: the real eyes
 * and the contract's fakes both write the frames they name.
 */
export function framesOnDisk(a: VideoAnalysis, exists: (rel: string) => boolean): ExitCheck {
  const p: string[] = []
  const missing = [...a.shots.flatMap((s) => s.frames), ...a.denseFrames.map((d) => d.path)].filter((f) => !exists(f))
  if (missing.length) p.push(`${a.videoId}: ${missing.length} evidence frames are missing on disk (first: ${missing[0]})`)
  for (const part of a.coverage.unreadAxes.includes('frames') ? [] : a.parts.slice(1)) {
    const near = a.denseFrames.filter((d) => Math.abs(d.atS - part.fromS) <= 2).length
    if (near < 4) p.push(`${a.videoId}: only ${near} dense frames around the ${part.part} change at ${part.fromS}s`)
  }
  return verdict(p)
}

/** Refuses a synthesis that misses a corpus video, leaves several styles unresolved, or names a field the definition lacks. */
export function checkP2(analyses: readonly VideoAnalysis[], synthesis: Synthesis, listed: Corpus, aside: readonly string[] = []): ExitCheck {
  const p = schemaProblems(Synthesis, synthesis)
  if (p.length) return verdict(p)
  // a video set aside (its analysis failed its own check, said in the decisions) is not missing
  const corpus = keptCorpus(listed, aside)
  for (const v of corpus.videos) if (!analyses.some((a) => a.videoId === v.id)) p.push(`video ${v.id} was not analysed`)
  for (const a of analyses) {
    p.push(...checkP2Video(a).problems)
    const listed = corpus.videos.find((v) => v.id === a.videoId)?.durationS
    if (listed && Math.abs(a.coverage.durationS - listed) > Math.max(listed * (1 - WHOLE_READ_SHARE), LISTED_DURATION_SLACK_S)) p.push(`${a.videoId}: analysis says ${a.coverage.durationS}s, the video lasts ${listed}s`)
  }
  if (synthesis.videoCount !== corpus.videos.length) p.push(`synthesis counts ${synthesis.videoCount} videos, corpus has ${corpus.videos.length}`)
  if (synthesis.styles.length > 1 && !synthesis.chosenStyle) p.push(`several styles found and none chosen (P2 picks one by itself): ${synthesis.styles.map((s) => `${s.id} « ${s.description} » (${s.videos.join(', ')})`).join('; ')}`)
  if (synthesis.chosenStyle && !synthesis.styles.some((s) => s.id === synthesis.chosenStyle)) p.push(`chosen style ${synthesis.chosenStyle} is not one of the styles found`)
  for (const s of synthesis.styles) for (const v of s.videos) if (!analyses.some((a) => a.videoId === v)) p.push(`style ${s.id} names ${v}, which was not analysed`)
  for (const c of synthesis.constants) for (const v of c.videos) if (!analyses.some((a) => a.videoId === v)) p.push(`constant ${c.field} names ${v}, which was not analysed`)
  const defaults = definitionDefaults()
  for (const c of synthesis.constants) if (!isSourced(atPath(defaults, c.field))) p.push(`constant ${c.field} is not a Style Definition field`)
  return verdict(p)
}
