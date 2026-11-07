// The remote render executor (vps-rendu, decision 0084): the heavy render nodes of a run (the film's assembly, the motion
// frames, Whisper) leave the team VPS for per-second serverless workers, and the VPS renders them itself when every remote
// fails, so production never blocks. It wraps the host's `local` executor (the same placement, `where: 'local'`): any other
// node goes straight to it.
//   - backends are tried in order (Scaleway, Modal, RunPod…); one that fails, times out or is down passes to the next;
//   - at most `maxRemote` remote jobs in flight from this VPS, the rest wait their turn (the queue is recorded);
//   - at most `maxLocal` heavy renders on the VPS at once (a 4 vCPU / 8 GB box holds one render beside the agents);
//   - a node error the worker calls permanent (bad input) is not retried elsewhere: it would fail the same way;
//   - each job is recorded (backend, seconds queued and billed, cost) through `onJob`.
// A cancel stops the remote run (the backend cancels it) and never falls back.
import os from 'node:os'
import type { RenderBackendId } from '../../shared/render-job'
import { AbortError, toEngineError } from '../errors'
import type { NodeExecution, NodeExecutor } from '../executor'
import { RemoteNodeError, type RenderBackend } from './backend'

/** The node types that render (by name, any major version). */
export const REMOTE_RENDER_NODES: readonly string[] = ['render.assemble', 'motion.render', 'words.align']

/** One heavy render, wherever it ran. */
export interface RenderJobRecord {
  runId: string
  nodeId: string
  nodeType: string
  /** Where it was made in the end; `local` = the VPS itself. */
  backend: RenderBackendId | 'local'
  ok: boolean
  /** Waiting for a remote slot here, plus the provider's own queue. */
  queuedS: number
  billedS: number
  costEur: number
  wallS: number
  /** The remotes that failed before, with why. */
  failed: { backend: RenderBackendId; error: string }[]
  error?: string
}

export interface RemoteRenderOptions {
  backends: RenderBackend[]
  nodeTypes?: readonly string[]
  maxRemote?: number
  maxLocal?: number
  /** Seconds a remote run may take (the provider stops it past this). Default: 10 min + 10 min per minute of film. */
  timeoutS?: (x: NodeExecution) => number
  onJob?: (r: RenderJobRecord) => void
}

/** A counting semaphore whose waiters leave on abort. */
export class Slots {
  private used = 0
  private readonly waiting: { go: () => void; signal: AbortSignal }[] = []
  readonly size: number
  constructor(size: number) {
    this.size = size
  }
  get inUse(): number {
    return this.used
  }
  get queued(): number {
    return this.waiting.length
  }
  async take(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw new AbortError()
    if (this.used < this.size) {
      this.used++
      return this.releaser()
    }
    await new Promise<void>((resolve, reject) => {
      const w = {
        signal,
        go: () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
      }
      const onAbort = (): void => {
        const i = this.waiting.indexOf(w)
        if (i >= 0) this.waiting.splice(i, 1)
        reject(new AbortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiting.push(w)
    })
    this.used++
    return this.releaser()
  }
  private releaser(): () => void {
    let done = false
    return () => {
      if (done) return
      done = true
      this.used--
      const next = this.waiting.shift()
      next?.go()
    }
  }
}

const typeName = (t: string): string => t.replace(/@\d+$/, '')

/**
 * Heavy renders a machine holds at once by its memory (vps-rendu, measured): one render takes 2-7 GB with its Chromium pages
 * and ffmpeg, and the brain with its agents 1-2 GB. A 4 vCPU / 8 GB VPS rendering 10 productions unqueued had 14 processes
 * killed for memory and lost 3 films; queued one at a time it lost none (research note vps-rendu-2026-11 (old repository)).
 */
export const defaultLocalRenders = (totalMemBytes: number): number => Math.min(4, Math.max(1, Math.floor((totalMemBytes / 2 ** 30 - 2) / 6)))

/** The memory this process may use: the container's limit when it runs in one (a VPS box), else the machine's. */
export function usableMemoryBytes(): number {
  const total = os.totalmem()
  const limit = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0
  return limit > 0 && limit < total ? limit : total
}

/** One VPS's renderer: its queues are shared by every run it wraps. */
export interface RemoteRenderer {
  wrap(local: NodeExecutor): NodeExecutor
  readonly remote: Slots
  readonly onVps: Slots
}

export const remoteRenderExecutor = (local: NodeExecutor, o: RemoteRenderOptions): NodeExecutor => createRemoteRenderer(o).wrap(local)

export function createRemoteRenderer(o: RemoteRenderOptions): RemoteRenderer {
  const types = new Set(o.nodeTypes ?? REMOTE_RENDER_NODES)
  const remote = new Slots(Math.max(1, o.maxRemote ?? 10))
  const onVps = new Slots(Math.max(1, o.maxLocal ?? 1))
  const timeoutOf = o.timeoutS ?? ((x: NodeExecution) => Math.round(600 + 600 * Math.max(0.25, x.settings.minutes)))

  const wrap = (local: NodeExecutor): NodeExecutor => ({
    async run(x) {
      if (!types.has(typeName(x.def.type))) return local.run(x)
      const signal = x.ctx.signal
      const t0 = Date.now()
      const failed: RenderJobRecord['failed'] = []
      const base = { runId: x.runId, nodeId: x.nodeId, nodeType: x.def.type }
      if (o.backends.length > 0) {
        const release = await remote.take(signal)
        const waitedS = (Date.now() - t0) / 1000
        try {
          for (const b of o.backends) {
            try {
              const r = await b.run(x, { timeoutS: timeoutOf(x), signal })
              o.onJob?.({ ...base, backend: b.id, ok: true, queuedS: waitedS + r.queuedS, billedS: r.billedS, costEur: r.costEur, wallS: (Date.now() - t0) / 1000, failed })
              return r.outputs
            } catch (e) {
              if (signal.aborted || e instanceof AbortError) throw e
              const err = toEngineError(e)
              // the node itself refused its input: the same input fails the same way anywhere (a provider's own failure never is)
              if (e instanceof RemoteNodeError && err.permanent) {
                o.onJob?.({ ...base, backend: b.id, ok: false, queuedS: waitedS, billedS: 0, costEur: 0, wallS: (Date.now() - t0) / 1000, failed, error: err.message })
                throw err
              }
              failed.push({ backend: b.id, error: err.message.slice(0, 300) })
              x.ctx.emit({ kind: 'log', level: 'warn', text: `Rendu à distance indisponible (${b.id}) : ${err.message.slice(0, 200)}` })
            }
          }
        } finally {
          release()
        }
        x.ctx.emit({ kind: 'log', level: 'warn', text: 'Rendu à distance indisponible : le rendu se fait sur l’ordinateur d’équipe.' })
      }
      // the VPS renders it itself, one heavy render at a time
      const release = await onVps.take(signal)
      const queuedS = (Date.now() - t0) / 1000
      try {
        const out = await local.run(x)
        o.onJob?.({ ...base, backend: 'local', ok: true, queuedS, billedS: 0, costEur: 0, wallS: (Date.now() - t0) / 1000, failed })
        return out
      } catch (e) {
        if (!(signal.aborted || e instanceof AbortError)) o.onJob?.({ ...base, backend: 'local', ok: false, queuedS, billedS: 0, costEur: 0, wallS: (Date.now() - t0) / 1000, failed, error: toEngineError(e).message })
        throw e
      } finally {
        release()
      }
    }
  })
  return { wrap, remote, onVps }
}
