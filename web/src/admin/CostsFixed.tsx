// « Coûts et rentabilité », lower half: the monthly fixed costs (typed by the founder, plus the team computers computed
// by the Cloud), the overall result of the month and the break-even in finished minutes, and the settings (the global
// price multiplier, the dated $ → € rate). Every change goes to the Cloud, which audits it.
import { useState, type FormEvent } from 'react'
import { CloudCallError } from '../cloud'
import { Button } from '../ui'
import { eur, minutes, multiplierLabel, num, parseAmount, removeFixedCost, saveFixedCost, saveSettings, type Currency, type FinanceDashboard, type FinanceFixedCost } from './finance'
import { FieldLabel, Panel, SelectInput, Table, TextInput, td, th, useToast } from './kit'

const failure = (e: unknown): string => (e instanceof CloudCallError ? e.message : 'Atelier Cloud ne répond pas.')

interface Draft {
  id?: string
  label: string
  amount: string
  currency: Currency
  note: string
}

const EMPTY: Draft = { label: '', amount: '', currency: 'EUR', note: '' }
const draftOf = (c: FinanceFixedCost): Draft => ({ id: c.id, label: c.label, amount: String(c.amountCents / 100).replace('.', ','), currency: c.currency, note: c.note ?? '' })
const amountLabel = (c: FinanceFixedCost): string =>
  (c.amountCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: c.currency })

export function FixedCostsPanel({ d, onChanged }: { d: FinanceDashboard; onChanged: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const cents = parseAmount(draft.amount)
    if (draft.label.trim().length === 0) return setError('Donne un nom à ce coût.')
    if (cents === null) return setError('Le montant est un nombre, par exemple 49 ou 5,99.')
    setBusy(true)
    saveFixedCost({ ...(draft.id ? { id: draft.id } : {}), label: draft.label.trim(), amountCents: cents, currency: draft.currency, note: draft.note.trim() || null })
      .then(() => {
        toast(draft.id ? 'Coût fixe modifié' : 'Coût fixe ajouté')
        setDraft(EMPTY)
        setError('')
        onChanged()
      })
      .catch((err: unknown) => setError(failure(err)))
      .finally(() => setBusy(false))
  }
  const remove = (c: FinanceFixedCost): void => {
    removeFixedCost(c.id)
      .then(() => {
        toast(`« ${c.label} » retiré`)
        onChanged()
      })
      .catch((err: unknown) => toast(failure(err)))
  }
  return (
    <Panel title="Frais fixes mensuels" sub={`${eur(d.fixed.monthlyEurCents)} par mois · plan HeyGen, serveur, abonnements…`} flush>
      <Table>
        <thead>
          <tr>
            <th className={th}>Poste</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={`${th} text-right`}>Par mois en €</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {d.fixed.costs.length === 0 && (
            <tr>
              <td className={td} colSpan={4}>
                Aucun coût fixe saisi.
              </td>
            </tr>
          )}
          {d.fixed.costs.map((c) => (
            <tr key={c.id} data-testid="finance-fixed">
              <td className={td}>
                <span className="block text-fg">{c.label}</span>
                {(c.note || c.auto) && (
                  <span className="block text-[12px] text-fg-3">{c.auto ? `calculé par le Cloud${c.note ? ` · ${c.note}` : ''}${c.demo ? ' · démo, non compté' : ''}` : c.note}</span>
                )}
              </td>
              <td className={`${td} num text-right`}>{amountLabel(c)}</td>
              <td className={`${td} num text-right`}>{eur(c.monthlyEurCents)}</td>
              <td className={`${td} text-right`}>
                {!c.auto && (
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(c))}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                      Retirer
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form onSubmit={submit} noValidate className="grid gap-3 p-5 sm:grid-cols-[2fr_1fr_90px]">
        <div>
          <FieldLabel htmlFor="fc-label">{draft.id ? 'Modifier le poste' : 'Nouveau poste'}</FieldLabel>
          <TextInput id="fc-label" value={draft.label} placeholder="Abonnement Claude" onChange={(e) => setDraft((s) => ({ ...s, label: e.target.value }))} />
        </div>
        <div>
          <FieldLabel htmlFor="fc-amount">Montant par mois</FieldLabel>
          <TextInput id="fc-amount" inputMode="decimal" value={draft.amount} placeholder="49" onChange={(e) => setDraft((s) => ({ ...s, amount: e.target.value }))} className="num" />
        </div>
        <div>
          <FieldLabel htmlFor="fc-currency">Devise</FieldLabel>
          <SelectInput id="fc-currency" value={draft.currency} onChange={(e) => setDraft((s) => ({ ...s, currency: e.target.value as Currency }))}>
            <option value="EUR">€</option>
            <option value="USD">$</option>
          </SelectInput>
        </div>
        <div className="sm:col-span-3">
          <FieldLabel htmlFor="fc-note">Note (facultatif)</FieldLabel>
          <TextInput id="fc-note" value={draft.note} placeholder="Hetzner CX23, facturé le 1er" onChange={(e) => setDraft((s) => ({ ...s, note: e.target.value }))} />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" size="sm" disabled={busy}>
            {draft.id ? 'Enregistrer' : 'Ajouter'}
          </Button>
          {draft.id && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(EMPTY)}>
              Annuler
            </Button>
          )}
          {error && <span className="text-[12px] text-err">{error}</span>}
        </div>
      </form>
    </Panel>
  )
}

function Line({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: 'err' | 'ok' }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-[13px] ${strong ? 'border-t border-line pt-2.5 font-medium text-fg' : 'text-fg-2'}`}>
      <span>{label}</span>
      <span className={`num ${tone === 'err' ? 'text-err' : tone === 'ok' ? 'text-ok' : ''}`}>{value}</span>
    </div>
  )
}

export function ResultPanel({ d }: { d: FinanceDashboard }) {
  const f = d.fixed
  const m = d.settings.priceMultiplier
  return (
    <Panel title="Résultat global" sub="Ce mois-ci : revenus − coûts fournisseurs − frais fixes">
      <Line label="Revenus encaissés" value={eur(f.month.revenueEurCents)} />
      <Line label="− Coûts fournisseurs" value={eur(f.month.providerCostEurCents)} />
      <Line label="− Frais fixes" value={eur(f.month.fixedEurCents)} />
      <Line label="= Résultat" value={eur(f.month.resultEurCents)} strong tone={f.month.resultEurCents < 0 ? 'err' : 'ok'} />
      <div className="mt-5 grid gap-1.5 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] leading-[1.5] text-fg-2">
        <p className="m-0">
          <strong className="font-medium text-fg">Point mort : </strong>
          {f.breakEvenMinutes !== null
            ? `${num(f.breakEvenMinutes)} minutes finies par mois paient les frais fixes (marge ${eur(f.marginPerMinuteEurCents ?? 0)} par minute).`
            : f.costPerMinuteEurCents === null
              ? 'pas encore calculable : aucune vidéo finie avec sa durée.'
              : m === 1
                ? 'jamais à marge 0 % : chaque minute est vendue à son coût.'
                : 'jamais à la marge actuelle.'}
        </p>
        {f.breakEvenMinutes === null && f.breakEvenAt.minutes !== null && (
          <p className="m-0">
            Avec un multiplicateur {multiplierLabel(f.breakEvenAt.multiplier)}, il faudrait {num(f.breakEvenAt.minutes)} minutes finies par mois.
          </p>
        )}
        <p className="m-0 text-fg-3">
          Coût réel par minute finie : {f.costPerMinuteEurCents === null ? '—' : eur(f.costPerMinuteEurCents)} (depuis le début) · {minutes(f.month.minutes)} minutes finies ce
          mois-ci.
        </p>
      </div>
    </Panel>
  )
}

export function SettingsPanel({ d, onChanged }: { d: FinanceDashboard; onChanged: () => void }) {
  const toast = useToast()
  const s = d.settings
  const [grid, setGrid] = useState(s.priceMultiplier === null)
  const [mult, setMult] = useState(String(s.priceMultiplier ?? 1).replace('.', ','))
  const [rate, setRate] = useState(String(s.eurPerUsd).replace('.', ','))
  const [asOf, setAsOf] = useState(s.fxAsOf)
  const [error, setError] = useState('')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const m = Number(mult.replace(',', '.'))
    const r = Number(rate.replace(',', '.'))
    if (!grid && !(m >= 1 && m <= 5)) return setError('Le multiplicateur va de 1 (prix coûtant) à 5.')
    if (!(r > 0 && r < 10)) return setError('Le taux est le prix d’un dollar en euros, par exemple 0,92.')
    saveSettings({ priceMultiplier: grid ? null : m, eurPerUsd: r, fxAsOf: asOf })
      .then(() => {
        toast('Réglages enregistrés : les prochains devis les suivent')
        setError('')
        onChanged()
      })
      .catch((err: unknown) => setError(failure(err)))
  }
  return (
    <Panel title="Réglages" sub="Le prix des crédits et le taux de change. Un changement vaut pour les prochains devis ; les devis passés gardent le leur.">
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-3">
        <div>
          <FieldLabel htmlFor="fin-mult">Multiplicateur de prix</FieldLabel>
          <TextInput id="fin-mult" inputMode="decimal" value={mult} disabled={grid} onChange={(e) => setMult(e.target.value)} className="num w-[110px]" />
          <label className="mt-2 flex items-center gap-2 text-[12px] text-fg-3">
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            Utiliser la marge de chaque ligne de la grille
          </label>
          <p className="m-0 mt-1.5 text-[12px] text-fg-3">1 = prix coûtant (bêta). 1,3 = 30 % de marge.</p>
        </div>
        <div>
          <FieldLabel htmlFor="fin-rate">1 $ en €</FieldLabel>
          <TextInput id="fin-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="num w-[110px]" />
        </div>
        <div>
          <FieldLabel htmlFor="fin-asof">Date du taux</FieldLabel>
          <TextInput id="fin-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[170px]" />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" size="sm">
            Enregistrer
          </Button>
          {error && <span className="text-[12px] text-err">{error}</span>}
        </div>
      </form>
    </Panel>
  )
}
