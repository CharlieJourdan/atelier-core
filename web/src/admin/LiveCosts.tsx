// « Coûts et rentabilité » on the real Atelier Cloud (decision 0040): the top line (offered credits left, this month's
// spend, the month's result, the overrun alerts), spending and margin per team (sortable), per provider and engine, the
// spend over time, then the fixed costs, the overall result and the settings (CostsFixed.tsx). A period filter and a
// switch for the calls the fakes answered. Pure views + a small container.
import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { HBar, LineChart } from './charts'
import { FixedCostsPanel, ResultPanel, SettingsPanel } from './CostsFixed'
import {
  bucketLabel,
  eur,
  fetchFinance,
  marginPctLabel,
  minutes,
  multiplierLabel,
  num,
  PERIODS,
  sortTeams,
  usd,
  type FinanceDashboard,
  type FinancePeriod,
  type TeamSortKey
} from './finance'
import { Chip2, PageHeader, Panel, Stat, StatRow, Status, Table, td, th } from './kit'

const TEAM_COLUMNS: { key: TeamSortKey; label: string; title: string }[] = [
  { key: 'creditsOffered', label: 'Offerts', title: 'Crédits donnés par un admin (cadeaux et corrections)' },
  { key: 'creditsBought', label: 'Achetés', title: 'Crédits payés : plans, packs, recharges' },
  { key: 'creditsSpent', label: 'Dépensés', title: 'Crédits consommés par les appels réussis' },
  { key: 'costEurCents', label: 'Coût réel', title: 'Ce que les fournisseurs nous ont facturé' },
  { key: 'revenueEurCents', label: 'Revenus', title: 'Ce que l’équipe a payé' },
  { key: 'marginEurCents', label: 'Marge', title: 'Revenus − coût réel' },
  { key: 'videos', label: 'Vidéos', title: 'Vidéos finies (kit envoyé sur la plateforme)' },
  { key: 'minutes', label: 'Minutes', title: 'Minutes de vidéo finies' },
  { key: 'costPerMinuteEurCents', label: '€ / minute', title: 'Coût réel par minute finie' }
]

interface Sort {
  key: TeamSortKey
  dir: 'asc' | 'desc'
}

function TopLine({ d }: { d: FinanceDashboard }) {
  const m = d.fixed.month
  return (
    <StatRow>
      <Stat
        label="Crédits offerts restants"
        value={num(d.top.offeredLeftCredits)}
        delta={`coûteraient ≈ ${eur(d.top.offeredLeftCostEurCents)} s’ils étaient tous dépensés`}
      />
      <Stat label="Dépense fournisseurs ce mois-ci" value={eur(d.top.monthCostEurCents)} delta={`${usd(d.top.monthCostUsdCents)} · ${num(d.top.monthCreditsSpent)} crédits consommés`} />
      <Stat
        label="Résultat du mois"
        value={eur(m.resultEurCents)}
        delta={`revenus ${eur(m.revenueEurCents)} − fournisseurs ${eur(m.providerCostEurCents)} − fixes ${eur(m.fixedEurCents)}`}
        tone={m.resultEurCents < 0 ? 'err' : 'ok'}
      />
      <Stat label="Alertes de dépassement" value={num(d.top.alerts)} delta="coût réel > devis + 10 %" tone={d.top.alerts > 0 ? 'warn' : undefined} />
    </StatRow>
  )
}

function SortHeader({ col, sort, onSort, align = 'right' }: { col: { key: TeamSortKey; label: string; title: string }; sort: Sort; onSort: (k: TeamSortKey) => void; align?: 'left' | 'right' }) {
  const active = sort.key === col.key
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`${th} ${align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={col.title}>
      <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-1 hover:text-fg">
        {col.label}
        {active && <Icon size={12} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </th>
  )
}

export function TeamsTable({ d, sort, onSort }: { d: FinanceDashboard; sort: Sort; onSort: (k: TeamSortKey) => void }) {
  const rows = sortTeams(d.teams, sort.key, sort.dir)
  const t = d.totals
  return (
    <Table>
      <thead>
        <tr>
          <SortHeader col={{ key: 'teamName', label: 'Équipe', title: 'Équipe et son propriétaire' }} sort={sort} onSort={onSort} align="left" />
          {TEAM_COLUMNS.map((c) => (
            <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td className={td} colSpan={TEAM_COLUMNS.length + 1}>
              Aucune équipe pour l’instant.
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.teamId} data-testid="finance-team">
            <td className={td}>
              <span className="block font-medium text-fg">
                {r.teamName}
                {r.test ? (
                  <span className="ml-2 text-[11px] font-normal text-fg-3" data-testid="finance-test-team">
                    test (crédits de test)
                  </span>
                ) : (
                  r.internal && <span className="ml-2 text-[11px] font-normal text-fg-3">interne</span>
                )}
              </span>
              <span className="block text-[12px] text-fg-3">{r.ownerEmail ?? '—'}</span>
            </td>
            <td className={`${td} num text-right`}>{num(r.creditsOffered)}</td>
            <td className={`${td} num text-right`}>{num(r.creditsBought)}</td>
            <td className={`${td} num text-right`}>{num(r.creditsSpent)}</td>
            <td className={`${td} num text-right`}>
              <span className="block text-fg">{eur(r.costEurCents)}</span>
              <span className="block text-[12px] text-fg-3">{usd(r.costUsdCents)}</span>
            </td>
            <td className={`${td} num text-right`}>{eur(r.revenueEurCents)}</td>
            <td className={`${td} num text-right ${r.marginEurCents < 0 ? 'text-err' : 'text-fg'}`}>{eur(r.marginEurCents)}</td>
            <td className={`${td} num text-right`}>{num(r.videos)}</td>
            <td className={`${td} num text-right`}>{minutes(r.minutes)}</td>
            <td className={`${td} num text-right`}>{r.costPerMinuteEurCents === null ? '—' : eur(r.costPerMinuteEurCents)}</td>
          </tr>
        ))}
      </tbody>
      {rows.length > 1 && (
        <tfoot>
          <tr className="font-medium text-fg">
            <td className={td}>Total</td>
            <td className={`${td} num text-right`}>{num(t.creditsOffered)}</td>
            <td className={`${td} num text-right`}>{num(t.creditsBought)}</td>
            <td className={`${td} num text-right`}>{num(t.creditsSpent)}</td>
            <td className={`${td} num text-right`}>{eur(t.costEurCents)}</td>
            <td className={`${td} num text-right`}>{eur(t.revenueEurCents)}</td>
            <td className={`${td} num text-right ${t.marginEurCents < 0 ? 'text-err' : ''}`}>{eur(t.marginEurCents)}</td>
            <td className={`${td} num text-right`}>{num(t.videos)}</td>
            <td className={`${td} num text-right`}>{minutes(t.minutes)}</td>
            <td className={`${td} num text-right`}>{t.costPerMinuteEurCents === null ? '—' : eur(t.costPerMinuteEurCents)}</td>
          </tr>
        </tfoot>
      )}
    </Table>
  )
}

export function ProvidersTable({ d }: { d: FinanceDashboard }) {
  const max = Math.max(...d.providers.map((p) => p.costUsdCents), 1)
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Fournisseur</th>
          <th className={th}>Moteur</th>
          <th className={`${th} text-right`}>Appels</th>
          <th className={`${th} text-right`} title="Les échecs rendent leurs crédits : rien n’est facturé">
            Échecs (non facturés)
          </th>
          <th className={`${th} text-right`}>Annulés</th>
          <th className={`${th} text-right`}>Crédits</th>
          <th className={`${th} text-right`}>Coût réel</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {d.providers.length === 0 && (
          <tr>
            <td className={td} colSpan={8}>
              Aucun appel sur cette période{d.demoCallsHidden > 0 ? ` (${num(d.demoCallsHidden)} appels en démo masqués)` : ''}.
            </td>
          </tr>
        )}
        {d.providers.map((p) => (
          <tr key={`${p.provider}/${p.engine ?? ''}/${p.demo ? 1 : 0}`} data-testid="finance-provider">
            <td className={`${td} font-medium text-fg`}>
              {p.provider}
              {p.demo && <span className="ml-2 text-[11px] font-normal text-warn">démo</span>}
            </td>
            <td className={td}>{p.engine ?? '—'}</td>
            <td className={`${td} num text-right`}>{num(p.calls)}</td>
            <td className={`${td} num text-right ${p.failed > 0 ? 'text-warn' : ''}`}>{num(p.failed)}</td>
            <td className={`${td} num text-right`}>{num(p.cancelled)}</td>
            <td className={`${td} num text-right`}>{num(p.creditsBilled)}</td>
            <td className={`${td} num text-right`}>
              <span className="block text-fg">{usd(p.costUsdCents)}</span>
              <span className="block text-[12px] text-fg-3">
                {eur(p.costEurCents)}
                {p.estimated > 0 ? ` · ${num(p.estimated)} estimé${p.estimated > 1 ? 's' : ''}` : ''}
              </span>
            </td>
            <td className={`${td} w-[160px]`}>
              <HBar value={p.costUsdCents} max={max} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function AlertsTable({ d }: { d: FinanceDashboard }) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Quand</th>
          <th className={th}>Équipe</th>
          <th className={th}>Fournisseur · moteur</th>
          <th className={`${th} text-right`}>Devis</th>
          <th className={`${th} text-right`}>Coût réel</th>
          <th className={`${th} text-right`}>Dépassement</th>
        </tr>
      </thead>
      <tbody>
        {d.alerts.map((a) => (
          <tr key={a.jobId}>
            <td className={td}>{new Date(a.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className={`${td} text-fg`}>{a.teamName}</td>
            <td className={td}>
              {a.provider}
              {a.engine ? ` · ${a.engine}` : ''}
            </td>
            <td className={`${td} num text-right`}>{usd(a.quotedUsdCents)}</td>
            <td className={`${td} num text-right`}>{usd(a.realUsdCents)}</td>
            <td className={`${td} num text-right text-warn`}>+{a.overPct.toLocaleString('fr-FR')} %</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export function CostsView({
  d,
  period,
  includeDemo,
  onPeriod,
  onDemo,
  onChanged
}: {
  d: FinanceDashboard
  period: FinancePeriod
  includeDemo: boolean
  onPeriod: (p: FinancePeriod) => void
  onDemo: (on: boolean) => void
  onChanged: () => void
}) {
  const [sort, setSort] = useState<Sort>({ key: 'costEurCents', dir: 'desc' })
  const onSort = (key: TeamSortKey): void => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'teamName' ? 'asc' : 'desc' }))
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? ''
  const atCost = d.settings.priceMultiplier === 1
  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0" data-testid="admin-live-costs">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Période">
        {PERIODS.map((p) => (
          <Chip2 key={p.id} active={p.id === period} onClick={() => onPeriod(p.id)}>
            {p.label}
          </Chip2>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <Chip2 active={includeDemo} onClick={() => onDemo(!includeDemo)}>
          Compter les appels en démo
        </Chip2>
      </div>
      <p className="m-0 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] leading-[1.5] text-fg-2">
        {atCost ? (
          <>
            <strong className="font-medium text-fg">Bêta : crédits vendus et offerts au prix coûtant (marge 0 %).</strong> Prix d’une ligne = coût
            fournisseur × 1. Le multiplicateur se change plus bas, sans code.
          </>
        ) : (
          <>
            Prix d’une ligne = coût fournisseur {multiplierLabel(d.settings.priceMultiplier)} (marge {marginPctLabel(d.settings.priceMultiplier)}).
          </>
        )}{' '}
        1 $ = {d.settings.eurPerUsd.toLocaleString('fr-FR')} € (taux du {d.settings.fxAsOf}).
        {d.paymentsSimulated ? ' Paiements simulés : les revenus affichés ne sont pas de l’argent réel.' : ''}
      </p>
      <TopLine d={d} />
      <Panel title="Par équipe" sub={`${periodLabel} · crédits, coût réel, revenus et marge, vidéos finies. Clique un titre pour trier.`} flush>
        <TeamsTable d={d} sort={sort} onSort={onSort} />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Dépense dans le temps" sub={`${periodLabel} · coût réel en €`}>
          {d.spend.length > 0 ? (
            <LineChart
              data={d.spend.map((p) => (p.costUsdCents * d.settings.eurPerUsd) / 100)}
              labels={d.spend.map((p) => bucketLabel(p.bucket))}
              format={(v) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 })}
              label="Dépense fournisseurs"
            />
          ) : (
            <p className="m-0 text-[13px] text-fg-3">Pas encore de dépense.</p>
          )}
        </Panel>
        <ResultPanel d={d} />
      </div>
      <Panel title="Par fournisseur et moteur" sub={`${periodLabel} · coût réel facturé par appel`} flush>
        <ProvidersTable d={d} />
      </Panel>
      <FixedCostsPanel d={d} onChanged={onChanged} />
      {d.alerts.length > 0 && (
        <Panel title="Alertes" sub="Appels dont le coût réel a dépassé leur devis de plus de 10 %" flush>
          <AlertsTable d={d} />
        </Panel>
      )}
      <SettingsPanel d={d} onChanged={onChanged} />
    </div>
  )
}

export function LiveCosts() {
  const [period, setPeriod] = useState<FinancePeriod>('month')
  const [includeDemo, setDemo] = useState(false)
  const [data, setData] = useState<FinanceDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let stop = false
    fetchFinance(period, includeDemo)
      .then((d) => {
        if (!stop) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!stop) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      stop = true
    }
  }, [period, includeDemo, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return (
    <>
      <PageHeader title="Coûts et rentabilité" sub="Chiffres réels d’Atelier Cloud : ce que chaque équipe dépense, ce que les fournisseurs nous facturent, et ce qu’il reste." />
      {error && (
        <p className="m-0 mb-4 text-[13px] text-fg-2">
          <Status tone="err">Atelier Cloud ne répond pas : {error}</Status>
        </p>
      )}
      {data && <CostsView d={data} period={period} includeDemo={includeDemo} onPeriod={setPeriod} onDemo={setDemo} onChanged={reload} />}
    </>
  )
}
