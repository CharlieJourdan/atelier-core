// The smaller blocks of the Monétisation screen: return per video, AI subscriptions, credits, and the rows entered by hand.
import { Check, Cpu, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { ChannelTag, fmtCompact, fmtEuro, fmtNum, ProgressBar, SectionHead, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Input, Label, Switch } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { COMPUTER_EUR, CREDIT_PACKS, SUB_PRICE, type MoneyEntry } from '@/proto/data-brain-money'
import type { EngineAccount, Workspace } from '@/proto/types'
import { fmtEuroSmart, fmtRoi, type VideoReturn } from './money-model'

/* ---------- per video ---------- */

export function VideoReturns({ items, live = false }: { items: VideoReturn[]; live?: boolean }) {
  return (
    <section aria-label={t('money2.videos.title')} data-testid="money-videos">
      <SectionHead title={t('money2.videos.title')} count={items.length} />
      {items.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-fg-3">
          {live ? t('live.money.videos.empty') : t('money2.videos.empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          <div className="hidden items-center gap-3.5 border-b border-line px-4 py-2 text-[12px] text-fg-3 @[900px]:flex" aria-hidden>
            <span className="flex-1">{t('money2.videos.col.video')}</span>
            <span className="w-[112px] text-right">{t('money2.videos.col.cost')}</span>
            <span className="w-[84px] text-right">{t('money2.videos.col.revenue')}</span>
            <span className="w-[58px] text-center">{t('money2.videos.col.roi')}</span>
          </div>
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <li key={r.video.id} data-testid="money-video" className="flex items-center gap-3.5 px-4 py-2.5">
                <Thumb hue={r.video.thumbHue} format={r.video.format} className={r.video.format === 'short' ? 'h-[46px]' : 'w-[80px]'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg">{r.video.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                    <ChannelTag channel={r.channel} className="min-w-0" />
                    {r.known !== false && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="num shrink-0">{t('money2.videos.views', { n: fmtCompact(r.video.views) })}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="num hidden w-[112px] shrink-0 text-right @[900px]:block">
                  <p className="text-[13px] text-fg-2">{fmtEuroSmart(r.costEuro)}</p>
                  <p className="text-[11.5px] text-fg-3">{t('money2.videos.credits', { n: fmtNum(r.costCredits) })}</p>
                </div>
                <p className="num w-[84px] shrink-0 text-right text-[13px] text-fg" data-estimated={r.estimated}>
                  {r.known === false ? '—' : `${r.estimated ? '≈ ' : ''}${fmtEuroSmart(r.revenue)}`}
                </p>
                <span
                  className="num inline-flex h-6 w-[58px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-medium text-fg"
                  title={t('money2.videos.roi')}
                >
                  {r.known === false ? '—' : fmtRoi(r.roi)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[12px] text-fg-3">{live ? t('live.money.videos.note') : t('money2.videos.note')}</p>
    </section>
  )
}

/* ---------- AI subscriptions ---------- */

const PROVIDER_LABEL: Record<EngineAccount['provider'], MessageKey> = {
  'claude-code': 'money2.subs.claude',
  codex: 'money2.subs.codex',
  atelier: 'money2.subs.atelier'
}

/** Real mode: the monthly price typed for each AI account, and the setter (null clears it). */
export interface SubPrices {
  prices: Record<string, number>
  onChange: (accountId: string, euros: number | null) => void
}

function PriceInput({ id, label, value, onChange }: { id: string; label: string; value: number | undefined; onChange: (euros: number | null) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','))
  const commit = (): void => {
    const raw = text.trim()
    if (raw === '') return onChange(null)
    const n = Number(raw.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) onChange(n)
  }
  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={t('live.money.subs.unset')}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-8 w-36 text-right"
      data-testid="money-sub-price"
    />
  )
}

export function SubsBlock({ accounts, live }: { accounts: EngineAccount[]; live?: SubPrices | undefined }) {
  const priceOf = (acc: EngineAccount): number => (live ? (live.prices[acc.id] ?? 0) : (SUB_PRICE[acc.id] ?? 0))
  const total = accounts.reduce((a, acc) => a + priceOf(acc), 0) + (live ? 0 : COMPUTER_EUR)
  return (
    <section aria-label={t('money2.subs.title')} data-testid="money-subs">
      <SectionHead title={t('money2.subs.title')} />
      <div className="overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
        <ul className="divide-y divide-line">
          {accounts.length === 0 && live && <li className="px-4 py-3 text-[12.5px] text-fg-3">{t('live.money.subs.empty')}</li>}
          {accounts.map((acc) => {
            const price = priceOf(acc)
            return (
              <li key={acc.id} className="px-4 py-2.5" data-testid="money-sub">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[13.5px] font-medium text-fg">{acc.label}</p>
                  {live ? (
                    <PriceInput id={`sub-${acc.id}`} label={`${acc.label} · ${t('live.money.subs.price')}`} value={live.prices[acc.id]} onChange={(v) => live.onChange(acc.id, v)} />
                  ) : (
                    <p className="num shrink-0 text-[13px] text-fg">{price > 0 ? t('money2.subs.perMonth', { n: fmtEuro(price) }) : t('money2.subs.inCredits')}</p>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-fg-3">
                  {t(PROVIDER_LABEL[acc.provider])} <span aria-hidden>·</span> {acc.owner}
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <ProgressBar value={acc.usageWeek} tone={acc.status === 'limited' ? 'warn' : 'ink'} />
                  <span className="num shrink-0 text-right text-[11.5px] whitespace-nowrap text-fg-3">{t('money2.subs.usage', { n: acc.usageWeek })}</span>
                </div>
              </li>
            )
          })}
          {!live && (
            <li className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-2">
                <Cpu className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-fg">{t('money2.subs.computer')}</p>
                <p className="text-[12px] text-fg-3">{t('money2.subs.computer.hint')}</p>
              </div>
              <p className="num shrink-0 text-[13px] text-fg">{t('money2.subs.perMonth', { n: fmtEuro(COMPUTER_EUR) })}</p>
            </li>
          )}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-t border-line-2 bg-surface-2/60 px-4 py-3">
          <p className="text-[12px] leading-[1.4] text-fg-3">{live ? t('live.money.subs.counted') : t('money2.subs.counted')}</p>
          <p className="num shrink-0 text-[14px] font-semibold whitespace-nowrap text-fg" data-testid="money-subs-total">
            {t('money2.subs.perMonth', { n: fmtEuro(total) })}
          </p>
        </div>
      </div>
    </section>
  )
}

/* ---------- credits ---------- */

export function CreditsBlock({ workspace, bought, onBuy }: { workspace: Workspace; bought: number; onBuy: (credits: number) => void }) {
  const [auto, setAuto] = useState(workspace.autoTopUp)
  const [done, setDone] = useState<string | null>(null)
  const balance = workspace.credits + bought
  const pct = Math.min(100, (balance / workspace.creditsMonthly) * 100)
  return (
    <section aria-label={t('money2.credits.title')} data-testid="money-credits">
      <SectionHead title={t('money2.credits.title')} />
      <div className="rounded-[16px] border border-line-2 bg-surface-1 p-4">
        <p className="text-[12px] text-fg-3">{t('money2.credits.balance')}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="num text-[28px] leading-none font-medium tracking-[-0.02em] text-fg" data-testid="money-balance">
            {fmtNum(balance)}
          </span>
          <span className="num text-[12.5px] text-fg-3">{t('money2.credits.of', { n: fmtNum(workspace.creditsMonthly) })}</span>
        </p>
        <ProgressBar value={pct} className="mt-3" />

        <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-3.5">
          <div className="min-w-0">
            <Label htmlFor="money-auto" className="text-[13px] font-medium text-fg">
              {t('money2.credits.auto')}
            </Label>
            <p className="mt-0.5 text-[12px] leading-[1.45] text-fg-3">{auto ? t('money2.credits.auto.on') : t('money2.credits.auto.off')}</p>
          </div>
          <Switch id="money-auto" checked={auto} onCheckedChange={setAuto} aria-label={t('money2.credits.auto')} data-testid="money-auto" />
        </div>

        <ul className="mt-3.5 space-y-2 border-t border-line pt-3.5" aria-label={t('money2.credits.packs')}>
          {CREDIT_PACKS.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <p className="num text-[13px] text-fg">
                {t('money2.credits.pack', { n: fmtNum(p.credits) })} <span className="text-fg-3">· {fmtEuro(p.euro)}</span>
              </p>
              <Button
                size="sm"
                variant="outline"
                data-testid="money-buy"
                onClick={() => {
                  onBuy(p.credits)
                  setDone(t('money2.credits.bought', { n: fmtNum(p.credits) }))
                }}
              >
                {t('money2.credits.buy')}
              </Button>
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="mt-2 min-h-[18px] text-[12px] text-fg-2">
          {done && (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-ok" aria-hidden />
              {done}
            </span>
          )}
        </p>
      </div>
    </section>
  )
}

/** Real mode (the beta): the Atelier Cloud account's credits and plan, nothing simulated; offline, it says there are none. */
export function LiveCreditsBlock({ workspace, onAccount }: { workspace: Workspace; onAccount: () => void }) {
  const offline = workspace.cloud !== 'signed-in'
  return (
    <section aria-label={t('money2.credits.title')} data-testid="money-credits" data-live="true">
      <SectionHead title={t('money2.credits.title')} />
      <div className="rounded-[16px] border border-line-2 bg-surface-1 p-4">
        <p className="text-[12px] text-fg-3">{t('money2.credits.balance')}</p>
        {offline ? (
          <p className="mt-1 text-[13px] text-fg-2" data-testid="money-balance-offline">
            {t('beta.account.offline.sub')}
          </p>
        ) : (
          <p className="mt-1 flex items-baseline gap-2">
            <span className="num text-[28px] leading-none font-medium tracking-[-0.02em] text-fg" data-testid="money-balance">
              {fmtNum(workspace.credits)}
            </span>
            <span className="text-[12.5px] text-fg-3">{workspace.plan}</span>
          </p>
        )}
        <Button size="sm" variant="outline" className="mt-4" data-testid="money-account" onClick={onAccount}>
          {offline ? t('beta.account.signIn') : t('beta.account.settings')}
        </Button>
      </div>
    </section>
  )
}

/* ---------- manual rows ---------- */

/** Real mode: a revenue can be deleted (the database keeps no expenses, so the hint says where costs come from). */
export function EntriesList({
  entries,
  channelName,
  onDelete,
  hint
}: {
  entries: MoneyEntry[]
  channelName: (id: string | null) => string
  onDelete?: (id: string) => void
  hint?: string
}) {
  return (
    <section aria-label={t('money2.entries.title')} data-testid="money-entries">
      <SectionHead title={t('money2.entries.title')} count={entries.length} />
      {entries.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-line-2 px-4 py-6 text-center text-[13px] text-fg-3">{t('money2.entries.empty')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          {entries.map((e) => (
            <li key={e.id} data-testid="money-entry" data-type={e.type} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">{e.label}</p>
                <p className="truncate text-[12px] text-fg-3">
                  {t(`money2.kind.${e.kind}` as MessageKey)} <span aria-hidden>·</span> {channelName(e.channelId)} <span aria-hidden>·</span>{' '}
                  {e.daysAgo === 0 ? t('common.today') : t('common.daysAgo', { n: e.daysAgo })}
                </p>
              </div>
              <p className="num shrink-0 text-[13px] font-medium text-fg">
                {e.type === 'revenue' ? '+' : '−'}
                {fmtEuro(e.amount)}
              </p>
              {onDelete && (
                <button
                  type="button"
                  aria-label={t('live.money.entries.delete')}
                  title={t('live.money.entries.delete')}
                  onClick={() => onDelete(e.id)}
                  data-testid="money-entry-delete"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-err"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="mt-2 text-[12px] text-fg-3">{hint}</p>}
    </section>
  )
}

/* ---------- where the money goes ---------- */

export function CostSplit({ credits, subs, pc, live = false }: { credits: number; subs: number; pc: number; live?: boolean }) {
  const total = credits + subs + pc
  const parts = [
    { id: 'subs', label: live ? t('live.money.ai') : t('money2.split.subs'), v: subs, cls: 'bg-ink' },
    { id: 'pc', label: t('money2.split.pc'), v: pc, cls: 'bg-fg-3' },
    { id: 'credits', label: t('money2.split.credits'), v: credits, cls: 'bg-line-3' }
  ]
  return (
    <div className="mt-5" data-testid="cost-split">
      <p className="mb-2 text-[13px] font-medium text-fg">{t('money2.split.title')}</p>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={t('money2.split.title')}>
        {parts.map((p) => (
          <span key={p.id} className={cn('h-full', p.cls)} style={{ width: `${total > 0 ? (p.v / total) * 100 : 0}%`, minWidth: p.v > 0 ? 4 : 0 }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {parts.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
            <span aria-hidden className={cn('size-2 rounded-full', p.cls)} />
            {p.label}
            <span className="num text-fg">{fmtEuroSmart(p.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
