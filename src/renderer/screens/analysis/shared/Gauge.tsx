// The reproducibility gauge (PLAN-V2-PRODUCTION §2.3): our own SVG arc, the note in big serif figures, the colour of its
// band, and a text for screen readers. No chart library (strict CSP).
import { t } from '../../../../shared/fr'
import { tierOf } from '../../../../shared/gauge'
import { cn } from '@/lib/utils'
import { arcPath, gaugeTone, type GaugeTone } from './gauge-view'

const STROKE: Record<GaugeTone, string> = { ok: 'stroke-ok', info: 'stroke-info', warn: 'stroke-warn', err: 'stroke-err' }
const TEXT: Record<GaugeTone, string> = { ok: 'text-ok', info: 'text-info', warn: 'text-warn', err: 'text-err' }

export function gaugeAria(score: number): string {
  return t('analysis.gauge.aria', { n: score, tier: t(`analysis.tier.${tierOf(score)}`) })
}

export function ReproGauge({ score, size = 220, className }: { score: number; size?: number; className?: string }) {
  const safe = Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0
  const tone = gaugeTone(safe)
  const c = 100
  const r = 80
  return (
    <div
      data-testid="repro-gauge"
      data-score={safe}
      data-tone={tone}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size * 0.88 }}
    >
      <svg viewBox="0 0 200 176" role="img" aria-label={gaugeAria(safe)} className="absolute inset-0 size-full">
        <path d={arcPath(c, c, r, 1)} fill="none" strokeWidth={12} strokeLinecap="round" className="stroke-line-2" />
        {safe > 0 && <path d={arcPath(c, c, r, safe / 100)} fill="none" strokeWidth={12} strokeLinecap="round" className={cn('transition-all duration-500', STROKE[tone])} />}
      </svg>
      <div className="relative flex flex-col items-center pb-2" aria-hidden>
        <span className={cn('font-serif leading-none', TEXT[tone])} style={{ fontSize: size * 0.3 }}>
          {safe}
        </span>
        <span className="micro-label mt-1">{t('analysis.gauge.outOf')}</span>
      </div>
      <span className="sr-only">{gaugeAria(safe)}</span>
    </div>
  )
}
