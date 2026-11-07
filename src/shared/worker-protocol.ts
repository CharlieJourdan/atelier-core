// The worker protocol (PLAN-V2-PRODUCTION §1.5, lot P5): how a host runs ONE engine node in a separate process, the
// "ouvrier". The same child program serves two hosts:
//   - the app's local executor (src/main/production/local-worker.ts): the child runs on this computer, may read the
//     artefact files by path, and asks the parent for Claude and Atelier Cloud calls (`call` lines), so no token or
//     agent runner ever lives in the worker;
//   - Atelier Cloud's RunPod path (cloud/src/runpod/): the pod's child downloads its input files from signed links
//     (`remoteFiles`) and has no parent services.
// Lines are NDJSON. Parent → child on stdin: one `job`, then `reply` lines for the child's calls. Child → parent on
// stdout: lines starting with WORKER_LINE_PREFIX, each written after a newline of its own (anything else a node prints is ignored). Cancel = the parent kills the
// child's whole process tree (taskkill /T /F on Windows, SIGKILL to the process group on macOS): nothing is asked.
// Pure types and zod only: imported by the app, the engine and the Cloud (which loads it with Node's type stripping).
import { z } from 'zod'

export const WORKER_PROTOCOL_VERSION = 1
/** Marks a protocol line on the child's stdout (an ASCII record separator, then a tag). */
export const WORKER_LINE_PREFIX = '\u001eatelier-worker '

const Json = z.unknown()

/** An input artefact as the worker receives it (engine `Artefact`, with remote files for the RunPod path). */
export const WireArtefact = z.object({
  type: z.string(),
  fingerprint: z.string(),
  value: Json.optional(),
  meta: z.record(z.string(), Json).optional(),
  /** Absolute paths on this computer (local executor). */
  files: z.array(z.string()).optional(),
  /** Files to download first, in order (RunPod path: signed links of Atelier Cloud). */
  remoteFiles: z.array(z.object({ name: z.string(), url: z.string() })).optional()
})
export type WireArtefact = z.infer<typeof WireArtefact>

export const WorkerJob = z.object({
  v: z.literal(WORKER_PROTOCOL_VERSION),
  nodeType: z.string(),
  params: Json,
  inputs: z.record(z.string(), WireArtefact),
  seed: z.number(),
  where: z.enum(['local', 'cloud', 'gpu']),
  attempt: z.number().int().min(1),
  notes: z.array(z.string()),
  settings: z.object({ minutes: z.number(), budgetMode: z.enum(['qualite_max', 'usage_max']) }),
  /** Run the node's `fake` (tests, demo mode). */
  fake: z.boolean(),
  /** A folder the child owns for this job: downloads, scratch and output files go under it. */
  outDir: z.string()
})
export type WorkerJob = z.infer<typeof WorkerJob>

export const WireCost = z.object({
  units: z.array(z.object({ unit: z.string(), qty: z.number() })),
  provider: z.string().optional()
})

export const WireOutput = z.object({ files: z.array(z.string()).optional(), value: Json.optional(), meta: z.record(z.string(), Json).optional() })
export type WireOutput = z.infer<typeof WireOutput>

/** A service call the child asks the parent to make (local executor only). */
export const WORKER_CALLS = ['cloud.synthesize', 'cloud.generateImage', 'cloud.generateVideo', 'cloud.talkingAvatar', 'cloud.searchStock', 'claude.ask', 'videos.read'] as const
export type WorkerCallName = (typeof WORKER_CALLS)[number]

export const WireError = z.object({ code: z.string(), message: z.string(), permanent: z.boolean() })
export type WireError = z.infer<typeof WireError>

/** Child → parent. */
export const ChildLine = z.discriminatedUnion('t', [
  z.object({ t: z.literal('progress'), frac: z.number(), text: z.string().optional() }),
  z.object({ t: z.literal('log'), level: z.enum(['info', 'warn']), text: z.string() }),
  z.object({ t: z.literal('cost'), cost: WireCost }),
  z.object({ t: z.literal('call'), id: z.number().int(), name: z.enum(WORKER_CALLS), req: Json, opts: Json.optional() }),
  z.object({ t: z.literal('done'), outputs: z.record(z.string(), WireOutput) }),
  z.object({ t: z.literal('error'), error: WireError })
])
export type ChildLine = z.infer<typeof ChildLine>

/** Parent → child. */
export const ParentLine = z.union([
  z.object({ t: z.literal('job'), job: WorkerJob }),
  z.object({ t: z.literal('reply'), id: z.number().int(), ok: z.literal(true), value: Json }),
  z.object({ t: z.literal('reply'), id: z.number().int(), ok: z.literal(false), error: WireError })
])
export type ParentLine = z.infer<typeof ParentLine>

/**
 * A child line starts with a newline of its own: a node that printed text without a final newline cannot glue it to
 * the protocol line (readers skip the empty lines this makes).
 */
export const encodeChildLine = (l: ChildLine): string => `\n${WORKER_LINE_PREFIX}${JSON.stringify(l)}\n`
export const encodeParentLine = (l: ParentLine): string => `${JSON.stringify(l)}\n`

/**
 * A protocol line of the child's stdout, or null for anything else (a node's own prints). Tolerant: the prefix may
 * follow other text on the same line (an older encoder without the leading newline). JSON escapes the prefix's control
 * character, so the prefix never appears inside the JSON itself.
 */
export function decodeChildLine(line: string): ChildLine | null {
  const at = line.indexOf(WORKER_LINE_PREFIX)
  if (at < 0) return null
  try {
    const parsed = ChildLine.safeParse(JSON.parse(line.slice(at + WORKER_LINE_PREFIX.length)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// ---- the GPU path: what the app sends Atelier Cloud (`submitGpuJob` payload) and what the pod answers ----------------

/** An input of a GPU node as the app sends it: its files are this team's uploaded artefacts (`POST /v1/uploads`). */
export const GpuInput = z.object({
  type: z.string(),
  fingerprint: z.string(),
  value: Json.optional(),
  meta: z.record(z.string(), Json).optional(),
  artefactIds: z.array(z.string().min(1).max(100)).max(500).optional()
})
export const GpuNodePayload = z.object({
  nodeType: z.string().min(3).max(100),
  params: Json,
  inputs: z.record(z.string(), GpuInput),
  seed: z.number(),
  attempt: z.number().int().min(1),
  notes: z.array(z.string()),
  settings: WorkerJob.shape.settings,
  fake: z.boolean()
})
export type GpuNodePayload = z.infer<typeof GpuNodePayload>

/**
 * The `result` of a succeeded `submitGpuJob` Cloud job: the node's outputs, each file named by the job artefact that
 * holds it (download them through `GET /v1/artefacts/:id`), plus what the node reported it used.
 */
export const GpuJobResult = z.object({
  outputs: z.record(z.string(), z.object({ files: z.array(z.string()).optional(), value: Json.optional(), meta: z.record(z.string(), Json).optional() })),
  cost: WireCost.optional(),
  gpuSeconds: z.number().optional()
})
export type GpuJobResult = z.infer<typeof GpuJobResult>
