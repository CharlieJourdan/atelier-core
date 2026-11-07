// Costs against revenues over the last weeks, as grouped SVG bars (no chart library). Colours come from tokens.
import { t } from '../../../shared/fr'
import type { WeekPoint } from '../../../shared/api/money'
import { dayLabel, eur } from './common'

const W = 640
const H = 220
const PAD = { top: 12, right: 8, bottom: 28, left: 8 }

export function WeeklyBars({ weeks }: { weeks: readonly WeekPoint[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.revenueCents, w.costCents]))
  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
  const slot = inner.w / Math.max(1, weeks.length)
  const bar = Math.min(26, slot / 2 - 4)
  const y = (v: number): number => PAD.top + inner.h - (v / max) * inner.h
  const summary = weeks.map((w) => `${dayLabel(w.week)} : ${t('money.ov.legendRevenue')} ${eur(w.revenueCents)}, ${t('money.ov.legendCosts')} ${eur(w.costCents)}`).join(' ; ')
  return (
    <figure data-testid="weekly-bars" className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t('money.ov.chart')}. ${summary}`} className="h-auto w-full">
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + inner.h} y2={PAD.top + inner.h} stroke="var(--line-2)" strokeWidth="1" />
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + inner.h * (1 - f)} y2={PAD.top + inner.h * (1 - f)} stroke="var(--line)" strokeDasharray="3 4" strokeWidth="1" />
        ))}
        {weeks.map((w, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={w.week}>
              <rect x={cx - bar - 1} y={y(w.revenueCents)} width={bar} height={PAD.top + inner.h - y(w.revenueCents)} rx="3" fill="var(--brand)">
                <title>{`${t('money.ov.legendRevenue')} ${eur(w.revenueCents)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(w.costCents)} width={bar} height={PAD.top + inner.h - y(w.costCents)} rx="3" fill="var(--warn)">
                <title>{`${t('money.ov.legendCosts')} ${eur(w.costCents)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--fg-3)">
                {dayLabel(w.week)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 flex items-center gap-4 text-[12px] text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
          {t('money.ov.legendRevenue')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warn" aria-hidden />
          {t('money.ov.legendCosts')}
        </span>
        <span className="ml-auto">{t('money.ov.weekFrom')}</span>
      </figcaption>
    </figure>
  )
}
