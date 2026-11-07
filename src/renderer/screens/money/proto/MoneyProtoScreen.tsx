// Monétisation (route `monetisation`): a profit and loss anyone can read. What each channel earns (AdSense, sponsors,
// products), what it costs (credits, the AI subscriptions shared out, the computer), the margin, and what each video
// returned. The previous six-tab screen stays one click away under « Avancé ». In real mode the figures are the
// measured ones (this month's P&L, the spend ledger, the revenues entered, the subscription prices typed, and, with Google
// connected, YouTube's views and estimated revenue of each linked channel); the block
// with no source yet (the credit balance) keeps its demo data under a « Données de démonstration » badge.
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import { LiveDemoNote } from '@/components/proto/LiveDemoBadge'
import { fmtEuro, fmtNum, ProtoPage, SectionHead, Segmented } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { liveEntries } from '@/proto/live/actions-brain-money'
import { LIVE_REVENUE_KINDS } from '@/proto/live/mapping-money'
import { SEED_ENTRIES, type MoneyEntry } from '@/proto/data-brain-money'
import { channelOf, useProto, useProtoActions } from '@/proto/store'
import { Trend } from '../../home/Kpis'
import type { ScreenProps } from '../../registry'
import { MoneyScreen } from '../MoneyScreen'
import { EntryDialog } from './EntryDialog'
import { GoogleMoneyBlock } from './GoogleMoneyBlock'
import { LiveLedger } from './LiveLedger'
import { CostSplit, CreditsBlock, EntriesList, LiveCreditsBlock, SubsBlock, VideoReturns } from './MoneyBlocks'
import { MoneyChart } from './MoneyChart'
import { liveLedger, liveVideoReturns } from './money-live'
import { computeLedger, fmtEuroSmart, videoReturns, type Kpis } from './money-model'
import { PnlTable } from './PnlTable'

type View = 'clear' | 'advanced'

function ViewSwitch({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div data-testid="money-view-switch">
      <Segmented<View>
        value={value}
        onChange={onChange}
        options={[
          { value: 'clear', label: t('money2.view.clear') },
          { value: 'advanced', label: t('money2.view.advanced') }
        ]}
      />
    </div>
  )
}

function KpiRow({ k, live }: { k: Kpis; live: boolean }) {
  const cells: { id: string; label: string; value: string; sub: React.ReactNode }[] = [
    { id: 'revenue', label: live ? t('live.money.kpi.revenue') : t('money2.kpi.revenue'), value: fmtEuro(k.revenue), sub: <Trend value={k.trendRevenue} /> },
    {
      id: 'cost',
      label: live ? t('live.money.kpi.cost') : t('money2.kpi.cost'),
      value: fmtEuro(k.cost),
      sub: <span className="text-[12px] text-fg-3">{live ? t('live.money.kpi.cost.hint') : t('money2.kpi.cost.hint')}</span>
    },
    {
      id: 'margin',
      label: t('money2.kpi.margin'),
      value: fmtEuro(k.margin),
      sub: (
        <span className={cn('num text-[12px] font-medium', k.margin >= 0 ? 'text-ok' : 'text-err')}>
          {t('money2.kpi.margin.pct', { n: Math.round(k.marginPct) })}
        </span>
      )
    },
    {
      id: 'costVideo',
      label: t('money2.kpi.costVideo'),
      value: k.videos > 0 ? fmtEuroSmart(k.costPerVideo) : '—',
      sub: <span className="num text-[12px] text-fg-3">{t('money2.kpi.videos', { n: fmtNum(k.videos) })}</span>
    },
    {
      id: 'revVideo',
      label: t('money2.kpi.revVideo'),
      value: k.videos > 0 ? fmtEuroSmart(k.revPerVideo) : '—',
      sub: <span className="num text-[12px] text-fg-3">{t('money2.kpi.videos', { n: fmtNum(k.videos) })}</span>
    }
  ]
  return (
    <div data-testid="money-kpis" className="mb-8 grid grid-cols-2 overflow-hidden rounded-[16px] border border-line-2 bg-surface-1 @[900px]:grid-cols-5">
      {cells.map((c, i) => (
        <div
          key={c.id}
          data-kpi={c.id}
          className={cn(
            'min-w-0 px-4 py-3.5',
            i > 0 && '@[900px]:border-l @[900px]:border-line',
            i % 2 === 1 && 'border-l border-line @[900px]:border-l',
            i >= 2 && 'border-t border-line @[900px]:border-t-0'
          )}
        >
          <p className="truncate text-[12px] text-fg-3">{c.label}</p>
          <p className="num mt-1 text-[26px] leading-none font-medium tracking-[-0.02em] text-fg">{c.value}</p>
          <p className="mt-2 min-h-[18px]">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}

function Clear({ onRoute, onAdvanced }: ScreenProps & { onAdvanced: (v: View) => void }) {
  const state = useProto()
  const { addRevenue, deleteRevenue, setSubscriptionPrice } = useProtoActions()
  const [entries, setEntries] = useState<MoneyEntry[]>(SEED_ENTRIES)
  const [dialog, setDialog] = useState<'revenue' | 'expense' | null>(null)
  const [bought, setBought] = useState(0)
  const scope = state.scope
  const live = state.mode === 'live'
  const money = state.liveMoney

  const ledger = useMemo(
    () =>
      live && money
        ? liveLedger({ money, channels: state.channels, accounts: state.accounts, scope })
        : computeLedger({ channels: state.channels, pipelines: state.pipelines, accounts: state.accounts, entries, scope }),
    [live, money, state.channels, state.pipelines, state.accounts, entries, scope]
  )
  const returns = useMemo(
    () => (live && money ? liveVideoReturns(money, state.channels, state.videos, scope) : videoReturns(state.channels, scope)),
    [live, money, state.channels, state.videos, scope]
  )
  const allEntries = useMemo(() => (live ? liveEntries({ liveMoney: money }) : entries), [live, money, entries])
  const shown = allEntries.filter((e) => scope === 'all' || e.channelId === scope).sort((a, b) => a.daysAgo - b.daysAgo)
  const nameOf = (id: string | null): string => channelOf(state, id)?.name ?? t('money2.add.general')
  const scopeChannel = scope === 'all' ? null : channelOf(state, scope)
  const scopeName = scopeChannel?.name ?? t('scope.all').toLowerCase()

  if (live && !money) {
    return (
      <ProtoPage testId="view-monetisation" wide title={t('section.monetisation')} subtitle={t('live.money.loading')} actions={<ViewSwitch value="clear" onChange={onAdvanced} />}>
        <p className="text-[13px] text-fg-3" data-testid="money-loading">
          {state.live.error ?? t('live.money.loading')}
        </p>
      </ProtoPage>
    )
  }

  return (
    <ProtoPage
      testId="view-monetisation"
      wide
      title={t('section.monetisation')}
      subtitle={live ? t('live.money.subtitle', { n: fmtNum(ledger.kpis.videos), scope: scopeName }) : t('money2.subtitle', { n: fmtNum(ledger.kpis.videos), scope: scopeName })}
      actions={
        <>
          <ViewSwitch value="clear" onChange={onAdvanced} />
          {!live && (
            <Button variant="outline" onClick={() => setDialog('expense')} data-testid="money-add-expense">
              <Plus aria-hidden />
              {t('money2.add.expense')}
            </Button>
          )}
          <Button onClick={() => setDialog('revenue')} data-testid="money-add-revenue">
            <Plus aria-hidden />
            {t('money2.add.revenue')}
          </Button>
        </>
      }
    >
      <div className="@container">
        <KpiRow k={ledger.kpis} live={live} />
        {live && money && <GoogleMoneyBlock google={money.google} channels={state.channels} scope={scope} onRoute={onRoute} />}

        <div className="mb-8 grid gap-x-8 gap-y-8 @[1000px]:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label={t('money2.chart.title')} className="min-w-0">
            <SectionHead
              title={t('money2.chart.title')}
              action={
                <ul className="flex items-center gap-4 text-[12px] text-fg-2">
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-4 rounded-full bg-brand" />
                    {t('money2.chart.revenue')}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-4 rounded-full bg-fg-4" />
                    {t('money2.chart.cost')}
                  </li>
                </ul>
              }
            />
            <div className="rounded-[16px] border border-line-2 bg-surface-1 p-3">
              <MoneyChart revenue={ledger.weeks.revenue} cost={ledger.weeks.cost} />
            </div>
            <p className="mt-2 text-[12px] text-fg-3">{live ? t('live.money.chart.hint') : t('money2.chart.hint')}</p>
            {live && scope !== 'all' && <p className="mt-1 text-[12px] text-fg-3">{t('live.money.chart.allChannels')}</p>}
            <CostSplit credits={ledger.total.credits} subs={ledger.total.claude} pc={ledger.total.pc} live={live} />
            {live && money && <LiveLedger spend={money.spend} />}
          </section>
          <SubsBlock
            accounts={state.accounts}
            live={live && money ? { prices: money.subscriptions, onChange: (id, euros) => void setSubscriptionPrice(id, euros) } : undefined}
          />
        </div>

        <section className="mb-8" aria-label={t('money2.table.title')}>
          <SectionHead title={t('money2.table.title')} />
          <PnlTable ledger={ledger} onRoute={onRoute} live={live} />
        </section>

        <div className="grid gap-x-8 gap-y-8 @[1000px]:grid-cols-[minmax(0,1fr)_360px]">
          <VideoReturns items={returns} live={live} />
          <div className="min-w-0 space-y-8">
            {live ? (
              <LiveCreditsBlock workspace={state.workspace} onAccount={() => onRoute({ section: 'reglages', page: 'compte' })} />
            ) : (
              <div>
                <LiveDemoNote block="credits" note="live.demo.credits" />
                <CreditsBlock workspace={state.workspace} bought={bought} onBuy={(n) => setBought((b) => b + n)} />
              </div>
            )}
            <EntriesList
              entries={shown}
              channelName={nameOf}
              {...(live ? { onDelete: (id: string) => void deleteRevenue(id), hint: t('live.money.entries.hint') } : {})}
            />
          </div>
        </div>
      </div>

      {dialog && (
        <EntryDialog
          type={dialog}
          channels={scope === 'all' ? state.channels : state.channels.filter((c) => c.id === scope)}
          onClose={() => setDialog(null)}
          {...(live ? { kinds: LIVE_REVENUE_KINDS } : {})}
          onAdd={(e) => (live ? void addRevenue(e) : setEntries((prev) => [{ ...e, id: `en-${Date.now().toString(36)}-${prev.length}` }, ...prev]))}
        />
      )}
    </ProtoPage>
  )
}

export function MoneyProtoScreen(props: ScreenProps & { initialView?: View }) {
  const [view, setView] = useState<View>(props.initialView ?? 'clear')
  if (view === 'advanced') {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="money-advanced">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-8 py-2.5">
          <p className="text-[12.5px] text-fg-3">{t('money2.advanced.hint')}</p>
          <ViewSwitch value="advanced" onChange={setView} />
        </div>
        <div className="min-h-0 flex-1">
          <MoneyScreen route={props.route} onRoute={props.onRoute} />
        </div>
      </div>
    )
  }
  return <Clear route={props.route} onRoute={props.onRoute} onAdvanced={setView} />
}
