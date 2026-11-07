// Réglages › Budgets: the monthly spend caps (global and per channel) of the spend ledger, with this month's figures.
import { useState } from 'react'
import type { SpendOverview } from '../../../../shared/api'
import { t } from '../../../../shared/fr'
import { fmtInt, fmtUsd } from '@/components/atelier/kit'
import { StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, parseBounded, PrefsPage } from './common'

/** Caps are money amounts: >= 0, not more than a sane ceiling. */
const MAX_CAP = 1_000_000

export function CapEditor({ cap, label, onSave }: { cap: number | null; label: string; onSave: (usd: number | null) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const text = draft ?? (cap === null ? '' : String(cap))
  const parsed = parseBounded(text, { min: 0, max: MAX_CAP, integer: false })
  const invalid = draft !== null && draft.trim() !== '' && parsed === null
  const empty = text.trim() === ''
  const dirty = draft !== null && (empty ? cap !== null : parsed !== null && parsed !== cap)
  const run = async (value: number | null): Promise<void> => {
    setBusy(true)
    try {
      await onSave(value)
      setDraft(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          value={text}
          placeholder={t('prefs.budgets.noCap')}
          aria-label={label}
          aria-invalid={invalid}
          className="w-28 text-right"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && !invalid) void run(empty ? null : parsed)
          }}
        />
        <Button size="sm" variant="secondary" disabled={!dirty || invalid || busy} onClick={() => void run(empty ? null : parsed)}>
          {t('prefs.save')}
        </Button>
        {cap !== null && draft === null && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(null)}>
            {t('prefs.budgets.remove')}
          </Button>
        )}
      </div>
      {invalid && (
        <p role="alert" className="text-[11.5px] text-err">
          {t('prefs.budgets.invalid')}
        </p>
      )}
    </div>
  )
}

async function saveCap(action: () => Promise<void>): Promise<void> {
  try {
    await action()
    toast.success(t('prefs.saved'))
  } catch (err) {
    toast.error(t('prefs.saveError'), errText(err))
  }
}

function usage(spent: number, cap: number | null): string {
  return cap === null ? t('prefs.budgets.usedNoCap', { spent: fmtUsd(spent) }) : t('prefs.budgets.used', { spent: fmtUsd(spent), cap: fmtUsd(cap) })
}

export function BudgetsBody({
  overview,
  onGlobal,
  onChannel
}: {
  overview: SpendOverview
  onGlobal: (usd: number | null) => Promise<void>
  onChannel: (channelId: number, usd: number | null) => Promise<void>
}) {
  const o = overview
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3" aria-label={t('prefs.budgets.month', { month: o.month })}>
        <StatTile label={t('prefs.budgets.spent')} value={fmtUsd(o.spentUsd)} hint={t('prefs.budgets.month', { month: o.month })} />
        <StatTile label={t('prefs.budgets.reserved')} value={fmtUsd(o.reservedUsd)} />
        <StatTile label={t('prefs.budgets.calls')} value={fmtInt(o.calls)} />
      </div>
      <Block title={t('prefs.budgets.global')}>
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-fg-3">{t('prefs.budgets.global.hint')}</p>
            <p className="mt-2 text-[13px] text-fg-2">{usage(o.spentUsd + o.reservedUsd, o.globalCapUsd)}</p>
            {o.globalCapUsd !== null && o.globalCapUsd > 0 && <Progress className="mt-2" value={Math.min(100, ((o.spentUsd + o.reservedUsd) / o.globalCapUsd) * 100)} />}
          </div>
          <CapEditor cap={o.globalCapUsd} label={t('prefs.budgets.global')} onSave={onGlobal} />
        </div>
      </Block>
      <Block title={t('prefs.budgets.channels')}>
        {o.channels.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t('prefs.budgets.channels.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {o.channels.map((c) => (
              <li key={c.channelId} data-testid="budget-channel" className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{c.name}</p>
                  <p className="mt-0.5 text-[12px] text-fg-3">{usage(c.spentUsd + c.reservedUsd, c.budgetUsd)}</p>
                  {c.budgetUsd !== null && c.budgetUsd > 0 && <Progress className="mt-2" value={Math.min(100, ((c.spentUsd + c.reservedUsd) / c.budgetUsd) * 100)} />}
                </div>
                <CapEditor cap={c.budgetUsd} label={`${t('prefs.budgets.usd')} · ${c.name}`} onSave={(usd) => onChannel(c.channelId, usd)} />
              </li>
            ))}
          </ul>
        )}
      </Block>
    </>
  )
}

export function BudgetsPage(_props: ScreenProps) {
  const overview = useLoader(() => call('spend.overview'), 'prefs-budgets', ['spend', 'channels', 'settings'])
  return (
    <PrefsPage page="budgets">
      <Loaded data={overview.data} error={overview.error} onRetry={overview.reload}>
        {(o) => (
          <BudgetsBody
            overview={o}
            onGlobal={(usd) => saveCap(() => call('spend.setGlobalCap', usd))}
            onChannel={(id, usd) => saveCap(() => call('spend.setChannelCap', id, usd))}
          />
        )}
      </Loaded>
    </PrefsPage>
  )
}
