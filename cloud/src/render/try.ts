// `npm run cloud -- render status | render try --backend scaleway|modal|runpod --bundle DIR [--out DIR] [--timeout-s 900]`
// (vps-rendu). `status` says which render providers have their vault entries (names only, never values). `try` runs ONE real
// remote render: a captured render job (a folder written by the app with ATELIER_RENDER_CAPTURE, see
// src/engine/remote-render/capture.ts) is put in the Cloud's bucket (R2), the provider starts the worker image with the job's
// presigned link, and the film comes back with the seconds billed and their price. It prints « Coût maximum » first, and refuses
// without paidCalls on, without its keys, or without an S3 bucket (the worker downloads through links only).
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { RENDER_JOB_VERSION, RENDER_PRICES, RENDER_SECRETS, RENDER_UPLOAD_SLOTS, RenderJob, RenderResult, renderCostEur, type RenderJobStore, type RenderStarter } from '../../../src/shared/render-job.ts'
import type { BlobStore } from '../blobs/types.ts'
import type { Vault } from '../vault.ts'
import { modalStarter, runpodRenderStarter, scalewayStarter } from './starters.ts'

export type RealRenderBackend = keyof typeof RENDER_SECRETS
export const REAL_RENDER_BACKENDS = Object.keys(RENDER_SECRETS) as RealRenderBackend[]

/** Each provider with the vault entries it still lacks. */
export function renderStatus(vault: Pick<Vault, 'has'>): { backend: RealRenderBackend; missing: string[] }[] {
  return REAL_RENDER_BACKENDS.map((backend) => ({ backend, missing: RENDER_SECRETS[backend].filter((n) => !vault.has(n)) }))
}

/** The starter of a provider, its secrets read from the vault at each use (each read is audited). */
export function renderStarter(backend: RealRenderBackend, vault: Pick<Vault, 'readForAdapter'>, fetchImpl?: typeof fetch): RenderStarter {
  const read = (name: string) => (): string => vault.readForAdapter(name, `render:${backend}`)
  const f = fetchImpl ? { fetchImpl } : {}
  if (backend === 'scaleway') return scalewayStarter({ secretKey: read('SCALEWAY_SECRET_KEY'), jobDefinitionId: read('SCALEWAY_JOB_DEFINITION_ID'), ...f })
  if (backend === 'modal') return modalStarter({ url: read('MODAL_RENDER_URL'), key: read('MODAL_PROXY_KEY'), secret: read('MODAL_PROXY_SECRET'), ...f })
  return runpodRenderStarter({ apiKey: read('RUNPOD_API_KEY'), endpointId: read('RUNPOD_RENDER_ENDPOINT_ID'), ...f })
}

type PresigningStore = BlobStore & { presignPut(key: string, ttlS: number): string }
const presigns = (b: BlobStore): b is PresigningStore => b.kind === 's3' && typeof (b as Partial<PresigningStore>).presignPut === 'function'

/** The render job store on the Cloud's bucket: keys under `render/`, links valid `ttlS` (default 6 h). */
export function blobJobStore(blobs: BlobStore, ttlS = 6 * 3600): RenderJobStore {
  if (!presigns(blobs)) throw new Error('remote renders need the S3 bucket (storage.kind "s3", R2): the worker reads and writes through presigned links')
  const k = (key: string): string => `render/${key}`
  const get = (key: string): string => blobs.presignGet(k(key), { ttlS, filename: basename(key), mime: 'application/octet-stream' }) as string
  return {
    async put(key, bytes) {
      await blobs.put(k(key), bytes, 'application/octet-stream')
      return get(key)
    },
    slot: (key) => ({ putUrl: blobs.presignPut(k(key), ttlS), getUrl: get(key) }),
    async get(key) {
      return (await blobs.has(k(key))) ? new Uint8Array(await blobs.get(k(key))) : null
    }
  }
}

/** The captured job: the node, its inputs' files by name in `files/`. */
interface Bundle {
  v: 1
  node: Omit<RenderJob['node'], 'inputs'> & { inputs: Record<string, RenderJob['node']['inputs'][string] & { bundleFiles?: string[] }> }
}

export interface TryRenderDeps {
  vault: Pick<Vault, 'has' | 'readForAdapter'>
  blobs: BlobStore
  paidCalls: boolean
  out: (line: string) => void
  fetchImpl?: typeof fetch
  pollMs?: number
}

export async function tryRender(d: TryRenderDeps, o: { backend: string; bundle: string; outDir?: string; timeoutS?: number }): Promise<{ billedS: number; costEur: number; files: string[] }> {
  if (!(REAL_RENDER_BACKENDS as string[]).includes(o.backend)) throw new Error(`--backend is one of ${REAL_RENDER_BACKENDS.join(', ')}`)
  const backend = o.backend as RealRenderBackend
  if (!d.paidCalls) throw new Error('paidCalls is off in config.json: no real render is started')
  const missing = RENDER_SECRETS[backend].filter((n) => !d.vault.has(n))
  if (missing.length) throw new Error(`missing in the vault: ${missing.join(', ')} (npm run cloud -- vault set NAME)`)
  const bundleFile = join(o.bundle, 'bundle.json')
  if (!existsSync(bundleFile)) throw new Error(`no bundle.json in ${o.bundle}`)
  const bundle = JSON.parse(await readFile(bundleFile, 'utf8')) as Bundle
  const store = blobJobStore(d.blobs)
  const timeoutS = o.timeoutS ?? 900
  const price = RENDER_PRICES[backend]
  d.out(`Coût maximum : ${renderCostEur(backend, timeoutS).toFixed(4)} € (${timeoutS} s × ${price.vcpu} vCPU / ${price.memGb} Go, ${price.source})`)

  const signal = AbortSignal.timeout((timeoutS + 300) * 1000)
  const id = `try-${Date.now().toString(36)}`
  const inputs: RenderJob['node']['inputs'] = {}
  for (const [port, { bundleFiles, ...rest }] of Object.entries(bundle.node.inputs)) {
    const remoteFiles = []
    for (const name of bundleFiles ?? []) remoteFiles.push({ name, url: await store.put(`jobs/${id}/in/${port}/${name}`, await readFile(join(o.bundle, 'files', name)), signal) })
    inputs[port] = { ...rest, ...(bundleFiles ? { remoteFiles } : {}) }
  }
  const slots = Array.from({ length: RENDER_UPLOAD_SLOTS }, (_, i) => `jobs/${id}/out-${String(i).padStart(2, '0')}`)
  const job = RenderJob.parse({
    v: RENDER_JOB_VERSION,
    id,
    node: { ...bundle.node, inputs },
    upload: { result: store.slot(`jobs/${id}/result.json`).putUrl, files: slots.map((key) => ({ key, url: store.slot(key).putUrl })) }
  })
  const jobUrl = await store.put(`jobs/${id}/job.json`, new TextEncoder().encode(JSON.stringify(job)), signal)

  const starter = renderStarter(backend, d.vault, d.fetchImpl)
  const ref = await starter.start(jobUrl, { jobId: id, timeoutS, signal })
  d.out(`started on ${backend}: ${ref}`)
  let shown = ''
  for (;;) {
    const st = await starter.status(ref, signal)
    if (st.state !== shown) d.out(`  ${new Date().toISOString().slice(11, 19)} ${(shown = st.state)}`)
    if (st.state === 'succeeded' || st.state === 'failed' || st.state === 'cancelled') {
      if (st.state !== 'succeeded') throw new Error(`the run ${st.state}${st.error ? `: ${st.error}` : ''}`)
      const raw = await store.get(`jobs/${id}/result.json`, signal)
      if (!raw) throw new Error('the run ended without a result')
      const r = RenderResult.parse(JSON.parse(new TextDecoder().decode(raw)))
      if (!r.ok) throw new Error(`the node failed on the worker: ${r.error.message}`)
      const billedS = st.billedS ?? r.wallS
      const files: string[] = []
      if (o.outDir) {
        await mkdir(o.outDir, { recursive: true })
        for (const out of Object.values(r.outputs)) {
          for (const [i, key] of (out.files ?? []).entries()) {
            const bytes = await store.get(key, signal)
            if (!bytes) continue
            const file = join(o.outDir, out.names?.[i] ?? basename(key))
            await writeFile(file, bytes)
            files.push(file)
          }
        }
      }
      const costEur = renderCostEur(backend, billedS)
      d.out(`done: ${billedS.toFixed(1)} s billed, ${costEur.toFixed(5)} € (worker ${r.wallS.toFixed(1)} s)${files.length ? `, files in ${o.outDir}` : ''}`)
      return { billedS, costEur, files }
    }
    await new Promise((res) => setTimeout(res, d.pollMs ?? 5000))
  }
}
