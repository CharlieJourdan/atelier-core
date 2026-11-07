// How many shot segments the render encodes at once (R7.6): half the CPUs this process may use, at least one (each
// ffmpeg is capped at 2 threads). `availableParallelism()` follows the container's CPU quota (cgroup `cpu.max`);
// `os.cpus()` lists every core of the host, which in a 4-CPU box on a 28-core PC ran 14 encoders and filled 8 GB.
import { availableParallelism } from 'node:os'

export function segmentWorkers(cores: number = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / 2))
}
