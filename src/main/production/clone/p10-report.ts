// P10 — Report to the user (spec §2 P10): the verdict, the example (only one the blind judge passed), side-by-side
// frames, what he must supply and what stands in meanwhile, measured cost and making time per minute, proposals. A
// not-reproducible clone reports its alert and the alternatives faithful to the channel. Chantier E owns it.
import { Brief, Report, type IngredientOption, type Example, type Feasibility, type PipelinePlan, type Round } from '../../../shared/clone'
import { artefactHead, type PhaseContext } from './context'
import { schemaProblems, verdict, type ExitCheck } from './exit-check'

export interface ReportInputs {
  outcome: Report['outcome']
  feasibility: Feasibility
  plan: PipelinePlan | null
  rounds: readonly Round[]
  example: Example | null
  /** A preview of a proposal (a short clip or a frame, path under the clone folder), or null when none exists yet. The real
   *  preview service is a request to the assembler (see the chantier's hand-over note); until then only proposals that
   *  reuse a frame of the passed example have a preview. */
  previewOf?: (proposalTitle: string) => string | null
}

/** The proposals the report offers, each with its preview, cost, time and look; only what the run measured or the
 *  feasibility proposed, never an invented option. */
export function proposalsFor(i: ReportInputs, shown: Example | null, perMin: { usd: number; make: number } | null): Report['proposals'] {
  const out: Report['proposals'] = []
  const frame = shown?.pairs[0]?.ours ?? null
  if (shown && perMin) out.push({ title: 'clone.proposal.asExample', previewPath: frame, usdPerMinute: round2(perMin.usd), makeMinutesPerMinute: round2(perMin.make), look: 'clone.proposal.asExample.look' })
  for (const s of i.plan?.slots ?? []) {
    if (s.filledBy === 'user') continue
    const title = `clone.proposal.slot:${s.id}`
    out.push({ title, previewPath: i.previewOf?.(title) ?? frame, usdPerMinute: perMin ? round2(perMin.usd) : null, makeMinutesPerMinute: perMin ? round2(perMin.make) : null, look: 'clone.proposal.slot.look' })
  }
  for (const a of i.feasibility.alternatives) {
    out.push({ title: a.title, previewPath: i.previewOf?.(a.title) ?? null, usdPerMinute: null, makeMinutesPerMinute: null, look: a.description })
  }
  return out
}

export function runP10(ctx: PhaseContext, i: ReportInputs): Report {
  const own = ctx.store.load('p0-brief.json', Brief)?.ownChannel ?? false
  const shown = i.example && i.example.verdict.sameChannel === 'yes' ? i.example : null
  const last = i.rounds[i.rounds.length - 1]
  const perMin = shown ? { usd: shown.costUsd / (shown.durationS / 60), make: shown.makeSeconds / shown.durationS } : last ? { usd: last.production.usdPerMinute, make: last.production.makeSecondsPerMinute / 60 } : null
  const summaryKey = `clone.report.${i.outcome}` as const
  const report: Report = {
    ...artefactHead(ctx, 'report'),
    outcome: i.outcome,
    verdict: i.feasibility.verdict,
    reproducibleShare: i.feasibility.reproducibleShare,
    alert: i.feasibility.alert,
    alternatives: i.feasibility.alternatives,
    example: shown ? { videoPath: shown.videoPath, durationS: shown.durationS } : null,
    sideBySide: shown ? shown.pairs : (last?.comparison?.pairs ?? []),
    framesFrom: shown ? 'example' : last?.comparison ? 'last-round' : 'none',
    axisScores: shown ? shown.verdict.scores : [],
    humanInputs: (i.plan?.slots ?? []).map((s) => ({ slot: s.id, what: s.what, placeholder: s.placeholder?.description ?? null })),
    usdPerMinute: perMin ? round2(perMin.usd) : null,
    makeMinutesPerMinute: perMin ? round2(perMin.make) : null,
    rounds: i.rounds.length,
    spentUsd: round2(ctx.store.spent()),
    proposals: proposalsFor(i, shown, perMin),
    ingredients: (i.plan?.slots ?? []).map((sl) => ({
      slot: sl.id, what: sl.what, options: ingredientOptions(sl.kind, own),
      current: sl.filledBy === 'own-clone' ? 'clone' : sl.filledBy === 'user' ? 'import' : sl.kind === 'footage' ? 'find' : 'generate'
    })),
    technologies: (i.plan?.bricks ?? []).map((b) => ({ node: b.node, role: b.role })),
    cannot: i.feasibility.elements.filter((e) => e.how === 'impossible').map((e) => ({ what: e.description, share: round2(e.screenShare.value / (i.feasibility.elements.reduce((t, x) => t + x.screenShare.value, 0) || 1)), technology: e.missing?.technology ?? '', buildCostUsd: e.missing?.buildCostUsd ?? null, importCostUsd: e.missing?.importCostUsd ?? null })),
    summaryKey,
    summaryVars: { share: Math.round(i.feasibility.reproducibleShare * 100), rounds: i.rounds.length }
  }
  ctx.decide('p10', `report ${i.outcome}`, i.feasibility.verdict)
  return report
}

/** Refuses a report that shows an example the judge did not pass, a not-reproducible outcome without its alert and
 *  alternatives, or a placeholder slot not listed among what the user must supply. */
export function checkP10(r: Report, example: Example | null, plan: PipelinePlan | null): ExitCheck {
  const p = schemaProblems(Report, r)
  if (p.length) return verdict(p)
  if (r.example && (!example || example.verdict.sameChannel !== 'yes' || example.videoPath !== r.example.videoPath)) p.push('the report shows an example the blind judge did not pass')
  if (r.outcome === 'cloned' && !r.example) p.push('outcome cloned without an example')
  if (r.outcome === 'not-reproducible' && (!r.alert || r.alternatives.length === 0)) p.push('not reproducible without its alert and alternatives')
  if (r.outcome === 'cloned' && (r.usdPerMinute === null || r.makeMinutesPerMinute === null)) p.push('outcome cloned without the measured cost and making time per minute')
  if ((r.outcome === 'stopped-budget' || r.outcome === 'example-refused') && r.rounds > 0 && r.sideBySide.length === 0) p.push(`${r.outcome} after ${r.rounds} round(s) without the rounds' side-by-side frames`)
  if (r.outcome === 'not-reproducible' && r.example) p.push('a not reproducible clone shows no example')
  if (r.framesFrom === 'example' && !r.example) p.push('frames from an example that is not shown')
  for (const h of r.humanInputs) if (plan?.slots.find((s) => s.id === h.slot)?.filledBy === 'placeholder' && !h.placeholder) p.push(`slot ${h.slot} stands in with a placeholder that is not described`)
  for (const s of plan?.slots ?? []) if (!r.ingredients.some((g) => g.slot === s.id)) p.push(`slot ${s.id} has no way to be provided listed`)
  for (const s of plan?.slots ?? []) if (!r.humanInputs.some((h) => h.slot === s.id)) p.push(`slot ${s.id} is not listed among what the user must supply`)
  return verdict(p)
}

/** The realistic ways to provide an ingredient (spec VISION §15, Charlie 2026-11-04). Never a third party's face or voice
 *  (a same-type look-alike is generated, an import slot stays); footage that exists in the reference is FOUND, never
 *  generated; his own channel gets fewer options: his own clones, or his own files. */
export function ingredientOptions(kind: string, own: boolean): IngredientOption[] {
  switch (kind) {
    case 'presenter-footage': case 'presenter-avatar': case 'voice': return own ? ['clone', 'import'] : ['generate', 'import']
    case 'footage': return own ? ['import'] : ['find', 'import']
    default: return own ? ['import'] : ['import', 'find']
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100
