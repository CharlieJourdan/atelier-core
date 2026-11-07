// Monétisation, real mode: the owner's YouTube figures of this month through Google (views, hours watched, subscribers,
// estimated revenue) per channel; their revenue is the AdSense line of the P&L. Without Google, a clear « Connecte Google »
// that opens Réglages › Chaînes. Pure body: the screen passes the snapshot's Google side.
import { getLocale, t } from '../../../../shared/fr'
import type { Route } from '../../../../shared/sections'
import { GOOGLE_SETTINGS_ROUTE, GoogleCta } from '@/components/proto/GoogleCta'
import { fmtEuro, fmtNum, SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { LiveGoogle } from '@/proto/live/mapping-google'
import { channelKey } from '@/proto/live/mapping'
import type { Scope } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'

const whenText = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale() === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function GoogleMoneyBlock({ google, channels, scope, onRoute }: { google: LiveGoogle | undefined; channels: ProtoChannel[]; scope: Scope; onRoute: (r: Route) => void }) {
  if (!google || (!google.connected && !google.needsReconnect && google.rows.length === 0)) return <GoogleCta onRoute={onRoute} className="mb-8" />
  const rows = google.rows.filter((r) => scope === 'all' || (r.channelId !== null && channelKey(r.channelId) === scope))
  const nameOf = (channelId: number | null, title: string): { name: string; linked: boolean } => {
    const c = channelId === null ? undefined : channels.find((x) => x.id === channelKey(channelId))
    return c ? { name: c.name, linked: true } : { name: title, linked: false }
  }
  const th = 'px-4 py-2.5 text-left text-[12px] font-medium text-fg-3'
  const td = 'px-4 py-2.5 text-[13px] text-fg-2'
  return (
    <section className="mb-8" aria-label={t('live.google.title')} data-testid="money-google">
      <SectionHead title={t('live.google.title')} />
      {google.needsReconnect && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-4 py-2.5" data-testid="money-google-reconnect">
          <p className="text-[12.5px] text-fg-2">{t('live.google.reconnect')}</p>
          <Button size="sm" variant="outline" onClick={() => onRoute(GOOGLE_SETTINGS_ROUTE)}>
            {t('prefs.google.reconnect')}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
        <table className="w-full border-collapse">
          <thead className="border-b border-line">
            <tr>
              <th className={th} />
              <th className={cn(th, 'text-right')}>{t('live.google.views')}</th>
              <th className={cn(th, 'text-right')}>{t('live.google.watch')}</th>
              <th className={cn(th, 'text-right')}>{t('live.google.subs')}</th>
              <th className={cn(th, 'text-right')}>{t('live.google.revenue')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ channelId, stat: s }) => {
              const who = nameOf(channelId, s.title)
              return (
                <tr key={s.youtubeChannelId} className="border-b border-line last:border-b-0" data-testid="money-google-row" data-linked={who.linked}>
                  <td className={cn(td, 'text-fg')}>
                    {who.name}
                    {!who.linked && <span className="ml-2 text-[12px] text-fg-3">{t('live.google.unmapped')}</span>}
                  </td>
                  <td className={cn(td, 'num text-right')}>{fmtNum(s.monthViews)}</td>
                  <td className={cn(td, 'num text-right')}>{fmtNum(Math.round(s.monthWatchMinutes / 60))}</td>
                  <td className={cn(td, 'num text-right')}>{s.subscribers === null ? '—' : fmtNum(s.subscribers)}</td>
                  <td className={cn(td, 'num text-right text-fg')}>{s.monthRevenueEur === null ? '—' : fmtEuro(s.monthRevenueEur)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-fg-3">
        {google.lastRefreshAt ? t('live.google.updated', { when: whenText(google.lastRefreshAt) }) : t('prefs.google.never')} {t('live.google.adsenseNote')}
      </p>
    </section>
  )
}
