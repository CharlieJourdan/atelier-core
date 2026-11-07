// The ingredients of a study's pipeline as the owner sees them (parcours-utilisateur): each option priced per minute and timed for a
// video of the pipeline's length (before → after, on the recommended pipeline as proposed), the owner's choice, and the price shown
// up front with the few choices that move it most (« moins de présentateur : ≈ −40 % »).
import type { RecipeDoc, TechnologyRegistry } from '../../../engine/technologies'
import { applyOps, basePipeline, optionProblem } from '../../../engine/technologies'
import { estimateCost, type CostInput, type Range } from '../../../engine/technologies/cost'
import type { VideoMeasure } from '../../../engine/technologies/fit'
import { ingredientsOf } from '../../../engine/technologies/ingredients'
import type { IngredientView, PriceView } from '../../../shared/style-agent'
import { createHash } from 'node:crypto'
import { renderTime } from '../estimates/duration'

/** A lever is shown when it moves the price of a minute by at least this much (%). */
const LEVER_PCT = 5

/** A study is read every couple of seconds while a sample runs: the same pipeline, references and prices give the same options. */
const memo = new Map<string, Omit<IngredientView, 'chosen'>[]>()
const MEMO_MAX = 64

export function ingredientViews(doc: RecipeDoc, reg: TechnologyRegistry, refs: readonly VideoMeasure[], cost: CostInput | null, chosen: Readonly<Record<string, string>>): IngredientView[] {
  const key = createHash('sha256').update(JSON.stringify([doc, refs, cost ? createHash('sha256').update(JSON.stringify(cost)).digest('hex') : null])).digest('hex')
  let base = memo.get(key)
  if (!base) {
    base = computeViews(doc, reg, refs, cost)
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
    memo.set(key, base)
  }
  return base.map((i) => ({ ...i, chosen: i.options.some((o) => o.id === chosen[i.id]) ? (chosen[i.id] as string) : i.current }))
}

function computeViews(doc: RecipeDoc, reg: TechnologyRegistry, refs: readonly VideoMeasure[], cost: CostInput | null): Omit<IngredientView, 'chosen'>[] {
  const checkOption = (id: string, v: unknown): string | null => optionProblem(basePipeline(doc.base)?.options ?? [], id, v)
  const price = (d: RecipeDoc): Range | null => {
    if (!cost) return null
    const e = estimateCost(d, reg, cost)
    return e.ok ? e.estimate.perMinute : null
  }
  const minutes = doc.format.minutes
  const seconds = (d: RecipeDoc): number | null => renderTime(d, reg, minutes)?.seconds.avg ?? null
  const before = { price: price(doc), seconds: seconds(doc) }
  return ingredientsOf(doc, reg, refs).map((ing) => ({
    id: ing.id,
    title: ing.title,
    reference: ing.reference,
    current: ing.current,
    options: ing.options.map((o) => {
      const r = o.ops.length > 0 ? applyOps(doc, o.ops, reg, { checkOption }) : null
      const after = r?.ok ? r.doc : doc
      const p = r?.ok ? price(after) : before.price
      const t = r?.ok ? seconds(after) : before.seconds
      return {
        id: o.id,
        source: o.source,
        title: o.title,
        detail: o.detail,
        needs: o.needs,
        far: o.far,
        lever: o.lever ?? null,
        perMinute: before.price && p ? { before: before.price, after: p } : null,
        deltaPct: before.price && p && before.price.avg > 0 ? Math.round(((p.avg - before.price.avg) / before.price.avg) * 100) : null,
        renderSeconds: before.seconds !== null && t !== null ? { before: before.seconds, after: t } : null
      }
    })
  }))
}

/** The recommended pipeline's price of a minute and its levers (the options that move it most, never one far from the references). */
export function priceView(perMinute: Range | null, minutes: number, ingredients: readonly IngredientView[]): PriceView {
  const levers = ingredients
    .flatMap((i) => i.options.filter((o) => o.id !== i.current && !o.far && o.deltaPct !== null && Math.abs(o.deltaPct) >= LEVER_PCT).map((o) => ({ ingredient: i.id, option: o.id, title: o.lever ?? o.title, deltaPct: o.deltaPct as number, after: o.perMinute?.after ?? null })))
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 4)
  return { perMinute, minutes, levers }
}
