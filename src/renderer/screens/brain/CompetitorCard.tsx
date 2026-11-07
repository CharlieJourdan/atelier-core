// The inspector of one competitor: figures, last video, what they do better, and the three actions.
import { ArrowUp, Check, Eye, Languages, ScanSearch, X } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { fmtAgo, fmtCompact, ProgressBar } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Competitor } from '@/proto/data-brain'

export const styleLabel = (c: Pick<Competitor, 'style'>): string => t(`brain.style.${c.style}` as MessageKey)

const num1 = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const euro2 = (n: number): string => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-surface-2 px-3 py-2.5" title={hint}>
      <p className="text-[11.5px] text-fg-3">{label}</p>
      <p className="num mt-0.5 text-[17px] leading-tight font-medium tracking-[-0.015em] text-fg">{value}</p>
    </div>
  )
}

export function outlierHint(score: number): string {
  if (score >= 3) return t('brain.comp.outlier.exceptional')
  if (score >= 2) return t('brain.comp.outlier.strong')
  if (score >= 1) return t('brain.comp.outlier.above')
  return t('brain.comp.outlier.average')
}

export function CompetitorCard({
  c,
  ringColor,
  watched,
  onWatch,
  onAsk,
  onClose,
  readOnly = false
}: {
  c: Competitor
  ringColor: string
  watched: boolean
  onWatch: () => void
  onAsk: (kind: 'style' | 'translate') => void
  onClose: () => void
  /** Real mode, example data: nothing to watch or to ask about, the card only describes. */
  readOnly?: boolean
}) {
  return (
    <aside
      data-testid="competitor-card"
      data-competitor={c.id}
      aria-label={c.name}
      className="fade-in absolute inset-y-0 right-0 z-20 flex w-[300px] flex-col border-l border-line-2 bg-surface-pop"
    >
      <header className="flex shrink-0 items-start gap-3 px-4 pt-4 pb-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-fg"
          style={{ boxShadow: `inset 0 0 0 2px ${ringColor}` }}
        >
          {c.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w.charAt(0))
            .join('')
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.014em] text-fg">{c.name}</h3>
          <p className="truncate text-[12.5px] text-fg-3">{c.handle}</p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          data-testid="competitor-close"
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-fg-2">
            <span aria-hidden className="size-2 rounded-full" style={{ background: ringColor }} />
            {styleLabel(c)}
          </span>
          {c.rising && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ink px-2.5 text-[12px] font-medium text-ink-fg">
              <ArrowUp className="size-3" strokeWidth={2.6} aria-hidden />
              {t('brain.comp.rising')}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label={t('brain.comp.subs')} value={fmtCompact(c.subscribers)} />
          <Stat label={t('brain.comp.views')} value={fmtCompact(c.views30d)} />
          <Stat label={t('brain.comp.outlier')} value={num1(c.outlier)} hint={outlierHint(c.outlier)} />
          <Stat label={t('brain.comp.rpm')} value={euro2(c.rpm)} />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
            <span className="text-fg-3">{t('brain.comp.similarity')}</span>
            <span className="num font-medium text-fg">{Math.round(c.similarity * 100)} %</span>
          </div>
          <ProgressBar value={c.similarity * 100} />
        </div>

        <div className="mt-4">
          <p className="text-[12px] text-fg-3">{t('brain.comp.last')}</p>
          <p className="mt-0.5 text-[13.5px] leading-[1.4] font-medium text-fg">{c.lastVideo.title}</p>
          <p className="num mt-0.5 text-[12px] text-fg-3">{c.lastVideo.daysAgo === 0 ? t('common.today') : fmtAgo(c.lastVideo.daysAgo * 1440)}</p>
        </div>

        <div className="mt-4 rounded-[12px] border border-line-2 p-3">
          <p className="text-[12px] font-medium text-fg">{t('brain.comp.better')}</p>
          <p className="mt-1 text-[13px] leading-[1.5] text-fg-2">{c.better}</p>
        </div>
      </div>

      {!readOnly && (
        <footer className="shrink-0 space-y-2 border-t border-line px-4 py-3">
          <Button
            size="sm"
            className={cn('w-full', watched && 'pointer-events-none')}
            variant={watched ? 'secondary' : 'default'}
            onClick={onWatch}
            aria-pressed={watched}
            data-testid="competitor-watch"
          >
            {watched ? <Check aria-hidden /> : <Eye aria-hidden />}
            {watched ? t('brain.comp.watching') : t('brain.comp.watch')}
          </Button>
          <div className="grid grid-cols-1 gap-2">
            <Button size="sm" variant="outline" onClick={() => onAsk('style')} data-testid="competitor-style">
              <ScanSearch aria-hidden />
              {t('brain.comp.style')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAsk('translate')} data-testid="competitor-translate">
              <Languages aria-hidden />
              {t('brain.comp.translate')}
            </Button>
          </div>
        </footer>
      )}
    </aside>
  )
}
