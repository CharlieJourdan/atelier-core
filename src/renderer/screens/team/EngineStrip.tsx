// « Moteur »: the pool of accounts the agents run on (Claude Code, Codex, Atelier plan) with their 5 h / weekly use,
// the queue of work, and the watchdog health. This is where the user sees that the team keeps going.
import { ShieldCheck } from 'lucide-react'
import { t, type MessageKey } from '../../../shared/fr'
import { ACCOUNT_RESET, WATCHDOG } from '@/proto/data-team-agents'
import type { OrchStatus } from '../../../shared/api/orchestra'
import type { EngineAccount, InboxItem, ProtoAgent, ProtoVideo } from '@/proto/types'
import { cn } from '@/lib/utils'
import { Card } from './atoms'

const PROVIDER: Record<EngineAccount['provider'], MessageKey> = {
  'claude-code': 'team.engine.provider.claude',
  codex: 'team.engine.provider.codex',
  atelier: 'team.engine.provider.atelier'
}

function Meter({ label, value }: { label: string; value: number }) {
  const tone = value >= 85 ? 'bg-warn' : 'bg-ink'
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[11px] text-fg-3">{label}</span>
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-[3px] w-20 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="num w-8 text-right text-[11px] text-fg-2">{value} %</span>
    </div>
  )
}

function AccountRow({ account }: { account: EngineAccount }) {
  const reset = ACCOUNT_RESET[account.id]
  const limited = account.status === 'limited'
  return (
    <li data-testid={`engine-account-${account.id}`} data-status={account.status} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-[13px] font-medium text-fg">{account.label}</p>
        <p className="truncate text-[11.5px] text-fg-3">
          {t(PROVIDER[account.provider])} · {account.owner}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Meter label={t('team.engine.window5h')} value={account.usage5h} />
        <Meter label={t('team.engine.week')} value={account.usageWeek} />
      </div>
      <span className={cn('inline-flex min-w-[116px] items-center gap-1.5 text-[12px]', limited ? 'text-warn' : 'text-fg-2')}>
        <span aria-hidden className={cn('size-1.5 rounded-full', limited ? 'bg-warn' : account.status === 'off' ? 'bg-fg-4' : 'bg-ok')} />
        {limited ? t('team.engine.limitedUntil', { time: reset ?? '18 h' }) : account.status === 'off' ? t('team.engine.off') : t('team.engine.active')}
      </span>
    </li>
  )
}

export function EngineStrip({
  accounts,
  videos,
  inbox,
  agents,
  live
}: {
  /** Real mode: the runtime's own counts replace the ones derived from the screens. */
  live?: OrchStatus | null
  accounts: readonly EngineAccount[]
  videos: readonly ProtoVideo[]
  inbox: readonly InboxItem[]
  agents: readonly ProtoAgent[]
}) {
  const running = videos.filter((v) => v.status === 'running').length
  const queued = videos.filter((v) => v.status === 'queued').length
  const working = agents.filter((a) => a.status === 'working').length
  const queue: { key: string; n: number; label: string }[] = live
    ? [
        { key: 'running', n: live.running, label: t('team.engine.queue.running') },
        { key: 'queued', n: (live.tasks.queued ?? 0) + (live.tasks.failed ?? 0) + (live.tasks.waiting ?? 0), label: t('team.engine.queue.queued') },
        { key: 'user', n: live.openInbox, label: t('team.engine.queue.user') }
      ]
    : [
        { key: 'running', n: running + working, label: t('team.engine.queue.running') },
        { key: 'queued', n: queued, label: t('team.engine.queue.queued') },
        { key: 'user', n: inbox.length, label: t('team.engine.queue.user') }
      ]
  return (
    <Card data-testid="team-engine" className="mt-8 overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{t('team.engine.title')}</h2>
        <p className="text-[12.5px] text-fg-3">{t('team.engine.hint')}</p>
      </div>
      <div className="grid divide-line lg:grid-cols-[1.9fr_1fr_1fr] lg:divide-x">
        <div className="px-5 py-4">
          <p className="mb-3 text-[12px] font-medium text-fg-3">{t('team.engine.accounts', { n: accounts.length })}</p>
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} />
            ))}
          </ul>
        </div>
        <div className="border-t border-line px-5 py-4 lg:border-t-0">
          <p className="mb-3 text-[12px] font-medium text-fg-3">{t('team.engine.queue')}</p>
          <ul className="flex flex-col gap-2.5" data-testid="engine-queue">
            {queue.map((q) => (
              <li key={q.key} className="flex items-baseline gap-3">
                <span className="num w-9 text-[24px] leading-none font-medium tracking-[-0.02em] text-fg">{q.n}</span>
                <span className="text-[12.5px] text-fg-2">{q.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-line px-5 py-4 lg:border-t-0" data-testid="engine-watchdog">
          <p className="mb-3 text-[12px] font-medium text-fg-3">{t('team.engine.watchdog')}</p>
          <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <ShieldCheck className="size-4 text-ok" aria-hidden />
            {t('team.engine.watchdog.ok')}
          </p>
          {live ? (
            <>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-fg-2">{t('team.engine.watchdog.live', { failed: live.tasks.failed ?? 0, dead: live.tasks.dead ?? 0 })}</p>
              <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-3">{live.enabled ? t('team.engine.live.on') : t('team.engine.live.off')}</p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-fg-2">{t('team.engine.watchdog.line', { n: WATCHDOG.restarts24h, lost: WATCHDOG.lost24h })}</p>
              <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-3">{WATCHDOG.lastRestart}</p>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
