// What the box uses while a production runs (vps-rendu): memory and CPU of the whole container, read from its cgroup v2
// files every `everyMs`. Inside `docker run --cpus 4 --memory 8g` that is exactly what the 8 GB limit counts (every
// process: the brain, the node workers, Chromium, ffmpeg, Whisper). Outside a cgroup v2 (a developer's Windows PC) it falls
// back to the machine's used memory, marked `scope: 'machine'`.
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'

export interface MeterSample {
  t: number
  memMB: number
  /** CPU seconds used by the box since the meter started. */
  cpuS: number
}

export interface BoxMeter {
  scope: 'cgroup' | 'machine'
  limitMB: number | null
  cpus: number | null
  samples: MeterSample[]
  /** Peak memory between two times (ms since epoch), from the samples. */
  peakMB(from: number, to: number): number
  /** CPU seconds between two times. */
  cpuS(from: number, to: number): number
  stop(): void
}

const CG = '/sys/fs/cgroup'

function readNum(file: string): number | null {
  try {
    const v = readFileSync(file, 'utf8').trim()
    return v === 'max' ? null : Number(v)
  } catch {
    return null
  }
}

function statField(name: string): number {
  try {
    const m = new RegExp(`^${name} (\\d+)$`, 'm').exec(readFileSync(`${CG}/memory.stat`, 'utf8'))
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}

/** Processes the kernel killed for memory in the box since it started (memory.events `oom_kill`). */
export function oomKills(): number {
  try {
    const m = /^oom_kill (\d+)$/m.exec(readFileSync(`${CG}/memory.events`, 'utf8'))
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}

function cgroupCpuUsec(): number | null {
  try {
    const m = /usage_usec (\d+)/.exec(readFileSync(`${CG}/cpu.stat`, 'utf8'))
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

export function startBoxMeter(everyMs = 250): BoxMeter {
  const cgroup = existsSync(`${CG}/memory.current`)
  const limit = cgroup ? readNum(`${CG}/memory.max`) : null
  let cpus: number | null = null
  if (cgroup) {
    try {
      const [quota, period] = readFileSync(`${CG}/cpu.max`, 'utf8').trim().split(/\s+/)
      if (quota && quota !== 'max' && period) cpus = Number(quota) / Number(period)
    } catch {
      cpus = null
    }
  }
  const cpu0 = cgroupCpuUsec()
  const t0 = process.cpuUsage()
  const samples: MeterSample[] = []
  const sample = (): void => {
    // the working set, as `docker stats` shows it: the page cache the kernel can drop (inactive files) is not counted
    const memB = cgroup ? Math.max(0, (readNum(`${CG}/memory.current`) ?? 0) - statField('inactive_file')) : os.totalmem() - os.freemem()
    const usec = cgroup ? cgroupCpuUsec() : null
    const cpuS = usec !== null && cpu0 !== null ? (usec - cpu0) / 1e6 : (process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1e6
    samples.push({ t: Date.now(), memMB: Math.round(memB / 1048576), cpuS })
  }
  sample()
  const timer = setInterval(sample, everyMs)
  timer.unref()
  const within = (from: number, to: number): MeterSample[] => samples.filter((s) => s.t >= from - everyMs && s.t <= to + everyMs)
  return {
    scope: cgroup ? 'cgroup' : 'machine',
    limitMB: limit === null ? null : Math.round(limit / 1048576),
    cpus,
    samples,
    peakMB: (from, to) => Math.max(0, ...within(from, to).map((s) => s.memMB)),
    cpuS: (from, to) => {
      const w = within(from, to)
      return w.length < 2 ? 0 : Math.max(0, (w[w.length - 1] as MeterSample).cpuS - (w[0] as MeterSample).cpuS)
    },
    stop: () => {
      sample()
      clearInterval(timer)
    }
  }
}
