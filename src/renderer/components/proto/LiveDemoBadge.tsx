// « Données de démonstration »: in real mode, a block that still shows demo data says so, on that block only (and says
// why). Renders nothing in demo mode, where everything is a demo anyway.
import { FlaskConical } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'

/** The small badge. `block` names the block it labels (tests and screenshots find it by it). */
export function LiveDemoBadge({ block, className }: { block: string; className?: string }) {
  const { mode } = useProto()
  if (mode !== 'live') return null
  return (
    <span
      data-testid="live-demo-badge"
      data-block={block}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border border-line-2 bg-surface-2 px-2 py-[3px] text-[11px] leading-none font-medium text-fg-2', className)}
    >
      <FlaskConical className="size-3" aria-hidden />
      {t('live.demo.badge')}
    </span>
  )
}

/** The badge followed by one sentence saying what is an example and why. */
export function LiveDemoNote({ block, note, className }: { block: string; note: MessageKey; className?: string }) {
  const { mode } = useProto()
  if (mode !== 'live') return null
  return (
    <p className={cn('mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3', className)} data-testid="live-demo-note" data-block={block}>
      <LiveDemoBadge block={block} />
      {t(note)}
    </p>
  )
}
