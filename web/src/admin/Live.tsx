// The founder console on the real Atelier Cloud (site built with VITE_ATELIER_CLOUD): the overview and the machines
// read the server (the users in LiveUsers.tsx); the other pages stay the mock-up, with a banner that says so.
import { useCallback, useEffect, useState } from 'react'
import { cloudCall } from '../cloud'
import { PageHeader, Panel, Stat, StatRow, Status, Table, td, th, useToast, type StatusTone } from './kit'

interface Overview {
  accounts: number
  teams: number
  plans: { plan: string; active: number }[]
  mrrCents: number
  monthRevenueCents: { subscription: number; pack: number; topup: number }
  machines: { running: number; hibernated: number; monthlyCostEur: number; demo: boolean }
  creditsThisMonth: { granted: number; spent: number }
  paymentsProvider: 'stripe' | 'fake'
  /** Providers that need the founder (HeyGen's sign-in whose refresh failed); absent on an older Cloud. */
  providerAlerts?: { provider: string; message: string; raisedAt: string }[]
}

interface Machine {
  id: string
  teamName: string
  plan: string
  serverType: string
  location: string
  status: 'creating' | 'running' | 'hibernating' | 'hibernated' | 'resuming' | 'deleted' | 'error'
  ipv4: string | null
  demo: boolean
  error: string | null
  createdAt: string
}

const euro = (cents: number): string => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const num = (n: number): string => n.toLocaleString('fr-FR')
const activeLabel = (n: number): string => (n > 1 ? `${num(n)} abonnements actifs` : `${n} abonnement actif`)

function useLoad<T>(path: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let stop = false
    cloudCall<T>(path)
      .then((d) => {
        if (!stop) setData(d)
      })
      .catch((e: unknown) => {
        if (!stop) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      stop = true
    }
  }, [path, n])
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) }
}

export function MockBanner() {
  return (
    <p className="m-0 mb-5 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2" data-testid="admin-mock">
      Maquette : cette page montre encore des données inventées. La vue d’ensemble, les utilisateurs, les machines, les coûts, les Blueprints et les Versions lisent le vrai Atelier Cloud.
    </p>
  )
}

export function LiveOverview() {
  const { data: o, error } = useLoad<Overview>('/v1/admin/overview')
  return (
    <>
      <PageHeader title="Vue d’ensemble" sub="Chiffres réels d’Atelier Cloud, ce mois-ci." />
      {error && <p className="m-0 text-[13px] text-fg-2">Atelier Cloud ne répond pas : {error}</p>}
      {o && (
        <div className="grid gap-4" data-testid="admin-live-overview">
          {(o.providerAlerts ?? []).map((a) => (
            <p key={a.provider} className="m-0 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-fg" data-testid="admin-provider-alert">
              <strong>{a.provider}</strong> : {a.message} <span className="text-fg-3">({a.raisedAt.slice(0, 16).replace('T', ' ')})</span>
            </p>
          ))}
          <StatRow>
            <Stat label="MRR" value={euro(o.mrrCents)} delta={activeLabel(o.plans.reduce((s, p) => s + p.active, 0))} tone="ok" />
            <Stat label="Comptes" value={num(o.accounts)} delta={`${num(o.teams)} équipes`} />
            <Stat label="Encaissé ce mois-ci" value={euro(o.monthRevenueCents.subscription + o.monthRevenueCents.pack + o.monthRevenueCents.topup)} delta={o.paymentsProvider === 'fake' ? 'paiement simulé' : 'Stripe'} tone={o.paymentsProvider === 'fake' ? 'warn' : undefined} />
            <Stat label="Machines en marche" value={num(o.machines.running)} delta={`${num(o.machines.hibernated)} en veille · ${o.machines.monthlyCostEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} / mois${o.machines.demo ? ' (démo)' : ''}`} />
          </StatRow>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Abonnements actifs par plan">
              {o.plans.length === 0 ? (
                <p className="m-0 text-[13px] text-fg-3">Aucun abonnement pour l’instant.</p>
              ) : (
                <ul className="hairline-list m-0 list-none p-0">
                  {o.plans.map((p) => (
                    <li key={p.plan} className="flex items-center justify-between py-2.5 text-[13px] first:pt-0">
                      <span className="font-medium capitalize text-fg">{p.plan}</span>
                      <span className="num text-fg-2">{num(p.active)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Ce mois-ci" sub="Encaissé et crédits">
              <ul className="hairline-list m-0 list-none p-0 text-[13px]">
                <li className="flex justify-between py-2.5 first:pt-0"><span className="text-fg-2">Abonnements</span><span className="num">{euro(o.monthRevenueCents.subscription)}</span></li>
                <li className="flex justify-between py-2.5"><span className="text-fg-2">Packs de crédits</span><span className="num">{euro(o.monthRevenueCents.pack)}</span></li>
                <li className="flex justify-between py-2.5"><span className="text-fg-2">Recharges automatiques</span><span className="num">{euro(o.monthRevenueCents.topup)}</span></li>
                <li className="flex justify-between py-2.5"><span className="text-fg-2">Crédits accordés / dépensés</span><span className="num">{num(o.creditsThisMonth.granted)} / {num(o.creditsThisMonth.spent)}</span></li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}

const STATUS_TONE: Record<Machine['status'], StatusTone> = {
  running: 'ok',
  creating: 'warn',
  resuming: 'warn',
  hibernating: 'warn',
  hibernated: 'idle',
  deleted: 'idle',
  error: 'err'
}
const STATUS_LABEL: Record<Machine['status'], string> = {
  running: 'En marche',
  creating: 'Création',
  resuming: 'Réveil',
  hibernating: 'Mise en veille',
  hibernated: 'En veille',
  deleted: 'Supprimée',
  error: 'Erreur'
}

export function LiveMachines() {
  const { data, error, reload } = useLoad<{ provider: 'hetzner' | 'fake'; machines: Machine[] }>('/v1/admin/machines')
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const act = (m: Machine, action: 'hibernate' | 'resume'): void => {
    setBusy(m.id)
    cloudCall(`/v1/admin/machines/${encodeURIComponent(m.id)}/action`, { method: 'POST', body: { action } })
      .then(() => toast(action === 'hibernate' ? 'Machine mise en veille.' : 'Machine réveillée.'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(null)
        reload()
      })
  }
  return (
    <>
      <PageHeader title="Machines" sub={data ? (data.provider === 'hetzner' ? 'Machines Hetzner réelles.' : 'Machines de démonstration (paidCalls éteint ou pas de jeton Hetzner).') : 'Les ordinateurs d’équipe loués.'} />
      {error && <p className="m-0 text-[13px] text-fg-2">Atelier Cloud ne répond pas : {error}</p>}
      {data && (
        <Panel flush>
          <Table>
            <thead>
              <tr>
                <th className={th}>Équipe</th>
                <th className={th}>Plan</th>
                <th className={th}>Machine</th>
                <th className={th}>État</th>
                <th className={th}>Adresse</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody data-testid="admin-live-machines">
              {data.machines.length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>Aucune machine pour l’instant.</td>
                </tr>
              )}
              {data.machines.map((m) => (
                <tr key={m.id}>
                  <td className={td}>{m.teamName}</td>
                  <td className={td}>{m.plan}</td>
                  <td className={td}>
                    {m.serverType.toUpperCase()} · {m.location}
                    {m.demo ? ' · démo' : ''}
                  </td>
                  <td className={td}>
                    <Status tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Status>
                  </td>
                  <td className={`${td} num`}>{m.ipv4 ?? '—'}</td>
                  <td className={td}>
                    {m.status === 'running' && (
                      <button type="button" disabled={busy === m.id} onClick={() => act(m, 'hibernate')} className="text-[12px] text-fg underline decoration-line-3 underline-offset-4 hover:decoration-fg disabled:opacity-50">
                        Mettre en veille
                      </button>
                    )}
                    {m.status === 'hibernated' && (
                      <button type="button" disabled={busy === m.id} onClick={() => act(m, 'resume')} className="text-[12px] text-fg underline decoration-line-3 underline-offset-4 hover:decoration-fg disabled:opacity-50">
                        Réveiller
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  )
}
