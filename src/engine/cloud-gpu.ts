// The `gpu` executor (PLAN-V2-PRODUCTION §1.5, §4.7; lot P5): the whole node is sent to Atelier Cloud as one
// `submitGpuJob` job, which the Cloud hands to RunPod (in v2 its fake RunPod, which runs our worker on the Cloud's
// machine). Steps of one attempt:
//   1. the input files go up to the team's storage (`GET /v1/uploads/:sha256` first: a file already there is not sent
//      again);
//   2. quote + job with the node run's idempotency key (cloud-http.ts: a retry or a resumed run replays the same job, so
//      a crash never pays twice); the Cloud holds the quoted credits and, on success, captures what the GPU really used;
//   3. wait (a cancel reaches the Cloud, which cancels the RunPod job), then download the outputs and rebuild the node's
//      outputs from the job's result (GpuJobResult).
// No provider key and no RunPod address ever reach this side: only the Cloud's contract.
import path from 'node:path'
import { GpuJobResult, type GpuNodePayload } from '../shared/worker-protocol'
import type { NodeOutputs } from './artefacts'
import { cloudJobRunner, type CloudHttpOptions } from './cloud-http'
import { EngineError } from './errors'
import type { NodeExecution, NodeExecutor } from './executor'
import { need } from './services'
import type { Json } from './types'

export interface GpuExecutorOptions extends CloudHttpOptions {
  /** Which worker image runs the node (`render` by default). */
  worker?: 'render' | 'gpu-video'
}

export function cloudGpuExecutor(o: GpuExecutorOptions): NodeExecutor {
  const { runJob, upload } = cloudJobRunner(o)

  return {
    async run(x: NodeExecution): Promise<NodeOutputs> {
      const signal = x.ctx.signal
      const inputs: GpuNodePayload['inputs'] = {}
      for (const [port, a] of Object.entries(x.inputs)) {
        const artefactIds: string[] = []
        for (const f of a.files ?? []) artefactIds.push(await upload(f, signal))
        inputs[port] = {
          type: a.type,
          fingerprint: a.fingerprint,
          ...(a.value !== undefined ? { value: a.value } : {}),
          ...(a.meta ? { meta: a.meta } : {}),
          ...(a.files ? { artefactIds } : {})
        }
      }
      x.ctx.emit({ kind: 'progress', frac: 0.05, text: 'fichiers envoyés au Cloud' })
      const payload: GpuNodePayload = {
        nodeType: x.def.type,
        params: x.params,
        inputs,
        seed: x.ctx.seed,
        attempt: x.ctx.attempt,
        notes: x.ctx.notes,
        settings: x.settings,
        fake: x.useFake
      }
      // what the Cloud holds before the job starts: the node's own estimate in GPU seconds (at least its duration)
      const est = x.def.estimate(
        {
          where: 'gpu',
          budgetMode: x.settings.budgetMode,
          minutes: x.settings.minutes,
          inputs: Object.fromEntries(Object.entries(x.inputs).map(([p, a]) => [p, { type: a.type, meta: a.meta }]))
        },
        x.params
      )
      const gpuS = est.units.find((u) => u.unit === 'gpu_s')?.qty ?? est.durationS
      const dir = await need(x.ctx, 'workspace').scratch(`gpu-${x.nodeId}`)
      const { job, files } = await runJob(
        'submitGpuJob',
        { worker: o.worker ?? 'render', payload, estimatedGpuSeconds: Math.min(36_000, Math.max(1, Math.ceil(gpuS))) },
        { idempotencyKey: x.idempotencyKey, signal, dir, onProgress: (f) => x.ctx.emit({ kind: 'progress', frac: 0.1 + 0.8 * f }) }
      )
      const result = GpuJobResult.safeParse(job.result)
      if (!result.success) throw new EngineError('internal', 'the GPU job returned no node outputs')
      const byName = new Map(files.map((f) => [path.basename(f), f]))
      const outputs: NodeOutputs = {}
      for (const [name, out] of Object.entries(result.data.outputs)) {
        const local = (out.files ?? []).map((n) => {
          const f = byName.get(n.replace(/[^\w.-]/g, '_'))
          if (!f) throw new EngineError('internal', `the GPU job lost the file ${n}`)
          return f
        })
        outputs[name] = {
          ...(out.files ? { files: local } : {}),
          ...(out.value !== undefined ? { value: out.value as Json } : {}),
          ...(out.meta ? { meta: out.meta as Record<string, Json> } : {})
        }
      }
      const gpuSeconds = result.data.gpuSeconds
      if (result.data.cost) x.ctx.reportCost(result.data.cost as Parameters<typeof x.ctx.reportCost>[0])
      else if (gpuSeconds !== undefined) x.ctx.reportCost({ units: [{ unit: 'gpu_s', qty: gpuSeconds }], provider: 'gpu' })
      return outputs
    }
  }
}
