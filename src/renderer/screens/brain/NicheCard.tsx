// The inspector of one niche: figures, who leads it, example videos, how well our models replicate it, and the actions.
import { Languages, Plus, X } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { fmtCompact, ProgressBar } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import type { NicheView } from './brain-model'

const euro = (n: number): string => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-surface-2 px-3 py-2.5">
      <p className="text-[11.5px] text-fg-3">{label}</p>
      <p className="num mt-0.5 truncate text-[17px] leading-tight font-medium tracking-[-0.015em] text-fg">{value}</p>
    </div>
  )
}

export function competitionWord(x: number): string {
  return x < 40 ? t('brain.niche.comp.low') : x < 65 ? t('brain.niche.comp.mid') : t('brain.niche.comp.high')
}

export function NicheCard({
  v,
  ideal,
  onClose,
  onCreate,
  onTranslate
}: {
  v: NicheView
  ideal: boolean
  onClose: () => void
  onCreate: () => void
  onTranslate: () => void
}) {
  const n = v.niche
  const name = t(`brain.niche.${n.id}` as MessageKey)
  return (
    <aside
      data-testid="niche-card"
      data-niche={n.id}
      aria-label={name}
      className="fade-in absolute inset-y-0 right-0 z-20 flex w-[310px] flex-col border-l border-line-2 bg-surface-pop"
    >
      <header className="flex shrink-0 items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] leading-tight font-semibold tracking-[-0.016em] text-fg">{name}</h3>
          <p className="mt-0.5 text-[12.5px] text-fg-3">{n.faceless ? t('brain.niche.faceless') : t('brain.niche.face')}</p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          data-testid="niche-close"
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {ideal && (
          <p className="mb-3 inline-flex h-6 items-center rounded-full bg-ink px-2.5 text-[12px] font-medium text-ink-fg" data-testid="niche-ideal">
            {t('brain.niches.zone')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('brain.niche.rpm')} value={euro(v.rpm)} />
          <Stat label={t('brain.niche.growth')} value={`+${v.growth30} %`} />
          <Stat label={t('brain.niche.channels')} value={v.channels.toLocaleString('fr-FR')} />
          <Stat label={t('brain.niche.competition')} value={competitionWord(v.x)} />
        </div>

        <h4 className="mt-5 mb-1.5 text-[13px] font-semibold text-fg">{t('brain.niche.top')}</h4>
        <ul className="divide-y divide-line rounded-[12px] border border-line-2">
          {n.top.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-fg">{c.name}</span>
              <span className="num shrink-0 text-fg-3">{t('brain.niche.subs', { n: fmtCompact(c.subs) })}</span>
            </li>
          ))}
        </ul>

        <h4 className="mt-5 mb-1.5 text-[13px] font-semibold text-fg">{t('brain.niche.videos')}</h4>
        <ul className="space-y-2">
          {n.videos.map((x) => (
            <li key={x.title} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 leading-[1.4] text-fg-2">{x.title}</span>
              <span className="num shrink-0 text-fg-3">{fmtCompact(x.views)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-[12px] border border-line-2 p-3" data-testid="niche-replic">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-fg-3">{t('brain.niche.replic')}</span>
            <span className="num font-medium text-fg">
              {n.replic.model} · {n.replic.pct} %
            </span>
          </div>
          <ProgressBar value={n.replic.pct} />
        </div>
      </div>

      <footer className="shrink-0 space-y-2 border-t border-line px-4 py-3">
        <Button size="sm" className="w-full" onClick={onCreate} data-testid="niche-create">
          <Plus aria-hidden />
          {t('brain.niche.create')}
        </Button>
        <Button size="sm" variant="outline" className="w-full" onClick={onTranslate} data-testid="niche-translate">
          <Languages aria-hidden />
          {t('brain.niche.translate')}
        </Button>
      </footer>
    </aside>
  )
}
