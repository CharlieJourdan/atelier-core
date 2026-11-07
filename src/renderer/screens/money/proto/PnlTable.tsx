// The profit and loss of each channel over 28 days: AdSense (real when YouTube Analytics is connected, an estimate
// otherwise), sponsors and products, then the credits, the share of the Claude subscription and the computer.
import { t } from '../../../../shared/fr'
import type { Route } from '../../../../shared/sections'
import { ChannelAvatar } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { fmtEuroSmart, type Ledger, type PnlRow } from './money-model'

const th = 'px-3 py-2 text-right text-[12px] font-medium text-fg-3 whitespace-nowrap'
const td = 'num px-3 py-3 text-right text-[13px] whitespace-nowrap'

function Cell({ v, dim = false, strong = false }: { v: number; dim?: boolean; strong?: boolean }) {
  return <td className={cn(td, dim ? 'text-fg-3' : strong ? 'font-medium text-fg' : 'text-fg-2')}>{v === 0 ? '—' : fmtEuroSmart(v)}</td>
}

function Row({ r, onRoute, others }: { r: PnlRow; onRoute: (route: Route) => void; others: boolean }) {
  return (
    <tr className="border-t border-line" data-testid="pnl-row" data-channel={r.channel?.id ?? 'general'}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {r.channel ? (
            <ChannelAvatar channel={r.channel} size={24} />
          ) : (
            <span aria-hidden className="size-6 rounded-full border border-dashed border-line-3" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-fg">{r.channel?.name ?? t('money2.table.general')}</p>
            {r.estimated && (
              <button
                type="button"
                onClick={() => onRoute({ section: 'chaines' })}
                data-testid="pnl-estimated"
                className="block text-left text-[11.5px] text-fg-3 underline-offset-4 hover:text-fg hover:underline"
              >
                {t('money2.table.estimated')}
              </button>
            )}
          </div>
        </div>
      </td>
      <td className={cn(td, r.estimated ? 'text-fg-3' : 'text-fg-2')} data-estimated={r.estimated}>
        {r.adsense === 0 ? '—' : `${r.estimated ? '≈ ' : ''}${fmtEuroSmart(r.adsense)}`}
      </td>
      <Cell v={r.sponsors} />
      <Cell v={r.products} />
      {others && <Cell v={r.others} />}
      <Cell v={r.credits} dim />
      <Cell v={r.claude} dim />
      <Cell v={r.pc} dim />
      <td className={cn(td, 'font-medium', r.margin >= 0 ? 'text-fg' : 'text-err')}>{fmtEuroSmart(r.margin)}</td>
      <Cell v={r.revPerVideo} />
      <Cell v={r.costPerVideo} dim />
    </tr>
  )
}

export function PnlTable({ ledger, onRoute, live = false }: { ledger: Ledger; onRoute: (route: Route) => void; live?: boolean }) {
  const others = ledger.showOthers === true
  return (
    <div className="overflow-x-auto rounded-[16px] border border-line-2 bg-surface-1" data-testid="pnl-table">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr>
            <th rowSpan={2} className="px-4 py-2 text-left align-bottom text-[12px] font-medium text-fg-3">
              {t('money2.table.channel')}
            </th>
            <th colSpan={others ? 4 : 3} className="px-3 pt-2.5 pb-0 text-center text-[12px] font-semibold text-fg">
              {t('money2.table.revenues')}
            </th>
            <th colSpan={3} className="border-l border-line px-3 pt-2.5 pb-0 text-center text-[12px] font-semibold text-fg">
              {t('money2.table.costs')}
            </th>
            <th rowSpan={2} className={cn(th, 'border-l border-line align-bottom')}>
              {t('money2.table.margin')}
            </th>
            <th rowSpan={2} className={cn(th, 'align-bottom')}>
              {t('money2.table.revVideo')}
            </th>
            <th rowSpan={2} className={cn(th, 'align-bottom')}>
              {t('money2.table.costVideo')}
            </th>
          </tr>
          <tr>
            <th className={th}>{t('money2.table.adsense')}</th>
            <th className={th}>{t('money2.table.sponsors')}</th>
            <th className={th}>{t('money2.table.products')}</th>
            {others && <th className={th}>{t('live.money.table.others')}</th>}
            <th className={cn(th, 'border-l border-line')}>{t('money2.table.credits')}</th>
            <th className={th}>{live ? t('live.money.ai') : t('money2.table.claude')}</th>
            <th className={th}>{t('money2.table.pc')}</th>
          </tr>
        </thead>
        <tbody>
          {ledger.rows.map((r) => (
            <Row key={r.channel?.id ?? 'general'} r={r} onRoute={onRoute} others={others} />
          ))}
          <tr className="border-t border-line-2 bg-surface-2/60" data-testid="pnl-total">
            <td className="px-4 py-3 text-[13px] font-semibold text-fg">{t('money2.table.total')}</td>
            <td className={cn(td, 'font-medium text-fg')}>{fmtEuroSmart(ledger.total.adsense)}</td>
            <Cell v={ledger.total.sponsors} strong />
            <Cell v={ledger.total.products} strong />
            {others && <Cell v={ledger.total.others} strong />}
            <Cell v={ledger.total.credits} strong />
            <Cell v={ledger.total.claude} strong />
            <Cell v={ledger.total.pc} strong />
            <td className={cn(td, 'font-semibold', ledger.total.margin >= 0 ? 'text-fg' : 'text-err')}>{fmtEuroSmart(ledger.total.margin)}</td>
            <Cell v={ledger.total.revPerVideo} strong />
            <Cell v={ledger.total.costPerVideo} strong />
          </tr>
        </tbody>
      </table>
      {ledger.anyEstimated && <p className="border-t border-line px-4 py-2.5 text-[12px] text-fg-3">{t('money2.table.estimatedNote')}</p>}
    </div>
  )
}
