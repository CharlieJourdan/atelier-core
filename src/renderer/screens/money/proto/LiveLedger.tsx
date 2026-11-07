// Real mode: the spend ledger of the month in one line (what the models were paid, in how many calls), straight from
// `spend.overview`: the figure the cost columns of the P&L are built on.
import { t } from '../../../../shared/fr'
import type { SpendOverview } from '../../../../shared/api/spend'
import { SectionHead } from '@/components/proto/kit'

// A model call costs fractions of a cent: small amounts keep their digits instead of reading « 0,00 $ ».
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtUsd = (n: number): string => usd.format(n)

export function LiveLedger({ spend }: { spend: SpendOverview }) {
  return (
    <section aria-label={t('live.money.ledger.title')} data-testid="money-ledger" className="mt-5">
      <SectionHead title={t('live.money.ledger.title')} />
      <div className="rounded-[16px] border border-line-2 bg-surface-1 px-4 py-3">
        <p className="num text-[13.5px] font-medium text-fg" data-testid="money-ledger-total" data-usd={spend.spentUsd}>
          {t('live.money.ledger.spent', { usd: fmtUsd(spend.spentUsd) })}
        </p>
        <p className="num mt-1 text-[12px] text-fg-3" data-testid="money-ledger-calls">
          {t('live.money.ledger.calls', { n: spend.calls })}
        </p>
        {spend.reservedUsd > 0 && <p className="num mt-1 text-[12px] text-fg-3">{t('live.money.ledger.reserved', { usd: fmtUsd(spend.reservedUsd) })}</p>}
        {spend.globalCapUsd !== null && <p className="num mt-1 text-[12px] text-fg-3">{t('live.money.ledger.cap', { usd: fmtUsd(spend.globalCapUsd) })}</p>}
      </div>
    </section>
  )
}
