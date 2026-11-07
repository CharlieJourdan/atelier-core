// Ordinateur (section `ordinateurs`): the team's own computer. The machine, what runs on it, its files, the agents'
// browsers, connected accounts, rendering (team PC or cloud GPU) and the plans. The real blocks (remote PCs added by
// hand, agent browser sessions) stay reachable under « Avancé ». The machine is a demo (DemoBadge next to it), except in
// real mode in the desktop app, where it shows this PC's real figures (useMachine.ts).
import { ChevronRight, Monitor, Plus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { DemoBadge } from '@/components/atelier/demo'
import { AgentAvatar, ProgressBar, ProgressRing, ProtoPage, fmtNum } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { OTHER_SERVICES, PLANS } from '@/proto/data-team-computer'
import type { EngineAccount, ProtoPipeline } from '@/proto/types'
import { BrowsersBlock } from '../computers/BrowsersBlock'
import { MachinesBlock } from '../computers/MachinesBlock'
import type { ScreenProps } from '../registry'
import { BlockTitle, Card } from './atoms'
import { BrainHealthLines } from './BrainHealth'
import { BrowsersCard, FilesCard } from './ComputerFiles'
import { useTeamAgents } from './model'
import { liveComputer, useMachine } from './useMachine'

const JOB_AGENTS = ['ag-enigmes-edit', 'ag-histoires-edit', 'ag-enigmes-compet']

function Gauge({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-2" data-testid={testId}>
      <ProgressRing value={value} size={64} stroke={4}>
        <span className="num text-[14px] font-medium text-fg">{value}%</span>
      </ProgressRing>
      <span className="text-[12px] text-fg-3">{label}</span>
    </div>
  )
}

function MachineCard() {
  const { state, agents } = useTeamAgents()
  const machine = useMachine(state.mode === 'live')
  const pc = machine ? liveComputer(machine, state.videos) : state.computer
  const diskPct = Math.round((pc.diskUsedGb / pc.diskTotalGb) * 100)
  return (
    <Card data-testid="pc-machine" data-live={machine ? 'true' : undefined} className="p-5">
      <div className="flex items-start gap-3.5">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-line-2 bg-surface-2 text-fg-2">
          <Monitor className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.016em] text-fg">{pc.name}</h2>
            {!machine && <DemoBadge />}
          </div>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            {pc.provider} · {pc.region}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] text-fg-2">
          <span aria-hidden className="size-1.5 rounded-full bg-ok" />
          {machine && machine.uptimeHours < 24 ? t('team.pc.onlineHours', { n: machine.uptimeHours }) : t('team.pc.online', { n: pc.uptimeDays })}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-fg-2">{pc.specs}</p>
      {machine?.brain && <BrainHealthLines brain={machine.brain} />}
      <div className="mt-5 grid grid-cols-[auto_auto_1fr] items-center gap-x-8 gap-y-4">
        <Gauge label={t('team.pc.cpu')} value={pc.cpu} testId="pc-cpu" />
        <Gauge label={t('team.pc.ram')} value={pc.ram} testId="pc-ram" />
        <div className="min-w-0" data-testid="pc-disk">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-fg-3">{t('team.pc.disk')}</span>
            <span className="num text-[12.5px] text-fg-2">{t('team.pc.disk.value', { used: pc.diskUsedGb, total: pc.diskTotalGb })}</span>
          </div>
          <ProgressBar value={diskPct} className="mt-2 h-1.5" />
          <p className="mt-1.5 text-[11.5px] text-fg-3">{t('team.pc.disk.free', { n: pc.diskTotalGb - pc.diskUsedGb })}</p>
        </div>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-3 text-[13px] font-semibold tracking-[-0.01em] text-fg">{t('team.pc.jobs')}</h3>
        {pc.jobs.length === 0 && <p className="text-[12.5px] text-fg-3">{t('team.pc.noJobs')}</p>}
        <ul className="flex flex-col gap-3" data-testid="pc-jobs">
          {pc.jobs.map((job, i) => {
            const agent = agents.find((a) => a.id === JOB_AGENTS[i])
            return (
              <li key={job.label} className="flex items-center gap-3">
                {agent && <AgentAvatar agent={agent} size={22} showStatus={false} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-fg-2">{job.label}</p>
                  <ProgressBar value={job.progress} className="mt-1.5" />
                </div>
                <span className="num w-10 shrink-0 text-right text-[12px] text-fg-2">{job.progress} %</span>
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}

function RenderCard({ pipelines }: { pipelines: readonly ProtoPipeline[] }) {
  const [mode, setMode] = useState<'team' | 'cloud'>('team')
  const rows = pipelines.slice(0, 4)
  const options: { id: 'team' | 'cloud'; title: string; tag: string; blurb: string }[] = [
    { id: 'team', title: t('team.pc.render.team'), tag: t('team.pc.render.team.tag'), blurb: t('team.pc.render.team.blurb') },
    { id: 'cloud', title: t('team.pc.render.cloud'), tag: t('team.pc.render.cloud.tag'), blurb: t('team.pc.render.cloud.blurb') }
  ]
  return (
    <Card data-testid="pc-render" className="flex flex-col p-5">
      <BlockTitle title={t('team.pc.render')} hint={t('team.pc.render.hint')} />
      <div role="radiogroup" aria-label={t('team.pc.render')} className="mt-4 flex flex-col gap-2">
        {options.map((o) => {
          const on = mode === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`pc-render-${o.id}`}
              onClick={() => setMode(o.id)}
              className={cn('flex items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring', on ? 'border-line-3 bg-selected' : 'border-line-2 hover:bg-hover')}
            >
              <span aria-hidden className={cn('mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-ink' : 'border-line-3')}>
                {on && <span className="size-2 rounded-full bg-ink" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                  {o.title}
                  <span className="rounded-full border border-line-2 px-2 py-px text-[11px] font-normal text-fg-3">{o.tag}</span>
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-fg-3">{o.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[12px] font-medium text-fg-3">{t('team.pc.render.perVideo')}</p>
        <div className="grid grid-cols-[1fr_72px_96px] gap-x-3 gap-y-1.5 text-[12.5px]" data-testid="pc-render-table">
          <span />
          <span className={cn('text-right text-[11.5px]', mode === 'team' ? 'font-medium text-fg' : 'text-fg-3')}>{t('team.pc.render.colTeam')}</span>
          <span className={cn('text-right text-[11.5px]', mode === 'cloud' ? 'font-medium text-fg' : 'text-fg-3')}>{t('team.pc.render.colCloud')}</span>
          {rows.map((p) => (
            <div key={p.id} className="col-span-3 grid grid-cols-subgrid items-baseline border-t border-line pt-1.5">
              <span className="truncate text-fg-2">{p.name}</span>
              <span className={cn('num text-right', mode === 'team' ? 'font-medium text-fg' : 'text-fg-3')}>{t('team.pc.render.min', { n: p.minutesPerVideo })}</span>
              <span className={cn('num text-right', mode === 'cloud' ? 'font-medium text-fg' : 'text-fg-3')}>
                {t('team.pc.render.min', { n: p.minutesCloud })} · {Math.max(6, Math.round(p.minutesCloud * 2.4))} cr.
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

/** A two-letter mark for the tile of an account (no brand logos in the demo). */
function serviceMark(label: string): string {
  if (/claude/i.test(label)) return 'CC'
  if (/codex|chatgpt/i.test(label)) return 'CX'
  if (/youtube/i.test(label)) return 'YT'
  if (/drive/i.test(label)) return 'Dr'
  if (/discord/i.test(label)) return 'Di'
  return label.trim().slice(0, 2)
}

function AccountsCard({ accounts, live }: { accounts: readonly EngineAccount[]; live: boolean }) {
  const engine = accounts.filter((a) => a.provider !== 'atelier')
  const rows = [
    ...engine.map((a) => ({ id: a.id, label: a.label, detail: [a.owner, a.plan].filter(Boolean).join(' · '), status: a.status === 'ok' ? ('ok' as const) : a.status === 'limited' ? ('limited' as const) : ('attention' as const), note: a.status === 'limited' ? t('team.engine.limitedUntil', { time: '18 h' }) : undefined })),
    // the beta: the other services of the demo (Google, Drive, Discord) are not shown as connected in real mode
    ...(live ? [] : OTHER_SERVICES.map((s) => ({ id: s.id, label: s.label, detail: s.detail, status: s.status, note: s.note })))
  ]
  return (
    <Card data-testid="pc-accounts" className="flex flex-col p-5">
      <BlockTitle title={t('team.pc.accounts')} hint={t('team.pc.accounts.hint')} />
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-[11px] font-semibold tracking-[-0.01em] text-fg-2">
              {serviceMark(r.label)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{r.label}</p>
              <p className="truncate text-[12px] text-fg-3">{r.detail}</p>
            </div>
            {r.status === 'attention' ? (
              <Button size="sm" variant="outline" onClick={() => toast.demo()}>
                {t('team.pc.accounts.reconnect')}
              </Button>
            ) : (
              <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[12px]', r.status === 'limited' ? 'text-warn' : 'text-fg-2')}>
                <span aria-hidden className={cn('size-1.5 rounded-full', r.status === 'limited' ? 'bg-warn' : 'bg-ok')} />
                {r.note ?? t('team.pc.accounts.connected')}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="mt-4 self-start" data-testid="pc-add-account" onClick={() => toast.demo()}>
        <Plus className="size-3.5" aria-hidden />
        {t('team.pc.accounts.add')}
      </Button>
    </Card>
  )
}

function UpgradeRow({ live }: { live: boolean }) {
  return (
    <Card data-testid="pc-upgrade" className="p-5">
      <BlockTitle title={t('team.pc.upgrade')} hint={t('team.pc.upgrade.hint')} action={live ? <DemoBadge /> : undefined} />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={cn('flex flex-col rounded-[14px] border p-4', p.current ? 'border-line-3 bg-selected' : 'border-line-2')}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-semibold tracking-[-0.012em] text-fg">{p.name}</p>
              {p.current && <span className="rounded-full bg-ink px-2 py-px text-[10.5px] font-semibold text-ink-fg">{t('team.pc.upgrade.current')}</span>}
            </div>
            <p className="mt-1 text-[12.5px] text-fg-3">{p.specs}</p>
            <p className="num mt-3 text-[15px] font-medium text-fg">{p.price}</p>
            {!p.current && (
              <Button size="sm" variant="outline" className="mt-3 self-start" onClick={() => toast.demo()}>
                {t('team.pc.upgrade.choose')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ComputerScreen(_props: ScreenProps) {
  const { state, agents } = useTeamAgents()
  const [advanced, setAdvanced] = useState(false)
  const channels = state.scope === 'all' ? state.channels : state.channels.filter((c) => c.id === state.scope)
  const pipelines = state.pipelines.filter((p) => state.scope === 'all' || p.channelIds.includes(state.scope))
  return (
    <ProtoPage
      testId="view-ordinateurs"
      title={t('team.pc.title')}
      subtitle={t('team.pc.subtitle', { n: fmtNum(state.mode === 'live' ? state.videos.filter((v) => v.status === 'running').length : state.computer.jobs.length) })}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <MachineCard />
          <RenderCard pipelines={pipelines} />
        </div>
        <FilesCard channels={channels} agents={agents} />
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <BrowsersCard agents={agents} />
          <AccountsCard accounts={state.accounts} live={state.mode === 'live'} />
        </div>
        <UpgradeRow live={state.mode === 'live'} />
        <section data-testid="pc-advanced">
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((a) => !a)}
            className="flex items-center gap-1.5 rounded-full text-[13px] font-medium text-fg-2 outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight className={cn('size-4 transition-transform duration-150', advanced && 'rotate-90')} aria-hidden />
            {t('team.pc.advanced')}
          </button>
          <p className="mt-1 pl-[22px] text-[12.5px] text-fg-3">{t('team.pc.advanced.hint')}</p>
          {advanced && (
            <div className="mt-4 flex flex-col gap-5">
              <MachinesBlock />
              <BrowsersBlock />
            </div>
          )}
        </section>
      </div>
    </ProtoPage>
  )
}
