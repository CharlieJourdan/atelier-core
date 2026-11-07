// « Mes pipelines » on the Lab's side (production-lab, Charlie 01/11: « une petite case… un petit rectangle, avec le nombre
// de vidéos en cours de production, pareil pour le prix moyen et le nombre de chaînes »): per pipeline its name, its
// Long / Short tag, a small graph of its stages that fills as its furthest video moves on, its videos in production, the
// average price of a video in credits beside its average render time, and its channels. A click opens the pipeline.
import { Clapperboard, Coins, Tv } from 'lucide-react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { EstimateCardsView } from '../../../../shared/estimates'
import type { PipelineForm, RecipeStage, RecipeSummary } from '../../../../shared/recipes'
import { cn } from '@/lib/utils'
import { durationText } from '../recettes/estimate-format'
import { stageLabel } from '../recettes/ui'
import { creditsText, stagesDone, videoSpecs, type PipelineActivity } from './lab-model'

/** « Long format » / « Short ». */
export function FormTag({ form, className }: { form: PipelineForm; className?: string }) {
  return (
    <span
      data-testid="form-tag"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap',
        form === 'short' ? 'border-info/30 bg-info/10 text-info' : 'border-line-2 bg-surface-2 text-fg-2',
        className
      )}
    >
      <span aria-hidden className={cn('inline-block rounded-[2px] border border-current', form === 'short' ? 'h-2.5 w-1.5' : 'h-1.5 w-2.5')} />
      {t(`lab.form.${form}` as MessageKey)}
    </span>
  )
}

/** The pipeline's stages as knots on a line; the done ones filled, the current one breathing while a video is in production. */
export function MiniGraph({ stages, progress, testId }: { stages: readonly RecipeStage[]; progress: number | null; testId?: string }) {
  const done = stagesDone(stages.length, progress)
  const live = progress !== null
  return (
    <div role="img" aria-label={t('lab.card.graph')} className="flex w-full items-center" data-testid={testId}>
      {stages.map((s, i) => {
        const state = i < done ? 'done' : live && i === done ? 'now' : 'todo'
        return (
          <div key={s} className={cn('flex items-center', i > 0 && 'flex-1')} title={stageLabel(s)}>
            {i > 0 && <span aria-hidden className={cn('h-[2px] flex-1 rounded-full', i <= done ? 'bg-brand' : 'bg-line-2')} />}
            <span
              aria-hidden
              data-state={state}
              className={cn(
                'relative block size-2.5 shrink-0 rounded-full',
                state === 'done' && 'bg-brand',
                state === 'now' && 'bg-brand ring-4 ring-brand-soft',
                state === 'todo' && 'bg-surface-3 ring-1 ring-line-3'
              )}
            >
              {state === 'now' && <span className="absolute inset-0 animate-ping rounded-full bg-brand/60" />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const plural = (base: string, n: number): string => (n === 0 ? t(`${base}.none` as MessageKey) : n === 1 ? t(`${base}.one` as MessageKey) : t(`${base}.many` as MessageKey, { n }))

export function MyPipelineCard({
  recipe,
  activity,
  estimates,
  onOpen
}: {
  recipe: RecipeSummary
  activity: PipelineActivity | undefined
  estimates: EstimateCardsView | null
  onOpen: (id: number) => void
}) {
  const specs = videoSpecs(estimates?.recipes[recipe.id], recipe.minutes)
  const videos = activity?.videos ?? 0
  return (
    <button
      type="button"
      data-testid={`recipe-${recipe.id}`}
      onClick={() => onOpen(recipe.id)}
      className={cn(
        'group card flex w-full flex-col gap-3 p-4 text-left transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring',
        recipe.archived && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{recipe.name}</h3>
        <FormTag form={recipe.form} />
      </div>
      <MiniGraph stages={recipe.stages} progress={activity?.progress ?? null} testId={`recipe-graph-${recipe.id}`} />
      <div className="flex flex-col gap-1.5 text-[12px]">
        <span className={cn('flex items-center gap-1.5', videos > 0 ? 'font-medium text-brand-fg' : 'text-fg-3')} data-testid={`recipe-videos-${recipe.id}`}>
          <Clapperboard className="size-3.5 shrink-0" aria-hidden />
          {plural('lab.card.videos', videos)}
        </span>
        <span className="num flex items-center gap-1.5 text-fg-2" data-testid={`recipe-price-${recipe.id}`}>
          <Coins className="size-3.5 shrink-0 text-fg-3" aria-hidden />
          {specs.credits !== null ? t('lab.card.perVideo', { credits: creditsText(specs.credits) }) : t('lab.spec.unknown')}
          {specs.seconds !== null && <span className="text-fg-3">· {durationText(specs.seconds)}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-fg-3" data-testid={`recipe-channels-${recipe.id}`}>
          <Tv className="size-3.5 shrink-0" aria-hidden />
          {plural('lab.card.channels', recipe.channels.length)}
          {recipe.archived && <span className="ml-auto text-warn">{t('lab.card.archived')}</span>}
        </span>
      </div>
    </button>
  )
}
