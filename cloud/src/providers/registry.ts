// Which adapter serves a usage, and the paidCalls guard (§4.10, §4.11). A real adapter is used only when ALL hold:
//   1. the Cloud's configuration says paidCalls: on (off by default);
//   2. the process is not a test run (VITEST, NODE_ENV=test or ATELIER_CLOUD_TEST=1 never reach a real adapter);
//   3. a real adapter exists for the usage and the Cloud's configuration picks it for that usage (`select`, from
//      config.json "providers": a usage left on "fake" stays a demo whatever is in the vault);
//   4. its vault secret is set.
// Otherwise the usage is served by its fake and shown as demo. The guard is checked again at call time, so a real
// adapter handed out before a configuration change still cannot run.
// A job whose input names an engine (`engine: "voice:fish-s2"`, decision 0029) is served by the real adapter whose id IS that
// engine id, under the same four conditions, where condition 3 reads: the configuration lists the engine in `realEngines`.
import { USAGES, type Usage } from '../../../src/shared/cloud-api.ts'
import type { Vault } from '../vault.ts'
import { FAKE_ADAPTERS } from './fakes.ts'
import type { ProviderAdapter } from './types.ts'

/** Real adapters registered by default. None: the Cloud builds its own from the configuration (providers/real.ts). */
export const REAL_ADAPTERS: readonly ProviderAdapter[] = []

export interface Resolved {
  adapter: ProviderAdapter
  status: 'real' | 'demo'
  reason: string | null
}

export function isTestRun(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.VITEST) || env.NODE_ENV === 'test' || env.ATELIER_CLOUD_TEST === '1'
}

export class PaidCallBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaidCallBlocked'
  }
}

export interface RegistryOptions {
  paidCalls: boolean
  vault: Vault
  real?: readonly ProviderAdapter[]
  /** Usage → the id of the adapter the configuration picks ('fake' or a missing usage = the demo). Without `select` at all
   *  (tests), the first real adapter that implements the usage is used. */
  select?: Partial<Record<Usage, string>>
  fakes?: Partial<Record<Usage, ProviderAdapter>>
  /** Engine ids whose real adapter may serve (config.json `realEngines`); any other named engine is a demo. */
  engines?: readonly string[]
  env?: NodeJS.ProcessEnv
}

/** The engine an input names, if any. */
export function engineOf(input: unknown): string | null {
  const e = typeof input === 'object' && input !== null ? (input as { engine?: unknown }).engine : undefined
  return typeof e === 'string' ? e : null
}

export class ProviderRegistry {
  private readonly opts: RegistryOptions
  private readonly env: NodeJS.ProcessEnv
  constructor(opts: RegistryOptions) {
    this.opts = opts
    this.env = opts.env ?? process.env
  }

  get paidCalls(): boolean {
    return this.opts.paidCalls
  }

  /** The engines config.json lists in `realEngines` (whether each is served also needs its key and paidCalls on). */
  enabledEngines(): string[] {
    return [...(this.opts.engines ?? [])]
  }

  fake(usage: Usage): ProviderAdapter {
    return this.opts.fakes?.[usage] ?? FAKE_ADAPTERS[usage]
  }

  resolve(usage: Usage): Resolved {
    return this.pick(usage, this.opts.select ? (this.opts.select[usage] ?? 'fake') : null)
  }

  /** Who serves this input: its engine's adapter when it names one (else the usage's configured provider). */
  resolveFor(usage: Usage, input: unknown): Resolved {
    const engine = engineOf(input)
    if (engine === null) return this.resolve(usage)
    if (!(this.opts.engines ?? []).includes(engine)) {
      return { adapter: this.fake(usage), status: 'demo', reason: `the engine ${engine} is not enabled (realEngines)` }
    }
    return this.pick(usage, engine)
  }

  /** Who can serve this usage now: its configured provider when real, else the first enabled engine of it that is real
   *  (issue #88: jobs naming that engine run on its real adapter, so the catalog must not say demo). */
  served(usage: Usage): Resolved {
    const plain = this.resolve(usage)
    if (plain.status === 'real') return plain
    for (const engine of this.opts.engines ?? []) {
      const r = this.resolveFor(usage, { engine })
      if (r.status === 'real' && typeof r.adapter[usage] === 'function') return r
    }
    return plain
  }

  private pick(usage: Usage, picked: string | null): Resolved {
    const fake = this.fake(usage)
    const real = (this.opts.real ?? REAL_ADAPTERS).find(
      (a) => a.kind === 'real' && typeof a[usage] === 'function' && (picked === null || a.id === picked)
    )
    const demo = (reason: string): Resolved => ({ adapter: fake, status: 'demo', reason })
    if (!this.opts.paidCalls) return demo('paidCalls is off')
    if (isTestRun(this.env)) return demo('tests never reach a real adapter')
    if (picked === 'fake') return demo('this usage is set to the fake provider')
    if (!real) return demo(picked === null ? 'no real adapter in this version' : `no real adapter ${picked} for this usage`)
    if (!real.keyless && (!real.secretName || !this.opts.vault.available || !this.opts.vault.has(real.secretName))) {
      return demo(`the platform key is not in the vault`)
    }
    return { adapter: real, status: 'real', reason: null }
  }

  /** What each usage resolves to now (for the start-up line and `providers status`). */
  overview(): { usage: Usage; provider: string; status: 'real' | 'demo'; reason: string | null; wanted: string | null }[] {
    return USAGES.map((usage) => {
      const r = this.resolve(usage)
      const picked = this.opts.select?.[usage]
      return { usage, provider: r.adapter.id, status: r.status, reason: r.reason, wanted: picked && picked !== 'fake' ? picked : null }
    })
  }

  /** Called right before an adapter runs: a real adapter must still pass the guard. */
  assertCallable(adapter: ProviderAdapter): void {
    if (adapter.kind !== 'real') return
    if (!this.opts.paidCalls) throw new PaidCallBlocked(`${adapter.id}: paidCalls is off`)
    if (isTestRun(this.env)) throw new PaidCallBlocked(`${adapter.id}: a test run never calls a real adapter`)
  }
}
