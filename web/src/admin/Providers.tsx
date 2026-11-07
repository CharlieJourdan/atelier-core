import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '../ui'
import { DEFAULT_MARKUP, PROVIDERS, UNIT_PRICES, eur, num } from './data'
import { PageHeader, Panel, Status, Table, td, th, useToast } from './kit'

export function Providers() {
  const toast = useToast()
  const [testing, setTesting] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, string>>({})

  const test = (id: string, name: string): void => {
    setTesting(id)
    window.setTimeout(() => {
      setTesting(null)
      setChecked((c) => ({ ...c, [id]: 'à l’instant' }))
      toast(`${name} : la clé répond (démo)`)
    }, 900)
  }

  return (
    <>
      <PageHeader title="Fournisseurs" sub="État des clés d’API et prix unitaires. Seul l’état « définie » ou « non définie » est visible : les valeurs restent côté serveur et ne s’affichent jamais." />
      <div className="grid gap-4">
        <Panel title="Clés d’API" flush>
          <Table>
            <thead>
              <tr>
                <th className={th}>Fournisseur</th>
                <th className={th}>Usage</th>
                <th className={th}>Clé</th>
                <th className={th}>Dernier test</th>
                <th className={`${th} text-right`}>Dépense du mois</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} font-medium text-fg`}>{p.name}</td>
                  <td className={td}>{p.usage}</td>
                  <td className={td}>
                    <Status tone={p.keySet ? 'ok' : 'warn'}>
                      {p.keySet ? (
                        <span className="inline-flex items-center gap-1.5">
                          Définie <Lock size={11} strokeWidth={1.5} className="text-fg-3" aria-hidden="true" />
                        </span>
                      ) : (
                        'Non définie'
                      )}
                    </Status>
                  </td>
                  <td className={td}>{checked[p.id] ?? p.checked}</td>
                  <td className={`${td} num text-right`}>{p.spend > 0 ? eur(p.spend, false) : '–'}</td>
                  <td className={`${td} text-right`}>
                    <Button variant="secondary" size="sm" disabled={!p.keySet || testing === p.id} onClick={() => test(p.id, p.name)} aria-label={`Tester la clé ${p.name}`}>
                      {testing === p.id ? 'Test…' : 'Tester'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Prix unitaires" sub={`Prix fournisseur et équivalent en crédits au multiplicateur de ${String(DEFAULT_MARKUP).replace('.', ',')} (1 USD ≈ 0,92 €, 1 crédit = 0,01 €).`} flush>
          <Table>
            <thead>
              <tr>
                <th className={th}>Fournisseur</th>
                <th className={th}>Service</th>
                <th className={th}>Unité</th>
                <th className={`${th} text-right`}>Prix fournisseur</th>
                <th className={`${th} text-right`}>Crédits facturés</th>
              </tr>
            </thead>
            <tbody>
              {UNIT_PRICES.map((u) => (
                <tr key={`${u.provider}-${u.item}`}>
                  <td className={`${td} font-medium text-fg`}>{u.provider}</td>
                  <td className={td}>{u.item}</td>
                  <td className={td}>{u.unit}</td>
                  <td className={`${td} num text-right`}>
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: u.currency, maximumFractionDigits: u.price < 1 ? 4 : 2 }).format(u.price)}
                  </td>
                  <td className={`${td} num text-right`}>{u.creditsAt1 * DEFAULT_MARKUP >= 10 ? num(u.creditsAt1 * DEFAULT_MARKUP) : (u.creditsAt1 * DEFAULT_MARKUP).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  )
}
