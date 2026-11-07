import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { HBar } from './charts'
import { HIBERNATED_COST, MACHINES, PROVISION_RUNS, VM_COST, agoLabel, eur, type Machine, type MachineStatus, type ProvisionRun } from './data'
import { Chip2, PageHeader, Panel, Status, Table, td, th, useToast } from './kit'

const STATUS_LABEL: Record<MachineStatus, string> = { running: 'En marche', hibernated: 'Hibernée', provisioning: 'Préparation' }
const STATUS_TONE = { running: 'ok', hibernated: 'idle', provisioning: 'info' } as const

const SIM_STEPS = [
  'Nouvel utilisateur créé',
  'Machine commandée chez Hetzner (CX33, fsn1)',
  'Système démarré, agent de relais connecté',
  'Claude Code installé (binaire officiel)',
  'Pare-feu fermé, disque chiffré',
  'Prêt en 3 min 12 s'
]

function runLog(run: ProvisionRun | undefined): { at: string; text: string }[] {
  let t = 0
  return (run?.steps ?? []).map((s) => {
    t += s.seconds
    return { at: `+${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, text: s.label }
  })
}

export function Machines() {
  const toast = useToast()
  const [machines, setMachines] = useState<Machine[]>(MACHINES)
  const [filter, setFilter] = useState<MachineStatus | 'all'>('all')
  const [log, setLog] = useState<{ at: string; text: string }[]>(() => runLog(PROVISION_RUNS[0]))
  const [simulating, setSimulating] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => window.clearTimeout(t))
  }, [])

  const counts = (s: MachineStatus): number => machines.filter((m) => m.status === s).length
  const shown = machines.filter((m) => filter === 'all' || m.status === filter)
  const monthly = machines.reduce((s, m) => s + m.monthlyCost, 0)

  const act = (m: Machine): void => {
    const toHibernated = m.status === 'running'
    setMachines((all) =>
      all.map((x) =>
        x.id === m.id
          ? { ...x, status: toHibernated ? 'hibernated' : 'running', monthlyCost: toHibernated ? HIBERNATED_COST : (VM_COST.starter), cpu: toHibernated ? 0 : 12, ram: toHibernated ? 0 : 30 }
          : x
      )
    )
    toast(toHibernated ? `${m.id} hibernée : snapshot créé, serveur supprimé (démo)` : `${m.id} redémarrée depuis son snapshot (démo)`)
  }

  const simulate = (): void => {
    if (simulating) return
    setSimulating(true)
    const id = `atl-pc-${String(41 + machines.length).padStart(4, '0')}`
    setMachines((all) => [{ id, userId: 'usr_new', userName: 'Nouvel utilisateur', type: 'CX33', region: 'fsn1 · Falkenstein', status: 'provisioning', monthlyCost: VM_COST.starter, vcpu: 4, ramGb: 8, cpu: 0, ram: 0 }, ...all])
    setLog([])
    SIM_STEPS.forEach((text, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setLog((l) => [...l, { at: `+0:${String(Math.min(59, i * 9)).padStart(2, '0')}`, text }])
          if (i === SIM_STEPS.length - 1) {
            setMachines((all) => all.map((m) => (m.id === id ? { ...m, status: 'running', cpu: 4, ram: 18 } : m)))
            setSimulating(false)
            toast('Machine prête (démo accélérée)')
          }
        }, 700 * (i + 1))
      )
    })
  }

  return (
    <>
      <PageHeader
        title="Machines"
        sub="Les ordinateurs d’équipe loués chez Hetzner. Une machine inactive se hiberne : snapshot, puis le serveur est supprimé pour ne plus être facturé."
        actions={
          <Button variant="secondary" onClick={simulate} disabled={simulating}>
            Simuler un nouvel utilisateur
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par état">
          <Chip2 active={filter === 'all'} onClick={() => setFilter('all')}>
            Toutes {machines.length}
          </Chip2>
          {(Object.keys(STATUS_LABEL) as MachineStatus[]).map((s) => (
            <Chip2 key={s} active={filter === s} onClick={() => setFilter(s)}>
              {STATUS_LABEL[s]} {counts(s)}
            </Chip2>
          ))}
        </div>
        <p className="num m-0 text-[13px] text-fg-3">Coût mensuel des machines : {eur(monthly)}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel flush className="min-w-0 overflow-hidden">
          <Table>
            <thead>
              <tr>
                <th className={th}>Machine</th>
                <th className={th}>Type Hetzner</th>
                <th className={th}>État</th>
                <th className={`${th} text-right`}>Coût / mois</th>
                <th className={th}>Charge</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    <span className="block font-medium text-fg">{m.id}</span>
                    <span className="block text-[12px] text-fg-3">{m.userName}</span>
                  </td>
                  <td className={td}>
                    <span className="block">
                      {m.type} <span className="text-fg-3">· {m.vcpu} vCPU, {m.ramGb} Go</span>
                    </span>
                    <span className="block text-[12px] text-fg-3">{m.region}</span>
                  </td>
                  <td className={td}>
                    <Status tone={STATUS_TONE[m.status]} pulse={m.status === 'provisioning'}>
                      {STATUS_LABEL[m.status]}
                    </Status>
                  </td>
                  <td className={`${td} num text-right`}>{eur(m.monthlyCost)}</td>
                  <td className={td}>
                    {m.status === 'running' ? (
                      <span className="grid gap-1.5">
                        <span className="flex items-center gap-2">
                          <span className="w-8 text-[11px] text-fg-3">CPU</span>
                          <HBar value={m.cpu} max={100} tone={m.cpu > 70 ? 'warn' : 'ink'} className="w-16" />
                          <span className="num w-9 text-[12px]">{m.cpu} %</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-8 text-[11px] text-fg-3">RAM</span>
                          <HBar value={m.ram} max={100} className="w-16" />
                          <span className="num w-9 text-[12px]">{m.ram} %</span>
                        </span>
                      </span>
                    ) : (
                      <span className="text-fg-4">–</span>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {m.status !== 'provisioning' && (
                      <Button variant="secondary" size="sm" onClick={() => act(m)} aria-label={`${m.status === 'running' ? 'Hiberner' : 'Redémarrer'} ${m.id}`}>
                        {m.status === 'running' ? 'Hiberner' : 'Redémarrer'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Automatisation du provisioning" sub="Dernière exécution">
            <ol className="m-0 list-none border-l border-line-2 p-0 pl-4 text-[13px]">
              {log.map((l, i) => (
                <li key={`${l.text}-${i}`} className="rise relative pb-3 last:pb-0">
                  <span aria-hidden="true" className="absolute -left-[20.5px] top-[7px] size-1.5 rounded-full bg-ok" />
                  <span className="num mr-2 text-[12px] text-fg-3">{l.at}</span>
                  <span className="text-fg-2">{l.text}</span>
                </li>
              ))}
            </ol>
            <p className="m-0 mt-4 border-t border-line pt-3 text-[12px] leading-[1.5] text-fg-3">
              nouvel utilisateur → machine commandée → Claude Code installé → prêt en {PROVISION_RUNS[0]?.total ?? '3 min 12 s'}. L’utilisateur se connecte lui-même à son abonnement : aucun identifiant ne quitte sa machine.
            </p>
          </Panel>
          <Panel title="Exécutions récentes" flush>
            <ul className="hairline-list m-0 list-none p-0">
              {PROVISION_RUNS.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{r.user}</span>
                    <span className="block text-[12px] text-fg-3">{agoLabel(r.agoMin)}</span>
                  </span>
                  <span className="num shrink-0 text-fg-2">{r.total}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  )
}
