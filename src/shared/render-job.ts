// The remote render job (vps-rendu, decision 0084): how a heavy render node (the film's assembly, the motion frames, Whisper)
// leaves the team VPS for a per-second serverless CPU worker and comes back. Everything goes through links, so the same
// worker image runs on Scaleway Jobs, Modal, RunPod or the local fake without knowing which:
//   1. the sender puts the node's input files and the job JSON in an object store (R2 in production, the fake's folder in
//      tests) and starts the worker with ONE value, the job's GET link (`ATELIER_JOB_URL`);
//   2. the worker (`scripts/render-job.ts`) downloads the inputs, runs the node (the worker protocol, `where: 'local'`),
//      PUTs each output file into one of the job's upload slots, then PUTs the result JSON into the result slot;
//   3. the sender reads the result, downloads the files, and records the seconds the provider billed.
// No provider key and no Cloud token ever reach the worker: only presigned links that expire. Pure types and zod: imported by
// the app, the engine and the Cloud (which loads it with Node's type stripping).
import { z } from 'zod'

// The worker protocol's shapes the job carries (src/shared/worker-protocol.ts, version 1). Restated here because this file is
// loaded by the Cloud without a bundler and by the renderer's typecheck, where a sibling import cannot carry its `.ts`;
// tests/unit/remote-render.test.ts checks both stay the same.
const WireArtefact = z.object({
  type: z.string(),
  fingerprint: z.string(),
  value: z.unknown().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  files: z.array(z.string()).optional(),
  remoteFiles: z.array(z.object({ name: z.string(), url: z.string() })).optional()
})
const WireCost = z.object({ units: z.array(z.object({ unit: z.string(), qty: z.number() })), provider: z.string().optional() })
const WireError = z.object({ code: z.string(), message: z.string(), permanent: z.boolean() })
/** The node of a render job: the worker protocol's job without its folder (the worker chooses it). */
export const RenderNode = z.object({
  v: z.literal(1),
  nodeType: z.string(),
  params: z.unknown(),
  inputs: z.record(z.string(), WireArtefact),
  seed: z.number(),
  where: z.enum(['local', 'cloud', 'gpu']),
  attempt: z.number().int().min(1),
  notes: z.array(z.string()),
  settings: z.object({ minutes: z.number(), budgetMode: z.enum(['qualite_max', 'usage_max']) }),
  fake: z.boolean()
})

export const RENDER_JOB_VERSION = 1

/** Upload slots a job gets for its output files (the render nodes give at most a few dozen). */
export const RENDER_UPLOAD_SLOTS = 64

const Url = z.string().min(1).max(4000)

export const RenderJob = z.object({
  v: z.literal(RENDER_JOB_VERSION),
  id: z.string().min(1).max(100),
  /** The node, as the worker protocol carries it; its input files are `remoteFiles` links. */
  node: RenderNode,
  upload: z.object({
    /** PUT the result JSON here, last. */
    result: Url,
    /** PUT each output file into the next free slot, in order. */
    files: z.array(z.object({ key: z.string().min(1).max(300), url: Url })).max(500)
  })
})
export type RenderJob = z.infer<typeof RenderJob>

export const RenderResult = z.discriminatedUnion('ok', [
  z.object({
    v: z.literal(RENDER_JOB_VERSION),
    ok: z.literal(true),
    /** Each output's files are the slot keys they were written to, in order; `names` their original file names. */
    outputs: z.record(z.string(), z.object({ files: z.array(z.string()).optional(), names: z.array(z.string().max(300)).optional(), value: z.unknown().optional(), meta: z.record(z.string(), z.unknown()).optional() })),
    cost: WireCost.optional(),
    /** The worker's own wall time for the node (download, run, upload). */
    wallS: z.number().min(0)
  }),
  z.object({ v: z.literal(RENDER_JOB_VERSION), ok: z.literal(false), error: WireError, wallS: z.number().min(0) })
])
export type RenderResult = z.infer<typeof RenderResult>

// ---- the providers and their prices -------------------------------------------------------------------------------------------

export const RENDER_BACKENDS = ['scaleway', 'modal', 'runpod', 'fake'] as const
export type RenderBackendId = (typeof RENDER_BACKENDS)[number]

/** One worker size on one provider and what a second of it costs (EUR; dollar prices converted at `USD_EUR`). */
export interface RenderPrice {
  vcpu: number
  memGb: number
  eurPerS: number
  /** Where the price was read (decision 0084's research, 2026-11-03). */
  source: string
}

/** The dated conversion used for dollar prices (2026-11-03, ≈ ECB reference). */
export const USD_EUR = 0.87

/**
 * The worker size of decision 0084 (6 vCPU / 12 GB) on each provider, per second:
 * - Scaleway Serverless Jobs: €0.00001 per vCPU-s + €0.000002 per GB-s (docs-content serverless-jobs FAQ, 2026-11-03);
 * - Modal: $0.0000131 per physical core-s (3 cores = 6 vCPU) + $0.00000222 per GiB-s, ×1.15 for the broad `eu` region (modal_app.py pins region="eu")
 *   (modal.com/pricing, region-selection guide, 2026-11-03);
 * - RunPod CPU serverless: no public per-second price (UNVERIFIED); planned at the Scaleway rate until a first job's bill.
 */
export const RENDER_PRICES: Record<RenderBackendId, RenderPrice> = {
  scaleway: { vcpu: 6, memGb: 12, eurPerS: 6 * 0.00001 + 12 * 0.000002, source: 'Scaleway Serverless Jobs FAQ (2026-11-03)' },
  modal: { vcpu: 6, memGb: 12, eurPerS: (3 * 0.0000131 + 12 * 0.00000222) * 1.15 * USD_EUR, source: 'modal.com/pricing, EU region ×1.15 (2026-11-03)' },
  runpod: { vcpu: 6, memGb: 12, eurPerS: 6 * 0.00001 + 12 * 0.000002, source: 'UNVERIFIED: RunPod publishes no CPU serverless price; Scaleway rate assumed' },
  fake: { vcpu: 6, memGb: 12, eurPerS: 6 * 0.00001 + 12 * 0.000002, source: 'the fake bills at the Scaleway rate' }
}

/** What `billedS` seconds of a worker cost on a provider (EUR, 6 decimals). */
export const renderCostEur = (backend: RenderBackendId, billedS: number): number => Math.round(Math.max(0, billedS) * RENDER_PRICES[backend].eurPerS * 1e6) / 1e6

/** The vault entries each provider needs (`npm run cloud -- vault set NAME`); without them its adapter is never called. */
export const RENDER_SECRETS: Record<Exclude<RenderBackendId, 'fake'>, readonly string[]> = {
  scaleway: ['SCALEWAY_SECRET_KEY', 'SCALEWAY_JOB_DEFINITION_ID'],
  modal: ['MODAL_RENDER_URL', 'MODAL_PROXY_KEY', 'MODAL_PROXY_SECRET'],
  runpod: ['RUNPOD_API_KEY', 'RUNPOD_RENDER_ENDPOINT_ID']
}

// ---- the two halves a backend is made of ---------------------------------------------------------------------------------------

export type RenderRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** A provider's run of one job, as its adapter reads it. */
export interface RenderRunStatus {
  state: RenderRunState
  /** Seconds the provider bills for this run (its own figure when it gives one), once it ended. */
  billedS?: number
  error?: string
}

/** Starts the worker image on one provider with the job's link (Scaleway Jobs, Modal, RunPod, the fake). */
export interface RenderStarter {
  id: RenderBackendId
  /** Starts one run; resolves with the provider's handle of it. `timeoutS`: the provider stops the run past it. */
  start(jobUrl: string, o: { jobId: string; timeoutS: number; signal: AbortSignal }): Promise<string>
  status(ref: string, signal: AbortSignal): Promise<RenderRunStatus>
  /** Best effort. */
  cancel(ref: string): Promise<void>
}

/** Where a job's files live while it runs (R2 through presigned links in production, the fake's folder in tests). */
export interface RenderJobStore {
  /** Stores bytes under `key`; resolves with a GET link the worker can follow. */
  put(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<string>
  /** A link the worker PUTs to, and the GET link of the same key. */
  slot(key: string): { putUrl: string; getUrl: string }
  /** Reads what the worker wrote under `key` (null while nothing is there). */
  get(key: string, signal: AbortSignal): Promise<Uint8Array | null>
}
