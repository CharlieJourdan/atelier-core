// vps-essai: inside a container limited to 4 CPUs (`docker run --cpus 4`, a serverless job, a VPS sold by quota) Node's
// `os.cpus()` lists every core of the host (28 on the beta PC): the render ran 14 ffmpeg segments at once in the 8 GB box
// and the kernel killed them (20 OOM kills, the 3-minute documentary lost). The pool follows the CPUs the process may use.
import type * as OsModule from 'node:os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async (orig) => {
  const real = await orig<typeof OsModule>()
  const fake = { ...real, cpus: () => new Array(28).fill(real.cpus()[0]), availableParallelism: () => 4 }
  return { ...fake, default: fake }
})

describe('render segment workers', () => {
  it('follows the CPUs this process may use (cgroup quota), not every core of the host', async () => {
    const { segmentWorkers } = await import('../../src/engine/render/workers')
    expect(segmentWorkers()).toBe(2)
  })

  it('is half the usable CPUs, at least one', async () => {
    const { segmentWorkers } = await import('../../src/engine/render/workers')
    expect(segmentWorkers(28)).toBe(14)
    expect(segmentWorkers(4)).toBe(2)
    expect(segmentWorkers(1)).toBe(1)
  })
})
