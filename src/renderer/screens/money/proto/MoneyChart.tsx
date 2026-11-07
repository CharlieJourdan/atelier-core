// Twelve weeks of revenue (ink line) and costs (grey line). Hover a week to read both. Drawn in real pixels.
import { useState, type MouseEvent } from 'react'
import { t } from '../../../../shared/fr'
import { fmtEuro } from '@/components/proto/kit'
import { useSize } from '../../brain/useSize'

const PAD = { l: 56, r: 14, t: 14, b: 28 }
export const CHART_H = 288

function niceMax(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

function weekLabel(today: Date, i: number, total: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() - (total - 1 - i) * 7)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function MoneyChart({ revenue, cost, today = new Date() }: { revenue: number[]; cost: number[]; today?: Date }) {
  const [ref, size] = useSize<HTMLDivElement>({ w: 640, h: CHART_H })
  const [hover, setHover] = useState<number | null>(null)
  const n = revenue.length
  const max = niceMax(Math.max(...revenue, ...cost, 1) * 1.05)
  const pw = Math.max(100, size.w - PAD.l - PAD.r)
  const ph = Math.max(80, size.h - PAD.t - PAD.b)
  const x = (i: number): number => PAD.l + (i / (n - 1)) * pw
  const y = (v: number): number => PAD.t + (1 - v / max) * ph
  const line = (vals: number[]): string => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const labelIdx = [...new Set([0, 4, 8, n - 1].filter((i) => i >= 0 && i < n))]

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = e.clientX - rect.left - PAD.l
    setHover(Math.max(0, Math.min(n - 1, Math.round((rel / pw) * (n - 1)))))
  }

  return (
    <div ref={ref} className="relative" style={{ height: CHART_H }} data-testid="money-chart">
      <svg width={size.w} height={size.h} role="img" aria-label={t('money2.chart.title')} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + pw} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--fg-3)" className="num">
              {fmtEuro(v)}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={x(i)} y={size.h - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--fg-3)">
            {i === n - 1 ? t('money2.chart.thisWeek') : weekLabel(today, i, n)}
          </text>
        ))}
        <path d={line(cost)} fill="none" stroke="var(--fg-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-series="cost" />
        <path d={line(revenue)} fill="none" stroke="var(--brand)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" data-series="revenue" />
        <circle cx={x(n - 1)} cy={y(revenue[n - 1] ?? 0)} r={3.5} fill="var(--brand)" />
        <circle cx={x(n - 1)} cy={y(cost[n - 1] ?? 0)} r={3} fill="var(--fg-4)" />
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ph} stroke="var(--line-3)" />
            <circle cx={x(hover)} cy={y(revenue[hover] ?? 0)} r={4} fill="var(--bg)" stroke="var(--brand)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(cost[hover] ?? 0)} r={3.5} fill="var(--bg)" stroke="var(--fg-4)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[10px] border border-line-2 bg-surface-pop px-2.5 py-1.5 shadow-[var(--shadow-pop)]"
          style={{ left: Math.min(size.w - 80, Math.max(80, x(hover))), top: 4 }}
        >
          <p className="text-[11.5px] text-fg-3">{weekLabel(today, hover, n)}</p>
          <p className="num text-[12.5px] whitespace-nowrap text-fg">
            {t('money2.chart.revenue')} {fmtEuro(revenue[hover] ?? 0)}
          </p>
          <p className="num text-[12.5px] whitespace-nowrap text-fg-2">
            {t('money2.chart.cost')} {fmtEuro(cost[hover] ?? 0)}
          </p>
        </div>
      )}
    </div>
  )
}
