// Progress events of a run (docs/ENGINE-SPEC.md §8). Every event gets a sequence number; per node the order is
// enforced here rather than trusted (R8.1, R8.2):
// - a node opens with `start`, or with `cached` when its result is reused, and opens at most once;
// - then `progress` / `artefact` / `log` / `retry` / `gate`;
// - then exactly one terminal event: `done`, `error` or `cancelled` (a node may also end with only a terminal event,
//   when it fails or is cancelled before it starts); nothing follows it;
// - `progress.frac` is clamped to [0,1] and never goes back within one attempt (a `retry` starts a new attempt).
// Node reports that break the order (a late progress after cancel…) are dropped; an engine event that breaks it is a
// bug and throws.
import type { EngineEvent, RunEvent } from './types'

export type Listener = (e: EngineEvent) => void

const OPENERS = new Set(['start', 'cached'])
const TERMINALS = new Set(['done', 'error', 'cancelled'])
const REPORTS = new Set(['progress', 'log', 'artefact'])

export class RunEvents {
  private seq = 0
  private readonly phase = new Map<string, 'open' | 'closed'>()
  private readonly lastFrac = new Map<string, number>()
  private readonly listeners = new Set<Listener>()
  private readonly log: EngineEvent[] = []

  readonly runId: string

  constructor(runId: string) {
    this.runId = runId
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Every event emitted so far, in order (tests, and the production operator reading what happened). */
  history(): EngineEvent[] {
    return [...this.log]
  }

  isClosed(nodeId: string): boolean {
    return this.phase.get(nodeId) === 'closed'
  }

  /** Returns the event as delivered, or null when a node report was dropped because it came out of order. */
  emit(event: RunEvent): EngineEvent | null {
    let e = event
    if (e.kind !== 'run' && e.kind !== 'state') {
      const phase = this.phase.get(e.nodeId)
      const report = REPORTS.has(e.kind)
      if (phase === 'closed' || (report && phase !== 'open')) {
        if (report) return null
        throw new Error(`event ${e.kind} for node ${e.nodeId} out of order (phase ${phase ?? 'none'})`)
      }
      if (OPENERS.has(e.kind)) {
        if (phase) throw new Error(`node ${e.nodeId} opened twice`)
        this.phase.set(e.nodeId, 'open')
      } else if (TERMINALS.has(e.kind)) {
        this.phase.set(e.nodeId, 'closed')
      } else if (e.kind === 'retry') {
        this.lastFrac.delete(e.nodeId)
      } else if (e.kind === 'progress') {
        const raw = Number.isFinite(e.frac) ? e.frac : 0
        const frac = Math.max(Math.min(1, Math.max(0, raw)), this.lastFrac.get(e.nodeId) ?? 0)
        this.lastFrac.set(e.nodeId, frac)
        e = { ...e, frac }
      }
      if (!report && !TERMINALS.has(e.kind) && !OPENERS.has(e.kind) && phase !== 'open') {
        throw new Error(`event ${e.kind} for node ${e.nodeId} before it started`)
      }
    }
    const out = { ...e, seq: ++this.seq, runId: this.runId } as EngineEvent
    this.log.push(out)
    for (const l of this.listeners) {
      try {
        l(out)
      } catch {
        // a listener's failure must never break the run
      }
    }
    return out
  }
}

/**
 * Global progress of a run, 0..1 (R8.4): each node weighs its expected duration (the average of past runs of its
 * type, else its estimate). Finished and cached nodes count fully; running nodes by their last progress.
 */
export function globalProgress(nodes: readonly { weightS: number; frac: number; finished: boolean }[]): number {
  let total = 0
  let done = 0
  for (const n of nodes) {
    const w = Math.max(0, Number.isFinite(n.weightS) ? n.weightS : 0)
    total += w
    done += w * (n.finished ? 1 : Math.min(1, Math.max(0, n.frac)))
  }
  if (total === 0) return nodes.length === 0 ? 1 : nodes.filter((n) => n.finished).length / nodes.length
  return done / total
}

/** Expected duration of a node type: the mean of its past durations, else its estimate (R8.4, hypothesis H3). */
export function expectedDurationS(pastS: readonly number[], estimateS: number): number {
  const valid = pastS.filter((d) => Number.isFinite(d) && d >= 0)
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : estimateS
}
