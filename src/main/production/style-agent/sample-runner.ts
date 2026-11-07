// A style sample as the app makes it (production-15): the sample pipeline compiled like a project's (the channel's settings,
// the styles at their versions) and started as a normal run of `ProductionRuns` — its own quote, wallet hold, cache and
// ledger, its imported narration as the `script` input — then read back: the run's state, what it spent, and the director's
// edit plan from the run's artefact store (what the likeness score measures). Its hold (the run's own quote, a worst case
// held from the wallet while it runs and given back when not spent) is read before, for the owner's quote. Never published.
import type { EditPlan } from '../../../engine/formats/editplan'
import { compileRecipe, type RecipeDoc } from '../../../engine/technologies'
import type { Db } from '../../db'
import { recipeError, type RecipeStore } from '../recipes/store'
import { readNodes, readRun } from '../runs/rows'
import type { ProductionRuns } from '../runs/service'
import type { SamplePort, SampleResult } from './service'

/**
 * A sample is real (Atelier Cloud's engines) whenever the runs can be (essais-utilisateur: on a brain signed in to the Cloud, « Voir un
 * exemple » made a demonstration video with drawn pictures and a system voice, priced 0 — the owner never saw the style).
 */
export const realSample = (r: Partial<Pick<ProductionRuns, 'realState'>>): boolean => r.realState?.().available === true

export function runSampler(db: Db, recipes: RecipeStore, runs: () => (Pick<ProductionRuns, 'startDocument' | 'storeFor' | 'quote'> & Partial<Pick<ProductionRuns, 'realState'>>) | null): SamplePort {
  const ready = () => {
    const r = runs()
    if (!r) throw new Error('Les fabrications ne sont pas disponibles ici.')
    return r
  }
  const compile = (doc: RecipeDoc, channelId: number) => {
    const compiled = compileRecipe(doc, recipes.registry, { channel: recipes.production(channelId), id: 'exemple-style', version: 1, styles: recipes.styleDocs(doc) })
    if (!compiled.ok) throw recipeError('Cet exemple ne peut pas se fabriquer', compiled.errors)
    return compiled.pipeline
  }
  return {
    async hold(o) {
      const p = compile(o.doc, o.channelId)
      const r = ready()
      const q = await r.quote({ channelId: o.channelId, topic: o.script.slice(0, 500), minutes: p.format.minutes.default, ...(realSample(r) ? { real: true } : {}) }, p)
      return { credits: q.modes[p.budget.default].totalCredits, debited: q.debited }
    },
    async start(o) {
      const r = ready()
      const p = compile(o.doc, o.channelId)
      const run = await r.startDocument(
        { channelId: o.channelId, title: o.title, topic: o.script.slice(0, 500), minutes: p.format.minutes.default, budgetMode: p.budget.default, gateMode: 'all', inputs: { script: o.script }, ...(realSample(r) ? { real: true } : {}) },
        p
      )
      return run.id
    },
    async result(runId): Promise<SampleResult> {
      const r = runs()
      const row = readRun(db, runId)
      const credits = row.spent_credits
      if (row.status === 'failed' || row.status === 'cancelled' || row.status === 'interrupted') {
        return { status: 'failed', error: row.error ?? 'L’exemple s’est arrêté.', plan: null, credits, lookFamily: null }
      }
      if (row.status !== 'succeeded' || !r) return { status: 'running', error: null, plan: null, credits, lookFamily: null }
      // the plan of any director: the mix director's, or the POV director's (pov@1, clone-monde-pov)
      const director = readNodes(db, runId).find((x) => x.type.startsWith('director.plan@') || x.type.startsWith('director.pov@'))
      const stored = director?.fingerprint ? await r.storeFor(row.video_id).getRun(director.fingerprint).catch(() => null) : null
      const plan = (stored?.outputs.plan?.value as EditPlan | undefined) ?? null
      return { status: 'done', error: null, plan, credits, lookFamily: null }
    }
  }
}
