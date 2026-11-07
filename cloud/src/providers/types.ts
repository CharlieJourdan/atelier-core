// The provider interface of §4.6. An adapter implements one or more usages; each usage has a fake of identical shape.
// Real adapters (lots P13/P14) declare the vault secret they need and are only reachable through the registry's
// paidCalls guard.
import type { Usage, UsageInput } from '../../../src/shared/cloud-api.ts'
import type { Measure } from '../pricing.ts'
import type { NewFile } from '../storage.ts'

/** The units a provider with a daily quota of its own has used today (the YouTube Data API). Persisted by the Cloud. */
export interface QuotaMeter {
  used(): number
  add(units: number): void
}

export interface ProviderContext {
  signal: AbortSignal
  progress: (fraction: number, note?: string) => void
  /** Real adapters only: the vault value of their `secretName` (audited). Fakes get a function that throws. */
  secret: () => string
  /** The Cloud job this call serves. */
  jobId: string
  /** An artefact of the job's team: its name and an absolute signed download link. Another team's or an unknown id
   *  throws not_found. */
  artefact: (id: string) => { name: string; url: string }
  /** `artefact(id).url`. */
  artefactUrl: (id: string) => string
  /** The absolute signed URL where a remote executor (RunPod) reports this job's end. */
  callbackUrl: () => string
  /** The provider's own handle of the work started for this Cloud job by an earlier attempt (e.g. a RunPod job id),
   *  stored with the job; null when none. A retry resumes that work instead of starting it again. */
  providerRef: () => string | null
  /** Stores (or clears, with null) that handle at once, before anything else can fail. */
  setProviderRef: (ref: string | null) => void
  /** The daily quota counter of this adapter (jobs always give one; a test or a one-off call may not). */
  quota?: QuotaMeter
  /** Real adapters whose vault entry rotates (an OAuth sign-in whose tokens are refreshed, production-10) write it back here
   *  (encrypted and audited like any vault write). Absent in fakes and tests that do not need it. */
  saveSecret?: (value: string) => void
  /** Raises (a message) or clears (null) this adapter's alert in the founder console: something only the founder can fix. */
  alert?: (message: string | null) => void
}

export interface ProviderOutput {
  files: NewFile[]
  data: Record<string, unknown>
  /** What the provider billed (or, for a fake, what the real one would have billed), in dollars. While the price
   *  multiplier is set (decision 0040), a real job is charged THIS converted at the dated rate × the multiplier, never more
   *  than its hold (production-17); so a real adapter reads it from the provider's own answer whenever it can. */
  costUsd: number
  /** The provider did not say what it billed (`costUsd` is then only a guess): the job is charged as before, `measure`
   *  priced on the grid, else the whole hold. */
  costUnknown?: true
  /** What was really used, in grid items. When given, the job is charged this (priced on its quote's grid, never more
   *  than the hold) instead of the whole quote when the cost cannot be used; the rest of the hold goes back. */
  measure?: Measure
}

/** A failure the jobs module may retry (timeouts, 5xx, rate limits). Anything else fails the job at once. */
export class RetryableProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableProviderError'
  }
}

type Method<U extends Usage> = (input: UsageInput<U>, ctx: ProviderContext) => Promise<ProviderOutput>

export interface ProviderAdapter {
  id: string
  kind: 'fake' | 'real'
  /** The vault entry a real adapter needs (e.g. ELEVENLABS_API_KEY). */
  secretName?: string
  /** A real adapter for a public API that needs no key (Wikimedia Commons): it is live without a vault entry, but still only
   *  behind the paidCalls guard and the configuration, because it still reaches the network. Its `ctx.secret()` is ''. */
  keyless?: boolean
  synthesize?: Method<'synthesize'>
  generateImage?: Method<'generateImage'>
  generateVideo?: Method<'generateVideo'>
  talkingAvatar?: Method<'talkingAvatar'>
  channelData?: Method<'channelData'>
  analyseVideo?: Method<'analyseVideo'>
  submitGpuJob?: Method<'submitGpuJob'>
  searchStock?: Method<'searchStock'>,
  cloneVoice?: Method<'cloneVoice'>
  designVoice?: Method<'designVoice'>
  /** Best-effort stop of work started under `ref` (a job that ended without success, or was cut off by a restart). */
  abandon?: (ref: string) => Promise<void>
}

export function runUsage(adapter: ProviderAdapter, usage: Usage, input: unknown, ctx: ProviderContext): Promise<ProviderOutput> {
  const method = adapter[usage] as ((i: unknown, c: ProviderContext) => Promise<ProviderOutput>) | undefined
  if (!method) throw new Error(`${adapter.id} does not implement ${usage}`)
  return method.call(adapter, input, ctx)
}
