// Monétisation › YouTube (read-only). Not connected: an in-memory demo chart (never stored, never in the P&L), the
// explanation of the read-only access and a plain note that the connection arrives with lot 20. No dead button.
import { Lock } from 'lucide-react'
import { t } from '../../../shared/fr'
import { DemoBadge, DemoBoundary } from '@/components/atelier/demo'
import { Panel } from '@/components/atelier/primitives'
import { useFeature } from '@/lib/features'

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
] as const

/** Invented 28-day curve: computed in memory on every render, never written anywhere. */
export function demoViews(): number[] {
  return Array.from({ length: 28 }, (_, i) => Math.round(2400 + 900 * Math.sin(i / 3.2) + i * 55))
}

export function DemoViewsChart() {
  const data = demoViews()
  const max = Math.max(...data)
  const W = 640
  const H = 160
  const step = W / (data.length - 1)
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(H - 12 - (v / max) * (H - 28)).toFixed(1)}`)
  return (
    <figure className="m-0" data-testid="youtube-demo-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('money.yt.chartLabel')} className="h-auto w-full">
        <polyline points={`0,${H - 4} ${points.join(' ')} ${W},${H - 4}`} fill="var(--brand-soft)" stroke="none" />
        <polyline points={points.join(' ')} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="0" x2={W} y1={H - 4} y2={H - 4} stroke="var(--line-2)" />
      </svg>
      <figcaption className="mt-2 flex items-center gap-2 text-[12px] text-fg-3">
        <DemoBadge />
        {t('money.yt.chartCaption')}
      </figcaption>
    </figure>
  )
}

export function YoutubeTab() {
  const connected = useFeature('youtube-analytics').status === 'real'
  // Connected: the demo curve must never stand in for real data. The sync itself arrives with lot 20.
  if (connected) {
    return (
      <Panel title={t('money.yt.accessTitle')}>
        <p className="text-[13px] text-fg-2">{t('money.yt.connected')}</p>
      </Panel>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <DemoBoundary feature="youtube-analytics">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title={t('money.yt.chartTitle')}>
            <DemoViewsChart />
            <p className="mt-3 text-[12px] text-fg-3">{t('money.yt.notInPnl')}</p>
          </Panel>
          <Panel title={t('money.yt.accessTitle')}>
            <div className="flex flex-col gap-3 text-[13px] text-fg-2">
              <p>{t('money.yt.access')}</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {YOUTUBE_SCOPES.map((s) => (
                  <li key={s} className="flex items-center gap-2">
                    <Lock className="size-3.5 shrink-0 text-ok" aria-hidden />
                    <code className="font-mono text-[11.5px] break-all text-fg-2">{s.split('/').pop()}</code>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-fg-3">{t('money.yt.readOnly')}</p>
              <p role="note" className="rounded-field border border-dashed border-line-3 px-3 py-2 text-[12px] text-fg-3">
                {t('money.yt.later')}
              </p>
            </div>
          </Panel>
        </div>
      </DemoBoundary>
    </div>
  )
}
