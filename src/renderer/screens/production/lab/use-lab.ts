// What the Lab and « Pipelines prêtes » read (production-lab): my pipelines, the ready ones, every card's estimate (price
// and render time, the fit to the channel in view), what each of my pipelines is making now; and the ready pipelines'
// actions — « Ajouter à mes pipelines » (as is, or « Modifier » on the agent), « Utiliser cette pipeline » (a video now).
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { EstimateCardsView } from '../../../../shared/estimates'
import type { BasePipelineInfo, RecipeSummary } from '../../../../shared/recipes'
import type { Route } from '../../../../shared/sections'
import { toast } from '@/lib/toast'
import { useProto } from '@/proto/store'
import { call, errText, useApi, useLoader } from '@/state/client'
import { openNewVideoNext, openRecipeNext } from '../recettes/selection'
import { activityOf, type PipelineActivity } from './lab-model'

export interface LabData {
  recipes: RecipeSummary[] | null
  bases: BasePipelineInfo[] | null
  error: string | null
  estimates: EstimateCardsView | null
  activity: Map<number, PipelineActivity>
  channelName: (id: number) => string | null
  busy: boolean
  /** « Ajouter à mes pipelines »: a copy, opened in the editor (on the agent with `modify`). */
  add: (b: BasePipelineInfo, modify: boolean) => Promise<void>
  /** « Utiliser cette pipeline »: my copy of it (made when I have none), then the new video's form. */
  use: (b: BasePipelineInfo) => Promise<void>
  /** Opens one of my pipelines. */
  open: (id: number, opts?: { agent?: boolean }) => void
  /** The new video's form, on a pipeline (null: the first). */
  newVideo: (recipeId: number | null) => void
}

export function useLab(onRoute: (r: Route) => void): LabData {
  const state = useProto()
  const recipes = useApi('recipes.list', ['production'])
  const bases = useApi('recipes.bases', ['production'])
  const projects = useLoader(() => call('projects.list'), 'lab-projects', ['production'])
  const runs = useLoader(() => call('production.list', { status: ['queued', 'running', 'waiting'] }), 'lab-runs', ['production'])
  const scoped = state.scope !== 'all' && state.scope.startsWith('db-') ? Number(state.scope.slice(3)) : null
  const [estimates, setEstimates] = useState<EstimateCardsView | null>(null)
  const recipesKey = (recipes.data ?? []).map((r) => `${r.id}:${r.version}`).join(',')
  useEffect(() => {
    let live = true
    call('estimates.cards', scoped).then(
      (v) => live && setEstimates(v),
      () => live && setEstimates(null)
    )
    return () => {
      live = false
    }
  }, [scoped, recipesKey])
  const activity = useMemo(() => activityOf(projects.data ?? [], runs.data ?? []), [projects.data, runs.data])
  const [busy, setBusy] = useState(false)
  const open = (id: number, opts: { agent?: boolean } = {}): void => {
    openRecipeNext(id, opts)
    onRoute({ section: 'production', page: 'pipeline' })
  }
  const newVideo = (recipeId: number | null): void => {
    openNewVideoNext(recipeId)
    onRoute({ section: 'production', page: 'bibliotheque' })
  }
  const act = async (f: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return {
    recipes: recipes.data,
    bases: bases.data,
    error: recipes.error ?? bases.error,
    estimates,
    activity,
    channelName: (id) => state.channels.find((c) => c.id === `db-${id}`)?.name ?? null,
    busy,
    add: (b, modify) =>
      act(async () => {
        const d = await call('recipes.fromBase', b.id)
        toast.success(t('lab.added', { name: d.name }))
        open(d.id, { agent: modify })
      }),
    use: (b) =>
      act(async () => {
        const mine = (recipes.data ?? []).find((r) => r.base === b.id && !r.archived)
        newVideo(mine ? mine.id : (await call('recipes.fromBase', b.id)).id)
      }),
    open,
    newVideo
  }
}
