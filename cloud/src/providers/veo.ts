// Veo 3.1 clips (usage `generateVideo`), two ways, both adapters whose id IS the engine id:
//
// 1. `clip:veo31-lite-vertex` — Google's own platform (Vertex AI, now the « Gemini Enterprise Agent Platform »), no audio.
//    The Gemini API no longer serves Veo 3.1: ai.google.dev/gemini-api/docs/video and /veo (read 2026-11-01) say the Veo 3.1 preview
//    models, `veo-3.1-lite-generate-preview` included, shut down on 2026-10-22. The Vertex model page (docs.cloud.google.com/
//    gemini-enterprise-agent-platform/models/veo/3-1-generate, read 2026-11-01) lists `veo-3.1-lite-generate-001` (Preview), clips
//    of 4, 6 or 8 s, 720p or 1080p, text and image in, video out, an input image of at most 20 MB, and no reference-image mode on
//    Lite. THE REST PAGE WOULD NOT RENDER in the reader used: the request below is the long-running prediction API of the Veo
//    models as I know it, not read this time, so every field is to be confirmed:
//      POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predictLongRunning
//        { instances [{ prompt, image { bytesBase64Encoded, mimeType } }], parameters { aspectRatio, durationSeconds, sampleCount 1,
//          resolution, negativePrompt, generateAudio false } } → { name: "…/operations/…" }
//      POST …/models/{model}:fetchPredictOperation { operationName } → { done, response { videos [{ bytesBase64Encoded, mimeType }],
//        raiMediaFilteredCount, raiMediaFilteredReasons [] }, error { code, message } }
//    Auth is OAuth 2: the vault entry VERTEX_SERVICE_ACCOUNT_JSON holds the service account's JSON key (client_email, private_key,
//    project_id); the adapter signs a JWT (RS256) and exchanges it at https://oauth2.googleapis.com/token for a one-hour token
//    (scope cloud-platform), kept in memory. The operation name is the job's providerRef, so a retry polls the SAME operation.
//    Price: the registry line (engines.ts), USD 0.03 per second × the length made. Third-party trackers quote USD 0.05 (720p) and
//    0.08 (1080p) per second for Lite on the Gemini API: to confirm on the Vertex price page.
//
// 2. `clip:veo31-lite-relaxed`, `clip:veo31-lite`, `clip:veo31-fast`, `clip:veo31-fast-1080p` — the reseller unifically.com
//    (Charlie's choice). Read on
//    2026-11-01: https://unifically.com/ , https://docs.unifically.com/ , .../api-reference/v1-tasks.md , .../models/video/google/veo-3.1.md
//      Create  POST https://api.unifically.com/v1/tasks, `Authorization: Bearer <UNIFICALLY_API_KEY>`
//              { model "google/veo-3.1-lite-relaxed" | "google/veo-3.1-lite" | "google/veo-3.1-fast",
//                input { prompt, start_image_url, duration 4 | 6 | 8, aspect_ratio "16:9" | "9:16", resolution "720p", allow_audio_filtered true } }
//              (`clip:veo31-fast-1080p`, production-10: the same `google/veo-3.1-fast` model with resolution "1080p".)
//              → { code 200, success, data { task_id, status "processing" } }
//      Poll    GET /v1/tasks/{task_id} → data { status processing | completed | failed, output { video_url }, error_message }
//      Errors  { success false, code 400 | 401 | 402 | 404 | 429 | 500, data { message } }. « Failed generations are never charged. »
//      No negative field is documented: « Avoid: … » is written at the end of the prompt. `allow_audio_filtered` lets a clip whose
//      audio track was filtered finish without sound (the film drops the clip's sound anyway). A start image is the artefact's signed link.
//      Price   per clip, the registry line (engines.ts): 0.075 relaxed (8 s, 720p, as the home page says), 0.15 lite, 0.3 fast,
//              0.325 fast at 1080p.
//    The docs define no content-policy failure: a failed task whose text speaks of policy, safety, moderation, sensitive or blocked
//    content is a `refused:` error, any other failure a plain one. TO CONFIRM on the first call: the shape of a failed task and of a
//    refusal, whether a task id can be polled for hours (the relaxed queue is slow: the adapter waits up to an hour, then the job
//    retries and resumes it), and the real price of lite and fast (the playground and `dry_run: true` give it for free).
import { createSign } from 'node:crypto'
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { clipLengthFor } from '../../../src/shared/visual-engines.ts'
import { call, clean, readJson } from './http.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { UNIFICALLY_BASE, unificallyCall, uploadToUnifically, type UnificallyHttp } from './unifically-common.ts'
import { engineUsd, fetchArtefactImage, pollUntil, readRef, refusal, refusedWhen, withAvoid, type PollOptions } from './visual-common.ts'

const POLICY = /polic|safety|moderat|sensitive|blocked|prohibited|nsfw|not allowed|violat/i

// ---- Vertex AI ----------------------------------------------------------------------------------------------------------

export const VEO_VERTEX_MODEL = 'veo-3.1-lite-generate-001'
export const VEO_VERTEX_DEFAULT_LOCATION = 'us-central1'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

export interface VeoVertexOptions extends PollOptions {
  id?: string
  model?: string
  location?: string
  /** Replaces the project of the service account key. */
  projectId?: string
  /** Replaces the Vertex host (tests). */
  baseUrl?: string
  tokenUrl?: string
  /** The clock of the JWT (tests). */
  now?: () => number
}

const ServiceAccount = z.object({ client_email: z.string().min(3), private_key: z.string().min(20), project_id: z.string().optional() }).passthrough()
const Token = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() }).passthrough()
const Op = z.object({ name: z.string().min(1) }).passthrough()
const Operation = z
  .object({
    done: z.boolean().optional(),
    error: z.object({ code: z.number().optional(), message: z.string().optional() }).passthrough().nullish(),
    response: z
      .object({
        videos: z.array(z.object({ bytesBase64Encoded: z.string().optional(), mimeType: z.string().optional() }).passthrough()).default([]),
        raiMediaFilteredCount: z.number().optional(),
        raiMediaFilteredReasons: z.array(z.string()).optional()
      })
      .passthrough()
      .nullish()
  })
  .passthrough()
/** `w`: the waits of the relaxed queue already used (see RELAXED_MAX_WAITS). */
const OpRef = z.object({ op: z.string(), w: z.number().int().min(0).optional() })

const b64url = (v: Buffer | string): string => Buffer.from(v).toString('base64url')

/** Google's error status, plus « content policy » when the message speaks of a safety or policy stop (so the job says refused). */
const googleError = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { error?: { status?: unknown; message?: unknown } | string }
    const e = j.error
    if (typeof e === 'string') return e
    const status = typeof e?.status === 'string' ? e.status : undefined
    const policy = typeof e?.message === 'string' && POLICY.test(e.message) ? 'content policy' : undefined
    return [status, policy].filter(Boolean).join(' ') || undefined
  } catch {
    return undefined
  }
}

export function veoVertexAdapter(o: VeoVertexOptions = {}): ProviderAdapter {
  const id = o.id ?? 'clip:veo31-lite-vertex'
  const model = o.model ?? VEO_VERTEX_MODEL
  const location = o.location ?? VEO_VERTEX_DEFAULT_LOCATION
  const label = 'Veo (Vertex)'
  const now = o.now ?? Date.now
  let cached: { email: string; token: string; until: number } | null = null

  const account = (secret: string): z.infer<typeof ServiceAccount> => {
    try {
      return ServiceAccount.parse(JSON.parse(secret))
    } catch {
      throw new Error(`${label}: the vault entry is not a service account JSON key (client_email, private_key, project_id)`)
    }
  }

  /** A one-hour OAuth token for the service account (JWT bearer grant), kept until a minute before it ends. */
  async function accessToken(secret: string, acc: z.infer<typeof ServiceAccount>, ctx: ProviderContext): Promise<string> {
    if (cached && cached.email === acc.client_email && cached.until > now() + 60_000) return cached.token
    const iat = Math.floor(now() / 1000)
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = b64url(JSON.stringify({ iss: acc.client_email, scope: SCOPE, aud: o.tokenUrl ?? GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }))
    let signature: string
    try {
      signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(acc.private_key).toString('base64url')
    } catch {
      throw new Error(`${label}: the private key of the service account cannot sign`)
    }
    const res = await call(
      {
        label: `${label} token`,
        url: o.tokenUrl ?? GOOGLE_TOKEN_URL,
        secret,
        signal: ctx.signal,
        detail: googleError,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${signature}` }).toString()
        }
      },
      o
    )
    const t = Token.safeParse(await readJson(res, `${label} token`, ctx.signal))
    if (!t.success) throw new RetryableProviderError(`${label} token: unexpected answer shape`)
    cached = { email: acc.client_email, token: t.data.access_token, until: now() + (t.data.expires_in ?? 3600) * 1000 }
    return t.data.access_token
  }

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const acc = account(secret)
    const project = o.projectId ?? acc.project_id
    if (!project) throw new Error(`${label}: no project (the service account key has no project_id)`)
    const seconds = clipLengthFor(id, input.seconds)
    const root = (o.baseUrl ?? `https://${location}-aiplatform.googleapis.com`).replace(/\/+$/, '')
    const modelUrl = `${root}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}`
    const auth = async (): Promise<Record<string, string>> => ({ authorization: `Bearer ${await accessToken(secret, acc, ctx)}`, 'content-type': 'application/json', accept: 'application/json' })

    let op = readRef(ctx.providerRef(), (v) => OpRef.parse(v).op)
    if (!op) {
      const instance: Record<string, unknown> = { prompt: input.prompt }
      if (input.imageArtefactId) {
        const still = await fetchArtefactImage(ctx, input.imageArtefactId, label, o)
        instance.image = { bytesBase64Encoded: still.bytes.toString('base64'), mimeType: still.mime }
      }
      const res = await refusedWhen(
        call(
          {
            label,
            url: `${modelUrl}:predictLongRunning`,
            secret,
            signal: ctx.signal,
            detail: googleError,
            init: {
              method: 'POST',
              headers: await auth(),
              body: JSON.stringify({
                instances: [instance],
                parameters: { aspectRatio: input.aspect, durationSeconds: seconds, sampleCount: 1, resolution: '720p', generateAudio: false, ...(input.negative ? { negativePrompt: input.negative } : {}) }
              })
            }
          },
          o
        ),
        POLICY,
        label
      )
      const sub = Op.safeParse(await readJson(res, label, ctx.signal))
      if (!sub.success) throw new RetryableProviderError(`${label}: unexpected answer to the submission`)
      op = sub.data.name
      ctx.setProviderRef(JSON.stringify({ op }))
    }
    const operationName = op
    ctx.progress(0.1)
    const found = await pollUntil(label, o, ctx, async () => {
      const res = await call(
        { label, url: `${modelUrl}:fetchPredictOperation`, secret, signal: ctx.signal, detail: googleError, init: { method: 'POST', headers: await auth(), body: JSON.stringify({ operationName }) } },
        o
      ).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) {
          ctx.setProviderRef(null)
          throw new Error(`${label}: Google no longer knows this operation`)
        }
        throw err
      })
      const parsed = Operation.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const r = parsed.data
      if (!r.done) return { done: false as const, progress: 0.5 }
      ctx.setProviderRef(null)
      if (r.error) {
        const text = r.error.message ?? ''
        if (POLICY.test(text)) throw refusal(label, 'the request was refused by the safety filters')
        throw new Error(`${label}: the operation failed (code ${r.error.code ?? '?'}: ${clean(text, secret, 80)})`)
      }
      const video = r.response?.videos.find((v) => v.bytesBase64Encoded)
      if (!video?.bytesBase64Encoded) {
        if ((r.response?.raiMediaFilteredCount ?? 0) > 0) throw refusal(label, `the clip was filtered (${clean((r.response?.raiMediaFilteredReasons ?? []).join(', '), secret, 80) || 'safety filters'})`)
        throw new Error(`${label}: the finished operation carries no video`)
      }
      return { done: true as const, value: { bytes: Buffer.from(video.bytesBase64Encoded, 'base64'), mime: video.mimeType ?? 'video/mp4' } }
    })
    if (found.bytes.length === 0) throw new RetryableProviderError(`${label}: the clip is empty`)
    ctx.progress(1)
    return {
      files: [{ name: found.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: found.mime, bytes: found.bytes }],
      data: { engine: id, model, location, seconds, requestedSeconds: input.seconds, resolution: '720p', audio: false, fromImage: Boolean(input.imageArtefactId) },
      costUsd: seconds * engineUsd(id)
    }
  }

  return { id, kind: 'real', secretName: 'VERTEX_SERVICE_ACCOUNT_JSON', generateVideo }
}

// ---- unifically.com -----------------------------------------------------------------------------------------------------

export { UNIFICALLY_BASE } from './unifically-common.ts'
export const UNIFICALLY_MODELS = {
  'clip:veo31-lite-relaxed': 'google/veo-3.1-lite-relaxed',
  'clip:veo31-lite': 'google/veo-3.1-lite',
  'clip:veo31-fast': 'google/veo-3.1-fast',
  'clip:veo31-fast-1080p': 'google/veo-3.1-fast'
} as const
export type UnificallyEngine = keyof typeof UNIFICALLY_MODELS
/** The resolution each engine asks for (720p unless the engine id says otherwise). */
export const unificallyResolution = (id: UnificallyEngine): '720p' | '1080p' => (id === 'clip:veo31-fast-1080p' ? '1080p' : '720p')

export interface UnificallyOptions extends PollOptions, UnificallyHttp {
  id: UnificallyEngine
  baseUrl?: string
}

const Created = z.object({ data: z.object({ task_id: z.string().min(1) }).passthrough() }).passthrough()
const Polled = z
  .object({
    data: z
      .object({
        status: z.string(),
        output: z.object({ video_url: z.string().optional() }).passthrough().nullish(),
        error_message: z.string().nullish()
      })
      .passthrough()
  })
  .passthrough()
const unificallyError = (body: string): string | undefined => {
  try {
    const j = JSON.parse(body) as { data?: { message?: unknown } }
    return typeof j.data?.message === 'string' ? j.data.message : undefined
  } catch {
    return undefined
  }
}

/** One wait for a clip on the relaxed queue (production-10): 15 minutes. */
export const RELAXED_MAX_WAIT_MS = 15 * 60_000
/** How many such waits a clip gets in all (cloud-3): the job keeps the provider's task between two of them and retries, so the
 *  task unifically bills is the one the retry resumes. After the last one the job fails for good and the next engine takes the
 *  clip: at most 45 minutes. */
export const RELAXED_MAX_WAITS = 3

export function unificallyAdapter(o: UnificallyOptions): ProviderAdapter {
  const label = `Veo (unifically)`
  const base = (o.baseUrl ?? UNIFICALLY_BASE).replace(/\/+$/, '')
  // the relaxed queue is slow on purpose: 15 minutes a wait (Charlie, production-10). When a wait ends the task is NOT dropped (it keeps
  // running, and being billed, on unifically's side): the job keeps its id and retries, resuming the same task; after RELAXED_MAX_WAITS
  // waits the job FAILS for good so the clip brick's next engine makes the clip
  const relaxed = o.id === 'clip:veo31-lite-relaxed'
  const poll: PollOptions = { ...o, maxWaitMs: o.maxWaitMs ?? (relaxed ? RELAXED_MAX_WAIT_MS : 20 * 60_000) }
  const headers = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' })

  const resolution = unificallyResolution(o.id)

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    const seconds = clipLengthFor(o.id, input.seconds)
    const saved = readRef(ctx.providerRef(), (v) => OpRef.parse(v))
    let taskId = saved?.op ?? null
    const waits = saved?.w ?? 0
    if (!taskId) {
      const res = await refusedWhen(
        unificallyCall(
          {
            label,
            url: `${base}/v1/tasks`,
            secret,
            signal: ctx.signal,
            detail: unificallyError,
            init: {
              method: 'POST',
              headers: headers(secret),
              body: JSON.stringify({
                model: UNIFICALLY_MODELS[o.id],
                input: {
                  prompt: withAvoid(input.prompt, input.negative),
                  ...(input.imageArtefactId ? { start_image_url: await uploadToUnifically(ctx, input.imageArtefactId, secret, label, o) } : {}),
                  duration: seconds,
                  aspect_ratio: input.aspect,
                  resolution,
                  allow_audio_filtered: true
                }
              })
            }
          },
          o
        ),
        POLICY,
        label
      )
      const sub = Created.safeParse(await readJson(res, label, ctx.signal))
      if (!sub.success) throw new RetryableProviderError(`${label}: unexpected answer to the submission`)
      taskId = sub.data.data.task_id
      ctx.setProviderRef(JSON.stringify({ op: taskId }))
    }
    const task = taskId
    ctx.progress(0.1)
    const url = await pollUntil(label, poll, ctx, async () => {
      const res = await unificallyCall({ label, url: `${base}/v1/tasks/${encodeURIComponent(task)}`, secret, signal: ctx.signal, detail: unificallyError, init: { method: 'GET', headers: headers(secret) } }, o).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) {
          ctx.setProviderRef(null)
          throw new Error(`${label}: unifically no longer knows this task`)
        }
        throw err
      })
      const parsed = Polled.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const d = parsed.data.data
      if (d.status === 'completed') {
        const link = d.output?.video_url
        if (!link) throw new RetryableProviderError(`${label}: the finished task carries no video link`)
        return { done: true as const, value: link }
      }
      if (d.status === 'failed') {
        ctx.setProviderRef(null)
        const text = d.error_message ?? ''
        if (POLICY.test(text)) throw refusal(label, `the clip was refused (${clean(text, secret, 100)})`)
        throw new Error(`${label}: the task failed${text ? ` (${clean(text, secret, 100)})` : ''}`)
      }
      return { done: false as const, progress: 0.4 }
    }).catch((err: unknown) => {
      if (relaxed && err instanceof RetryableProviderError && /still not finished/.test(err.message)) {
        if (waits + 1 >= RELAXED_MAX_WAITS) {
          // every wait is spent: fail for good, the next engine of the brick makes the clip
          ctx.setProviderRef(null)
          throw new Error(`${label}: the relaxed queue did not deliver within ${(RELAXED_MAX_WAITS * (poll.maxWaitMs ?? 0)) / 60_000} minutes, the next engine takes the clip`)
        }
        // keep the task: unifically still runs it, the retry resumes it
        ctx.setProviderRef(JSON.stringify({ op: task, w: waits + 1 }))
        throw new RetryableProviderError(`${label}: still queued, will resume (wait ${waits + 1} of ${RELAXED_MAX_WAITS})`)
      }
      throw err
    })
    ctx.progress(0.9)
    // a CDN link: the key is not sent to it
    const got = await downloadVideo('unifically video download', url, ['video/mp4', 'video/webm'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    ctx.progress(1)
    return {
      files: [{ name: got.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: got.mime, bytes: Buffer.from(got.bytes) }],
      data: { engine: o.id, model: UNIFICALLY_MODELS[o.id], seconds, requestedSeconds: input.seconds, resolution, fromImage: Boolean(input.imageArtefactId) },
      costUsd: engineUsd(o.id)
    }
  }

  return { id: o.id, kind: 'real', secretName: 'UNIFICALLY_API_KEY', generateVideo }
}

