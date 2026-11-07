// A render job written to a folder instead of being sent (vps-rendu): the bundle `npm run cloud -- render try --bundle DIR`
// sends to a real provider for the first paid test. Placed first among the backends, it writes `<dir>/<node>-<time>/bundle.json`
// (the node as the worker protocol carries it, its input files by name under `files/`), then steps aside (a transient failure)
// so the next backend or the VPS makes the render as usual. Free; nothing leaves the machine.
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WORKER_PROTOCOL_VERSION } from '../../shared/worker-protocol'
import { EngineError } from '../errors'
import { safeFileName } from '../worker/child'
import type { RenderBackend } from './backend'

export function captureRenderBackend(dir: string, o: { once?: boolean } = {}): RenderBackend & { captured: string[] } {
  const captured: string[] = []
  const seen = new Set<string>()
  return {
    id: 'fake',
    captured,
    async run(x) {
      const kind = x.def.type
      if (!(o.once && seen.has(kind))) {
        seen.add(kind)
        const folder = path.join(dir, safeFileName(`${kind}-${x.nodeId}-${Date.now().toString(36)}`))
        await mkdir(path.join(folder, 'files'), { recursive: true })
        const inputs: Record<string, unknown> = {}
        let n = 0
        for (const [port, a] of Object.entries(x.inputs)) {
          const bundleFiles: string[] = []
          for (const f of a.files ?? []) {
            const name = `${String(n++).padStart(3, '0')}-${safeFileName(path.basename(f))}`
            await copyFile(f, path.join(folder, 'files', name))
            bundleFiles.push(name)
          }
          inputs[port] = { type: a.type, fingerprint: a.fingerprint, ...(a.value !== undefined ? { value: a.value } : {}), ...(a.meta ? { meta: a.meta } : {}), ...(a.files ? { bundleFiles } : {}) }
        }
        const node = { v: WORKER_PROTOCOL_VERSION, nodeType: kind, params: x.params, inputs, seed: x.ctx.seed, where: 'local', attempt: x.ctx.attempt, notes: x.ctx.notes, settings: x.settings, fake: x.useFake }
        await writeFile(path.join(folder, 'bundle.json'), JSON.stringify({ v: 1, node }, null, 1))
        captured.push(folder)
      }
      throw new EngineError('transient', 'captured for a later real test (not sent)')
    }
  }
}
