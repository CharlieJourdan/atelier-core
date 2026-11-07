// « Vidéos qui surperforment chez tes concurrents »: the videos that beat their channel's usual views, with a shortcut
// that turns one into an idea on the board.
import { Check, Lightbulb } from 'lucide-react'
import { t } from '../../../shared/fr'
import { fmtAgo, fmtCompact, SectionHead, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { COMPETITORS, type Outperformer } from '@/proto/data-brain'

/** `onAdd` absent (real mode, example data): the videos are only listed, they do not become real ideas. */
export function Outperformers({ items, added, onAdd }: { items: Outperformer[]; added: ReadonlySet<string>; onAdd?: (o: Outperformer) => void }) {
  return (
    <section aria-label={t('brain.comp.out.title')} data-testid="outperformers" className="mt-8">
      <SectionHead title={t('brain.comp.out.title')} count={items.length} />
      {items.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-line-2 px-4 py-6 text-center text-[13px] text-fg-3">{t('brain.comp.out.empty')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          {items.map((o) => {
            const comp = COMPETITORS.find((c) => c.id === o.competitorId)
            const done = added.has(o.id)
            return (
              <li key={o.id} data-testid="outperformer" className="flex items-center gap-4 px-4 py-3">
                <Thumb hue={o.hue} format={o.format} className={o.format === 'short' ? 'h-[62px]' : 'w-[104px]'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-fg">{o.title}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-fg-3">
                    {comp?.name} <span aria-hidden>·</span> {o.daysAgo === 0 ? t('common.today') : fmtAgo(o.daysAgo * 1440)}
                  </p>
                </div>
                <p className="num hidden w-[84px] shrink-0 text-right text-[13px] text-fg-2 @[640px]:block">
                  {t('brain.comp.out.views', { n: fmtCompact(o.views) })}
                </p>
                <span
                  className="num inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-fg"
                  title={t('brain.comp.out.multiple.hint')}
                >
                  ×{o.multiple.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                {onAdd && (
                  <Button size="sm" variant="outline" disabled={done} onClick={() => onAdd(o)} data-testid="outperformer-add" className="shrink-0">
                    {done ? <Check aria-hidden /> : <Lightbulb aria-hidden />}
                    {done ? t('brain.comp.out.added') : t('brain.comp.out.make')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
