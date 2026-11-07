// The live quote of the composer: per node (where it runs, credits, duration, gate), totals, the demo notice.
import { t, type MessageKey } from '../../../../shared/fr'
import type { QuoteMode, RunQuote } from '../../../../shared/runs'
import { ErrorLine, LoadingBlock, fmtCredits, fmtEur } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'
import { ExampleCreditsLine } from '../ExampleCredits'
import { fmtDuration } from '../shared'

const WHERE: Record<string, MessageKey> = {
  local: 'production.new.where.local',
  cloud: 'production.new.where.cloud',
  gpu: 'production.new.where.gpu'
}

export function QuotePanel({ quote, mode, error, loading }: { quote: RunQuote | null; mode: QuoteMode | null; error: string | null; loading: boolean }) {
  return (
    <Panel title={t('production.new.quote')} data-testid="quote-panel" className="flex flex-col gap-4">
      {error && <ErrorLine message={error} />}
      {!quote && !error && (loading ? <LoadingBlock rows={4} /> : <p className="text-[13px] text-fg-3">{t('production.new.quoteHint')}</p>)}
      {quote && mode && (
        <>
          <p className="text-[12px] text-fg-3">{t('production.new.pipelineUsed', { name: quote.pipelineLabel, version: quote.pipelineVersion })}</p>
          <ul className="m-0 flex list-none flex-col p-0" aria-label={t('production.new.quote')}>
            {mode.nodes.map((n) => (
              <li key={n.nodeId} className="flex items-center gap-3 border-b border-line py-2 text-[13px] last:border-b-0" data-testid="quote-node">
                <span className="min-w-0 flex-1 truncate text-fg">{n.label}</span>
                <span className="micro-label">{t(WHERE[n.where] ?? 'production.new.where.local')}</span>
                {n.gate !== 'none' && <span className="micro-label text-warn">{t(`production.new.gate.${n.gate}` as MessageKey)}</span>}
                <span className={cn('w-24 text-right tabular-nums', n.credits === 0 ? 'text-fg-3' : 'text-fg')}>
                  {n.cached ? t('production.new.cached') : n.credits === 0 ? t('production.new.free') : fmtCredits(n.credits)}
                </span>
                <span className="w-16 text-right text-[12px] text-fg-3 tabular-nums">{fmtDuration(n.durationS)}</span>
              </li>
            ))}
          </ul>
          <dl className="m-0 grid grid-cols-3 gap-3">
            <div>
              <dt className="micro-label">{t('production.new.total')}</dt>
              <dd className="m-0 font-serif text-[28px] leading-none" data-testid="quote-total">
                {fmtCredits(mode.totalCredits)}
              </dd>
              <dd className="m-0 mt-1 text-[12px] text-fg-3">{fmtEur(mode.totalEur)}</dd>
            </div>
            <div>
              <dt className="micro-label">{t('production.new.duration')}</dt>
              <dd className="m-0 font-serif text-[28px] leading-none">{fmtDuration(mode.durationS)}</dd>
            </div>
            <div>
              <dt className="micro-label">{t('production.new.balance')}</dt>
              <dd className="m-0 font-serif text-[28px] leading-none">{fmtCredits(quote.balance.available)}</dd>
              {quote.debited && (
                <dd className="m-0 mt-1 text-[12px] text-fg-3">{t('production.new.after', { n: Math.max(0, quote.balance.available - mode.totalCredits) })}</dd>
              )}
            </div>
          </dl>
          <ExampleCreditsLine example={quote.balance.example} />
          <p className="m-0 text-[12px] text-fg-3" data-testid="quote-debit">
            {quote.debited ? t('production.new.debited') : t('production.new.notDebited')}
          </p>
        </>
      )}
    </Panel>
  )
}
