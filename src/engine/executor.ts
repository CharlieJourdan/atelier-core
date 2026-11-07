// Executors (PLAN-V2-PRODUCTION §1.5, lot P5): HOW a node's work is carried out once the scheduler has placed it
// (`where`). The scheduler keeps everything else (reservation, retries, storing, settling); an executor only turns one
// attempt into outputs. Hosts inject one per placement:
//   - local: the app runs the node in its own worker process (src/main/production/local-worker.ts), killed with its
//     whole process tree on cancel;
//   - cloud: the node runs in the host process and its paid items go to Atelier Cloud (quote, job, download);
//   - gpu: the node itself is sent to Atelier Cloud, which hands it to RunPod (cloud-gpu.ts).
// Without an executor for a placement, the node runs in this process (tests, the demo script).
import type { NodeOutputs } from './artefacts'
import type { AnyNodeDef, ResolvedInputs, RunCtx, RunSettings } from './registry'
import type { Executor } from './types'

export interface NodeExecution {
  runId: string
  nodeId: string
  def: AnyNodeDef
  /** Parsed params of the node. */
  params: unknown
  inputs: ResolvedInputs
  ctx: RunCtx
  /** The run-wide settings, for executors that hand the node to another process (inside the node, `ctx` guards them). */
  settings: RunSettings
  /** Run the node's `fake` instead of `run`. */
  useFake: boolean
  /** The node run's fingerprint and its idempotency key (the same on every retry and after a crash, R10.6). */
  fingerprint: string
  idempotencyKey: string
}

export interface NodeExecutor {
  /** One attempt; rejects with an EngineError (transient ones are retried by the scheduler) or an AbortError. */
  run(x: NodeExecution): Promise<NodeOutputs>
}

/** Runs the node in this process. */
export const inProcessExecutor: NodeExecutor = {
  run: (x) => (x.useFake ? x.def.fake(x.ctx, x.inputs, x.params) : x.def.run(x.ctx, x.inputs, x.params))
}

export type Executors = Partial<Record<Executor, NodeExecutor>>
