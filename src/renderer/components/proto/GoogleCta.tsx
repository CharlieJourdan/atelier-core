// « Connecte Google », real mode: the channels' figures (views, watch time, subscribers, estimated revenue) need the owner's
// Google account; the button opens Réglages › Chaînes, where the Google block connects it. Shown by Chaînes and Monétisation.
import { BarChart3 } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const GOOGLE_SETTINGS_ROUTE: Route = { section: 'reglages', page: 'chaines' }

/** « Connecte Google »: the figures of the channels need the owner's Google account. */
export function GoogleCta({ onRoute, className }: { onRoute: (r: Route) => void; className?: string }) {
  return (
    <div data-testid="google-cta" className={cn('flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-dashed border-line-3 px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-fg">{t('live.google.cta.title')}</p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">{t('live.google.cta.body')}</p>
        </div>
      </div>
      <Button size="sm" data-testid="google-cta-connect" onClick={() => onRoute(GOOGLE_SETTINGS_ROUTE)}>
        {t('live.google.cta.button')}
      </Button>
    </div>
  )
}

