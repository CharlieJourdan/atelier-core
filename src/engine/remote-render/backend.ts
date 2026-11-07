// One remote render backend (vps-rendu, src/shared/render-job.ts): a provider that starts the worker image (`RenderStarter`:
// Scaleway Jobs, Modal, RunPod, the fake) plus the object store its files go through (`RenderJobStore`). One attempt of one
// node: its input files are put in the store (once per content), the job JSON with its upload slots, the run started with
// the job's link and followed until it ends (cancelled on abort or past its deadline), then the result read and its files
// brought back into a scratch folder. The seconds the provider billed are priced here (RENDER_PRICES).
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RENDER_JOB_VERSION, RENDER_UPLOAD_SLOTS, RenderResult, renderCostEur, type RenderBackendId, type RenderJob, type RenderJobStore, type RenderStarter } from '../../shared/render-job'
import { WORKER_PROTOCOL_VERSION, type WireArtefact } from '../../shared/worker-protocol'
import type { NodeOutputs } from '../artefacts'
import { AbortError, EngineError, ERROR_CODES, type ErrorCode } from '../errors'
import type { NodeExecution } from '../executor'
import { ESTIMATE_UNITS, type EstimateUnit } from '../types'
import { safeFileName } from '../worker/child'

/** What one remote attempt gave. */
export interface RemoteOutcome {
  outputs: NodeOutputs
  backend: RenderBackendId
  /** Seconds the run waited in the provider's queue (cold start included). */
  queuedS: number
  billedS: number
  costEur: number
  wallS: number
}

/** The node itself failed on the worker (its own error, as it would fail here): only this kind can be final. */
export class RemoteNodeError extends EngineError {}

export interface RenderBackend {
  id: RenderBackendId
  run(x: NodeExecution, o: { timeoutS: number; signal: AbortSignal }): Promise<RemoteOutcome>
}

export interface StoreBackendOptions {
  starter: RenderStarter
  store: RenderJobStore
  pollMs?: number
  /** Seconds a run may go past its timeout before it is cancelled here (the provider should have stopped it). */
  graceS?: number
}

const asCode = (c: string): ErrorCode => ((ERROR_CODES as readonly string[]).includes(c) ? (c as ErrorCode) : 'internal')

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export function storeRenderBackend(o: StoreBackendOptions): RenderBackend {
  const pollMs = o.pollMs ?? 2000
  const graceS = o.graceS ?? 60
  // a file put once is not sent again (the same picture for every attempt and every run of this VPS)
  const staged = new Map<string, Promise<string>>()
  const stage = async (file: string, signal: AbortSignal): Promise<{ name: string; url: string }> => {
    const bytes = await readFile(file)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const name = safeFileName(path.basename(file))
    const key = `in/${sha.slice(0, 40)}-${name}`
    let p = staged.get(key)
    if (!p) {
      p = o.store.put(key, bytes, signal)
      staged.set(key, p)
      p.catch(() => staged.delete(key))
    }
    return { name, url: await p }
  }

  return {
    id: o.starter.id,
    async run(x, { timeoutS, signal }) {
      const t0 = Date.now()
      const id = safeFileName(`${x.runId}-${x.nodeId}-a${x.ctx.attempt}-${randomBytes(4).toString('hex')}`).slice(0, 90)
      const inputs: Record<string, WireArtefact> = {}
      for (const [port, a] of Object.entries(x.inputs)) {
        const remoteFiles = []
        for (const f of a.files ?? []) remoteFiles.push(await stage(f, signal))
        inputs[port] = {
          type: a.type,
          fingerprint: a.fingerprint,
          ...(a.value !== undefined ? { value: a.value } : {}),
          ...(a.meta ? { meta: a.meta } : {}),
          ...(a.files ? { remoteFiles } : {})
        }
      }
      const prefix = `jobs/${id}`
      const resultKey = `${prefix}/result.json`
      const job: RenderJob = {
        v: RENDER_JOB_VERSION,
        id,
        node: { v: WORKER_PROTOCOL_VERSION, nodeType: x.def.type, params: x.params, inputs, seed: x.ctx.seed, where: 'local', attempt: x.ctx.attempt, notes: x.ctx.notes, settings: x.settings, fake: x.useFake },
        upload: {
          result: o.store.slot(resultKey).putUrl,
          files: Array.from({ length: RENDER_UPLOAD_SLOTS }, (_, i) => {
            const key = `${prefix}/out-${String(i).padStart(2, '0')}`
            return { key, url: o.store.slot(key).putUrl }
          })
        }
      }
      const jobUrl = await o.store.put(`${prefix}/job.json`, new TextEncoder().encode(JSON.stringify(job)), signal)
      if (signal.aborted) throw new AbortError()
      x.ctx.emit({ kind: 'progress', frac: 0.05, text: `rendu à distance (${o.starter.id}) : en file` })

      const ref = await o.starter.start(jobUrl, { jobId: id, timeoutS, signal })
      const deadline = Date.now() + (timeoutS + graceS) * 1000
      let runningAt: number | null = null
      let st = await o.starter.status(ref, signal).catch(() => ({ state: 'queued' as const }))
      try {
        while (st.state === 'queued' || st.state === 'running') {
          if (st.state === 'running' && runningAt === null) {
            runningAt = Date.now()
            x.ctx.emit({ kind: 'progress', frac: 0.1, text: `rendu à distance (${o.starter.id}) : en cours` })
          }
          if (signal.aborted) throw new AbortError()
          if (Date.now() > deadline) throw new EngineError('transient', `the remote render (${o.starter.id}) ran past its ${timeoutS} s`)
          await sleep(pollMs, signal)
          if (signal.aborted) throw new AbortError()
          // one status that does not answer is not the end of the run
          st = await o.starter.status(ref, signal).catch((e: unknown) => {
            if (signal.aborted) throw new AbortError()
            void e
            return st
          })
        }
      } catch (e) {
        await o.starter.cancel(ref).catch(() => undefined)
        throw e
      }
      const ended = Date.now()
      const billedS = st.billedS ?? (ended - (runningAt ?? t0)) / 1000
      if (st.state !== 'succeeded') throw new EngineError('transient', `the remote render (${o.starter.id}) ${st.state}${st.error ? `: ${st.error.slice(0, 300)}` : ''}`)

      const raw = await o.store.get(resultKey, signal)
      if (!raw) throw new EngineError('transient', `the remote render (${o.starter.id}) ended without a result`)
      const parsed = RenderResult.safeParse(JSON.parse(new TextDecoder().decode(raw)))
      if (!parsed.success) throw new EngineError('transient', `the remote render (${o.starter.id}) wrote an unexpected result`)
      const r = parsed.data
      if (!r.ok) throw new RemoteNodeError(asCode(r.error.code), r.error.message, r.error.permanent)

      const ownDir = !x.ctx.services.workspace
      const dir = x.ctx.services.workspace ? await x.ctx.services.workspace.scratch(`remote-${x.nodeId}`) : await mkdtemp(path.join(os.tmpdir(), 'atelier-remote-'))
      try {
      await mkdir(dir, { recursive: true })
      const outputs: NodeOutputs = {}
      let n = 0
      for (const [name, out] of Object.entries(r.outputs)) {
        const files: string[] = []
        for (const [i, key] of (out.files ?? []).entries()) {
          const bytes = await o.store.get(key, signal)
          if (!bytes) throw new EngineError('transient', `the remote render (${o.starter.id}) lost an output file`)
          const file = path.join(dir, `${String(n++).padStart(2, '0')}-${safeFileName(out.names?.[i] ?? `${name}-${i}`)}`)
          await writeFile(file, bytes)
          files.push(file)
        }
        outputs[name] = {
          ...(out.files ? { files } : {}),
          ...(out.value !== undefined ? { value: out.value as never } : {}),
          ...(out.meta ? { meta: out.meta as never } : {})
        } as NodeOutputs[string]
      }
      if (r.cost)
        x.ctx.reportCost({
          units: r.cost.units.filter((u) => (ESTIMATE_UNITS as readonly string[]).includes(u.unit)).map((u) => ({ unit: u.unit as EstimateUnit, qty: u.qty })),
          ...(r.cost.provider ? { provider: r.cost.provider } : {})
        })
      return {
        outputs,
        backend: o.starter.id,
        queuedS: ((runningAt ?? ended) - t0) / 1000,
        billedS,
        costEur: renderCostEur(o.starter.id, billedS),
        wallS: (Date.now() - t0) / 1000
      }
      } catch (err) {
        // A folder this backend made itself (no workspace service) belongs to nobody if the download failed.
        if (ownDir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
        throw err
      }
    }
  }
}
