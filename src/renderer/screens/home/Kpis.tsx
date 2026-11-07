// The figures row. Shown only when YouTube Analytics is connected for at least one channel in scope; otherwise a quiet
// "Connecter YouTube Analytics" row stands in, so the dashboard never shows numbers it does not have.
import { Link2 } from 'lucide-react'
import { t } from '../../../shared/fr'
import { fmtCompact, fmtEuro, fmtNum } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import type { Route } from '../../../shared/sections'
import { sparkPath, sparkSeries, type Kpis as KpiValues } from './home-model'

export function Trend({ value, className }: { value: number; className?: string }) {
  const up = value >= 0
  return (
    <span className={cn('num text-[12px] font-medium', up ? 'text-ok' : 'text-err', className)}>
      {up ? '+' : '−'}
      {Math.abs(value)} %
    </span>
  )
}

export function Sparkline({ seed, trend, className }: { seed: string; trend: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn('h-6 w-full', className)} aria-hidden data-testid="sparkline">
      <path d={sparkPath(sparkSeries(seed, trend))} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface Cell {
  id: string
  label: string
  value: string
  trend: number | null
}

export function KpiRow({ kpis, scopeKey }: { kpis: KpiValues; scopeKey: string }) {
  const cells: Cell[] = [
    { id: 'views', label: t('home.dash.kpi.views'), value: fmtCompact(kpis.views), trend: kpis.trendViews },
    { id: 'revenue', label: t('home.dash.kpi.revenue'), value: fmtEuro(kpis.revenue), trend: kpis.trendRevenue },
    { id: 'subs', label: t('home.dash.kpi.subscribers'), value: fmtCompact(kpis.subscribers), trend: kpis.trendSubscribers },
    { id: 'published', label: t('home.dash.kpi.published'), value: fmtNum(kpis.published), trend: null }
  ]
  return (
    <div data-testid="home-kpis" className="mb-8 grid grid-cols-2 overflow-hidden rounded-[16px] border border-line-2 bg-surface-1 @[760px]:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.id} data-kpi={c.id} className={cn('min-w-0 px-4 py-3.5', i > 0 && '@[760px]:border-l @[760px]:border-line', i % 2 === 1 && 'border-l border-line @[760px]:border-l', i >= 2 && 'border-t border-line @[760px]:border-t-0')}>
          <p className="text-[12px] text-fg-3">{c.label}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="num text-[28px] leading-none font-medium tracking-[-0.02em] text-fg">{c.value}</span>
            {c.trend !== null && <Trend value={c.trend} />}
          </p>
          <Sparkline seed={`${scopeKey}-${c.id}`} trend={c.trend ?? 6} className="mt-3" />
        </div>
      ))}
    </div>
  )
}

export function ConnectRow({ onRoute }: { onRoute: (r: Route) => void }) {
  return (
    <div data-testid="home-connect" className="mb-8 flex items-center gap-3 rounded-[16px] border border-dashed border-line-2 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-2">
        <Link2 className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-fg">{t('home.dash.connect.title')}</p>
        <p className="text-[12.5px] text-fg-3">{t('home.dash.connect.hint')}</p>
      </div>
      <button type="button" onClick={() => onRoute({ section: 'chaines' })} className="shrink-0 rounded-full border border-line-2 px-3 py-1.5 text-[12.5px] font-medium text-fg hover:bg-hover">
        {t('home.dash.connect.action')}
      </button>
    </div>
  )
}
