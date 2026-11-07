// Production › Vue d'ensemble: per channel, the videos being made, waiting for a decision and finished this month, and
// the credits they cost. Real figures from `production.list`, the channels and the wallet; nothing invented.
import { ArrowRight, Plus } from 'lucide-react'
import { t } from '../../../../shared/fr'
import type { RunSummary } from '../../../../shared/runs'
import { ErrorLine, ExampleBadge, LoadingBlock, fmtCredits, fmtInt } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState, StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { call, useApi, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { ExampleCreditsLine } from '../ExampleCredits'
import { RUN_TOPICS, focusRun, useChannelList } from '../shared'

const BUSY = ['queued', 'running', 'interrupted']

export interface ChannelFigures {
  making: RunSummary[]
  waiting: RunSummary[]
  doneThisMonth: number
  spentThisMonth: number
}

export function sameMonth(iso: string | null, now: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

/** The figures of one channel; demo runs spend nothing (0 by construction) and example runs are not real spend. */
export function figuresOf(runs: RunSummary[], now: Date): ChannelFigures {
  return {
    making: runs.filter((r) => BUSY.includes(r.status)),
    waiting: runs.filter((r) => r.status === 'waiting'),
    doneThisMonth: runs.filter((r) => r.status === 'succeeded' && sameMonth(r.finishedAt, now)).length,
    spentThisMonth: runs.filter((r) => !r.example && sameMonth(r.startedAt ?? r.createdAt, now)).reduce((s, r) => s + r.spentCredits, 0)
  }
}

export function ApercuScreen({ onRoute }: ScreenProps) {
  const channels = useChannelList()
  const runs = useLoader(() => call('production.list', { limit: 500 }), 'all', RUN_TOPICS)
  const balance = useApi('credits.balance', ['credits', 'example'])
  const example = useApi('example.status', ['example'])
  const now = new Date()
  const exampleIds = new Set(example.data?.channelIds ?? [])
  const all = runs.data ?? []
  const total = figuresOf(all, now)
  const goLive = (runId: number | null): void => {
    focusRun(runId)
    onRoute({ section: 'production', page: 'encours' })
  }

  return (
    <PageShell
      section="production"
      title={t('page.production.apercu')}
      subtitle={t('production.overview.subtitle')}
      actions={
        <Button variant="brand" size="sm" onClick={() => onRoute({ section: 'production', page: 'nouvelle' })}>
          <Plus aria-hidden />
          {t('page.production.nouvelle')}
        </Button>
      }
    >
      {(runs.error || channels.error) && <ErrorLine message={(runs.error ?? channels.error) as string} onRetry={runs.reload} />}
      {(!runs.data || !channels.data) && !runs.error && !channels.error && <LoadingBlock rows={4} />}
      {runs.data && channels.data && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-tiles">
            <StatTile label={t('production.overview.making')} value={fmtInt(total.making.length)} />
            <StatTile label={t('production.overview.waiting')} value={fmtInt(total.waiting.length)} />
            <StatTile label={t('production.overview.done')} value={fmtInt(total.doneThisMonth)} hint={t('production.overview.thisMonth')} />
            <StatTile
              label={t('production.overview.balance')}
              value={balance.data ? fmtInt(balance.data.available) : '—'}
              hint={t('production.overview.spent', { n: fmtCredits(total.spentThisMonth) })}
            />
          </div>
          {balance.data && <ExampleCreditsLine example={balance.data.example} />}
          {channels.data.length === 0 ? (
            <EmptyState title={t('production.overview.empty.title')} blurb={t('production.overview.empty.blurb')} />
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label={t('production.overview.channels')}>
              {channels.data.map((c) => {
                const f = figuresOf(
                  all.filter((r) => r.channelId === c.id),
                  now
                )
                const first = f.waiting[0] ?? f.making[0] ?? null
                return (
                  <li key={c.id} data-testid="channel-card" className="flex flex-col gap-4 rounded-card border border-line bg-surface-1 p-4">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 min-w-0 flex-1 truncate font-serif text-[22px] leading-tight text-fg">{c.name}</h2>
                      {exampleIds.has(c.id) && <ExampleBadge />}
                    </div>
                    <dl className="m-0 grid grid-cols-3 gap-2">
                      {(
                        [
                          ['production.overview.making', f.making.length],
                          ['production.overview.waiting', f.waiting.length],
                          ['production.overview.done', f.doneThisMonth]
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt className="micro-label">{t(k)}</dt>
                          <dd className="m-0 font-serif text-[28px] leading-none text-fg">{fmtInt(v)}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="m-0 text-[12px] text-fg-3">{t('production.overview.spent', { n: fmtCredits(f.spentThisMonth) })}</p>
                    <div className="mt-auto flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => goLive(first?.id ?? null)}>
                        {t('page.production.encours')}
                        <ArrowRight aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onRoute({ section: 'production', page: 'nouvelle' })}>
                        {t('page.production.nouvelle')}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </PageShell>
  )
}
