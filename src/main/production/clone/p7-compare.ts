// P7 — Compare, honestly (spec §2 P7, §3): matched frames side by side at the same moments, measured curves, the review
// agent's defects, a blind « same channel? » judge scoring each axis with its defects. Everything is SAVED: a comparison
// that is not saved did not happen. Chantier D owns it.
import { MIN_FRAME_PAIRS, REQUIRED_CURVES, Round, blindItems, verdictProblems, type Corpus, type StyleDefinition, type VideoAnalysis } from '../../../shared/clone'
import type { PhaseContext } from './context'

/** The contact sheet a real frames service writes in the round folder (every pair, reference beside ours). */
export const CONTACT_SHEET = 'contact-sheet.jpg'
import { SIDE_BY_SIDE_FILE } from './compare/film'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

export async function runP7(ctx: PhaseContext, round: Round, corpus: Corpus, analyses: readonly VideoAnalysis[], def: StyleDefinition): Promise<Round> {
  const dir = ctx.store.folder(`p7-round-${String(round.n).padStart(2, '0')}`)
  const refVideo = corpus.videos.find((v) => v.id === round.production.passage.videoId)!
  const refAnalysis = analyses.find((a) => a.videoId === refVideo.id)!
  const pairs = await ctx.services.frames.matched(refVideo, round.production, dir)
  const curves = await ctx.services.curves.compare(refAnalysis, round.production)
  const defects = await ctx.services.review.defects(round.production, def)
  const p = round.production.passage
  const anon = blindItems(pairs, `${refVideo.url}#t=${p.fromS},${p.toS}`, round.production.videoPath, round.n)
  let blind
  try {
    blind = await ctx.services.judge.blind(anon.items, dir)
  } catch (e) {
    // unusable answers were still paid: the ledger keeps them before the round fails
    const paid = (e as { costUsd?: unknown }).costUsd
    if (typeof paid === 'number' && paid > 0) ctx.spend({ usd: paid, seconds: 0, what: `p7 round ${round.n} blind judge (no usable verdict)` })
    throw e
  }
  if (blind.costUsd) ctx.spend({ usd: blind.costUsd, seconds: 0, what: `p7 round ${round.n} blind judge` })
  const sheet = `${dir.rel}/comparison.json`
  const contact = `${dir.rel}/${CONTACT_SHEET}`
  const contactSheet = ctx.exists(contact) ? contact : undefined
  const filmRel = `${dir.rel}/${SIDE_BY_SIDE_FILE}`
  const sideBySideVideo = ctx.exists(filmRel) ? filmRel : undefined
  ctx.store.save(sheet, { round: round.n, passage: p, pairs, contactSheet: contactSheet ?? null, sideBySideVideo: sideBySideVideo ?? null, curves, defects, items: anon.items, blindKey: anon.key, verdict: blind })
  ctx.decide('p7', `round ${round.n}: same channel ${blind.sameChannel}`, blind.scores.map((s) => `${s.axis} ${s.score}`).join(', '))
  return { ...round, stage: 'compared', comparison: { pairs, blindKey: anon.key, curves, defects, verdict: blind, sheet, ...(contactSheet ? { contactSheet } : {}), ...(sideBySideVideo ? { sideBySideVideo } : {}) } }
}

/** Refuses a round without a saved comparison: fewer than MIN_FRAME_PAIRS matched pairs, a frame or the sheet missing on
 *  disk, an axis not scored or scored without its defects, a required curve missing, pairs outside the passage. */
export function checkP7(round: Round, exists: (rel: string) => boolean): ExitCheck {
  const p = schemaProblems(Round, round)
  if (p.length) return verdict(p)
  const c = round.comparison
  if (!c) return verdict([`round ${round.n}: no comparison — a comparison not saved did not happen`])
  if (c.pairs.length < MIN_FRAME_PAIRS) p.push(`round ${round.n}: ${c.pairs.length} frame pairs, needs ${MIN_FRAME_PAIRS}`)
  if (!exists(c.sheet)) p.push(`round ${round.n}: comparison sheet ${c.sheet} not saved`)
  for (const pair of c.pairs) for (const f of [pair.reference, pair.ours, pair.sideBySide]) if (!exists(f)) p.push(`round ${round.n}: frame ${f} not saved`)
  if (c.sideBySideVideo && !exists(c.sideBySideVideo)) p.push(`round ${round.n}: side-by-side film ${c.sideBySideVideo} not saved`)
  if (c.contactSheet && !exists(c.contactSheet)) p.push(`round ${round.n}: contact sheet ${c.contactSheet} not saved`)
  for (const x of c.curves) if (!Number.isFinite(x.distance)) p.push(`round ${round.n}: curve ${x.name} has no distance`)
  p.push(...verdictProblems(`round ${round.n}`, c.verdict, c.blindKey))
  for (const name of REQUIRED_CURVES) if (!c.curves.some((x) => x.name === name)) p.push(`round ${round.n}: curve ${name} not compared`)
  const { fromS, toS } = round.production.passage
  for (const pair of c.pairs) if (pair.atS < fromS || pair.atS > toS) p.push(`round ${round.n}: frame pair at ${pair.atS}s is outside the passage`)
  return verdict(p)
}
