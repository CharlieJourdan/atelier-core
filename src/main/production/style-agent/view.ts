// What a style study shows (production-15): recomputed from its state on every read — the proposal (pure, cheap), each
// variant with the gap edits the owner applied, the sample's measured score, and the gaps of the variant as it is now.
// After an edit the sample is « à refaire »: its measures are moved by what the edit changes (predicted, likeness.ts
// `shiftMeasure`) until it is made again.
import { applyOps, basePipeline, optionProblem, type RecipeDoc, type TechnologyRegistry } from '../../../engine/technologies'
import { estimateCost, type CostInput, type Range } from '../../../engine/technologies/cost'
import { medianOf, type VideoMeasure } from '../../../engine/technologies/fit'
import { likeness, likenessGaps, predictStyle, shiftMeasure, type LikenessGap } from '../../../engine/technologies/likeness'
import { diffPipelines } from '../../../engine/technologies/pipeline-diff'
import { baseForReferences, proposeForStyle, type StyleProposal } from '../../../engine/technologies/style-propose'
import { differentiators, withDifferentiators, type DifferentiatorProposal } from '../../../engine/technologies/differentiators'
import { inspire, type AxisReference, type InspiredAxis } from '../../../engine/technologies/inspirations'
import { withIngredients } from '../../../engine/technologies/ingredients'
import { ingredientViews, priceView } from './ingredients-view'
import { renderTime } from '../estimates/duration'
import type { EditOpView, PipelineChangeView, VariantKindId } from '../../../shared/pipeline-agent'
import type { RecipeDocument } from '../../../shared/recipes'
import type { DifferentiatorView, IngredientView, InspirationView, LikenessGapView, SketchView, StudyPath, StudyView, StyleMeasureView } from '../../../shared/style-agent'
import type { FeasibilityView } from '../../../shared/style-feasibility'
import { SAMPLE_SECONDS } from '../../../engine/technologies/style-sample'
import type { StudyRow, StudyState } from './store'

/** The parts of a study the proposal reads. */
type ProposalState = Pick<StudyState, 'refs' | 'answers' | 'text' | 'baseId' | 'language' | 'inspirations' | 'rework' | 'feasibility'>

/** The way in of a study (studies made before parcours-utilisateur: from their flags). */
export function pathOf(s: Pick<StudyState, 'path' | 'own' | 'language' | 'inspirations' | 'rework' | 'links'>): StudyPath {
  if (s.path) return s.path
  if (s.rework) return 'rework'
  if ((s.inspirations?.length ?? 0) > 0) return 'inspire'
  return s.own ? 'own' : s.language ? 'translate' : s.links.length > 1 ? 'mix' : 'clone'
}

/** The axes the pipeline takes from their own reference (the content axis is the proposal's). */
export const axesOf = (s: Pick<StudyState, 'inspirations'>): AxisReference[] => (s.inspirations ?? []).map((a) => ({ axis: a.axis, title: a.title, refs: a.measures }))

/** « Retravailler » : the owner's pipeline as it is, the one variant (its proposals apply on it). */
function reworkProposal(r: NonNullable<StudyState['rework']>, reg: TechnologyRegistry, cost: CostInput | null): StyleProposal {
  const e = cost ? estimateCost(r.doc, reg, cost) : null
  return { base: r.doc.base ?? 'avatar@1', measured: 0, reason: 'chosen', recommended: 'faithful', questions: [], variants: [{ kind: 'faithful', doc: r.doc, ops: [], estimate: e?.ok ? e.estimate : null, fit: null, likeness: null }] }
}

const CREDIT_EUR = 0.01
const known = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined)

/** The references' measures; the eyes' demonstration gives way to a base the owner's words (or the agent) chose against it:
 * it is an example, not a reading of their videos (style-test-2: a stock voice-over proposed for a video of a presenter). */
function measuresOf(s: Pick<StudyState, 'refs' | 'baseId'>): VideoMeasure[] {
  const all = s.refs.flatMap((r) => r.measures)
  const demoOnly = s.refs.every((r) => r.demo || r.measures.length === 0)
  return s.baseId && demoOnly && baseForReferences(all).baseId !== s.baseId ? [] : all
}

/** The measures the pipeline's mix copies: none when the style is out of reach and the agent chose another base for the same subject
 * (essais-utilisateur: Yarnhub's 3D battles as an archive documentary keep the documentary's own mix, not 100 % generated clips). */
function mixOf(s: Pick<StudyState, 'refs' | 'baseId' | 'feasibility'>): VideoMeasure[] {
  const all = measuresOf(s)
  return s.feasibility?.verdict === 'no' && s.baseId && all.length > 0 && baseForReferences(all).baseId !== s.baseId ? [] : all
}

/** The genres in French (a pipeline's name when nothing else names it). */
const BASE_FR: Readonly<Record<string, string>> = { 'avatar@1': 'Présentateur', 'voiceover@1': 'Voix off', 'documentary@2': 'Documentaire', 'story-short@1': 'Histoire Reddit', 'pov@1': 'Histoire POV' }

/**
 * An estimate from settings is never a measure: it never says more than this (a documentary cloned shot by shot measured ≈ 74 / 100,
 * clone-markets-2); the screen shows it as a range « à vérifier sur un exemple ».
 */
export const ESTIMATE_MAX = 80
export const capEstimate = (x: number | null): number | null => (x === null ? null : Math.min(ESTIMATE_MAX, x))

export function proposalOf(s: ProposalState, reg: TechnologyRegistry, cost: CostInput | null): StyleProposal {
  if (s.rework) return reworkProposal(s.rework, reg, cost)
  const first = (s.text ?? '').split(/[.!?\n]/)[0]?.trim() ?? ''
  // at most 40 characters, cut between two words
  const words = first.length <= 40 ? first : first.slice(0, 41).replace(/\s+\S*$/, '')
  // a short French name: the channel's (a channel link read for real), else the owner's words, else the genre; then the format
  // (#93: a video link's title is the eyes' English description of the video, never a name)
  const channel = s.refs.find((r) => r.kind === 'channel' && !r.demo && r.measures.length > 0)?.title
  const baseId = s.baseId ?? undefined
  const raw = proposeForStyle({ refs: mixOf(s), ...(cost ? { cost } : {}), ...(baseId ? { baseId } : {}), name: 'Ma pipeline', answers: s.answers }, reg)
  const named = (doc: RecipeDoc): RecipeDoc => ({ ...doc, name: `${(channel || words || BASE_FR[doc.base ?? ''] || 'Ma pipeline').slice(0, 60)} · ${doc.format.aspect === '9:16' ? 'Shorts' : 'format long'}` })
  const proposed = { ...raw, variants: raw.variants.map((v) => ({ ...v, doc: named(v.doc), likeness: capEstimate(v.likeness) })) }
  // « Créer de zéro avec des inspirations » / « Mélanger » : the editing, the motion and the script from their own references
  const axes = axesOf(s).filter((a) => a.axis !== 'content')
  const p = axes.length === 0 ? proposed : {
    ...proposed,
    variants: proposed.variants.map((v) => {
      const doc = inspire(v.doc, axes, reg).doc
      const e = cost ? estimateCost(doc, reg, cost) : null
      const predicted = predictStyle(doc, reg)
      return { ...v, doc, estimate: e?.ok ? e.estimate : v.estimate, likeness: predicted && measuresOf(s).length > 0 ? capEstimate(likeness(measuresOf(s), predicted).score) : v.likeness }
    })
  }
  // translating the references' channel: the same pipelines in the target language
  const lang = s.language
  return lang ? { ...p, variants: p.variants.map((v) => ({ ...v, doc: { ...v.doc, language: lang, name: `${v.doc.name} (${lang.toUpperCase()})`.slice(0, 120) } })) } : p
}

const checkOption = (doc: RecipeDoc) => (o: string, v: unknown): string | null => optionProblem(basePipeline(doc.base)?.options ?? [], o, v)

/** The reference channels, each with its measures (a mix of channels gets a « plus proche de … » per channel). */
const channelsOf = (s: Pick<StudyState, 'refs'>): { title: string; refs: VideoMeasure[] }[] => s.refs.filter((r) => !r.demo && r.measures.length > 0).map((r) => ({ title: r.title, refs: r.measures }))

/** The differentiators of a variant's pipeline (clonage-traduction): logical for its genre, none for the owner's own channel. */
export function differentiatorsOf(s: Pick<StudyState, 'refs' | 'baseId' | 'own' | 'suggested'>, doc: RecipeDoc, reg: TechnologyRegistry, cost: CostInput | null): DifferentiatorProposal[] {
  const weak = s.refs.some((r) => r.insight?.verdict === 'weak')
  const list = differentiators(doc, reg, { refs: measuresOf(s), ...(cost ? { cost } : {}), ...(s.own ? { own: true } : {}), ...(weak ? { weak: true } : {}), channels: channelsOf(s) })
  const suggested = s.suggested ?? []
  return suggested.length === 0 ? list : list.map((d) => (suggested.includes(d.id) ? { ...d, recommended: true } : d))
}

/** A variant as it is now: the proposal's, with the differentiators the owner picked, then the gap edits (dropped if they no longer apply). */
export function variantDoc(s: ProposalState & Pick<StudyState, 'edits' | 'own' | 'picks' | 'suggested' | 'choices'>, kind: VariantKindId, reg: TechnologyRegistry, cost: CostInput | null): RecipeDoc {
  const v = proposalOf(s, reg, cost).variants.find((x) => x.kind === kind) ?? proposalOf(s, reg, null).variants.find((x) => x.kind === kind)
  if (!v) throw new Error('Cette variante n’est pas proposée pour ces références.')
  const picks = s.picks ?? []
  const differed = picks.length > 0 ? withDifferentiators(v.doc, differentiatorsOf(s, v.doc, reg, null).filter((d) => picks.includes(d.id)), reg) : v.doc
  // the owner's ingredients (« mes clips, mes scripts, ma voix… ») on top
  const picked = Object.keys(s.choices ?? {}).length > 0 ? withIngredients(differed, s.choices ?? {}, reg, measuresOf(s)) : differed
  const edits = s.edits[kind] ?? []
  if (edits.length === 0) return picked
  const r = applyOps(picked, edits, reg, { checkOption: checkOption(picked) })
  return r.ok ? r.doc : picked
}

/** The sample's measures as the variant is now (moved by the edits applied since it was made). */
function effectiveSample(s: StudyState, reg: TechnologyRegistry): { measures: VideoMeasure; stale: boolean } | null {
  const sample = s.sample
  if (!sample?.measures) return null
  const atSample = variantDoc({ ...s, edits: { ...s.edits, [sample.variant]: sample.edits } }, sample.variant, reg, null)
  const now = variantDoc(s, sample.variant, reg, null)
  const stale = JSON.stringify(atSample) !== JSON.stringify(now)
  if (!stale) return { measures: sample.measures, stale }
  const before = predictStyle(atSample, reg)
  const after = predictStyle(now, reg)
  return { measures: before && after ? shiftMeasure(sample.measures, before, after) : sample.measures, stale }
}

/** The three biggest gaps of the sample's variant as it is now. */
export function currentGaps(s: StudyState, reg: TechnologyRegistry, cost: CostInput | null): LikenessGap[] {
  const e = effectiveSample(s, reg)
  if (!e || !s.sample) return []
  const doc = variantDoc(s, s.sample.variant, reg, cost)
  return likenessGaps(doc, measuresOf(s), e.measures, reg, { ...(cost ? { cost } : {}), apply: { checkOption: checkOption(doc) } })
}

export function measureView(m: VideoMeasure): StyleMeasureView {
  return {
    minutes: m.minutes ?? null,
    presenterShare: m.presenterShare ?? null,
    layouts: m.layouts ?? [],
    kinds: (m.kinds as Record<string, number> | null | undefined) ?? null,
    shotS: m.shotS ?? null,
    lookFamily: m.lookFamily ?? null,
    captions: m.captions ?? null,
    labelsPerMinute: m.labelsPerMinute ?? null,
    wordsPerMinute: m.wordsPerMinute ?? null,
    curve: m.curve ?? null,
    offerAtS: m.sponsor === false ? null : (m.sponsorAtS ?? null),
    presenterActs: m.presenterActs ?? null,
    light: m.light ?? null,
    camera: m.camera ?? null
  }
}

/** The references' typical video: the median of each measure, the most common value of the others. */
export function profileView(videos: readonly VideoMeasure[]): StyleMeasureView | null {
  if (videos.length === 0) return null
  const med = (f: 'minutes' | 'presenterShare' | 'shotS' | 'labelsPerMinute' | 'wordsPerMinute' | 'sponsorAtS' | 'presenterActs'): number | null => medianOf(known(videos.map((v) => v[f])))
  const mode = <T>(xs: readonly T[]): T | null => (xs.length === 0 ? null : (xs.slice().sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0] as T))
  const kindsOf = videos.filter((v) => v.kinds)
  const names = [...new Set(kindsOf.flatMap((v) => Object.keys(v.kinds ?? {})))]
  const kinds = kindsOf.length === 0 ? null : Object.fromEntries(names.map((k) => [k, medianOf(kindsOf.map((v) => (v.kinds as Record<string, number>)[k] ?? 0)) ?? 0]))
  const captions = known(videos.map((v) => v.captions))
  return {
    minutes: med('minutes'),
    presenterShare: med('presenterShare'),
    layouts: [...new Set(videos.flatMap((v) => v.layouts ?? []))],
    kinds,
    shotS: med('shotS'),
    lookFamily: mode(known(videos.map((v) => v.lookFamily))),
    captions: captions.length === 0 ? null : captions.filter(Boolean).length * 2 > captions.length,
    labelsPerMinute: med('labelsPerMinute'),
    wordsPerMinute: med('wordsPerMinute'),
    curve: mode(known(videos.map((v) => v.curve))),
    offerAtS: videos.some((v) => v.sponsor === true) ? med('sponsorAtS') : null,
    presenterActs: med('presenterActs'),
    light: mode(known(videos.map((v) => v.light))),
    camera: mode(known(videos.map((v) => v.camera)))
  }
}

const LIGHT_FR: Readonly<Record<string, string>> = { overcast: 'grise, couverte', warm: 'jour chaud, ensoleillé', studio: 'studio', mixed: 'mélangée' }
const CAMERA_FR: Readonly<Record<string, string>> = { steady: 'fixe', handheld: 'à la main', moving: 'en mouvement' }

/** The references' « profil mesuré » in one French paragraph, kept with the pipeline it made (its first message). */
export function profileText(p: StyleMeasureView, videos: number): string {
  const pct = (x: number): string => `${Math.round(x * 100)} %`
  const parts: string[] = []
  if (p.presenterShare !== null) {
    const acts = typeof p.presenterActs === 'number' && p.presenterActs > 0 ? `, joue dans ${pct(p.presenterActs)} des images` : ''
    parts.push(`présentateur face caméra ${pct(p.presenterShare)}${acts}`)
  }
  if (p.kinds) {
    const words: Record<string, string> = { clipAi: 'clips', imageAi: 'images fixes', stock: 'banque d’images', archive: 'archives', motion: 'cartes' }
    const kinds = Object.entries(p.kinds).filter(([, v]) => v > 0.02).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${words[k] ?? k} ${pct(v)}`)
    if (kinds.length > 0) parts.push(`images : ${kinds.join(', ')}`)
  }
  if (p.shotS !== null) parts.push(`un plan toutes les ${p.shotS.toFixed(1).replace('.', ',')} s`)
  if (p.wordsPerMinute !== null) parts.push(`${Math.round(p.wordsPerMinute)} mots par minute`)
  if (p.light) parts.push(`lumière ${LIGHT_FR[p.light] ?? p.light}`)
  if (p.camera) parts.push(`caméra ${CAMERA_FR[p.camera] ?? p.camera}`)
  if (p.captions !== null || p.labelsPerMinute !== null) parts.push(p.captions ? 'sous-titres' : (p.labelsPerMinute ?? 0) < 0.5 ? 'aucun texte à l’écran' : `${p.labelsPerMinute?.toFixed(1)} textes à l’écran par minute`)
  if (p.offerAtS !== null) parts.push(`produit vers ${Math.floor(p.offerAtS / 60)}:${String(Math.round(p.offerAtS % 60)).padStart(2, '0')}`)
  return parts.length === 0 ? '' : `Profil mesuré (${videos} vidéo${videos > 1 ? 's' : ''}) : ${parts.join(' ; ')}.`
}

/** The feasibility with each « instead » priced from the pipeline's own ingredient option (null when it has none). */
export function feasibilityOf(f: FeasibilityView | null | undefined, ingredients: readonly IngredientView[]): FeasibilityView | null {
  if (!f) return null
  const option = (id: string | null) => (id ? ingredients.flatMap((i) => i.options).find((o) => o.id === id) : undefined)
  return { ...f, instead: f.instead.map((x) => ({ ...x, perMinute: option(x.option)?.perMinute?.after ?? null })) }
}

export function buildView(row: StudyRow, reg: TechnologyRegistry, cost: CostInput | null): StudyView {
  const s = row.state
  // a likeness is never above the share of the style Atelier can make (a studio cartoon is not « 65 / 100 »)
  const reach = s.feasibility ? s.feasibility.share : 100
  const capReach = (x: number | null): number | null => (x === null ? null : Math.min(x, reach))
  const proposal = proposalOf(s, reg, cost)
  const perMinute = (d: RecipeDoc): Range | null => {
    if (!cost) return null
    const e = estimateCost(d, reg, cost)
    return e.ok ? e.estimate.perMinute : null
  }
  const refs = measuresOf(s)
  const variants = proposal.variants.map((v) => {
    const edited = (s.edits[v.kind]?.length ?? 0) > 0 || (s.picks?.length ?? 0) > 0 || Object.keys(s.choices ?? {}).length > 0
    const doc = edited ? variantDoc(s, v.kind, reg, cost) : v.doc
    const p = edited ? predictStyle(doc, reg) : null
    return {
      kind: v.kind,
      doc: doc as unknown as RecipeDocument,
      ops: [...v.ops, ...(edited ? (s.edits[v.kind] ?? []) : [])] as unknown as EditOpView[],
      perMinute: edited ? perMinute(doc) : (v.estimate?.perMinute ?? null),
      likeness: capReach(edited ? (p ? capEstimate(likeness(refs, p).score) : null) : v.likeness),
      fit: v.fit,
      edits: edited ? (s.edits[v.kind]?.length ?? 0) : 0
    }
  })
  // « Comment veux-tu te différencier ? »: on the recommended variant as proposed, each with its Δ price, Δ render time and Δ likeness
  const rec = proposal.variants.find((v) => v.kind === proposal.recommended) ?? proposal.variants[0]
  const minutes = rec?.doc.format.minutes ?? 12
  const seconds = (d: RecipeDoc): number | null => renderTime(d, reg, minutes)?.seconds.avg ?? null
  const differentiatorViews: DifferentiatorView[] = rec
    ? differentiatorsOf(s, rec.doc, reg, cost).map((d) => {
        const after = applyOps(rec.doc, d.ops, reg, { checkOption: checkOption(rec.doc) })
        const b = seconds(rec.doc)
        const a = after.ok ? seconds(after.doc) : null
        const sb = sketchOf(rec.doc, reg)
        const sa = after.ok ? sketchOf(after.doc, reg) : null
        return {
          sketch: sb && sa ? { before: sb, after: sa } : null,
          id: d.id,
          family: d.family,
          effect: d.effect,
          title: d.title,
          detail: d.detail,
          previewKey: d.previewKey,
          beforeKey: d.beforeKey,
          recommended: d.recommended,
          perMinute: d.perMinute,
          renderSeconds: b !== null && a !== null ? { before: b, after: a } : null,
          likeness: d.likeness ? { before: capReach(capEstimate(d.likeness.before)) as number, after: capReach(capEstimate(d.likeness.after)) as number } : null,
          picked: (s.picks ?? []).includes(d.id)
        }
      })
    : []
  let sample: StudyView['sample'] = null
  if (s.sample) {
    const e = effectiveSample(s, reg)
    const measured = s.sample.measures ? likeness(refs, s.sample.measures) : null
    const doc = variantDoc(s, s.sample.variant, reg, cost)
    const gaps: LikenessGapView[] = currentGaps(s, reg, cost).map((g) => {
      const r = g.ops.length > 0 ? applyOps(doc, g.ops, reg, { checkOption: checkOption(doc) }) : null
      const before = perMinute(doc)
      const after = r?.ok ? perMinute(r.doc) : null
      return {
        dimension: g.dimension,
        score: g.score,
        ops: g.ops as unknown as EditOpView[],
        changes: r?.ok ? (diffPipelines(doc, r.doc) as unknown as PipelineChangeView[]) : [],
        scoreAfter: g.scoreAfter,
        perMinute: before && after ? { before, after } : null
      }
    })
    sample = {
      variant: s.sample.variant,
      status: s.sample.status,
      runId: s.sample.runId,
      stale: e?.stale ?? false,
      error: s.sample.error,
      measures: s.sample.measures ? measureView(s.sample.measures) : null,
      score: measured?.score ?? null,
      dimensions: measured?.dimensions ?? [],
      predicted: e?.stale ? likeness(refs, e.measures).score : null,
      gaps,
      lookFromStyle: s.sample.lookFromStyle,
      credits: s.sample.credits
    }
  }
  // what each axis took from its reference, said on the recommended pipeline
  const inspired: InspiredAxis[] = rec && (s.inspirations?.length ?? 0) > 0 ? inspire(proposeBase(s, reg), axesOf(s), reg).axes : []
  const inspirations: InspirationView[] = (s.inspirations ?? []).map((a, i) => {
    const said = inspired[i]
    return { axis: a.axis, url: a.url, title: a.title, said: a.problem ? `${a.title} : pas mesurée (${a.problem}).` : (said?.said ?? ''), taken: !a.problem && (said?.taken ?? false), problem: a.problem }
  })
  // a pipeline without a presenter is not asked how long its presenter is on screen
  const presenter = rec ? rec.doc.bricks.some((b) => reg.get(b.tech)?.engineFamily === 'presenter') : true
  const path = pathOf(s)
  const own = s.own === true
  const ingredients = rec ? ingredientViews(rec.doc, reg, refs, cost, s.choices ?? {}) : []
  const videoS = rec ? seconds(rec.doc) : null
  const sampleS = rec ? (renderTime(rec.doc, reg, SAMPLE_SECONDS / 60)?.seconds.avg ?? null) : null
  return {
    id: row.id,
    path,
    text: s.text ?? '',
    instructions: s.instructions ?? '',
    links: s.links,
    insights: s.refs.flatMap((r) => (r.insight ? [r.insight] : [])),
    inspirations,
    rework: s.rework ? { id: s.rework.id, name: s.rework.name } : null,
    ask: s.ask ?? askFor(path, own, s.refs.some((r) => r.insight?.verdict === 'weak')),
    feasibility: feasibilityOf(s.feasibility, ingredients),
    scope: s.scope ?? 'video',
    timing: { analysisS: s.analysisS ?? null, sampleS, videoS, minutes },
    ingredients,
    price: priceView(rec ? (rec.estimate?.perMinute ?? null) : null, minutes, ingredients),
    references: s.refs.map((r) => ({ url: r.url, kind: r.kind, title: r.title, videos: r.measures.length, demo: r.demo, problem: r.problem, ...(r.coverage?.length ? { coverage: r.coverage } : {}) })),
    profile: profileView(refs),
    measured: refs.length,
    demo: s.refs.some((r) => r.demo),
    base: proposal.base,
    reason: proposal.reason,
    variants,
    recommended: proposal.recommended,
    differentiators: differentiatorViews,
    own: s.own === true,
    language: s.language ?? null,
    questions: proposal.questions.filter((q) => presenter || q.id !== 'presenter').map((q) => ({ id: q.id, choices: q.choices.map((c) => c.value), default: q.default, answer: q.answer })),
    summary: s.summary,
    agentNote: s.agentNote,
    script: s.script,
    channelId: s.channelId,
    quote: s.quote ? { id: s.quote.id, variant: s.quote.variant, credits: s.quote.credits, hold: s.quote.hold ?? null, debited: s.quote.debited !== false, seconds: s.quote.seconds, script: s.quote.script, channelId: s.quote.channelId } : null,
    sample,
    measureCredits: s.measureCredits,
    creditEur: CREDIT_EUR,
    createdAt: row.createdAt
  }
}

/** The proposed pipeline of the content axis alone, before the other axes (what `inspire` says each axis took on). */
function proposeBase(s: StudyState, reg: TechnologyRegistry): RecipeDoc {
  const p = proposalOf({ ...s, inspirations: (s.inspirations ?? []).filter((a) => a.axis === 'content') }, reg, null)
  return (p.variants.find((v) => v.kind === p.recommended) ?? p.variants[0])?.doc ?? (basePipeline('avatar@1')?.doc as RecipeDoc)
}

/** A pipeline's look in a few numbers (predicted from its settings), for a proposal's drawn « avant / après ». */
export function sketchOf(doc: RecipeDoc, reg: TechnologyRegistry): SketchView | null {
  const p = predictStyle(doc, reg)
  const applied = applyOps(doc, [], reg, { checkOption: checkOption(doc) })
  if (!p || !applied.ok) return null
  const captions = applied.doc.bricks.find((b) => b.tech.startsWith('captions.make@'))?.settings as { burn?: unknown; preset?: unknown } | undefined
  const burnt = captions?.burn === true || (doc.options as Record<string, unknown>).captions === true
  const voice = applied.doc.bricks.find((b) => b.tech.startsWith('voice.tts@'))?.settings as { wpm?: unknown } | undefined
  return {
    kinds: Object.fromEntries(Object.entries(p.kinds ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number')),
    presenter: p.presenterShare ?? 0,
    shotS: p.shotS ?? null,
    wordsPerMinute: typeof voice?.wpm === 'number' ? voice.wpm : (p.wordsPerMinute ?? null),
    captions: burnt ? (typeof captions?.preset === 'string' ? captions.preset : 'classic') : null
  }
}

/** The question the agent asks on how to differ, when it did not word one (the case decides it). */
export function askFor(path: StudyPath, own: boolean, weak: boolean): string {
  if (own) return weak ? 'Ta chaîne reste la même ; veux-tu aussi l’une de ces améliorations ?' : 'Ta chaîne est reproduite à l’identique. Une seule chose à changer, peut-être ?'
  if (weak) return 'Cette chaîne ne décolle pas : on part sur une meilleure version ? Voici ce que je changerais d’abord.'
  if (path === 'translate') return 'Même montage, nouvelle langue. Comment veux-tu que ta chaîne se distingue de l’originale ?'
  if (path === 'rework') return 'Qu’est-ce qu’on change sur ta pipeline ? Voici ce que je te propose.'
  if (path === 'mix' || path === 'inspire') return 'Voici ce que chaque inspiration apporte. Tu veux encore te distinguer sur un point ?'
  return 'Comment veux-tu te différencier de cette chaîne ?'
}
