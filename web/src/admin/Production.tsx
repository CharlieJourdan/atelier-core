import { useEffect, useState } from 'react'
import { Button } from '../ui'
import { HBar } from './charts'
import { JOBS, num, type Job } from './data'
import { PageHeader, Panel, Stat, StatRow, Status, Table, td, th, useToast } from './kit'

const STATE_LABEL = { running: 'En cours', queued: 'En attente', error: 'Erreur' } as const
const STATE_TONE = { running: 'ok', queued: 'idle', error: 'err' } as const

export function Production() {
  const toast = useToast()
  const [jobs, setJobs] = useState<Job[]>(JOBS)

  // Demo only: running jobs creep forward every two seconds so the page feels live.
  useEffect(() => {
    const id = window.setInterval(() => {
      setJobs((all) =>
        all.map((j) => (j.state === 'running' && j.progress < 99 ? { ...j, progress: Math.min(99, j.progress + 1), credits: j.credits + Math.round(j.credits * 0.01) } : j))
      )
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  const running = jobs.filter((j) => j.state === 'running')
  const errors = jobs.filter((j) => j.state === 'error')
  const queued = jobs.filter((j) => j.state === 'queued')
  const credits = jobs.reduce((s, j) => s + j.credits, 0)

  const retry = (job: Job): void => {
    setJobs((all) => all.map((j) => (j.id === job.id ? { ...j, state: 'running', error: undefined } : j)))
    toast(`${job.id} relancé (démo)`)
  }

  return (
    <>
      <PageHeader title="Production en direct" sub="Les vidéos en cours de fabrication chez tous les utilisateurs : étape, fournisseur, coût déjà engagé, erreurs." />
      <div className="grid gap-4">
        <StatRow>
          <Stat label="En cours" value={String(running.length)} />
          <Stat label="En attente" value={String(queued.length)} />
          <Stat label="En erreur" value={String(errors.length)} tone={errors.length > 0 ? 'err' : undefined} delta={errors.length > 0 ? 'à regarder' : 'rien à signaler'} />
          <Stat label="Crédits engagés" value={num(credits)} delta="sur les vidéos affichées" />
        </StatRow>

        {errors.length > 0 && (
          <Panel title="Erreurs" sub="Une relance automatique est tentée avant de te prévenir.">
            <ul className="hairline-list m-0 list-none p-0">
              {errors.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px] first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">
                      {j.id} · {j.video}
                    </span>
                    <span className="block text-err">{j.error}</span>
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => retry(j)}>
                    Relancer
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel flush className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <th className={th}>Vidéo</th>
                <th className={th}>Étape</th>
                <th className={th}>Avancement</th>
                <th className={`${th} text-right`}>Crédits</th>
                <th className={th}>État</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className={td}>
                    <span className="block max-w-[300px] truncate font-medium text-fg">{j.video}</span>
                    <span className="block text-[12px] text-fg-3">
                      {j.id} · {j.user} · {j.pipeline}
                    </span>
                  </td>
                  <td className={td}>
                    <span className="block">{j.node}</span>
                    <span className="block text-[12px] text-fg-3">{j.provider}</span>
                  </td>
                  <td className={td}>
                    <span className="flex items-center gap-2">
                      <HBar value={j.progress} max={100} tone={j.state === 'error' ? 'err' : 'ink'} className="w-24" />
                      <span className="num w-9 text-[12px]">{j.progress} %</span>
                    </span>
                  </td>
                  <td className={`${td} num text-right`}>{num(j.credits)}</td>
                  <td className={td}>
                    <Status tone={STATE_TONE[j.state]} pulse={j.state === 'running'}>
                      {STATE_LABEL[j.state]}
                    </Status>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  )
}
