// The small « simulé » mark of a part of the onboarding that has no real service behind it yet (Google, the Claude login,
// the competitors list…). Shown in real mode only: the demo is entirely simulated, so it needs no mark.
import { t } from '../../../../shared/fr'
import { useIsLiveOnboarding } from '@/proto/live/use-onboarding-live'
import { cn } from '@/lib/utils'

export function SimBadge({ className }: { className?: string }) {
  const live = useIsLiveOnboarding()
  if (!live) return null
  return (
    <span
      data-testid="sim-badge"
      title={t('onb.live.sim.hint')}
      className={cn('inline-flex h-5 items-center rounded-full border border-line-2 px-2 text-[11px] font-medium text-fg-3', className)}
    >
      {t('onb.live.sim')}
    </span>
  )
}
