// What every unifically.com adapter shares (veo.ts and unifically.ts, chantier vrais-tests):
//
// 1. The pictures go to unifically's own storage, not as a link to the Cloud. Seen on the first real calls (2026-11-01): the
//    workers behind Veo, SeeDance, Hailuo and Nano Banana answered « image URL not accessible / download failed » for the beta's
//    signed links (https on port 8443 behind Tailscale Funnel) although the Cloud served them; FLUX and Seedream read them. So the
//    adapter reads the artefact itself (the Cloud's own signed link) and uploads it: docs.unifically.com/api-reference/storage/
//    direct-upload.md (read 2026-11-01): PUT https://files.unifically.com/upload, `Authorization: Bearer <key>`, multipart `file`
//    → { success, file_url } (a file of unifically's storage, under a random name). It is the provider that generates from it
//    anyway; the upload is free.
// 2. unifically answers HTTP 429 « Rate limit exceeded. Please try again after 1 second. » to a few requests a second (seen with
//    8 jobs polling at once): a 429 is waited out here (1.5 s, then 3 s, then 4.5 s) before it becomes a retryable job error.
import { z } from 'zod'
import { call, readJson, type CallSpec, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderContext } from './types.ts'
import { fetchArtefactImage, sleep } from './visual-common.ts'

export const UNIFICALLY_BASE = 'https://api.unifically.com'
export const UNIFICALLY_FILES = 'https://files.unifically.com'
const RATE_WAITS_MS = [1500, 3000, 4500]

export interface UnificallyHttp extends HttpOptions {
  /** The waits after a 429 (tests: zeros). */
  rateWaitsMs?: readonly number[]
  /** Replaces files.unifically.com (tests). */
  filesUrl?: string
}

/** `call`, with unifically's per-second rate limit waited out. */
export async function unificallyCall(spec: CallSpec, o: UnificallyHttp): Promise<Response> {
  const waits = o.rateWaitsMs ?? RATE_WAITS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(spec, o)
    } catch (err) {
      const limited = err instanceof RetryableProviderError && /HTTP 429/.test(err.message)
      if (!limited || attempt >= waits.length) throw err
      await sleep(waits[attempt] as number, spec.signal)
    }
  }
}

const Uploaded = z.object({ success: z.literal(true), file_url: z.string().url() }).passthrough()

/** One team artefact (a picture), read through the Cloud's signed link and put in unifically's storage: its file_url. */
export async function uploadToUnifically(ctx: ProviderContext, artefactId: string, secret: string, label: string, o: UnificallyHttp): Promise<string> {
  const still = await fetchArtefactImage(ctx, artefactId, label, o)
  const ext = still.mime === 'image/jpeg' ? 'jpg' : still.mime === 'image/webp' ? 'webp' : 'png'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(still.bytes)], { type: still.mime }), `${artefactId}.${ext}`)
  const res = await unificallyCall(
    {
      label: `${label} upload`,
      url: `${(o.filesUrl ?? UNIFICALLY_FILES).replace(/\/+$/, '')}/upload`,
      secret,
      signal: ctx.signal,
      init: { method: 'PUT', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, body: form }
    },
    o
  )
  const got = Uploaded.safeParse(await readJson(res, `${label} upload`, ctx.signal))
  if (!got.success) throw new RetryableProviderError(`${label}: the picture upload did not answer a file link`)
  return got.data.file_url
}
