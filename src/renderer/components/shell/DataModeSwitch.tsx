// Top bar: which data the app shows. Since the beta, the desktop app always shows the real workspace; the demo one is the
// « Mode présentation » of Réglages › Avancé, announced by a banner (PresentationBanner). Here, in the desktop app, only a
// small dot tells whether the last sync of the real data worked (the tooltip says why not); in the web demo, the
// « Données de démonstration » label.
import { FlaskConical } from 'lucide-react'
import { t } from '../../../shared/fr'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PRESENTATION_KEY } from '@/proto/live/BetaSync'
import { canGoLive } from '@/proto/live/LiveSync'
import { useProto } from '@/proto/store'
import { call } from '@/state/client'

export function DataModeSwitch() {
  const { mode, live } = useProto()

  if (!canGoLive()) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-testid="demo-data-pill" className="no-drag mr-1 hidden items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] text-fg-3 xl:inline-flex">
            <FlaskConical className="size-3.5" aria-hidden />
            {t('shell.demoData')}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          {t('shell.demoData.hint')}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (mode === 'demo') return <span data-testid="data-mode" data-mode="demo" className="sr-only" />
  const tone = live.error ? 'bg-err' : live.loading || live.syncedAt === null ? 'bg-warn' : 'bg-ok'
  const hint = live.error
    ? t('shell.mode.live.error', { error: live.error })
    : live.syncedAt === null
      ? t('shell.mode.live.loading')
      : t('shell.mode.live.hint', { agents: live.status?.agents ?? 0, running: live.status?.running ?? 0 })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="status"
          aria-label={hint}
          data-testid="data-mode"
          data-mode="live"
          className="no-drag mr-1 inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden className={cn('size-1.5 rounded-full', tone)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[280px]">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

/** The banner of the presentation mode (desktop app): what is shown is invented; one click goes back to the real data. */
export function PresentationBanner() {
  const { mode } = useProto()
  if (!canGoLive() || mode !== 'demo') return null
  return (
    <div role="status" data-testid="presentation-banner" className="flex h-8 shrink-0 items-center justify-center gap-3 border-b border-line bg-surface-2 px-4 text-[12.5px] text-fg-2">
      <FlaskConical className="size-3.5" aria-hidden />
      <span>{t('beta.presentation.banner')}</span>
      <button
        type="button"
        data-testid="presentation-leave"
        onClick={() => void call('settings.set', PRESENTATION_KEY, false)}
        className="no-drag rounded-full px-2 py-0.5 font-medium text-fg underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t('beta.presentation.leave')}
      </button>
    </div>
  )
}
