// The thin band above the demo app: says the data is made up, and starts the tour over (onboarding first).
import { RotateCcw } from 'lucide-react'
import { t } from '../../../shared/fr'
import { restartDemo } from './visit'

export function DemoBanner() {
  return (
    <div data-testid="demo-banner" role="note" className="flex h-8 shrink-0 items-center justify-center gap-3 border-b border-line bg-surface-2 px-3 text-[12.5px] text-fg-2">
      <span className="font-semibold text-fg">{t('demo.banner')}</span>
      <span className="hidden truncate text-fg-3 md:inline">{t('demo.banner.detail')}</span>
      <button
        type="button"
        data-testid="demo-restart"
        onClick={restartDemo}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <RotateCcw aria-hidden className="size-3.5" />
        {t('demo.restart')}
      </button>
    </div>
  )
}
