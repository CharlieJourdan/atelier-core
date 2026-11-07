// `app.machine`: this PC's real figures for the Ordinateur screen (processor load between two calls, memory, disk),
// and the card built from them in real mode.
import { describe, expect, it } from 'vitest'
import type { CpuInfo } from 'node:os'
import { machineReader, type MachineDeps } from '../../src/main/machine'
import { liveComputer } from '../../src/renderer/screens/team/useMachine'
import type { ProtoVideo } from '../../src/renderer/proto/types'

const GB = 1024 ** 3
const cpu = (idle: number, busy: number): CpuInfo => ({ model: 'Test  CPU  9000', speed: 3000, times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } })

function deps(samples: CpuInfo[][]): MachineDeps {
  let i = 0
  return {
    cpus: () => samples[Math.min(i++, samples.length - 1)]!,
    totalmem: () => 32 * GB,
    freemem: () => 8 * GB,
    uptime: () => 50 * 3600,
    statfs: () => ({ blocks: 1000, bfree: 400, bavail: 250, bsize: GB / 2 }),
    hostname: () => 'atelier-pc',
    platform: 'win32',
    release: () => '10.0.22631'
  }
}

describe('machine stats', () => {
  it('measures the processor load since the previous call, plus memory and disk', () => {
    const read = machineReader(deps([[cpu(100, 100), cpu(100, 100)], [cpu(150, 250), cpu(150, 250)]]))
    const first = read('/data')
    expect(first).toMatchObject({ hostname: 'atelier-pc', os: 'Windows 10.0.22631', cpuModel: 'Test CPU 9000', cores: 2, ramTotalGb: 32, ram: 75, diskTotalGb: 500, diskUsedGb: 375, uptimeHours: 50 })
    expect(first.cpu).toBe(50)
    // second call: +50 idle and +150 busy per core → 75 % busy
    expect(read('/data').cpu).toBe(75)
  })

  it('a card from the live figures: real specs, the running runs as jobs', () => {
    const read = machineReader(deps([[cpu(10, 10)]]))
    const video = (id: string, state: 'running' | 'done'): ProtoVideo =>
      ({ id, title: `Vidéo ${id}`, progress: 42.4, liveRun: { runId: 1, demo: true, nodes: [{ nodeId: 'voice', state, progress: 0.5 }] } }) as unknown as ProtoVideo
    const pc = liveComputer(read('/'), [video('a', 'running'), video('b', 'done')])
    expect(pc.name).toBe('atelier-pc')
    expect(pc.specs).toContain('Test CPU 9000')
    expect(pc.uptimeDays).toBe(2)
    expect(pc.jobs).toEqual([{ label: 'Vidéo a', progress: 42 }])
  })
})
