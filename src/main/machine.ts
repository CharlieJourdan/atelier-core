// `app.machine`: the live figures of the machine the app runs on. In the beta this PC stands for the team computer a
// subscription will rent (archived note RECAP (old repository) §4), so the Ordinateur screen shows its real processor, memory and disk.
// The processor load is measured between two calls (the first one compares with the boot totals).
import os from 'node:os'
import { statfsSync } from 'node:fs'
import type { MachineStats } from '../shared/api/app'

export interface MachineDeps {
  cpus: () => os.CpuInfo[]
  totalmem: () => number
  freemem: () => number
  uptime: () => number
  statfs: (dir: string) => { blocks: number; bfree: number; bavail: number; bsize: number }
  hostname: () => string
  platform: NodeJS.Platform
  release: () => string
}

const REAL: MachineDeps = {
  cpus: os.cpus,
  totalmem: os.totalmem,
  freemem: os.freemem,
  uptime: os.uptime,
  statfs: (dir) => statfsSync(dir),
  hostname: os.hostname,
  platform: process.platform,
  release: os.release
}

interface CpuSample {
  idle: number
  total: number
}

function sample(cpus: os.CpuInfo[]): CpuSample {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

const GB = 1024 ** 3
const pct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))

/** A reader that remembers its previous processor sample, so each call reports the load since the last one. */
export function machineReader(deps: MachineDeps = REAL): (dir: string) => MachineStats {
  let last: CpuSample | null = null
  return (dir) => {
    const cpus = deps.cpus()
    const now = sample(cpus)
    const prev = last ?? { idle: 0, total: 0 }
    last = now
    const dTotal = now.total - prev.total
    const cpu = dTotal > 0 ? pct((1 - (now.idle - prev.idle) / dTotal) * 100) : 0
    const total = deps.totalmem()
    const fs = deps.statfs(dir)
    const diskTotal = fs.blocks * fs.bsize
    const diskFree = fs.bavail * fs.bsize
    const os = deps.platform === 'win32' ? 'Windows' : deps.platform === 'darwin' ? 'macOS' : 'Linux'
    return {
      hostname: deps.hostname(),
      os: `${os} ${deps.release()}`,
      cpuModel: (cpus[0]?.model ?? '').replace(/\s+/g, ' ').trim(),
      cores: cpus.length,
      cpu,
      ramTotalGb: Math.round(total / GB),
      ram: total > 0 ? pct(((total - deps.freemem()) / total) * 100) : 0,
      diskTotalGb: Math.round(diskTotal / GB),
      diskUsedGb: Math.round((diskTotal - diskFree) / GB),
      uptimeHours: Math.floor(deps.uptime() / 3600)
    }
  }
}
