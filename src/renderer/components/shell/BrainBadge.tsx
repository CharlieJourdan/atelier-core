// Top bar: « Connecté à l'ordinateur d'équipe <name> » while the app talks to the team computer's brain (Réglages ›
// Ordinateur d'équipe). Nothing when the app uses its own brain. The dot is green while the event stream is open.
import { Server } from 'lucide-react'
import { t } from '../../../shared/fr'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useApi } from '@/state/client'

export function BrainBadge() {
  const { data } = useApi('brain.status', ['brain'])
  if (!data || data.mode !== 'remote') return null
  const label = t('shell.brain.remote', { name: data.name ?? data.url ?? '' })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="brain-badge"
          data-live={data.live}
          className="no-drag mr-1 inline-flex max-w-[320px] shrink-0 items-center gap-1.5 truncate rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-fg-2"
        >
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', data.live ? 'bg-ok' : 'bg-warn')} />
          <Server className="size-3.5 shrink-0" aria-hidden />
          {/* under ~1280 px only the dot and the icon stay (the full text is in the tooltip): the badge never covers the page tabs (QA D4) */}
          <span className="hidden truncate min-[1280px]:inline">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[300px]">
        {data.error ?? `${label} · ${data.url ?? ''}`}
      </TooltipContent>
    </Tooltip>
  )
}
