// Accueil of a real workspace with no channel yet (e.g. after « Plus tard » in the first-run onboarding): one clear call to
// action that opens the add-a-channel flow, in place of the analytics row (there is nothing to connect yet).
import { Plus, TvMinimalPlay } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { Button } from '@/components/ui/button'
import { addChannel } from '../channels/add-intent'

export function FirstChannel({ onRoute }: { onRoute: (r: Route) => void }) {
  return (
    <div data-testid="home-first-channel" className="mb-8 flex flex-wrap items-center gap-4 rounded-[18px] border border-line-2 bg-surface-1 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-fg-2">
        <TvMinimalPlay className="size-5" aria-hidden />
      </span>
      <div className="min-w-[220px] flex-1">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-fg">{t('home.first.title')}</p>
        <p className="mt-0.5 text-[13px] leading-[1.5] text-fg-3">{t('home.first.body')}</p>
      </div>
      <Button data-testid="home-first-channel-add" onClick={() => addChannel(onRoute)}>
        <Plus aria-hidden />
        {t('home.first.action')}
      </Button>
    </div>
  )
}
