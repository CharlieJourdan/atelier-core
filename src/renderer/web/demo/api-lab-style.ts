// Demo fixtures, lab: « Reproduire un style » (style.*). The real agent measures the visitor's links with the eyes; the
// demo never reads a link (no real channel is analysed): it answers with an invented measure, marked as a demonstration,
// and three variants of the closest base pipeline with their price and likeness. A sample is quoted, then « made » over a
// few seconds (the screen polls style.get while it runs), with its likeness score and its three biggest gaps.
import type { EstimateRange } from '../../../shared/estimates'
import type { RecipeDocument } from '../../../shared/recipes'
import type { DifferentiatorView, StudyInput, StudySummary, StudyView, StyleVariantView } from '../../../shared/style-agent'
import { changed, type DemoHandlers } from './bridge'
import { BASES } from './api-lab-bases'
import { estimateOf } from './api-lab-estimates'
import { saveRecipe } from './api-lab-recipes'
import { DEMO_CHANNELS, nextId } from './world'

const studies: StudyView[] = []
const timers = new Map<number, number>()

function pickBase(input: StudyInput): { id: string; reason: StudyView['reason'] } {
  const text = `${input.text ?? ''} ${input.instructions ?? ''}`.toLowerCase()
  const has = (prefix: string): string | null => BASES.find((b) => b.id.startsWith(prefix))?.id ?? null
  if (input.format === 'short' || /short|vertical|reddit/.test(text)) return { id: has('story-short') ?? 'story-short@1', reason: 'story' }
  if (/pr[ée]sentat|avatar|face cam/.test(text)) return { id: has('avatar@1') ?? 'avatar@1', reason: 'presenter' }
  if (/animation|pov|dessin/.test(text)) return { id: has('pov') ?? 'pov@1', reason: 'animation' }
  if (/voix off|sans pr[ée]sentateur/.test(text)) return { id: has('voiceover') ?? 'voiceover@1', reason: 'no-presenter' }
  return { id: has('documentary') ?? BASES[0]?.id ?? 'avatar@1', reason: 'documentary' }
}

const scale = (r: EstimateRange, k: number): EstimateRange => ({ min: Math.round(r.min * k * 10) / 10, avg: Math.round(r.avg * k * 10) / 10, max: Math.round(r.max * k * 10) / 10 })

function variants(baseId: string, title: string, language: string | null): StyleVariantView[] {
  const base = BASES.find((b) => b.id === baseId) ?? BASES[0]
  if (!base) return []
  const make = (kind: StyleVariantView['kind'], suffix: string, k: number, likeness: number, edits: number): StyleVariantView => {
    const doc: RecipeDocument = { ...structuredClone(base.doc), base: base.id, name: `${title} — ${suffix}`, language }
    const e = estimateOf(doc)
    return { kind, doc, ops: [], perMinute: scale(e.perMinute, k), likeness, fit: null, edits }
  }
  return [make('faithful', 'fidèle', 1, 84, 6), make('cheap', 'économique', 0.55, 71, 4), make('premium', 'premium', 1.6, 90, 8)]
}

const DIFFS: Omit<DifferentiatorView, 'picked'>[] = [
  { id: 'cards', family: 'motion', effect: 'differ', title: 'Des cartes animées à la place des photos fixes', detail: 'Le même récit, mais chaque lieu apparaît sur une carte qui se dessine.', previewKey: null, beforeKey: null, recommended: true, sketch: null, perMinute: null, renderSeconds: { before: 840, after: 910 }, likeness: { before: 84, after: 79 } },
  { id: 'faster', family: 'rhythm', effect: 'improve', title: 'Un rythme un peu plus soutenu', detail: 'Des plans de 4 secondes au lieu de 6 : plus vivant, sans fatiguer.', previewKey: null, beforeKey: null, recommended: false, sketch: null, perMinute: null, renderSeconds: null, likeness: { before: 84, after: 82 } },
  { id: 'stills', family: 'economy', effect: 'cheaper', title: 'Plus d’images fixes, moins de clips', detail: 'La moitié des clips devient des images animées : environ 35 % moins cher.', previewKey: null, beforeKey: null, recommended: false, sketch: null, perMinute: null, renderSeconds: { before: 840, after: 600 }, likeness: { before: 84, after: 78 } }
]

function newStudy(input: StudyInput): StudyView {
  const links = (input.links ?? []).filter((l) => l.trim())
  const { id: base, reason } = pickBase(input)
  const title = (input.text?.trim() || 'Style de référence').slice(0, 60)
  const language = input.language ?? 'fr'
  const vs = variants(base, title, language)
  const minutes = vs[0]?.doc.format.minutes ?? 10
  return {
    id: nextId(),
    path: input.path ?? 'clone',
    text: input.text ?? '',
    instructions: input.instructions ?? '',
    links,
    insights: [],
    inspirations: [],
    rework: null,
    ask: '',
    feasibility: null,
    scope: input.scope ?? 'video',
    ingredients: [],
    price: { perMinute: vs[0]?.perMinute ?? null, minutes, levers: [] },
    timing: { analysisS: 95, sampleS: 240, videoS: Math.round(minutes * 150), minutes },
    references: links.map((url, i) => ({ url, kind: /\/@|\/channel\//.test(url) ? 'channel' : 'video', title: `Référence ${i + 1} (démo : lien non lu)`, videos: 3, demo: true, problem: null })),
    profile: { minutes, presenterShare: reason === 'presenter' ? 0.4 : 0, layouts: reason === 'presenter' ? ['full', 'corner'] : [], kinds: { imageAi: 0.55, clipAi: 0.2, stock: 0.25 }, shotS: 5.2, lookFamily: 'archive', captions: reason === 'story', labelsPerMinute: 1.4, wordsPerMinute: 142, curve: 'hook-heavy', offerAtS: null },
    measured: 3,
    demo: true,
    base,
    reason,
    variants: vs,
    recommended: 'faithful',
    differentiators: DIFFS.map((d) => ({ ...d, picked: false })),
    own: input.own === true,
    language,
    questions: [{ id: 'captions', choices: ['yes', 'no'], default: reason === 'story' ? 'yes' : 'no', answer: null }],
    summary: 'Démo : mesure inventée. Un récit posé sur des images d’archives et des cartes, avec une accroche forte dans les dix premières secondes. Les vraies références sont lues par les yeux d’Atelier dans l’application.',
    agentNote: null,
    script: 'Ce soir, une énigme que personne n’a jamais résolue. Tout commence par une lettre, retrouvée au fond d’un tiroir…',
    channelId: DEMO_CHANNELS[0]?.id ?? null,
    quote: null,
    sample: null,
    measureCredits: 0,
    creditEur: 0.01,
    createdAt: new Date().toISOString()
  }
}

function find(id: number): StudyView {
  const s = studies.find((x) => x.id === id)
  if (!s) throw new Error('Étude introuvable.')
  return s
}

const variantOf = (s: StudyView, kind: string): StyleVariantView => {
  const v = s.variants.find((x) => x.kind === kind)
  if (!v) throw new Error('Variante inconnue.')
  return v
}

const out = (s: StudyView): StudyView => structuredClone(s)

/** Ends a running sample: a likeness score near the variant's estimate and its three biggest gaps. */
function finishSample(s: StudyView): void {
  if (!s.sample || s.sample.status !== 'running') return
  const v = variantOf(s, s.sample.variant)
  const score = (v.likeness ?? 80) - 3
  s.sample = {
    ...s.sample,
    status: 'done',
    measures: s.profile,
    score,
    dimensions: [
      { id: 'mix', weight: 0.25, score: score + 4 },
      { id: 'rhythm', weight: 0.2, score: score - 9 },
      { id: 'presenter', weight: 0.15, score: s.reason === 'presenter' ? score - 2 : null },
      { id: 'look', weight: 0.15, score: score + 2 },
      { id: 'text', weight: 0.1, score: score - 12 },
      { id: 'pace', weight: 0.15, score: score + 1 }
    ],
    predicted: v.likeness,
    gaps: [
      { dimension: 'text', score: score - 12, ops: [{ op: 'setOption', option: 'captions', value: true }], changes: [{ kind: 'option', key: 'captions', before: false, after: true }], scoreAfter: score - 2, perMinute: null },
      { dimension: 'rhythm', score: score - 9, ops: [{ op: 'setOption', option: 'editing', value: 'dynamic' }], changes: [{ kind: 'option', key: 'editing', before: 'simple', after: 'dynamic' }], scoreAfter: score - 1, perMinute: null }
    ],
    credits: s.quote?.credits.avg ?? 0
  }
  changed('production')
}

export const styleHandlers: DemoHandlers = {
  'style.study': (input) => {
    const s = newStudy(input)
    studies.unshift(s)
    changed('production')
    return out(s)
  },
  'style.get': (id) => out(find(id)),
  'style.list': (): StudySummary[] => studies.map((s) => ({ id: s.id, title: s.text || s.links[0] || 'Étude', base: s.base, score: s.sample?.score ?? null, createdAt: s.createdAt })),
  'style.answer': (id, answers) => {
    const s = find(id)
    s.questions = s.questions.map((q) => (answers[q.id] !== undefined ? { ...q, answer: answers[q.id] ?? null } : q))
    return out(s)
  },
  'style.channel': (id, channelId) => {
    const s = find(id)
    s.channelId = channelId
    return out(s)
  },
  'style.script': (id, script) => {
    const s = find(id)
    s.script = script.trim()
    return out(s)
  },
  'style.quote': (id, variant) => {
    const s = find(id)
    const v = variantOf(s, variant)
    const seconds = 45
    const per = v.perMinute ?? { min: 10, avg: 14, max: 20 }
    s.quote = { id: `q-${nextId()}`, variant: v.kind, credits: scale(per, seconds / 60), hold: null, debited: false, seconds, script: s.script, channelId: s.channelId ?? DEMO_CHANNELS[0]?.id ?? 1 }
    return out(s)
  },
  'style.sample': (id, variant, quoteId) => {
    const s = find(id)
    if (!s.quote || s.quote.id !== quoteId) throw new Error('Ce devis n’est plus valable : redemande-le.')
    s.sample = { variant: variantOf(s, variant).kind, status: 'running', runId: nextId(), stale: false, error: null, measures: null, score: null, dimensions: [], predicted: null, gaps: [], lookFromStyle: false, credits: 0 }
    clearTimeout(timers.get(id))
    timers.set(id, window.setTimeout(() => finishSample(s), 7000))
    return out(s)
  },
  'style.applyGap': (id, index) => {
    const s = find(id)
    const gap = s.sample?.gaps[index]
    if (!s.sample || !gap) throw new Error('Écart introuvable.')
    const v = variantOf(s, s.sample.variant)
    for (const op of gap.ops) if (op.op === 'setOption' && typeof op.option === 'string') v.doc.options[op.option] = op.value as string | boolean
    v.edits += 1
    if (v.likeness !== null && gap.scoreAfter !== null) v.likeness = Math.min(99, v.likeness + Math.round((gap.scoreAfter - gap.score) / 3))
    s.sample = { ...s.sample, stale: true, gaps: s.sample.gaps.filter((_, i) => i !== index) }
    return out(s)
  },
  'style.pick': (id, ids) => {
    const s = find(id)
    s.differentiators = s.differentiators.map((d) => ({ ...d, picked: ids.includes(d.id) }))
    return out(s)
  },
  'style.choose': (id, ingredient, option) => {
    const s = find(id)
    s.ingredients = s.ingredients.map((g) => (g.id === ingredient ? { ...g, chosen: option } : g))
    return out(s)
  },
  'style.adopt': (id, variant) => {
    const s = find(id)
    const v = variantOf(s, variant)
    return saveRecipe(structuredClone(v.doc), `Depuis « Reproduire un style » (${v.kind})`)
  }
}
