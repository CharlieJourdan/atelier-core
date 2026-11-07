import { ACTIVE_USERS, ACTIVITY, CHURN_RATE, COST_LINES, COST_TOTAL, CREDITS_MONTH, GROSS_MARGIN_EUR, GROSS_MARGIN_PCT, MACHINES, MARGIN_SERIES, MONTHS, MRR, MRR_SERIES, REVENUE_MONTH, USERS, VIDEOS_MONTH, economics, eur, num, pct } from './data'
import { LineChart, StackedBar } from './charts'
import { PageHeader, Panel, Stat, StatRow, Status } from './kit'
import { Link } from '../router'

export function Overview() {
  const running = MACHINES.filter((m) => m.status === 'running').length
  const atRisk = USERS.filter((u) => u.status === 'churn-risk')
  const prev = MRR_SERIES[MRR_SERIES.length - 2] ?? MRR
  const growth = ((MRR - prev) / prev) * 100
  return (
    <>
      <PageHeader title="Vue d’ensemble" sub="Octobre 2026, bêta fermée. Chiffres calculés à partir des comptes, des machines et des crédits consommés." />
      <div className="grid gap-4">
        <StatRow>
          <Stat label="MRR" value={eur(MRR, false)} delta={`+${pct(growth)} sur un mois`} tone="ok" />
          <Stat label="Utilisateurs actifs" value={String(ACTIVE_USERS)} delta={`${USERS.length} comptes dont ${USERS.filter((u) => u.status === 'trial').length} en essai`} />
          <Stat label="Churn mensuel" value={pct(CHURN_RATE)} delta={`${USERS.filter((u) => u.status === 'churn-risk').length} comptes à risque`} tone="warn" />
          <Stat label="Marge brute" value={pct(GROSS_MARGIN_PCT)} delta={`${eur(GROSS_MARGIN_EUR, false)} ce mois-ci`} tone={GROSS_MARGIN_PCT > 40 ? 'ok' : 'warn'} />
        </StatRow>
        <StatRow>
          <Stat label="Revenus du mois" value={eur(REVENUE_MONTH, false)} delta="abonnements et recharges de crédits" />
          <Stat label="Coûts du mois" value={eur(COST_TOTAL, false)} delta={`${pct((COST_TOTAL / REVENUE_MONTH) * 100)} des revenus`} />
          <Stat label="Machines en marche" value={`${running} / ${MACHINES.length}`} delta={`${MACHINES.filter((m) => m.status === 'hibernated').length} en hibernation`} />
          <Stat label="Vidéos produites" value={num(VIDEOS_MONTH)} delta={`${num(CREDITS_MONTH)} crédits consommés`} />
        </StatRow>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="MRR sur 12 mois" sub="Abonnements mensuels, hors recharges">
            <LineChart data={MRR_SERIES} labels={MONTHS} format={(v) => eur(v, false)} label="MRR" />
          </Panel>
          <Panel title="Marge brute sur 12 mois" sub="Après machines, API, stockage, frais Stripe et infrastructure">
            <LineChart data={MARGIN_SERIES} labels={MONTHS} format={(v) => `${Math.round(v)} %`} label="Marge brute" />
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Coûts du mois par catégorie" sub={`Total ${eur(COST_TOTAL, false)}`}>
            <StackedBar parts={COST_LINES.map((c) => ({ label: c.label, value: c.amount }))} format={(v) => eur(v, false)} />
          </Panel>
          <Panel title="À surveiller">
            <ul className="hairline-list m-0 list-none p-0">
              {atRisk.map((u) => {
                const e = economics(u)
                return (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px] first:pt-0">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{u.name}</span>
                      <span className="block text-fg-3">Marge {eur(e.margin)} · risque de départ</span>
                    </span>
                    <Status tone="warn">À risque</Status>
                  </li>
                )
              })}
            </ul>
            <p className="m-0 mt-3 text-[12px] text-fg-3">
              <Link to="/admin/utilisateurs" className="text-fg underline decoration-line-3 underline-offset-4 hover:decoration-fg">
                Ouvrir la liste des utilisateurs
              </Link>
            </p>
          </Panel>
        </div>

        <Panel title="Activité récente" flush>
          <ul className="hairline-list m-0 list-none p-0">
            {ACTIVITY.map((a) => (
              <li key={a.text} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Status tone={a.tone}>{a.text}</Status>
                </span>
                <span className="shrink-0 text-fg-3">{a.at}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  )
}
