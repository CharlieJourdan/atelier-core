// reverse-pipeline (docs/METHODE-REVERSE-PIPELINE.md): the REVERSE-ENGINEERED PIPELINE of a clone, built from what
// its phases saved (load.ts reads them): the bricks graph with every setting's source and evidence, how each style element
// is distributed along the video, what a human supplies (and what stands in), what cannot be made and why, the feasibility,
// the corpus read, the cost per minute (measured when a proof ran), the proof (side by side, blind judge, defects) and its
// state. Pure: the same artefacts give the same pipeline.
import { VIDEO_PARTS, atPath, isSourced, type VideoPart } from '../../../../shared/clone'
import { REVERSE_SCHEMA, type Distribution, type HumanInput, type NotPossible, type PipelineProof, type ReversePipeline } from '../../../../shared/reverse/pipeline'
import { EVIDENCE_PER_FIELD, edgesOf, feasibilityNodes, nodesOf } from './build-graph'
import type { ReverseInputs } from './load'

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const unit = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const isPart = (p: unknown): p is VideoPart => typeof p === 'string' && (VIDEO_PARTS as readonly string[]).includes(p)

/** How each element is distributed along the video: the definition's `sourcing.distributions` when it has them, else the
 *  presenter's measured presence per part. An element without evidence is left out (nothing is said that was not measured). */
export function distributionsOf(def: ReverseInputs['definition']): Distribution[] {
  if (!def) return []
  const field = atPath(def, 'sourcing.distributions')
  if (isSourced(field) && field.source === 'measured' && Array.isArray(field.value) && field.value.length > 0) {
    const evidence = field.evidence.slice(0, EVIDENCE_PER_FIELD)
    if (evidence.length === 0) return []
    return field.value.flatMap((raw): Distribution[] => {
      const d = raw as { element?: unknown; overall?: unknown; byPart?: unknown; curve?: unknown }
      if (typeof d.element !== 'string' || !d.element) return []
      const byPart = Array.isArray(d.byPart) ? d.byPart.flatMap((x) => { const p = x as { part?: unknown; share?: unknown }; return isPart(p.part) ? [{ part: p.part, share: unit(p.share) }] : [] }) : []
      const curve = Array.isArray(d.curve) ? d.curve.slice(0, 10).map(unit) : []
      return [{ element: d.element, overall: unit(d.overall), byPart, curve, evidence }]
    })
  }
  const presence = def.presenter.presenceByPart
  if (def.presenter.kind.value === 'none' || presence.source !== 'measured' || presence.evidence.length === 0 || presence.value.length === 0) return []
  const byPart = presence.value.map((p) => ({ part: p.part, share: unit(p.share) }))
  return [{ element: 'presenter', overall: r3(byPart.reduce((t, p) => t + p.share, 0) / byPart.length), byPart, curve: [], evidence: presence.evidence.slice(0, EVIDENCE_PER_FIELD) }]
}

export function humanInputsOf(i: ReverseInputs): HumanInput[] {
  const slots = i.plan?.slots ?? []
  const out: HumanInput[] = (i.feasibility?.elements ?? []).flatMap((e): HumanInput[] => {
    if (e.how !== 'human-input' || !e.slot) return []
    const slot = slots.find((s) => s.id === e.id)
    return [{
      slot: e.id,
      kind: e.slot.kind,
      what: e.slot.what,
      screenShare: unit(e.screenShare.value),
      placeholder: slot?.placeholder ?? null,
      userSupplies: e.slot.userSupplies ?? (slot ? slot.filledBy !== 'placeholder' : false)
    }]
  })
  for (const s of slots) if (!out.some((h) => h.slot === s.id)) out.push({ slot: s.id, kind: s.kind, what: s.what, screenShare: 0, placeholder: s.placeholder, userSupplies: s.filledBy !== 'placeholder' })
  return out
}

export function notPossibleOf(i: ReverseInputs): NotPossible[] {
  return (i.feasibility?.elements ?? []).filter((e) => e.how === 'impossible').map((e) => ({
    what: e.description,
    screenShare: unit(e.screenShare.value),
    reason: e.missing?.note?.trim() || e.description,
    technology: e.missing?.technology ?? 'a technology the engine does not have',
    buildCostUsd: e.missing?.buildCostUsd ?? null,
    importCostUsd: e.missing?.importCostUsd ?? null
  }))
}

/** The example P9 really made (a refused example only copies the last round's comparison and costs nothing). */
const madeExample = (i: ReverseInputs): ReverseInputs['example'] => (i.example && (i.example.costUsd > 0 || i.example.makeSeconds > 0) ? i.example : null)
const lastCompared = (i: ReverseInputs): ReverseInputs['rounds'][number] | null => [...i.rounds].reverse().find((r) => r.comparison) ?? null

const c0 = (i: ReverseInputs): NonNullable<ReverseInputs['rounds'][number]['comparison']> | null => lastCompared(i)?.comparison ?? null

export function proofOf(i: ReverseInputs): PipelineProof | null {
  const ex = madeExample(i)
  if (ex) {
    const first = i.corpus?.videos[0]
    return {
      passage: { videoId: first?.id ?? 'v1', fromS: 0, toS: ex.durationS },
      videoPath: ex.videoPath,
      sideBySideVideo: ex.sideBySideVideo ?? c0(i)?.sideBySideVideo ?? null,
      pairs: ex.pairs,
      sameChannel: ex.verdict.sameChannel,
      reason: ex.verdict.reason,
      judge: ex.verdict.judge,
      scores: ex.verdict.scores,
      defects: ex.review,
      rounds: i.rounds.length,
      costUsd: r3(ex.costUsd)
    }
  }
  const r = lastCompared(i)
  if (!r?.comparison) return null
  const c = r.comparison
  return {
    passage: r.production.passage,
    videoPath: r.production.videoPath,
    sideBySideVideo: c.sideBySideVideo ?? null,
    pairs: c.pairs,
    sameChannel: c.verdict.sameChannel,
    reason: c.verdict.reason,
    judge: c.verdict.judge,
    scores: c.verdict.scores,
    defects: c.defects,
    rounds: i.rounds.length,
    costUsd: r3(r.production.costUsd)
  }
}

export function costOf(i: ReverseInputs): ReversePipeline['cost'] {
  const ex = madeExample(i)
  if (ex && ex.durationS > 0) return { usdPerMinute: r3(ex.costUsd / (ex.durationS / 60)), makeMinutesPerMinute: r3(ex.makeSeconds / ex.durationS), measured: true }
  const last = [...i.rounds].reverse().find((r) => r.production.durationS > 0)
  if (last) return { usdPerMinute: r3(last.production.usdPerMinute), makeMinutesPerMinute: r3(last.production.makeSecondsPerMinute / 60), measured: true }
  if (i.report && (i.report.usdPerMinute !== null || i.report.makeMinutesPerMinute !== null)) return { usdPerMinute: i.report.usdPerMinute, makeMinutesPerMinute: i.report.makeMinutesPerMinute, measured: false }
  const d = i.definition
  return d ? { usdPerMinute: r3(Math.max(0, d.cost.usdPerMinute.value)), makeMinutesPerMinute: r3(Math.max(0, d.cost.makeMinutesPerMinute.value)), measured: false } : { usdPerMinute: null, makeMinutesPerMinute: null, measured: false }
}

export function stateOf(i: ReverseInputs, proof: PipelineProof | null): ReversePipeline['state'] {
  if (i.feasibility?.verdict === 'not-reproducible' || i.report?.outcome === 'not-reproducible') return 'not-reproducible'
  if (i.failed) return 'failed'
  if (i.report?.outcome === 'stopped-budget') return 'stopped-budget'
  // proven only by a blind « same channel » on what the current definition makes (a report « cloned » says P9 passed it)
  if (proof?.sameChannel !== 'yes') return 'not-proven'
  if (i.report?.outcome === 'cloned') return 'proven'
  const judged = madeExample(i)?.definitionVersion ?? lastCompared(i)?.definitionVersion
  if (!i.report && i.definition && judged === i.definition.version) return 'proven'
  return 'not-proven'
}

function summaryOf(i: ReverseInputs, p: Pick<ReversePipeline, 'state' | 'graph' | 'feasibility' | 'humanInputs' | 'notPossible' | 'proof'>): string {
  const ref = i.request.links.map((l) => l.url).join(' + ')
  const bricks = p.graph.nodes.filter((n) => n.status !== 'missing' && n.id !== 'recipe').length
  const share = Math.round(p.feasibility.reproducibleShare * 100)
  const derived = i.derivedFrom ? ` (${i.derivedFrom.transform.action} of ${i.derivedFrom.pipelineId})` : ''
  const human = p.humanInputs.length ? `, ${p.humanInputs.length} human input(s) with stand-ins meanwhile` : ''
  const verdict: Record<ReversePipeline['state'], string> = {
    proven: `proven: the blind judge said « same channel » after ${p.proof?.rounds ?? 0} round(s)`,
    'not-proven': p.proof ? `not proven yet: the blind judge said « ${p.proof.sameChannel} » (${p.proof.reason})` : 'not proven yet: no test render was judged',
    'not-reproducible': `not reproducible: ${p.notPossible.map((n) => `${n.what} (${Math.round(n.screenShare * 100)} %)`).join(', ') || 'what it shows'} has no engine brick`,
    'stopped-budget': 'stopped at the test budget before the proof ended',
    failed: 'the engine stopped on an error before the proof ended'
  }
  return `A ${bricks}-brick pipeline${derived} reproducing ${ref}, ${share} % of the screen time made by bricks and human inputs${human}; ${verdict[p.state]}.`
}

export function buildReversePipeline(i: ReverseInputs, createdAt: string): ReversePipeline {
  const f = i.feasibility
  const nodes = i.plan ? nodesOf(i.plan, i.definition) : f ? feasibilityNodes(f) : []
  if (nodes.length === 0) throw new Error(`clone ${i.cloneId} has no plan and no feasibility map yet: no pipeline to show`)
  const graph = { nodes, edges: i.plan ? edgesOf(i.plan, nodes) : [] }
  const feasibility = f
    ? { verdict: f.verdict, brickShare: f.brickShare, reproducibleShare: f.reproducibleShare, alert: f.alert }
    : { verdict: 'partly' as const, brickShare: 0, reproducibleShare: 0, alert: 'the feasibility map was not made yet' }
  const proof = proofOf(i)
  const state = stateOf(i, proof)
  const humanInputs = humanInputsOf(i)
  const notPossible = notPossibleOf(i)
  const analyses = new Map(i.analyses.map((a) => [a.videoId, a]))
  const corpus = (i.corpus?.videos ?? []).map((v) => {
    const a = analyses.get(v.id)
    return { videoId: v.id, title: v.title, durationS: a?.coverage.durationS ?? v.durationS ?? 0, why: v.note ? `${v.why}: ${v.note}` : v.why, whole: a?.coverage.complete ?? false }
  })
  return {
    schema: REVERSE_SCHEMA,
    id: i.cloneId,
    createdAt,
    request: i.request,
    derivedFrom: i.derivedFrom,
    corpus,
    state,
    summary: summaryOf(i, { state, graph, feasibility, humanInputs, notPossible, proof }),
    feasibility,
    graph,
    distributions: distributionsOf(i.definition),
    humanInputs,
    notPossible,
    alternatives: f?.alternatives ?? [],
    cost: costOf(i),
    proof,
    spentUsd: Math.max(0, i.spentUsd),
    recipe: i.plan?.recipe ?? null,
    definitionVersion: i.definition?.version ?? i.plan?.definitionVersion ?? 1
  }
}
