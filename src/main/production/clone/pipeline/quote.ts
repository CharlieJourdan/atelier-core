// The `cloud` service of the cloning engine (CloneServices.cloud, chantier moteur-pipeline, decision 0099): the Cloud's quote of a
// plan, in dollars per finished minute, before anything is spent. The plan's compiled recipe is quoted for its own length by the
// injected port (the app's recipe quote: the Cloud's prices, never a price of our own); the per-minute figure is that quote divided
// by the length. A plan without a compiled recipe cannot be quoted (P5 compiles it).
import type { PipelinePlan } from '../../../../shared/clone'

export interface RecipeQuotePort {
  /** Dollars the Cloud quotes for one video of `minutes` made with this recipe (the dearest engines of each brick it may use). */
  quoteRecipe(recipe: unknown, minutes: number): Promise<number>
}

export function planQuoteService(port: RecipeQuotePort): { quoteUsdPerMinute(plan: PipelinePlan): Promise<number> } {
  return {
    async quoteUsdPerMinute(plan) {
      if (!plan.recipe) throw new Error('the plan has no compiled recipe: P5 compiles it before a quote')
      const minutes = (plan.recipe as { format?: { minutes?: number } }).format?.minutes ?? 10
      const usd = await port.quoteRecipe(plan.recipe, minutes)
      if (!Number.isFinite(usd) || usd < 0) throw new Error(`the Cloud's quote is not a price: ${usd}`)
      return Math.round((usd / minutes) * 1000) / 1000
    }
  }
}
