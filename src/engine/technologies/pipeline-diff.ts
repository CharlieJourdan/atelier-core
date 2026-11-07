// What a batch of edit operations changes in a pipeline (decision 0024, R10.1): the batch is applied to a copy (edit-ops.ts),
// then the two documents are compared field by field — name, format, mix, options, each brick's engine, fallbacks, style and
// settings, bricks added, removed or moved, gates, inputs, cap — with the average cost per minute and the fit % before and
// after. Nothing is saved here: the owner accepts the change, then the store saves it as a new version. Pure: no I/O.
import { estimateCost, type CostInput, type Range } from './cost'
import { applyOps, type ApplyOptions, type EditIssue } from './edit-ops'
import type { FitContext, VideoMeasure } from './fit'
import { fitPercent } from './propose'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'
import { techName } from './types'

export type PipelineChangeKind =
  | 'name'
  | 'format'
  | 'language'
  | 'mix'
  | 'option'
  | 'engine'
  | 'fallbacks'
  | 'style'
  | 'setting'
  | 'brick-added'
  | 'brick-removed'
  | 'order'
  | 'gates'
  | 'input'
  | 'cap'

export interface PipelineChange {
  kind: PipelineChangeKind
  /** The brick (technology name), the option, the setting or the input concerned. */
  brick?: string
  key?: string
  before: unknown
  after: unknown
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The changes from `a` to `b`, in the order of the document. */
export function diffPipelines(a: RecipeDoc, b: RecipeDoc): PipelineChange[] {
  const out: PipelineChange[] = []
  const top = (kind: PipelineChangeKind, x: unknown, y: unknown): void => {
    if (!same(x, y)) out.push({ kind, before: x ?? null, after: y ?? null })
  }
  top('name', a.name, b.name)
  top('format', a.format, b.format)
  top('language', a.language, b.language)
  top('mix', a.mix, b.mix)
  for (const key of new Set([...Object.keys(a.options), ...Object.keys(b.options)])) {
    if (!same(a.options[key], b.options[key])) out.push({ kind: 'option', key, before: a.options[key] ?? null, after: b.options[key] ?? null })
  }
  const names = (d: RecipeDoc): string[] => d.bricks.map((x) => techName(x.tech))
  const an = names(a)
  const bn = names(b)
  for (const x of b.bricks) {
    const name = techName(x.tech)
    const y = a.bricks.find((z) => techName(z.tech) === name)
    if (!y) {
      out.push({ kind: 'brick-added', brick: name, before: null, after: x.tech })
      continue
    }
    if (!same(y.engine, x.engine)) out.push({ kind: 'engine', brick: name, before: y.engine, after: x.engine })
    if (!same(y.fallbacks, x.fallbacks)) out.push({ kind: 'fallbacks', brick: name, before: y.fallbacks, after: x.fallbacks })
    if (!same(y.style, x.style)) out.push({ kind: 'style', brick: name, before: y.style, after: x.style })
    for (const key of new Set([...Object.keys(y.settings), ...Object.keys(x.settings)])) {
      if (!same(y.settings[key], x.settings[key])) out.push({ kind: 'setting', brick: name, key, before: y.settings[key] ?? null, after: x.settings[key] ?? null })
    }
  }
  for (const name of an) if (!bn.includes(name)) out.push({ kind: 'brick-removed', brick: name, before: name, after: null })
  const kept = (list: string[], other: string[]): string[] => list.filter((n) => other.includes(n))
  if (!same(kept(an, bn), kept(bn, an))) out.push({ kind: 'order', before: an, after: bn })
  top('gates', a.checkpoints, b.checkpoints)
  for (const key of new Set([...Object.keys(a.inputs), ...Object.keys(b.inputs)])) {
    if (!same(a.inputs[key], b.inputs[key])) out.push({ kind: 'input', key, before: a.inputs[key] ?? null, after: b.inputs[key] ?? null })
  }
  top('cap', a.capCredits, b.capCredits)
  return out
}

export interface TryInput {
  cost?: CostInput
  /** The channel's measured videos, for the fit before and after. */
  videos?: readonly VideoMeasure[]
  ctx?: FitContext
}

export interface TriedEdit {
  ok: true
  doc: RecipeDoc
  changes: PipelineChange[]
  /** Credits (or dollars, the book's currency) per finished minute, before and after; null without a book. */
  perMinute: { before: Range; after: Range } | null
  fit: { before: number | null; after: number | null }
}

/** Applies a batch to a copy, then says what changed, what it costs and how it fits. Typed errors when it is refused. */
export function tryEdit(doc: RecipeDoc, ops: readonly unknown[], reg: TechnologyRegistry, apply: ApplyOptions, input: TryInput = {}): TriedEdit | { ok: false; errors: EditIssue[] } {
  const r = applyOps(doc, ops, reg, apply)
  if (!r.ok) return r
  const cost = (d: RecipeDoc): Range | null => {
    if (!input.cost) return null
    const e = estimateCost(d, reg, input.cost)
    return e.ok ? e.estimate.perMinute : null
  }
  const before = cost(doc)
  const after = cost(r.doc)
  // a document the estimator refuses after the edit (options that no longer compile) is refused like a bad batch
  if (input.cost && before && !after) return { ok: false, errors: [{ op: -1, code: 'schema', message: 'the pipeline no longer compiles after these operations' }] }
  const videos = input.videos ?? []
  return {
    ok: true,
    doc: r.doc,
    changes: diffPipelines(doc, r.doc),
    perMinute: before && after ? { before, after } : null,
    fit: { before: fitPercent(doc, videos, reg, input.ctx), after: fitPercent(r.doc, videos, reg, input.ctx) }
  }
}
