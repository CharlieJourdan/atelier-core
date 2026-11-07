// Charge: how rested or busy every agent is, hour by hour over the last 24 h (ink opacity), and the main agent's own
// reading of the balance with the two moves it proposes.
import { Check } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { AgentAvatar, ChannelAvatar } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { hourlyLoad, restOf } from '@/proto/data-team-agents'
import type { ProtoChannel } from '@/proto/types'
import { Card } from './atoms'
import { averageLoad, balanceSentence, type TeamAgent } from './model'

const TAKE_KEY: Partial<Record<TeamAgent['role'], MessageKey>> = {
  editor: 'team.load.take.editor',
  scriptwriter: 'team.load.take.scriptwriter',
  packaging: 'team.load.take.packaging',
  researcher: 'team.load.take.researcher',
  director: 'team.load.take.director'
}

function cellBackground(v: number): string {
  const pct = Math.round(6 + v * 0.8)
  return `color-mix(in oklab, var(--ink) ${pct}%, transparent)`
}

function hourLabel(nowHour: number, i: number): string {
  return `${(nowHour - 23 + i + 48) % 24} h`
}

function Balance({ agents, principalAgent }: { agents: readonly TeamAgent[]; principalAgent: TeamAgent }) {
  const [applied, setApplied] = useState<Record<string, boolean>>({})
  const { busy, rested } = balanceSentence(agents)
  if (!busy) return null
  const take = t(TAKE_KEY[busy.role] ?? 'team.load.take.default')
  return (
    <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-start" data-testid="load-balance">
      <AgentAvatar agent={principalAgent} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-fg-3">{t('team.load.fromMain', { name: principalAgent.name })}</p>
        <p className="mt-1 text-[15px] leading-[1.5] tracking-[-0.01em] text-fg">
          {t('team.load.balance', { busy: busy.name, load: busy.load, take })}
          {rested ? ` ${t('team.load.balance.rested', { rested: rested.name, load: rested.load })}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={applied['move'] ? 'secondary' : 'default'}
            data-testid="load-apply"
            onClick={() => setApplied((a) => ({ ...a, move: true }))}
            disabled={applied['move']}
          >
            {applied['move'] ? (
              <>
                <Check className="size-3.5" aria-hidden />
                {t('team.load.applied')}
              </>
            ) : (
              t('team.load.apply')
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setApplied((a) => ({ ...a, move: false }))} disabled={!applied['move']}>
            {t('team.load.undo')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-line-2 bg-surface-1 px-4 py-3">
      <p className="text-[12px] text-fg-3">{label}</p>
      <p className="num mt-0.5 text-[24px] font-medium tracking-[-0.02em] text-fg">{value}</p>
    </div>
  )
}

export function LoadView({ agents, channels, principalAgent }: { agents: readonly TeamAgent[]; channels: readonly ProtoChannel[]; principalAgent: TeamAgent }) {
  const workers = agents.filter((a) => a.role !== 'principal')
  const nowHour = new Date().getHours()
  const groups: { id: string; label: string; channel?: ProtoChannel; rows: TeamAgent[] }[] = [
    ...(workers.some((a) => a.channelId === null) ? [{ id: 'shared', label: t('team.chart.shared'), rows: workers.filter((a) => a.channelId === null) }] : []),
    ...channels.map((ch) => ({ id: ch.id, label: ch.name, channel: ch, rows: workers.filter((a) => a.channelId === ch.id) }))
  ]
  const rested = workers.filter((a) => restOf(a.load) === 'rested').length
  const stretched = workers.filter((a) => restOf(a.load) === 'busy' || restOf(a.load) === 'overloaded').length
  return (
    <div className="flex flex-col gap-5" data-testid="team-load">
      <Balance agents={agents} principalAgent={principalAgent} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('team.load.avg')} value={`${averageLoad(workers)} %`} />
        <Stat label={t('team.load.restedCount')} value={String(rested)} />
        <Stat label={t('team.load.stretchedCount')} value={String(stretched)} />
      </div>
      <Card className="overflow-x-auto p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{t('team.load.heat')}</h2>
          <div className="flex items-center gap-2 text-[11.5px] text-fg-3" aria-hidden>
            <span>{t('team.load.calm')}</span>
            {[8, 25, 45, 65, 85].map((v) => (
              <span key={v} className="size-3.5 rounded-[4px]" style={{ background: cellBackground(v) }} />
            ))}
            <span>{t('team.load.hot')}</span>
          </div>
        </div>
        <div className="min-w-[760px]" role="table" aria-label={t('team.load.heat')}>
          <div className="mb-1.5 grid grid-cols-[190px_1fr_44px] items-end gap-x-3">
            <span />
            <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="num text-center text-[10.5px] text-fg-3">
                  {i % 4 === 3 || i === 23 ? (i === 23 ? t('team.load.now') : hourLabel(nowHour, i)) : ''}
                </span>
              ))}
            </div>
            <span className="num text-right text-[10.5px] text-fg-3">{t('team.load.today')}</span>
          </div>
          {groups.map((g) => (
            <div key={g.id} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-fg-2">
                {g.channel ? <ChannelAvatar channel={g.channel} size={14} /> : <span className="size-2 rounded-full bg-fg-4" aria-hidden />}
                {g.label}
              </div>
              {g.rows.map((a) => {
                const hours = hourlyLoad(a, a.load, nowHour)
                return (
                  <div key={a.id} role="row" data-testid={`load-row-${a.id}`} className="grid grid-cols-[190px_1fr_44px] items-center gap-x-3 py-[2px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <AgentAvatar agent={a} size={18} showStatus={false} />
                      <span className="shrink-0 text-[12.5px] text-fg">{a.name}</span>
                      <span className="min-w-0 truncate text-[11.5px] text-fg-3">{a.roleLabel}</span>
                    </span>
                    <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
                      {hours.map((v, i) => (
                        <span key={i} role="cell" title={`${a.name} · ${hourLabel(nowHour, i)} · ${v} %`} className="h-5 rounded-[4px]" style={{ background: cellBackground(v) }} />
                      ))}
                    </div>
                    <span className="num text-right text-[12px] text-fg-2">{a.load} %</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
