// The Lab's pure helpers (production-lab): the category of a ready pipeline, the orders of « Pipelines prêtes », the price of
// a video in credits from a card's estimate, and what each of my pipelines is making now (its videos in production and
// how far the furthest one is). No React here: tests/unit/production-lab.test.tsx checks them.
import type { EstimateCardsView, PipelineCardEstimate } from '../../../../shared/estimates'
import type { BasePipelineInfo, PipelineForm, ProjectSummary, RecipeSummary } from '../../../../shared/recipes'
import type { RunStatus, RunSummary } from '../../../../shared/runs'

/** A ready pipeline's category: the family of its id (`avatar@1` → `avatar`). One today; more come with more pipelines. */
export const categoryOf = (b: Pick<BasePipelineInfo, 'id'>): string => b.id.split('@')[0] ?? b.id

/** The categories of the ready pipelines, in their first appearance order. */
export const categoriesOf = (bases: readonly Pick<BasePipelineInfo, 'id'>[]): string[] => [...new Set(bases.map(categoryOf))]

export const READY_SORTS = ['used', 'cheap', 'fast'] as const
export type ReadySort = (typeof READY_SORTS)[number]

/** What one video of a pipeline costs on average, in credits (rounded), and its average render time in seconds. */
export interface VideoSpecs {
  credits: number | null
  seconds: number | null
}

export function videoSpecs(est: PipelineCardEstimate | undefined, minutes: number): VideoSpecs {
  const credits = est && est.perMinute.avg > 0 ? Math.round(est.perVideo?.avg ?? est.perMinute.avg * minutes) : null
  return { credits, seconds: est?.renderTime ? est.renderTime.seconds.avg : null }
}

/** The ready pipelines of one category (null: all) and one form (null: both), in the order asked; « Les plus utilisées » is
 *  the default, Long format the default form (Charlie 01/11: long form first, short shown but secondary). */
export function sortReady(
  bases: readonly BasePipelineInfo[],
  sort: ReadySort,
  estimates: EstimateCardsView | null,
  category: string | null = null,
  form: PipelineForm | null = null
): BasePipelineInfo[] {
  const specs = (b: BasePipelineInfo): VideoSpecs => videoSpecs(estimates?.bases[b.id], b.doc.format.minutes)
  const last = Number.POSITIVE_INFINITY
  const key = (b: BasePipelineInfo): number => {
    if (sort === 'used') return -b.copies
    if (sort === 'cheap') return specs(b).credits ?? last
    return specs(b).seconds ?? last
  }
  return bases.filter((b) => (category === null || categoryOf(b) === category) && (form === null || b.form === form)).sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id))
}

const ACTIVE: readonly RunStatus[] = ['queued', 'running', 'waiting']

/** What a pipeline is making now: its videos in production and the progress (0..1) of the furthest one, or null. */
export interface PipelineActivity {
  videos: number
  progress: number | null
}

/** Per pipeline id: its videos in production (projects whose run is queued, running or waiting) and how far they are. */
export function activityOf(projects: readonly ProjectSummary[], runs: readonly Pick<RunSummary, 'id' | 'progress'>[]): Map<number, PipelineActivity> {
  const progress = new Map(runs.map((r) => [r.id, r.progress]))
  const out = new Map<number, PipelineActivity>()
  for (const p of projects) {
    if (p.runId === null || !p.runStatus || !(ACTIVE as readonly string[]).includes(p.runStatus)) continue
    const a = out.get(p.recipeId) ?? { videos: 0, progress: null }
    const pr = progress.get(p.runId) ?? 0
    out.set(p.recipeId, { videos: a.videos + 1, progress: Math.max(a.progress ?? 0, Math.min(1, Math.max(0, pr))) })
  }
  return out
}

/** How many stages of `count` are done at `progress` (the current one is the next). */
export const stagesDone = (count: number, progress: number | null): number => (progress === null ? 0 : Math.min(count, Math.floor(progress * count)))

/** My pipelines the Lab lists: the live ones first (by videos in production), long format before short, then as the list gives them. */
export function orderMine(recipes: readonly RecipeSummary[], activity: Map<number, PipelineActivity>): RecipeSummary[] {
  const live = (r: RecipeSummary): number => activity.get(r.id)?.videos ?? 0
  return recipes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(a.r.archived) - Number(b.r.archived) || live(b.r) - live(a.r) || Number(a.r.form === 'short') - Number(b.r.form === 'short') || a.i - b.i)
    .map((x) => x.r)
}

/** `1 240` (French grouping, a narrow no-break space). */
export const creditsText = (n: number): string => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)
