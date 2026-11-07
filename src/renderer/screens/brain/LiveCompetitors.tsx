// Cerveau › Mes concurrents in real mode (the beta): the competitors a real channel follows and the videos of theirs that
// outperform, as « the eyes » keep them (eyes.get, eyes.outliers; read from YouTube through Atelier Cloud). No invented
// channel: an empty workspace or a channel without competitors gets the next action instead.
import { ExternalLink, Flame } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { DemoBadge } from '@/components/atelier/demo'
import { fmtCompact, Segmented } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import type { ProtoChannel } from '@/proto/types'
import { call, useLoader } from '@/state/client'
import { dbIdOf } from '../channels/ChannelLife'

export function LiveCompetitors({ channels, scope, onRoute }: { channels: readonly ProtoChannel[]; scope: string; onRoute: (r: Route) => void }) {
  const real = channels.filter((c) => dbIdOf(c) !== null)
  const [pick, setPick] = useState('')
  const current = real.find((c) => c.id === (scope !== 'all' ? scope : pick)) ?? real[0]
  const id = current ? dbIdOf(current) : null
  const eyes = useLoader(() => (id === null ? Promise.resolve(null) : call('eyes.get', id)), String(id), ['channels', 'cloud'])
  const outliers = useLoader(() => (id === null ? Promise.resolve([]) : call('eyes.outliers', id)), `o-${String(id)}`, ['channels', 'cloud'])

  if (!current || id === null) {
    return (
      <div className="rounded-[16px] border border-dashed border-line-2 px-4 py-12 text-center" data-testid="competitors-empty">
        <p className="text-[13px] text-fg-3">{t('beta.brain.noChannel')}</p>
        <Button className="mt-3" size="sm" onClick={() => onRoute({ section: 'chaines' })}>
          {t('beta.empty.channels.action')}
        </Button>
      </div>
    )
  }
  const list = eyes.data?.competitors ?? []
  const top = (outliers.data ?? []).filter((o) => o.sourceKey !== 0).slice(0, 8)
  return (
    <div data-testid="competitors-live">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{t('brain.comp.title', { name: current.name })}</h2>
          <p className="text-[12.5px] text-fg-3">{t('beta.brain.compSub', { n: list.length, w: list.filter((c) => c.watched).length })}</p>
        </div>
        {scope === 'all' && real.length > 1 && <Segmented<string> size="sm" value={current.id} onChange={setPick} options={real.map((c) => ({ value: c.id, label: c.name }))} />}
      </div>
      {list.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-line-2 px-4 py-10 text-center" data-testid="competitors-empty">
          <p className="text-[13px] text-fg-3">{t('beta.brain.noCompetitor', { name: current.name })}</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => onRoute({ section: 'chaines' })}>
            {t('beta.brain.addCompetitor')}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1" data-testid="competitors-list">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="competitor-row">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-fg">
                  {c.name || c.url}
                  {c.demo && <DemoBadge />}
                </p>
                <p className="truncate text-[12px] text-fg-3">
                  {c.lastReadAt ? t('beta.brain.read', { n: c.videos, o: c.outliers }) : t('beta.brain.notRead')}
                  {c.subscribers !== null ? ` · ${t('home.dash.subs', { n: fmtCompact(c.subscribers) })}` : ''}
                </p>
              </div>
              <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 text-fg-3 hover:text-fg" aria-label={c.url}>
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
      {top.length > 0 && (
        <section className="mt-6" data-testid="outliers-live">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-fg">
            <Flame className="size-4 text-warn" aria-hidden />
            {t('beta.brain.outliers')}
          </h3>
          <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
            {top.map((o) => (
              <li key={`${o.sourceKey}-${o.videoId}`} className="px-4 py-2.5">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-fg">
                  {o.title}
                  {o.demo && <DemoBadge />}
                </p>
                <p className="truncate text-[12px] text-fg-3">
                  {o.channelName} · {t('beta.brain.views', { n: fmtCompact(o.views) })} · ×{o.score.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} · {o.why}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
