// The remote render worker's body (vps-rendu, src/shared/render-job.ts): one job, read from its link, run with the worker
// protocol's child IN this process (no parent services: a render node never calls Claude or the Cloud), its output files
// PUT into the job's upload slots, then the result JSON PUT last. A node that fails gives an `ok: false` result (the sender
// reads why); only a job that cannot be read or a result that cannot be written is a failure of the worker itself.
// Used by `scripts/render-job.ts` (the Docker image's entry point) and by the tests, with their own registry.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { RENDER_JOB_VERSION, RenderJob, type RenderResult } from '../../shared/render-job'
import { decodeChildLine, encodeParentLine, type ChildLine } from '../../shared/worker-protocol'
import type { NodeRegistry } from '../registry'
import { runWorkerChild, safeFileName } from '../worker/child'

export interface RenderJobRunOptions {
  registry: NodeRegistry
  /** The job's link (http/https) or a local file. */
  job: string
  dataDir: string
  resourcesDir: string
  /** The job's own folder (downloads, scratch, outputs). */
  workDir: string
  fetchImpl?: typeof fetch
  pathEnv?: string
  /** Each protocol line of the node (progress, logs), for the worker's own log. */
  onLine?: (l: ChildLine) => void
}

async function readJob(where: string, fetchImpl: typeof fetch): Promise<RenderJob> {
  let text: string
  if (/^https?:\/\//.test(where)) {
    const res = await fetchImpl(where, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`the job link answered HTTP ${res.status}`)
    text = await res.text()
  } else text = await readFile(where, 'utf8')
  return RenderJob.parse(JSON.parse(text))
}

async function put(url: string, body: Buffer | string, fetchImpl: typeof fetch, type: string): Promise<void> {
  // a short retry: an object store answers 5xx now and then
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { method: 'PUT', body: typeof body === 'string' ? body : new Uint8Array(body), headers: { 'content-type': type }, signal: AbortSignal.timeout(300_000) }).catch((e: unknown) => {
      if (attempt >= 3) throw e
      return null
    })
    if (res?.ok) {
      await res.body?.cancel()
      return
    }
    await res?.body?.cancel()
    if (attempt >= 3) throw new Error(`an upload answered HTTP ${res?.status ?? 'no answer'}`)
    await new Promise((r) => setTimeout(r, 500 * attempt))
  }
}

/** Runs the job; resolves with the result it wrote. Rejects only when the job cannot be read or the result cannot be written. */
export async function runRenderJob(o: RenderJobRunOptions): Promise<RenderResult> {
  const fetchImpl = o.fetchImpl ?? fetch
  const t0 = Date.now()
  const job = await readJob(o.job, fetchImpl)
  const outDir = path.join(o.workDir, safeFileName(job.id))
  const stdin = new PassThrough()
  let done: Extract<ChildLine, { t: 'done' }> | null = null
  let error: Extract<ChildLine, { t: 'error' }> | null = null
  const costs: { unit: string; qty: number }[] = []
  let provider: string | undefined
  let buf = ''
  const stdout = {
    write: (s: string): boolean => {
      buf += s
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = decodeChildLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (!line) continue
        o.onLine?.(line)
        if (line.t === 'done') done = line
        else if (line.t === 'error') error = line
        else if (line.t === 'cost') {
          costs.push(...line.cost.units)
          provider ??= line.cost.provider
        }
      }
      return true
    }
  }
  stdin.write(encodeParentLine({ t: 'job', job: { ...job.node, outDir } }))
  // the channel stays open while the node runs (a closed channel means « parent gone » to the child)
  await runWorkerChild({ registry: o.registry, dataDir: o.dataDir, resourcesDir: o.resourcesDir, parentServices: false, stdin, stdout, fetchImpl, ...(o.pathEnv !== undefined ? { pathEnv: o.pathEnv } : {}) })
  stdin.end()

  let result: RenderResult
  const d = done as Extract<ChildLine, { t: 'done' }> | null
  const e = error as Extract<ChildLine, { t: 'error' }> | null
  if (d) {
    const slots = [...job.upload.files]
    const outputs: Extract<RenderResult, { ok: true }>['outputs'] = {}
    try {
      for (const [name, out] of Object.entries(d.outputs)) {
        const keys: string[] = []
        const names: string[] = []
        for (const f of out.files ?? []) {
          const slot = slots.shift()
          if (!slot) throw new Error(`the node gave more files than the job's ${job.upload.files.length} upload slots`)
          await put(slot.url, await readFile(f), fetchImpl, 'application/octet-stream')
          keys.push(slot.key)
          names.push(path.basename(f))
        }
        outputs[name] = { ...(out.files ? { files: keys, names } : {}), ...(out.value !== undefined ? { value: out.value } : {}), ...(out.meta ? { meta: out.meta } : {}) }
      }
      result = { v: RENDER_JOB_VERSION, ok: true, outputs, ...(costs.length ? { cost: { units: costs, ...(provider ? { provider } : {}) } } : {}), wallS: (Date.now() - t0) / 1000 }
    } catch (err) {
      result = { v: RENDER_JOB_VERSION, ok: false, error: { code: 'transient', message: `upload failed: ${err instanceof Error ? err.message : String(err)}`, permanent: false }, wallS: (Date.now() - t0) / 1000 }
    }
  } else {
    result = { v: RENDER_JOB_VERSION, ok: false, error: e?.error ?? { code: 'internal', message: 'the node ended without an answer', permanent: false }, wallS: (Date.now() - t0) / 1000 }
  }
  await put(job.upload.result, JSON.stringify(result), fetchImpl, 'application/json')
  return result
}
