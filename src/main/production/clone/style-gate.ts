// The free-first gate (controles-bloquants, decision 0102): before any PAID render — a P6 round on real engines, the P9 example —
// the engine renders a FREE demo of the current Style Definition (demo engines, 0 $), and the blind judge (a separate model call that
// never saw the work) compares it with the reference. Money is spent only when the judge says the STYLE is right on the axes a demo
// can show (layout, cadence, motion — the channel-styled cards are drawn for real —, captions); the axes a demo fakes (the template
// script, the stand-in pictures and their palette, the presenter's identity, the voice, the sound) are judged on paid renders. The demo's
// stand-ins are FOUND (decision 0109, `withFoundStandIns`): free stock photographs full frame, the presenter's photograph laid out
// as planned, so a channel made of pictures and a presenter shows its layout to the judge (drawn slides scored Finary's layout 10). A refused demo is improved for free: the improver fixes the cause in
// the definition from the demo's comparison and the demo is made again, `GATE_TRIES` times at most; then the clone stops before paying.
// Each gate is saved per definition version (`gate-vNN.json`, evidence in `gate-vNN/`): a resume never judges the same demo twice.
import { z } from 'zod'
import { BlindKey, BlindVerdict, Change, FramePair, blindItems, type CompareAxis, type Corpus, type PipelinePlan, type Round, type StyleDefinition, type VideoAnalysis } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { pickPassage } from './p6-reproduce'

/** What a demo render shows of a style (its script is a template; its pictures, presenter, voice and sound come from demo engines). */
export const GATE_AXES: readonly CompareAxis[] = ['layout', 'cadence', 'motion', 'captions']
/** The lowest score on a shown axis that passes (the engine judge's picture-axis floor, commit 856703c3). */
export const GATE_MIN_SCORE = 70
/** What one refused gate may cost in model calls (the judge, then the improver; measured ≈ 0.035 + 0.022 $ on the real runs):
 *  the gate runs before the money check only while this much is left. */
export const GATE_CALLS_USD = 0.06
/** Free demos tried for one paid step before the clone stops. */
export const GATE_TRIES = 3

export const GateResult = z.object({
  schema: z.literal('atelier.clone-gate/1'),
  definitionVersion: z.number().int().min(1),
  /** The paid step it guards. */
  before: z.enum(['p6', 'p9']),
  demoPath: z.string().min(1),
  pairs: z.array(FramePair),
  blindKey: BlindKey,
  /** The saved comparison of a refused demo (what the improver read). */
  sheet: z.string().nullable().default(null),
  verdict: BlindVerdict,
  pass: z.boolean(),
  why: z.array(z.string()),
  /** The judge's cost (the demo itself is free). */
  costUsd: z.number().min(0),
  /** Definition changes the improver made from this demo when it was refused. */
  changes: z.array(Change).default([])
})
export type GateResult = z.infer<typeof GateResult>

export const gateName = (version: number): string => `gate-v${String(version).padStart(2, '0')}.json`

/** Whether the judge says the style is right on what a demo shows (pure). */
export function gateVerdict(v: BlindVerdict, axes: readonly CompareAxis[] = GATE_AXES, min = GATE_MIN_SCORE): { pass: boolean; why: string[] } {
  const why: string[] = []
  for (const axis of axes) {
    const s = v.scores.find((x) => x.axis === axis)
    if (!s) why.push(`${axis}: not scored`)
    else if (s.score < min) why.push(`${axis} ${s.score} < ${min}: ${s.defects.slice(0, 3).join('; ') || 'no defect given'}`)
  }
  return { pass: why.length === 0, why }
}

/** The gate for the current definition: its saved result, or a free demo judged now (null: no demo service, the gate cannot run). */
export async function styleGate(ctx: PhaseContext, plan: PipelinePlan, def: StyleDefinition, corpus: Corpus, analyses: readonly VideoAnalysis[], before: 'p6' | 'p9'): Promise<GateResult | null> {
  const saved = ctx.store.load(gateName(def.version), GateResult)
  if (saved) return saved
  const demo = ctx.services.demo
  if (!demo) return null
  const dir = ctx.store.folder(gateName(def.version).replace(/\.json$/, ''))
  const passage = pickPassage(corpus, analyses)
  const production = await demo.produce(plan, def, passage, dir)
  if (production.costUsd > 0) throw new Error(`the demo render of definition v${def.version} cost ${production.costUsd} $: a demo must be free`)
  const reference = corpus.videos.find((v) => v.id === passage.videoId)!
  const pairs = await ctx.services.frames.matched(reference, production, dir)
  const anon = blindItems(pairs, `${reference.url}#t=${passage.fromS},${passage.toS}`, production.videoPath, def.version)
  // the judge sees the same demo without its « DÉMO » mark (only the assembly re-runs, in `judge/`), and is told card words
  // are placeholders: a demo's mark and template words are not the style (POV, 2026-11-04: three demos refused on them).
  // Everything kept for the user (the demo film, its frames, the side-by-sides) is the marked render.
  let judged = anon.items
  // the film the measures read: the judge copy when there is one (the same film without its mark; the frames service measures
  // the last film it matched, so the curves and the review follow the judge)
  let measured = production
  if (demo.unmarked) {
    const jdir = ctx.store.folder(`${dir.rel}/judge`)
    const clean = await demo.unmarked(plan, def, passage, jdir)
    measured = clean
    if (clean.costUsd > 0) throw new Error(`the unmarked demo of definition v${def.version} cost ${clean.costUsd} $: a demo must be free`)
    judged = blindItems(await ctx.services.frames.matched(reference, clean, jdir), `${reference.url}#t=${passage.fromS},${passage.toS}`, clean.videoPath, def.version).items
  }
  const verdict = await ctx.services.judge.blind(judged, dir, { placeholderWords: true })
  if (verdict.costUsd) ctx.spend({ usd: verdict.costUsd, seconds: 0, what: `gate v${def.version}: blind judge of the free demo` })
  const g = gateVerdict(verdict)
  const result: GateResult = {
    schema: 'atelier.clone-gate/1', definitionVersion: def.version, before, demoPath: production.videoPath, pairs, blindKey: anon.key,
    verdict, pass: g.pass, why: g.why, costUsd: verdict.costUsd ?? 0, changes: [], sheet: null
  }
  // the improver reads a comparison: the demo's, with its measured curves and review defects (all free)
  if (!g.pass) {
    const refAnalysis = analyses.find((a) => a.videoId === reference.id)
    const curves = refAnalysis ? await ctx.services.curves.compare(refAnalysis, measured) : []
    const defects = await ctx.services.review.defects(measured, def)
    const sheet = `${dir.rel}/comparison.json`
    result.sheet = sheet
    ctx.store.save(sheet, { gate: def.version, passage, pairs, curves, defects, items: anon.items, blindKey: anon.key, verdict })
    const round: Round = {
      ...artefactHead(ctx, 'round'), n: 1, stage: 'compared', kind: 'quality', definitionVersion: def.version, production,
      comparison: curves.length ? { pairs, blindKey: anon.key, curves, defects, verdict, sheet } : null,
      changes: [], improvedAxes: [], regressedAxes: [], decision: null
    }
    if (round.comparison) result.changes = (await ctx.services.improver.propose(round, def)).filter((c) => c.cause === 'definition' && !c.target.startsWith('cost.'))
  }
  ctx.store.save(gateName(def.version), result)
  ctx.decide('gate', `v${def.version} before ${before}: ${g.pass ? 'pass' : 'refused'}`, g.pass ? 'the blind judge says the style is right on the free demo' : g.why.join(' | '))
  return result
}

/** The definition after a refused gate's changes (each field `measured` from the demo's comparison, as P8 does for a round). */
export function demoRound(g: GateResult): Pick<Round, 'n' | 'comparison'> {
  return { n: 0, comparison: { sheet: g.sheet ?? '' } as Round['comparison'] }
}

/** The definition changes every saved gate made (P4's check lets these fields differ from the synthesis). */
export function gateChanges(ctx: Pick<PhaseContext, 'store'>): Change[] {
  return ctx.store.list('gate-v').flatMap((f) => ctx.store.load(f, GateResult)?.changes ?? [])
}
