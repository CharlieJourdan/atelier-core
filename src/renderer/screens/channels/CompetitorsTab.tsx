// Competitors of a channel: the ones the agent found, how far each outperforms its peers, and which ones are watched.
import { Search } from 'lucide-react'
import { t } from '../../../shared/fr'
import { fmtCompact } from '@/components/proto/kit'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { competitorsOf } from '@/proto/data-onboarding-channels'
import type { ProtoChannel } from '@/proto/types'
import { Inset } from '../onboarding/parts'

export function CompetitorsTab({ channel, watched, onWatched }: { channel: ProtoChannel; watched: Record<string, boolean>; onWatched: (w: Record<string, boolean>) => void }) {
  const list = competitorsOf(channel.id)
  const count = list.filter((c) => watched[c.id]).length
  return (
    <div data-testid="competitors-tab">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[560px] text-[13.5px] leading-[1.55] text-fg-3" data-testid="competitors-count">
          {t('chan.comp.hint', { n: count, total: list.length })}
        </p>
        <button
          type="button"
          onClick={() => toast.demo()}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-2 px-3.5 text-[13px] font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Search className="size-4" aria-hidden />
          {t('chan.comp.find')}
        </button>
      </div>
      <Inset>
        {list.map((c) => (
          <div key={c.id} data-testid="competitor-row" className="flex items-center gap-3.5 px-4 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-[#0a0a0a]" style={{ background: `oklch(0.76 0.08 ${c.hue})` }} aria-hidden>
              {c.initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-fg">{c.name}</p>
              <p className="num text-[12.5px] text-fg-3">{t('chan.comp.subs', { n: fmtCompact(c.subscribers) })}</p>
            </div>
            <span
              className={cn('num rounded-full px-2.5 py-0.5 text-[12px] font-medium', c.outlier >= 3 ? 'bg-[var(--ok-soft)] text-ok' : 'bg-surface-3 text-fg-2')}
              title={t('chan.comp.outlier.hint')}
            >
              {t('chan.comp.outlier', { n: c.outlier.toLocaleString('fr-FR', { minimumFractionDigits: 1 }) })}
            </span>
            <label className="flex w-[110px] shrink-0 items-center justify-end gap-2 text-[12.5px] text-fg-2">
              {watched[c.id] ? t('chan.comp.watched') : t('chan.comp.unwatched')}
              <Switch aria-label={t('chan.comp.watch', { name: c.name })} checked={!!watched[c.id]} onCheckedChange={(on) => onWatched({ ...watched, [c.id]: on })} />
            </label>
          </div>
        ))}
      </Inset>
    </div>
  )
}
