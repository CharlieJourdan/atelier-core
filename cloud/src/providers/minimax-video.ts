// MiniMax Hailuo 3 Lite (usage `generateVideo`): engine `clip:minimax-h3-lite`, adapter id = engine id. The vault entry is the same
// as the voice adapter's, MINIMAX_API_KEY (the video pages use the same `Authorization: Bearer <API key>`; no GroupId). Written
// from MiniMax's documentation read on 2026-11-01, never called:
//   https://platform.minimax.io/docs/guides/video-generation.md , .../api-reference/video-generation-v2-create.md ,
//   .../video-generation-v2-query.md , .../video-generation-v2-delete.md , .../pricing/overview.md
//   Create   POST {host}/v2/video_generation { model "MiniMax-H3-Lite", content [{ type "text", text } , { type "image_url",
//            image_url { url }, role "first_frame" }], resolution "480P" | "768P", duration 4–15 (integer), ratio } → { task_id }.
//            The first frame is a public URL: the team artefact's signed link. Ratio: H3-Lite « does not support adaptive », so the
//            film's own ratio (16:9 or 9:16) is always sent. The prompt is at most 7 000 characters; no negative field: « Avoid: … ».
//   Query    GET {host}/v2/query/video_generation/{task_id} → { task { status queued | running | succeeded | failed | cancelled,
//            content { url } (time-limited), error { code, message }, usage { output_seconds, … } } }. Only the last 7 days.
//   Cancel   DELETE {host}/v2/video_generation/{task_id}: cancels a task still queued (no charge); a running one cannot be stopped.
//   Errors   OpenAI-style { type: "error", error { type, message (…ends with the internal code in parentheses), http_code } }:
//            422 « sensitive content » (1026) → a `refused:` error; 429 / 5xx retry; 401 and 402 are fatal.
//   Price    480P USD 0.025, 768P USD 0.04 per second (pricing overview). Billed on the seconds the task reports (usage.output_seconds).
//            Note: the registry line of the engine (engines.ts) says 0.03 per second, between the two.
// The task id is stored with the job (`setProviderRef`) before the first poll: a retry polls the SAME task, it does not pay for a
// second one. The clip is the clip length the engine asks for (6 or 10 s, shared/visual-engines.ts).
// TO CONFIRM on the first call: that `MiniMax-H3-Lite` is the « Hailuo 3 Lite » of the engine, that an explicit `ratio` is accepted
// together with a first frame (the page says image-to-video « always uses adaptive » yet H3-Lite « does not support adaptive »),
// that 6 and 10 s are accepted, the resolution to buy (768P here), and the real price per second.
import { z } from 'zod'
import type { UsageInput } from '../../../src/shared/cloud-api.ts'
import { clipLengthFor } from '../../../src/shared/visual-engines.ts'
import { MINIMAX_REGIONS } from './minimax.ts'
import { call, clean, readJson } from './http.ts'
import { downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { pollUntil, readRef, refusedWhen, withAvoid, type PollOptions } from './visual-common.ts'

export const MINIMAX_VIDEO_MODEL = 'MiniMax-H3-Lite'
export const MINIMAX_VIDEO_RESOLUTIONS = ['480P', '768P'] as const
export type MinimaxVideoResolution = (typeof MINIMAX_VIDEO_RESOLUTIONS)[number]
/** USD per second of video (pricing overview, 2026-11-01). */
export const MINIMAX_VIDEO_USD_PER_SECOND: Record<MinimaxVideoResolution, number> = { '480P': 0.025, '768P': 0.04 }

export interface MinimaxVideoOptions extends PollOptions {
  id?: string
  model?: string
  region?: keyof typeof MINIMAX_REGIONS
  resolution?: MinimaxVideoResolution
}

const Created = z.object({ task_id: z.union([z.string().min(1), z.number()]) }).passthrough()
const Task = z
  .object({
    task: z
      .object({
        status: z.string(),
        content: z.object({ url: z.string().optional() }).passthrough().nullish(),
        error: z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).passthrough().nullish(),
        duration: z.number().optional(),
        usage: z.object({ output_seconds: z.number().optional() }).passthrough().nullish()
      })
      .passthrough()
  })
  .passthrough()
const Ref = z.object({ id: z.string() })

/** The short code of a MiniMax error body: its type, and the internal code the message ends with (« … (1026) »). */
const errorDetail = (body: string): string | undefined => {
  try {
    const e = (JSON.parse(body) as { error?: { type?: unknown; message?: unknown } }).error
    const code = typeof e?.message === 'string' ? /\((\d{4})\)\s*$/.exec(e.message)?.[1] : undefined
    const type = typeof e?.type === 'string' ? e.type : undefined
    return [type, code].filter(Boolean).join(' ') || undefined
  } catch {
    return undefined
  }
}

const SENSITIVE = /\b1026\b|sensitive/i

export function minimaxVideoAdapter(o: MinimaxVideoOptions = {}): ProviderAdapter {
  const id = o.id ?? 'clip:minimax-h3-lite'
  const model = o.model ?? MINIMAX_VIDEO_MODEL
  const resolution = o.resolution ?? '768P'
  const base = MINIMAX_REGIONS[o.region ?? 'global']
  const label = 'MiniMax video'
  // the key of the last call in this process: a cancel after the job ended has no job context to ask for it
  let lastSecret: string | null = null
  const headers = (secret: string, json: boolean): Record<string, string> => ({ authorization: `Bearer ${secret}`, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) })

  async function generateVideo(input: UsageInput<'generateVideo'>, ctx: ProviderContext) {
    const secret = ctx.secret()
    lastSecret = secret
    const seconds = clipLengthFor(id, input.seconds)
    let taskId = readRef(ctx.providerRef(), (v) => Ref.parse(v).id)
    if (!taskId) {
      const content: unknown[] = [{ type: 'text', text: withAvoid(input.prompt, input.negative) }]
      if (input.imageArtefactId) content.push({ type: 'image_url', image_url: { url: ctx.artefactUrl(input.imageArtefactId) }, role: 'first_frame' })
      const res = await refusedWhen(
        call(
          {
            label,
            url: `${base}/v2/video_generation`,
            secret,
            signal: ctx.signal,
            detail: errorDetail,
            init: { method: 'POST', headers: headers(secret, true), body: JSON.stringify({ model, content, resolution, duration: seconds, ratio: input.aspect }) }
          },
          o
        ),
        SENSITIVE,
        label
      )
      const created = Created.safeParse(await readJson(res, label, ctx.signal))
      if (!created.success) throw new RetryableProviderError(`${label}: unexpected answer to the submission`)
      taskId = String(created.data.task_id)
      // before anything else can fail: a retry polls this task
      ctx.setProviderRef(JSON.stringify({ id: taskId }))
    }
    const task = taskId
    const forget = (message: string): never => {
      ctx.setProviderRef(null)
      throw new Error(message)
    }
    ctx.progress(0.1)
    const done = await pollUntil(label, o, ctx, async () => {
      const res = await call(
        { label, url: `${base}/v2/query/video_generation/${encodeURIComponent(task)}`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: headers(secret, false) } },
        o
      ).catch((err: unknown) => {
        if (err instanceof Error && /HTTP 404/.test(err.message)) return forget(`${label}: MiniMax no longer knows this task`)
        throw err
      })
      const parsed = Task.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected status answer`)
      const t = parsed.data.task
      if (t.status === 'succeeded') {
        const url = t.content?.url
        if (!url) throw new RetryableProviderError(`${label}: the finished task carries no video link`)
        return { done: true as const, value: { url, billed: t.usage?.output_seconds ?? t.duration ?? seconds } }
      }
      if (t.status === 'failed' || t.status === 'cancelled') {
        const text = `${t.error?.code ?? ''} ${t.error?.message ?? ''}`
        ctx.setProviderRef(null)
        if (t.status === 'failed' && SENSITIVE.test(text)) throw new Error(`refused: ${label}: the description was refused as sensitive content`)
        throw new Error(`${label}: the task ${t.status}${t.error?.code !== undefined ? ` (code ${clean(String(t.error.code), secret, 20)})` : ''}`)
      }
      return { done: false as const, progress: t.status === 'running' ? 0.5 : 0.2 }
    })
    ctx.progress(0.9)
    // the link is time-limited and public: the key is not sent to it
    const got = await downloadVideo('MiniMax video download', done.url, ['video/mp4', 'video/webm'], ctx.signal, o)
    if (!got) throw undownloadable(label)
    ctx.setProviderRef(null)
    ctx.progress(1)
    return {
      files: [{ name: got.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', mime: got.mime, bytes: Buffer.from(got.bytes) }],
      data: { engine: id, model, resolution, seconds: done.billed, requestedSeconds: input.seconds, fromImage: Boolean(input.imageArtefactId) },
      costUsd: done.billed * MINIMAX_VIDEO_USD_PER_SECOND[resolution]
    }
  }

  return {
    id,
    kind: 'real',
    secretName: 'MINIMAX_API_KEY',
    generateVideo,
    // only a task still queued can be cancelled (no charge); best effort, with the key of the last call of this process
    async abandon(ref) {
      const task = readRef(ref, (v) => Ref.parse(v).id)
      if (!task || !lastSecret) return
      await call({ label, url: `${base}/v2/video_generation/${encodeURIComponent(task)}`, secret: lastSecret, signal: AbortSignal.timeout(10_000), init: { method: 'DELETE', headers: headers(lastSecret, false) } }, o).catch(() => undefined)
    }
  }
}
