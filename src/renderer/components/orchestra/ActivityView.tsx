// « Activité » (Équipe › Activité, docs/AGENT-RUNTIME.md §25): what the team does right now — who works on what since
// when, what waits and on whom, what is next in the queue, the next routines, the accounts and their limits, the team's
// spend, the daily / weekly report and the latest events. Live: refetched on every runtime event (topic `orchestra`). Real mode only (IPC).
import type { ReactNode } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { ActivitySnapshot, ActivityWait } from '../../../shared/api/autopilot'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel, StatusDot } from '@/components/atelier/primitives'
import { AgentAvatar } from '@/components/proto/kit'
import { useProto } from '@/proto/store'
import type { ProtoAgent } from '@/proto/types'
import { useApi } from '@/state/client'
import { ReportPanel } from './ReportPanel'

const time = (iso: string): string => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const when = (iso: string): string => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

function Rows({ empty, children }: { empty: string; children: ReactNode[] }) {
  return children.length === 0 ? <p className="text-[13px] text-fg-3">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>
}

/** The mascot of a runtime agent (its status dot is the row's own); the coloured bubble's place when the agent is not known. */
function Who({ agents, id, name }: { agents: readonly ProtoAgent[]; id: number; name: string }) {
  const agent = agents.find((a) => a.liveId === id)
  return agent ? <AgentAvatar agent={agent} size={26} showStatus={false} /> : <span aria-hidden title={name} className="size-[26px] shrink-0 rounded-full bg-surface-3" />
}

function waitText(w: ActivityWait): string {
  const base = t(`auto.act.on.${w.on}` as MessageKey, { who: w.who })
  return w.until ? `${base} · ${t('auto.act.until', { time: when(w.until) })}` : base
}

export function ActivityView({ onAnswer }: { onAnswer?: () => void }) {
  const snap = useApi('autopilot.activity', ['orchestra'])
  const { agents } = useProto()
  if (snap.error) return <ErrorLine message={snap.error} onRetry={snap.reload} />
  const s: ActivitySnapshot | null = snap.data
  if (!s) return <LoadingBlock rows={4} />
  return (
    <div data-testid="team-activity" className="grid gap-4 lg:grid-cols-2">
      <Panel title={t('auto.act.running')} data-testid="activity-running">
        <Rows empty={t('auto.act.running.none')}>
          {s.running.map((r) => (
            <li key={r.taskId} className="flex items-center gap-3 py-2 text-[13px]">
              <Who agents={agents} id={r.agentId} name={r.agentName} />
              <StatusDot tone="ok" pulse />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium text-fg">{r.agentName}</b> <span className="text-fg-2">{r.title}</span>
                {r.channelName && <span className="text-fg-3"> · {r.channelName}</span>}
              </span>
              <span className="num text-[12px] text-fg-3">{t('auto.act.since', { time: time(r.since) })}</span>
            </li>
          ))}
        </Rows>
      </Panel>
      <Panel title={t('auto.act.waiting')} data-testid="activity-waiting">
        <Rows empty={t('auto.act.waiting.none')}>
          {s.waiting.map((w) => (
            <li key={w.taskId} className="flex items-center gap-3 py-2 text-[13px]" data-on={w.on}>
              <Who agents={agents} id={w.agentId} name={w.agentName} />
              <StatusDot tone={w.on === 'charlie' ? 'warn' : 'info'} />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium text-fg">{w.agentName}</b> <span className="text-fg-2">{w.title}</span>
                <span className="block text-[12px] text-fg-3">{waitText(w)}</span>
              </span>
              {w.on === 'charlie' && w.inboxId !== null && onAnswer && (
                <button type="button" className="text-[12px] font-medium text-accent hover:underline" onClick={onAnswer}>
                  {t('auto.act.answer')}
                </button>
              )}
            </li>
          ))}
        </Rows>
      </Panel>
      <Panel title={t('auto.act.queued', { n: s.queued.count })} data-testid="activity-queued">
        <Rows empty={t('auto.act.queued.none')}>
          {s.queued.next.map((q) => (
            <li key={q.taskId} className="flex items-center gap-3 py-2 text-[13px]">
              <Who agents={agents} id={q.agentId} name={q.agentName} />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium text-fg">{q.agentName}</b> <span className="text-fg-2">{q.title}</span>
              </span>
              {q.notBefore && <span className="num text-[12px] text-fg-3">{when(q.notBefore)}</span>}
            </li>
          ))}
        </Rows>
      </Panel>
      <Panel title={t('auto.act.routines')} data-testid="activity-routines">
        <Rows empty={t('auto.act.routines.none')}>
          {s.nextRoutines.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
              <Who agents={agents} id={r.agentId} name={r.agentName} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-fg">{r.name}</span> <span className="text-fg-3">· {r.agentName}</span>
              </span>
              <span className="num text-[12px] text-fg-3">{when(r.at)}</span>
            </li>
          ))}
        </Rows>
      </Panel>
      <Panel title={t('auto.act.accounts')} data-testid="activity-accounts">
        <Rows empty={t('orch.noAccount')}>
          {s.accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
              <StatusDot tone={a.ready ? 'ok' : a.limitedUntil ? 'warn' : 'off'} />
              <span className="min-w-0 flex-1 truncate text-fg">{a.label}</span>
              <span className="num text-[12px] text-fg-3">
                {a.limitedUntil ? t('auto.act.account.limited', { time: when(a.limitedUntil) }) : a.ready ? t('auto.act.account.ready') : t('auto.act.account.unchecked')}
                {a.running > 0 && ` · ${a.running}/${a.maxConcurrent}`}
              </span>
            </li>
          ))}
        </Rows>
        <p className="micro-label mt-4 mb-1">{t('auto.act.spend')}</p>
        <p className="num text-[13px] text-fg-2" data-testid="activity-spend">
          {t('auto.act.spend.line', { calls: s.spend.callsToday, today: s.spend.usdToday.toFixed(2), month: s.spend.usdMonth.toFixed(2) })}
        </p>
      </Panel>
      <ReportPanel />
      <Panel title={t('auto.act.events')} className="lg:col-span-2" data-testid="activity-events">
        <Rows empty={t('auto.act.events.none')}>
          {s.events.map((e) => (
            <li key={e.id} className="flex gap-3 py-1.5 text-[12.5px]">
              <span className="num w-12 shrink-0 text-fg-3">{time(e.at)}</span>
              <span className="w-24 shrink-0 truncate text-fg-3">{e.type}</span>
              <span className="min-w-0 flex-1 text-fg-2">{e.text}</span>
            </li>
          ))}
        </Rows>
      </Panel>
    </div>
  )
}
