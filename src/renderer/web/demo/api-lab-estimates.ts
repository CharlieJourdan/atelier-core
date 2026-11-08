// Demo fixtures, lab: what a pipeline costs and how close it is to a channel (estimates.*), its read-only graph (graph.*)
// and its saved previews (previews.*). The real numbers come from main's cost model and the Cloud's prices; here a small
// plausible table (credits per finished minute per picture kind) gives the same shapes, stable for the same document.
import { DEFAULT_ENGINES, engineFamilyOf } from '../../../shared/cloud-engines'
import type { EstimateCardsView, EstimateLineView, EstimateRange, FitView, PipelineCardEstimate, PipelineEstimateView } from '../../../shared/estimates'
import { OPTION_PREVIEWS, optionPreviewKey } from '../../../shared/option-previews'
import type { GraphEdgeView, GraphNodeView, PipelineGraphView } from '../../../shared/pipeline-graph'
import type { PreviewItem } from '../../../shared/previews'
import type { RecipeDocument } from '../../../shared/recipes'
import type { DemoHandlers } from './bridge'
import { BASES, baseById } from './api-lab-bases'
import { recipeDocs } from './api-lab-recipes'
import { hueOf, svgStill, techOf } from './api-lab-techs'
import { DEMO_CHANNELS, ago } from './world'

const CREDIT_EUR = 0.01

const range = (avg: number): EstimateRange => ({ min: round(avg * 0.78), avg: round(avg), max: round(avg * 1.35) })
const round = (n: number): number => Math.round(n * 10) / 10
const has = (doc: RecipeDocument, name: string): boolean => doc.bricks.some((b) => b.tech.startsWith(`${name}@`))

/** Credits per finished minute of each line, read from the bricks and the mix. */
function lines(doc: RecipeDocument): EstimateLineView[] {
  const mix = doc.mix ?? { imageAi: 0.7, clipAi: 0.3, curve: 'flat' as const }
  const minutes = doc.format.minutes
  const out: EstimateLineView[] = []
  const line = (id: EstimateLineView['id'], brick: string | null, family: keyof typeof DEFAULT_ENGINES, perMinute: number, oneOff = 0): void => {
    const b = brick ? doc.bricks.find((x) => x.tech.startsWith(`${brick}@`)) : undefined
    const engines = [b?.engine ?? DEFAULT_ENGINES[family].engine, ...(b?.fallbacks.length ? b.fallbacks : DEFAULT_ENGINES[family].fallbacks)]
    out.push({ id, brick, engines, perMinute: range(perMinute + oneOff / minutes), perVideo: range(perMinute * minutes + oneOff), unpriced: [] })
  }
  if (has(doc, 'avatar.speak')) line('presenter', 'avatar.speak', 'presenter', 60 * Math.max(0.15, mix.presenter ?? 0.35))
  if (has(doc, 'clip.make')) line('clips', 'clip.make', 'clip', 45 * Math.max(0.05, mix.clipAi ?? 0.2))
  if (doc.bricks.some((b) => b.tech.startsWith('visuals.'))) line('images', 'visuals.fulfil', 'image', 9 * Math.max(0.2, (mix.imageAi ?? 0.5) + (mix.stock ?? 0) * 0.2 + (mix.archive ?? 0) * 0.3))
  line('voice', 'voice.tts', 'voice', 2.5)
  if (has(doc, 'sound.music')) line('music', 'sound.music', 'music', 0.2)
  if (has(doc, 'thumbnail.make')) line('thumbnails', 'thumbnail.make', 'image', 0, 6)
  line('llm', null, 'llm', 0, 0)
  return out
}

const sum = (ls: EstimateLineView[], k: 'perMinute' | 'perVideo'): EstimateRange => ({
  min: round(ls.reduce((a, l) => a + l[k].min, 0)),
  avg: round(ls.reduce((a, l) => a + l[k].avg, 0)),
  max: round(ls.reduce((a, l) => a + l[k].max, 0))
})

/** A stable 55..93 % fit of a document to a channel. */
function fitPercent(doc: RecipeDocument, channelId: number): number {
  return 55 + (hueOf(`${doc.name}|${doc.base ?? ''}|${channelId}`) % 39)
}

function fitOf(doc: RecipeDocument, channelId: number | null | undefined): FitView {
  if (channelId === null || channelId === undefined) return { state: 'no-channel' }
  const percent = fitPercent(doc, channelId)
  const s = (k: number): number => Math.min(100, Math.max(20, percent + ((hueOf(`${doc.name}${k}`) % 30) - 15)))
  return {
    state: 'ok',
    channelId,
    percent,
    videos: 12 + (channelId % 4) * 3,
    demo: true,
    dimensions: [
      { id: 'presenter', weight: 0.2, score: has(doc, 'avatar.speak') ? s(1) : null },
      { id: 'kinds', weight: 0.25, score: s(2) },
      { id: 'rhythm', weight: 0.2, score: s(3) },
      { id: 'script', weight: 0.15, score: s(4) },
      { id: 'look', weight: 0.1, score: s(5) },
      { id: 'text', weight: 0.05, score: s(6) },
      { id: 'sponsor', weight: 0.05, score: null }
    ],
    gaps:
      percent < 85
        ? [
            { dimension: 'rhythm', score: s(3), scoreAfter: Math.min(100, s(3) + 12), closer: { kind: 'rhythm', shotLengthS: { imageAi: 3.2 } }, costDelta: 0.4 },
            { dimension: 'kinds', score: s(2), scoreAfter: Math.min(100, s(2) + 9), closer: { kind: 'mix', shares: { clipAi: 0.3, imageAi: 0.7 } }, costDelta: 2.1 }
          ]
        : []
  }
}

/** Per option, per value: a small Δ of credits per finished minute (0 for the default). */
function optionDeltas(doc: RecipeDocument): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const o of baseById(doc.base)?.options ?? []) {
    const values = o.kind === 'slider' ? ['+0.05'] : o.choices.map((c) => String(c.value))
    out[o.id] = Object.fromEntries(values.map((v) => [v, v === String(o.default) ? 0 : round(((hueOf(o.id + v) % 50) - 15) / 10)]))
  }
  return out
}

function renderTimes(doc: RecipeDocument): PipelineEstimateView['renderTimes'] {
  const perMinute = has(doc, 'avatar.speak') ? 260 : has(doc, 'clip.make') ? 180 : 95
  const at = (minutes: number) => ({ minutes, seconds: { min: Math.round(perMinute * minutes * 0.7), avg: Math.round(perMinute * minutes), max: Math.round(perMinute * minutes * 1.6) } })
  return [at(doc.format.minutes), ...[1, 8, 20].filter((m) => m !== doc.format.minutes).map(at)]
}

export function estimateOf(doc: RecipeDocument, channelId?: number | null): PipelineEstimateView {
  const ls = lines(doc)
  return {
    available: true,
    reason: null,
    prices: { at: ago(42), source: 'cache' },
    creditEur: CREDIT_EUR,
    minutes: doc.format.minutes,
    perMinute: sum(ls, 'perMinute'),
    perVideo: sum(ls, 'perVideo'),
    lines: ls,
    assumedMix: doc.mix === null,
    llm: { backend: 'subscription', tasks: ['script', 'director', 'package'], onCreditsPerVideo: round(doc.format.minutes * 1.8), apiKeyEurPerVideo: round(doc.format.minutes * 0.02), included: true },
    optionDeltas: optionDeltas(doc),
    fixedMonthly: [],
    renderTimes: renderTimes(doc),
    fit: fitOf(doc, channelId)
  }
}

function card(doc: RecipeDocument, channelId: number | null | undefined): PipelineCardEstimate {
  const e = estimateOf(doc, channelId)
  return { perMinute: e.perMinute, perVideo: e.perVideo, fit: e.fit.state === 'ok' ? e.fit.percent : null, renderTime: e.renderTimes[0] ?? null }
}

// ------------------------------------------------------------------------------------------------ graph

/** What each stage hands to the next (the slot an edge carries). */
const SLOT: Record<string, string> = { idee: 'brief', script: 'script', voix: 'voice', realisateur: 'plan', elements: 'media', montage: 'video', controle: 'video' }

export function graphOf(doc: RecipeDocument): PipelineGraphView {
  const nodes: GraphNodeView[] = doc.bricks.map((b) => {
    const t = techOf(b.tech)
    const name = b.tech.split('@')[0] ?? b.tech
    const family = t?.engineFamily ?? null
    return {
      id: name,
      tech: b.tech,
      labelKey: t?.labelKey ?? `tech.${name}`,
      stage: t?.stage ?? 'elements',
      kind: t?.kind ?? 'node',
      nodeIds: [name.replace('.', '-')],
      reads: (t?.inputs ?? []).map((i) => i.id),
      engine: family ? (b.engine ?? DEFAULT_ENGINES[family].engine) : null,
      engineDefault: family !== null && b.engine === null,
      fallbacks: b.fallbacks,
      style: b.style,
      gate: name === 'idea.brief' || name === 'thumbnail.make',
      off: null
    }
  })
  const edges: GraphEdgeView[] = []
  const order = ['idee', 'script', 'voix', 'realisateur', 'elements', 'montage', 'controle']
  for (const n of nodes) {
    const i = order.indexOf(n.stage)
    const from = [...nodes].reverse().find((m) => order.indexOf(m.stage) === i - 1) ?? nodes.slice(0, nodes.indexOf(n)).reverse().find((m) => m.stage === n.stage)
    if (from && from !== n) edges.push({ from: from.id, to: n.id, slot: SLOT[from.stage] ?? 'data', off: false })
  }
  const inputs = new Map<string, PipelineGraphView['inputs'][number]>()
  for (const b of doc.bricks) {
    for (const i of techOf(b.tech)?.inputs ?? []) {
      const src = doc.inputs[i.id]
      inputs.set(i.id, { ...i, source: src === undefined || src === 'project' ? 'project' : src === 'channel' ? 'channel' : 'fixed' })
    }
  }
  const output = nodes.find((n) => n.id === 'package.youtube')?.id ?? nodes.find((n) => n.id === 'render.assemble')?.id ?? null
  return { ok: true, errors: [], nodes, edges, inputs: [...inputs.values()], output }
}

// ------------------------------------------------------------------------------------------------ previews

const FAMILY_WORD: Record<string, string> = { image: 'Images', clip: 'Clips', presenter: 'Présentateur' }

function preview(key: string, kind: PreviewItem['kind'], family: PreviewItem['family'], label: string): PreviewItem {
  return { key, kind, family, label, source: 'demo', madeAt: ago(60 * 24 * 6), files: [{ ref: 'still.svg', type: 'image' }] }
}

function previewsForDoc(doc: RecipeDocument): PreviewItem[] {
  const out = new Map<string, PreviewItem>()
  for (const b of doc.bricks) {
    const fam = techOf(b.tech)?.engineFamily
    if (fam !== 'image' && fam !== 'clip' && fam !== 'presenter') continue
    if (b.style) out.set(`style:${b.style}`, preview(`style:${b.style.replace(/@\d+$/, '')}`, 'style', fam, `${FAMILY_WORD[fam]} · ${b.style.replace(/@\d+$/, '').replace(/-/g, ' ')}`))
    for (const e of [b.engine ?? DEFAULT_ENGINES[fam].engine, ...b.fallbacks]) {
      if (engineFamilyOf(e) === fam && !out.has(e)) out.set(e, preview(e, 'engine', fam, `${FAMILY_WORD[fam]} · exemple ${out.size + 1}`))
    }
  }
  return [...out.values()]
}

const OPTION_ITEMS: PreviewItem[] = OPTION_PREVIEWS.flatMap((p) =>
  (['before', 'after'] as const).map((side) => preview(optionPreviewKey(p.option, p[side]), 'option', 'image', `${p.option} : ${side === 'before' ? 'avant' : 'après'}`))
)

export const estimatesHandlers: DemoHandlers = {
  'estimates.pipeline': (doc, channelId) => estimateOf(doc, channelId),
  'estimates.cards': (channelId): EstimateCardsView => {
    const bases: Record<string, PipelineCardEstimate> = {}
    for (const b of BASES) bases[b.id] = card(b.doc, channelId)
    const recipes: Record<number, PipelineCardEstimate> = {}
    for (const r of recipeDocs()) recipes[r.id] = card(r.doc, channelId ?? DEMO_CHANNELS[0]?.id)
    return { available: true, reason: null, creditEur: CREDIT_EUR, bases, recipes }
  },
  'graph.pipeline': (doc) => graphOf(doc),
  'graph.run': () => {
    const first = recipeDocs()[0]
    return first ? graphOf(first.doc) : null
  },
  'previews.forDoc': (doc) => previewsForDoc(doc),
  'previews.options': () => OPTION_ITEMS,
  'previews.file': (key, ref) => {
    const after = key.endsWith(':true') || /:(auto|library|recrops|all|presenter-as-actor|dynamic)$/.test(key)
    const label = key.startsWith('option:') ? `${key.split(':')[1] ?? ''} · ${after ? 'après' : 'avant'}` : (key.split(':')[1] ?? key).replace(/-/g, ' ')
    const bytes = new TextEncoder().encode(svgStill(label, hueOf(key) + (after ? 140 : 0)))
    return { name: ref, mime: 'image/svg+xml', size: bytes.length, bytes }
  }
}
