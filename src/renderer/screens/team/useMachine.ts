// Real mode, Ordinateur: this PC stands for the team computer (the beta has no rented machine yet), so the machine
// card shows its real processor, memory and disk, polled every few seconds, and the real runs in progress.
import { useEffect, useState } from 'react'
import type { MachineStats } from '../../../shared/api/app'
import { t } from '../../../shared/fr'
import { isDesktop } from '@/proto/live/driver'
import type { ProtoVideo, TeamComputer } from '@/proto/types'
import { call } from '@/state/client'

const EVERY_MS = 4000

/** The machine's live figures, or null in demo mode, in the web app, or until the first answer. */
export function useMachine(live: boolean): MachineStats | null {
  const [stats, setStats] = useState<MachineStats | null>(null)
  useEffect(() => {
    if (!live || !isDesktop()) return
    let stop = false
    const read = (): void => {
      call('app.machine')
        .then((s) => {
          if (!stop) setStats(s)
        })
        .catch(() => undefined)
    }
    read()
    const id = setInterval(read, EVERY_MS)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [live])
  return live ? stats : null
}

/** The computer card's data from the live figures: real specs, real load, the real runs as its jobs. */
export function liveComputer(m: MachineStats, videos: readonly ProtoVideo[]): TeamComputer {
  return {
    name: m.hostname,
    provider: t(m.brain ? 'team.pc.live.providerBrain' : 'team.pc.live.provider'),
    specs: t('team.pc.live.specs', { model: m.cpuModel, cores: m.cores, ram: m.ramTotalGb }),
    region: m.os,
    cpu: m.cpu,
    ram: m.ram,
    diskUsedGb: m.diskUsedGb,
    diskTotalGb: m.diskTotalGb,
    uptimeDays: Math.floor(m.uptimeHours / 24),
    jobs: videos
      .filter((v) => v.liveRun?.nodes.some((n) => n.state === 'running' || n.state === 'queued'))
      .slice(0, 4)
      .map((v) => ({ label: v.title, progress: Math.round(v.progress) }))
  }
}
