import { useMemo, useState } from 'react'
import { Button } from '../ui'
import { HBar, StackedBar } from './charts'
import { COST_LINES, COST_TOTAL, DEFAULT_MARKUP, PROVIDERS, REVENUE_MONTH, listMargin, planEconomics, eur, pct } from './data'
import { FieldLabel, PageHeader, Panel, Table, TextInput, td, th, useToast } from './kit'

interface Markups {
  global: number
  commodity: number
  glue: number
}

export function Costs() {
  const toast = useToast()
  const [m, setM] = useState<Markups>({ global: DEFAULT_MARKUP, commodity: 1.2, glue: 1.5 })
  const [saved, setSaved] = useState<Markups>(m)
  const econ = useMemo(() => planEconomics(m.global), [m.global])
  const maxMargin = Math.max(...econ.map((e) => Math.abs(e.margin)), 1)
  const maxSpend = Math.max(...PROVIDERS.map((p) => p.spend), 1)
  const dirty = m.global !== saved.global || m.commodity !== saved.commodity || m.glue !== saved.glue

  const field = (key: keyof Markups, label: string, help: string) => (
    <div>
      <FieldLabel htmlFor={`mk-${key}`}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <TextInput
          id={`mk-${key}`}
          type="number"
          inputMode="decimal"
          step="0.05"
          min="1"
          max="3"
          value={m[key]}
          onChange={(e) => setM((s) => ({ ...s, [key]: Math.min(3, Math.max(1, Number(e.target.value) || 1)) }))}
          className="num w-[90px]"
        />
        <span className="text-[13px] text-fg-3">×</span>
      </div>
      <p className="m-0 mt-1.5 text-[12px] text-fg-3">{help}</p>
    </div>
  )

  return (
    <>
      <PageHeader title="Coûts et rentabilité" sub="Marge par plan, dépenses par fournisseur et réglage du multiplicateur de crédits. Les marges se recalculent quand tu changes le multiplicateur." />
      <div className="grid gap-4">
        <Panel title="Marge par plan" sub={`Ce mois-ci, avec un multiplicateur de ${String(m.global).replace('.', ',')}`} flush>
          <Table>
            <thead>
              <tr>
                <th className={th}>Plan</th>
                <th className={`${th} text-right`}>Comptes</th>
                <th className={`${th} text-right`}>Revenus</th>
                <th className={`${th} text-right`}>Coûts</th>
                <th className={`${th} text-right`}>Marge</th>
                <th className={`${th} text-right`}>Marge %</th>
                <th className={th}>À 100 % d’usage des crédits</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {econ.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} font-medium text-fg`}>{e.name}</td>
                  <td className={`${td} num text-right`}>{e.users}</td>
                  <td className={`${td} num text-right`}>{eur(e.revenue, false)}</td>
                  <td className={`${td} num text-right`}>{eur(e.cost, false)}</td>
                  <td className={`${td} num text-right ${e.margin < 0 ? 'text-err' : 'text-fg'}`}>{eur(e.margin, false)}</td>
                  <td className={`${td} num text-right`}>{pct(e.marginPct)}</td>
                  <td className={`${td} num`}>{pct(listMargin(e.id, m.global))}</td>
                  <td className={`${td} w-[160px]`}>
                    <HBar value={Math.abs(e.margin)} max={maxMargin} tone={e.margin < 0 ? 'err' : 'ink'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Dépenses par catégorie" sub={`${eur(COST_TOTAL, false)} sur ${eur(REVENUE_MONTH, false)} de revenus`}>
            <StackedBar parts={COST_LINES.map((c) => ({ label: c.label, value: c.amount }))} format={(v) => eur(v, false)} />
          </Panel>

          <Panel
            title="Multiplicateur de crédits"
            sub="Prix d’un crédit = coût fournisseur × multiplicateur. 1 crédit = 0,01 € côté client."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {field('global', 'Global', 'Cible 1,3')}
              {field('commodity', 'Comparables', 'Voix, images')}
              {field('glue', 'Liant', 'QC, rendu, orchestration')}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button
                size="sm"
                disabled={!dirty}
                onClick={() => {
                  setSaved(m)
                  toast('Multiplicateurs enregistrés pour les prochaines générations (démo)')
                }}
              >
                Enregistrer
              </Button>
              <span className="text-[12px] text-fg-3">{dirty ? 'Modifications non enregistrées' : 'À jour'}</span>
            </div>
            <p className="m-0 mt-4 text-[12px] leading-[1.5] text-fg-3">
              Marge sur un pack de crédits au multiplicateur global : {pct((1 - 1 / m.global) * 100)} avant frais de paiement. Les valeurs sont gardées entre 1 et 3.
            </p>
          </Panel>
        </div>

        <Panel title="Dépenses par fournisseur" sub="Le mois en cours" flush>
          <Table>
            <thead>
              <tr>
                <th className={th}>Fournisseur</th>
                <th className={th}>Usage</th>
                <th className={`${th} text-right`}>Dépense</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.filter((p) => p.spend > 0)
                .sort((a, b) => b.spend - a.spend)
                .map((p) => (
                  <tr key={p.id}>
                    <td className={`${td} font-medium text-fg`}>{p.name}</td>
                    <td className={td}>{p.usage}</td>
                    <td className={`${td} num text-right`}>{eur(p.spend, false)}</td>
                    <td className={`${td} w-[200px]`}>
                      <HBar value={p.spend} max={maxSpend} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Panel>
        <p className="m-0 text-[12px] text-fg-3">
          Frais de paiement pris en compte : 5,7 % + 0,25 € par paiement (carte européenne, marchand de référence, facturation). Les montants sont des données de démonstration.
        </p>
      </div>
    </>
  )
}
