// The scheduler (docs/ENGINE-SPEC.md §6, §7, §10, §11): runs a valid pipeline. A node starts as soon as its inputs
// are available (upstream finished and, when gated, approved); independent nodes run in parallel within the
// concurrency limits. A node whose fingerprint is stored is reused (`cached`). Transient errors are retried with a
// growing wait; cancel aborts the running nodes and keeps finished results in the store. Gated nodes pause their
// branch until the user approves, asks for a change (new fingerprint, rerun) or replaces the output.
import { randomUUID } from 'node:crypto'
import type { Artefact, NodeOutputs } from './artefacts'
import { compositeFingerprint } from './canonical'
import {
  AbortError,
  DEFAULT_RETRY,
  EngineError,
  backoffMs,
  systemClock,
  toEngineError,
  type Clock,
  type RetryPolicy
} from './errors'
import type { Reservation, Spender } from './estimate'
import { inProcessExecutor, type Executors } from './executor'
import { RunEvents, globalProgress, type Listener } from './events'
import { AttemptWatch, DEFAULT_LIMITS, DEFAULT_WATCH, Slots, poolOf, withGrace, type Limits, type WatchLimits } from './limits'
import { replacementRun, runArtefacts } from './outputs'
import {
  effectiveRun,
  inputFingerprint,
  nodeRunFingerprint,
  parseNodeParams,
  resolveExecutor,
  resolveNodeParams,
  type LaunchInputs
} from './plan'
import { createRunCtx, type EstimateCtx, type ResolvedInputs, type RunSettings } from './registry'
import type { EngineServices } from './services'
import { MemoryNodeStateStore, type NodeStateStore } from './state'
import type { ArtefactStore, StoredRun } from './store'
import type { BudgetMode, Cost, Estimate, Executor, GateMode, NodeState, RunStatus } from './types'
import type { ResolvedNode, ResolvedPipeline } from './validate'

export interface StartRunOptions {
  plan: ResolvedPipeline
  store: ArtefactStore
  state?: NodeStateStore
  runId?: string
  /** Gate decisions are shared by every run of one scope (a video). Default: the run id. */
  scope?: string
  inputs?: LaunchInputs
  style?: Record<string, unknown>
  budgetMode?: BudgetMode
  gateMode?: GateMode
  minutes?: number
  /** Per-node seed (R7.5: a new seed regenerates that node and its dependents). Default 0. */
  seeds?: Record<string, number>
  limits?: Partial<Limits>
  retry?: Partial<RetryPolicy>
  clock?: Clock
  random?: () => number
  /** Run each node's `fake` instead of `run` (tests, demo mode, R1.6). */
  useFakes?: boolean
  spender?: Spender
  onEvent?: Listener
  /** How long a cancelled node may take to stop before the run stops waiting for it (decision: 10 s). */
  cancelGraceMs?: number
  /** The node watchdog (solidite): a node quiet or long past these limits is stopped and retried, then fails `stalled`. */
  watch?: Partial<WatchLimits>
  /** Host services handed to every node (ENGINE-SPEC §15.7); a node that needs a missing one fails clearly. */
  services?: EngineServices
  /** How each placement runs a node (lot P5: local worker, Cloud, RunPod); default: in this process. */
  executors?: Executors
}

export interface RunResult {
  status: RunStatus
  states: Record<string, NodeState>
}

export interface Run {
  readonly runId: string
  readonly events: RunEvents
  /** Settles when nothing can progress any more (all finished, failed branches blocked, or cancelled). */
  readonly done: Promise<RunResult>
  /** Resolves once nothing is preparing, queued or running (gates may be waiting). */
  idle(): Promise<void>
  state(nodeId: string): NodeState
  /** Global progress 0..1 weighted by estimated durations (R8.4). */
  progress(): number
  approve(nodeId: string): void
  requestChange(nodeId: string, note: string): void
  /** The user's version becomes the node's output (R11.3); unlisted outputs keep the node's. Type-checked. */
  replaceOutput(nodeId: string, outputs: NodeOutputs): Promise<void>
  cancel(): void
}

type Decision = { kind: 'approve' } | { kind: 'change'; note: string } | { kind: 'replace'; outputs: NodeOutputs; run: StoredRun }

export function startRun(opts: StartRunOptions): Run {
  const { plan, store } = opts
  const runId = opts.runId ?? randomUUID()
  const scope = opts.scope ?? runId
  const stateStore = opts.state ?? new MemoryNodeStateStore()
  const inputs = opts.inputs ?? {}
  const style = opts.style ?? {}
  const budgetMode = opts.budgetMode ?? plan.pipeline.budget.default
  const gateMode = opts.gateMode ?? 'step'
  const minutes = opts.minutes ?? plan.pipeline.format.minutes.default
  const runSettings: RunSettings = { minutes, budgetMode }
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const retry: RetryPolicy = { ...DEFAULT_RETRY, ...opts.retry }
  const clock = opts.clock ?? systemClock
  const random = opts.random ?? Math.random
  const grace = opts.cancelGraceMs ?? 10_000
  const watchLimits: WatchLimits = { ...DEFAULT_WATCH, ...opts.watch }
  // a required pipeline input blocks the launch; a suggested one never does (R5.9)
  const missing = plan.pipeline.inputs.filter((i) => i.required && inputs[i.id] === undefined).map((i) => i.id)
  if (missing.length > 0) throw new EngineError('missing_input', `Il manque des entrées obligatoires : ${missing.join(', ')}.`)
  const events = new RunEvents(runId)
  if (opts.onEvent) events.on(opts.onEvent)
  const abort = new AbortController()

  const states = new Map<string, NodeState>()
  const results = new Map<string, Record<string, Artefact>>()
  const fracs = new Map<string, number>()
  const weights = new Map<string, number>()
  const attempts = new Map<string, number>()
  /** Nodes parked at a gate: how to resume them, and the result the user is looking at. */
  const gates = new Map<string, { decide: (d: Decision) => void; run: StoredRun }>()
  const slots = new Slots(limits)
  let inflight = 0
  let idleWaiters: (() => void)[] = []
  let finished = false
  let resolveDone!: (r: RunResult) => void
  const done = new Promise<RunResult>((r) => (resolveDone = r))

  const setState = (nodeId: string, state: NodeState, extra: { fingerprint?: string; error?: EngineError } = {}): void => {
    states.set(nodeId, state)
    const prev = stateStore.get(runId, nodeId)
    stateStore.put({
      runId,
      nodeId,
      state,
      fingerprint: extra.fingerprint ?? prev?.fingerprint,
      attempts: attempts.get(nodeId) ?? 0,
      error: extra.error ? { code: extra.error.code, message: extra.error.message, permanent: extra.error.permanent } : prev?.error,
      updatedAt: clock.now()
    })
    events.emit({ kind: 'state', nodeId, state })
  }
  for (const id of plan.order) setState(id, 'pending')
  // first weights for global progress (R8.4), refined with the real inputs when each node starts
  for (const id of plan.order) {
    const rn = plan.nodes.get(id) as ResolvedNode
    try {
      const p = parseNodeParams(rn.def, resolveNodeParams(rn, budgetMode, inputs, style))
      weights.set(id, rn.def.estimate({ where: rn.def.executors[0] as Executor, budgetMode, minutes, inputs: {} }, p).durationS)
    } catch {
      weights.set(id, 1) // its params fail: the node reports the error when it is reached
    }
  }

  // a node may flag its own result for review (`meta.needsReview === true`, e.g. a failed quality check): it then stops the
  // run at a review gate in any gate mode, once, until the user approves that result
  const flagged = (run: StoredRun): boolean => Object.values(run.outputs).some((a) => a.meta?.needsReview === true)
  const gateActive = (rn: ResolvedNode, run: StoredRun): boolean => rn.gate === 'owner' || (rn.gate === 'review' && gateMode === 'step') || flagged(run)
  const known = (): Map<string, Record<string, string>> =>
    new Map([...results].map(([id, outs]) => [id, Object.fromEntries(Object.entries(outs).map(([o, a]) => [o, a.fingerprint]))]))

  const enter = (): void => {
    inflight++
  }
  const leave = (): void => {
    inflight--
    if (inflight === 0) {
      const ws = idleWaiters
      idleWaiters = []
      for (const w of ws) w()
    }
  }

  const finishIfStuck = (): void => {
    if (finished || inflight > 0 || gates.size > 0) return
    if (plan.order.some((id) => states.get(id) === 'pending' && ready(id))) return
    finished = true
    const all = [...states.values()]
    const status: RunStatus = abort.signal.aborted ? 'cancelled' : all.some((s) => s === 'error') ? 'error' : 'done'
    events.emit({ kind: 'run', status })
    resolveDone({ status, states: Object.fromEntries(states) })
  }

  const ready = (id: string): boolean => {
    const rn = plan.nodes.get(id) as ResolvedNode
    return rn.deps.every((d) => results.has(d) && (states.get(d) === 'done' || states.get(d) === 'cached'))
  }

  const pump = (): void => {
    if (finished) return
    if (!abort.signal.aborted) {
      for (const id of plan.order) {
        if (states.get(id) === 'pending' && ready(id)) {
          setState(id, 'queued')
          enter()
          void launch(id).finally(() => {
            pump() // launch what this node unblocked before it stops counting as in flight (idle() must not resolve early)
            leave()
            finishIfStuck()
          })
        }
      }
    }
    finishIfStuck()
  }

  const fail = (id: string, e: EngineError): void => {
    setState(id, 'error', { error: e })
    events.emit({ kind: 'error', nodeId: id, permanent: e.permanent, message: e.message, code: e.code })
  }
  const cancelled = (id: string): void => {
    if (events.isClosed(id)) return
    setState(id, 'cancelled')
    events.emit({ kind: 'cancelled', nodeId: id })
  }

  /** Metadata of what is wired to each port, for estimates (the same view `estimatePipeline` has, R2.4). */
  const estimateInputs = (given: ResolvedInputs): EstimateCtx['inputs'] =>
    Object.fromEntries(Object.entries(given).map(([port, a]) => [port, { type: a.type, meta: a.meta }]))

  /** One node, from queued to a terminal event. */
  async function launch(id: string): Promise<void> {
    const rn = plan.nodes.get(id) as ResolvedNode
    let opened = false
    try {
      for (;;) {
        if (abort.signal.aborted) throw new AbortError()
        // resolve params and fingerprint (again after a change request: the notes enter the fingerprint)
        const params = parseNodeParams(rn.def, resolveNodeParams(rn, budgetMode, inputs, style))
        const inputsOf = resolvedInputs(rn)
        const ectx = (where: Executor): EstimateCtx => ({ where, budgetMode, minutes, inputs: estimateInputs(inputsOf) })
        const where = resolveExecutor(rn.def, rn.node.where, budgetMode, (w) => rn.def.estimate(ectx(w), params))
        const estimate = rn.def.estimate(ectx(where), params)
        weights.set(id, estimate.durationS)
        const notes = stateStore.notes(scope, id)
        const fp = nodeRunFingerprint(rn, params, known(), inputs, opts.seeds?.[id] ?? 0, notes, {
          run: runSettings,
          fake: opts.useFakes === true
        })
        if (!fp) throw new EngineError('internal', `inputs of ${id} are not available`)
        let run = await effectiveRun(store, stateStore, scope, id, fp)
        if (abort.signal.aborted) throw new AbortError() // cancelled while looking in the store
        let cost: Cost | undefined
        const fromCache = run !== null
        let replaced = false
        if (run) {
          if (!opened) events.emit({ kind: 'cached', nodeId: id, fingerprint: run.fingerprint })
          opened = true
          setState(id, 'cached', { fingerprint: run.fingerprint })
        } else {
          const r = await execute(rn, id, fp, params, where, estimate, opened, inputsOf)
          opened = true
          run = r.run
          cost = r.cost
          // a cancel that lands once the node has finished: its result stays stored (R10.4), the node is cancelled
          if (abort.signal.aborted) throw new AbortError()
        }
        results.set(id, run.outputs)
        if (gateActive(rn, run) && !stateStore.isApproved(scope, id, run.fingerprint)) {
          const decision = await waitGate(rn, id, run)
          if (decision.kind === 'change') {
            stateStore.addNote(scope, id, decision.note)
            results.delete(id)
            attempts.set(id, 0)
            events.emit({ kind: 'retry', nodeId: id, attempt: 1, delayMs: 0, code: 'change_requested' })
            setState(id, 'queued')
            continue
          }
          if (decision.kind === 'replace') {
            replaced = true
            run = await replace(id, run, decision.run, decision.outputs)
            if (abort.signal.aborted) throw new AbortError()
          }
          stateStore.setApproved(scope, id, run.fingerprint)
        }
        fracs.set(id, 1)
        // a reused result stays `cached` even after its gate; a fresh run or a replacement made now is `done`
        setState(id, fromCache && !replaced ? 'cached' : 'done', { fingerprint: run.fingerprint })
        events.emit({ kind: 'done', nodeId: id, fingerprint: run.fingerprint, ...(cost ? { cost } : {}) })
        return
      }
    } catch (e) {
      results.delete(id)
      if (abort.signal.aborted || e instanceof AbortError) cancelled(id)
      else fail(id, toEngineError(e))
    }
  }

  /**
   * Reserve (paid nodes), take a slot, run with retries, then check and store the outputs and settle. Retries reuse
   * the reservation (R10.1); the slot is given back while waiting to retry. Storing and settling happen once, after
   * the node succeeded: a failed settlement never runs a paid node again.
   */
  async function execute(
    rn: ResolvedNode,
    id: string,
    fp: string,
    params: unknown,
    where: Executor,
    estimate: Estimate,
    opened: boolean,
    inputsOf: ResolvedInputs
  ): Promise<{ run: StoredRun; cost?: Cost }> {
    // a paid placement without a wallet is refused (fail closed, R9.3, R12.5), except with fake nodes
    if (where !== 'local' && !opts.spender && !opts.useFakes) {
      throw new EngineError('budget', `${rn.def.type} runs on ${where} and needs credits, but no wallet was given`)
    }
    const pool = poolOf(rn, where)
    await slots.acquire(pool, rn.index)
    let holding = true
    let reservation: Reservation | undefined
    const idempotencyKey = compositeFingerprint('job', { runId, nodeId: id, fingerprint: fp })
    const executor = opts.executors?.[where] ?? inProcessExecutor
    try {
      // a local node that buys items from the Cloud (images inside `visuals.fulfil`) reserves too, so the video's cap
      // and the wallet check hold for it (R12.5); Claude tokens cost no credits
      const buys = !opts.useFakes && estimate.units.some((u) => u.unit !== 'tokens' && u.qty > 0)
      if (opts.spender && (where !== 'local' || buys)) {
        reservation = await opts.spender.reserve({ runId, nodeId: id, fingerprint: fp, idempotencyKey, estimate, where, params })
      }
      if (abort.signal.aborted) throw new AbortError()
      if (!opened) events.emit({ kind: 'start', nodeId: id, at: clock.now() })
      setState(id, 'running', { fingerprint: fp })
      let outputs: NodeOutputs | undefined
      let reported: Cost | undefined
      for (let attempt = 1; outputs === undefined; attempt++) {
        attempts.set(id, attempt)
        reported = undefined
        const span = estimate.durationS * 1000 * watchLimits.factor
        const watch = new AttemptWatch(abort.signal, {
          ...watchLimits,
          quietMs: Math.max(watchLimits.quietMs, span),
          maxMs: Math.max(watchLimits.maxMs, span),
          graceMs: grace,
          label: `${rn.def.type} (${id})`
        })
        // a run-wide setting is readable only when declared, because only then is it in the fingerprint (R7.1)
        const ctx = createRunCtx(rn.def, {
          emit: (r) => {
            if (abort.signal.aborted) return
            watch.touch()
            if (r.kind === 'progress') {
              const sent = events.emit({ kind: 'progress', nodeId: id, frac: r.frac, ...(r.text ? { text: r.text } : {}) })
              if (sent?.kind === 'progress') fracs.set(id, sent.frac)
            } else events.emit({ kind: 'log', nodeId: id, level: r.level, text: r.text })
          },
          signal: watch.signal,
          store,
          seed: opts.seeds?.[id] ?? 0,
          where,
          attempt,
          notes: stateStore.notes(scope, id),
          reportCost: (c) => (reported = c),
          services: opts.services ?? {}
        }, runSettings)
        try {
          const work = executor.run({ runId, nodeId: id, def: rn.def, params, inputs: inputsOf, ctx, settings: runSettings, useFake: opts.useFakes === true, fingerprint: fp, idempotencyKey })
          outputs = await watch.follow(withGrace(work, abort.signal, clock, grace))
        } catch (e) {
          if (abort.signal.aborted) throw new AbortError()
          const err = toEngineError(e)
          if (err.permanent) throw err
          if (attempt > retry.retries) {
            // retries exhausted: the node stops for good (R10.2), so the error is reported as permanent
            throw new EngineError(err.code, `gave up after ${retry.retries} retries: ${err.message}`, true)
          }
          const delayMs = backoffMs(retry, attempt, random)
          events.emit({ kind: 'retry', nodeId: id, attempt: attempt + 1, delayMs, code: err.code })
          fracs.set(id, 0)
          slots.release(pool) // a node only waiting to retry gives its slot to the others
          holding = false
          await clock.sleep(delayMs, abort.signal)
          await slots.acquire(pool, rn.index)
          holding = true
        }
      }
      const run = await storeOutputs(rn, fp, outputs)
      if (reservation) {
        const r = reservation
        reservation = undefined
        await settle(r, reported, id)
      }
      return { run, ...(reported ? { cost: reported } : {}) }
    } finally {
      // a failure or a cancel costs the user nothing (R10.3)
      if (reservation) await reservation.release().catch(() => undefined)
      if (holding) slots.release(pool)
    }
  }

  /** Settles a finished paid node; a transient failure retries the settlement only, never the node. */
  async function settle(r: Reservation, cost: Cost | undefined, id: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await r.settle(cost)
        return
      } catch (e) {
        const err = toEngineError(e)
        if (err.permanent || attempt > retry.retries) {
          // the result is good and kept; the open reservation is reconciled by its idempotency key (R10.6)
          events.emit({ kind: 'log', nodeId: id, level: 'warn', text: `settlement failed (${err.code}): left to reconcile` })
          return
        }
        await clock.sleep(backoffMs(retry, attempt, random))
      }
    }
  }

  function resolvedInputs(rn: ResolvedNode): ResolvedInputs {
    const out: ResolvedInputs = {}
    for (const [port, ref] of Object.entries(rn.node.in ?? {})) {
      const dot = ref.indexOf('.')
      const root = ref.slice(0, dot)
      const name = ref.slice(dot + 1)
      const type = rn.def.inputs[port]?.type
      if (!type) continue
      if (root === '$inputs') {
        const v = inputs[name]
        if (v === undefined) continue
        out[port] = 'files' in v
          ? { type, fingerprint: inputFingerprint(v), files: [...v.files], ...(v.meta ? { meta: v.meta } : {}) }
          : { type, fingerprint: inputFingerprint(v), value: v.value, ...(v.meta ? { meta: v.meta } : {}) }
        continue
      }
      const a = results.get(root)?.[name]
      if (a) out[port] = { ...a, type }
    }
    for (const [port, spec] of Object.entries(rn.def.inputs)) {
      if (spec.required && !out[port]) throw new EngineError('missing_input', `input "${port}" of ${rn.node.id} was not provided`)
    }
    return out
  }

  /** Checks a node's outputs against its declaration (R2.2) and stores them atomically. */
  async function storeOutputs(rn: ResolvedNode, fp: string, outputs: NodeOutputs): Promise<StoredRun> {
    const stored = await store.putRun(runArtefacts(rn.def, fp, outputs))
    for (const [name, a] of Object.entries(stored.outputs)) {
      events.emit({ kind: 'artefact', nodeId: rn.node.id, output: name, fingerprint: a.fingerprint })
    }
    return stored
  }

  function waitGate(rn: ResolvedNode, id: string, run: StoredRun): Promise<Decision> {
    if (abort.signal.aborted) return Promise.reject(new AbortError()) // never park a node once the run is cancelled
    setState(id, 'waiting_gate', { fingerprint: run.fingerprint })
    events.emit({ kind: 'gate', nodeId: id, gate: rn.gate === 'owner' ? 'owner' : 'review', fingerprint: run.fingerprint })
    leave() // a branch parked at a gate is not in flight; independent branches go on (R6.4)
    return new Promise<Decision>((resolve, reject) => {
      const onAbort = (): void => {
        gates.delete(id)
        enter()
        reject(new AbortError())
      }
      abort.signal.addEventListener('abort', onAbort, { once: true })
      gates.set(id, {
        run,
        decide: (d) => {
          abort.signal.removeEventListener('abort', onAbort)
          gates.delete(id)
          enter()
          resolve(d)
        }
      })
      finishIfStuck()
    })
  }

  /** Stores the user's version as a run of its own and remembers it replaces `original` for this scope. */
  async function replace(id: string, original: StoredRun, replacement: StoredRun, given: NodeOutputs): Promise<StoredRun> {
    const stored = await store.putRun(replacement)
    stateStore.setOverride(scope, id, original.fingerprint, stored.fingerprint)
    results.set(id, stored.outputs)
    for (const name of Object.keys(given)) {
      events.emit({ kind: 'artefact', nodeId: id, output: name, fingerprint: (stored.outputs[name] as Artefact).fingerprint })
    }
    return stored
  }

  const decide = (nodeId: string, d: Decision): void => {
    const gate = gates.get(nodeId)
    if (!gate) throw new Error(`node ${nodeId} is not waiting at a gate`)
    gate.decide(d)
  }

  // the first nodes start on the next microtask, so a caller can attach listeners first; idle() waits for that start
  const started = Promise.resolve().then(pump)
  const whenIdle = (): Promise<void> => (inflight === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r)))

  return {
    runId,
    events,
    done,
    idle: () => started.then(whenIdle),
    state: (nodeId) => states.get(nodeId) ?? 'pending',
    progress: () =>
      globalProgress(
        plan.order.map((id) => ({
          weightS: weights.get(id) ?? 1,
          frac: fracs.get(id) ?? 0,
          finished: states.get(id) === 'done' || states.get(id) === 'cached'
        }))
      ),
    approve: (nodeId) => decide(nodeId, { kind: 'approve' }),
    requestChange: (nodeId, note) => decide(nodeId, { kind: 'change', note }),
    replaceOutput: async (nodeId, outputs) => {
      const rn = plan.nodes.get(nodeId)
      const gate = gates.get(nodeId)
      if (!rn || !gate) throw new Error(`node ${nodeId} is not waiting at a gate`)
      // built (type-checked, files hashed) before resuming the node, so a bad replacement fails here, for the caller
      const run = await replacementRun(rn.def, gate.run, outputs)
      decide(nodeId, { kind: 'replace', outputs, run })
      await idleOrDone()
    },
    cancel: () => {
      if (finished || abort.signal.aborted) return
      abort.abort()
      slots.close()
      for (const id of plan.order) if (states.get(id) === 'pending') cancelled(id)
      queueMicrotask(pump)
    }
  }

  function idleOrDone(): Promise<void> {
    return Promise.race([whenIdle(), done.then(() => undefined)])
  }
}
