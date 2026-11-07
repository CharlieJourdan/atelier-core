// Small pieces shared by the rebuilt Production screens: a technology's label, the stage number of the « rail », the
// status badge, and the loading / error line.
import { t, type MessageKey } from '../../../../shared/fr'
import { RECIPE_STAGES, type RecipeStage, type TechnologyInfo } from '../../../../shared/recipes'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export const techLabel = (tech: Pick<TechnologyInfo, 'labelKey'>): string => t(tech.labelKey as MessageKey)
export const techBlurb = (tech: Pick<TechnologyInfo, 'labelKey'>): string => t(`${tech.labelKey}.blurb` as MessageKey)
export const stageLabel = (stage: RecipeStage): string => t(`recipe.stage.${stage}` as MessageKey)
export const stageHelp = (stage: RecipeStage): string => t(`recipe.stage.${stage}.help` as MessageKey)

/** The stage's number (1 to 7) in a round mark, the knot of the rail. */
export function StageMark({ stage, filled = true, className }: { stage: RecipeStage; filled?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'num inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
        filled ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-3 ring-1 ring-line-2',
        className
      )}
    >
      {RECIPE_STAGES.indexOf(stage) + 1}
    </span>
  )
}

export function TechStatus({ tech }: { tech: Pick<TechnologyInfo, 'status'> }) {
  return <Badge variant={tech.status === 'validated' ? 'ok' : 'warn'}>{t(`tech.status.${tech.status}` as MessageKey)}</Badge>
}

export function LoadLine({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="mb-3 text-[12.5px] text-warn" data-testid="load-error">{error}</p>
  if (loading) return <p className="mb-3 text-[12.5px] text-fg-3">{t('prodStart.loading')}</p>
  return null
}
