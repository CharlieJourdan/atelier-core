// ai33.pro voice (engine `voice:ai33`, Charlie's choice of 2026-10-31; production-5). ai33.pro now serves « OpenSpeaker »:
// written from its public pages read on 2026-11-01, NEVER called (docs/PROVIDERS.md §6 lists what to confirm):
//   https://openspeaker.ai/api-guide.txt , https://openspeaker.ai/developers , https://openspeaker.ai/openapi-generation.json,
//   and the API documentation shown inside its web app (public JS bundle of https://ai33.pro). Base https://api.openspeaker.ai,
//   header `xi-api-key: <key>`.
//   TTS    POST /v3/text-to-speech multipart { voice_id, text, speed? , with_transcript } → { success, task_id }; then
//          GET /v1/task/{task_id} → { status: doing | done | error, error_message, credit_cost, metadata { audio_url } }.
//          The public curl example sends JSON with `provider:voice-id` ids and the in-app docs multipart with `provider_id`
//          ids: to confirm. Word timings only as srt/json files with `with_transcript` (format and extra price not written):
//          not asked; the engine aligns the script itself.
//   Clone  POST /v3/text-to-speech/voice-clone multipart { voice_name, audio_file (3–30 s, 10 MB) } → { data { voice_id } };
//          the voice is then spoken as `clone_<voice_id>`. No clone price written.
//   Price  « premium credits »: 1 000 000 for USD 5 (1-month validity, https://openspeaker.ai/pricing, read 2026-11-01; its
//          pages say « last verified 13 July 2026 » and the flat promo ended 2026-10-01). Credits per character are NOT
//          published: the cost is read from each task's `credit_cost`. Never guessed.
//   Watch-out (vendor's own words): every request may be answered by OpenSpeaker's own model instead of the provider model
//          picked, and outputs may be used to train its systems (docs/PROVIDERS.md §6).
// The task id is kept with the Cloud job (`providerRef`): a retry polls the same task, it never pays a second one.
import { z } from 'zod'
import { USAGE_ITEM } from '../pricing.ts'
import { call, readBytes, readJson, throwIfAborted, type HttpOptions } from './http.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'
import { fetchClip } from './voice-clip.ts'

export const AI33_BASE = 'https://api.openspeaker.ai'
/** USD per premium credit: the 1-month package (USD 5 per 1 000 000), to confirm on the dashboard. */
export const AI33_USD_PER_CREDIT = 5 / 1_000_000
export const AI33_CLONE_MAX_BYTES = 10 * 1024 * 1024
const MP3_BYTES_PER_SECOND = 128_000 / 8

const errorDetail = (body: string): string | undefined => {
  try {
    const d = JSON.parse(body) as { message?: unknown }
    return typeof d.message === 'string' ? d.message : undefined
  } catch {
    return undefined
  }
}
const Created = z.object({ task_id: z.union([z.string().min(1), z.number()]) }).passthrough()
const Task = z
  .object({
    status: z.string(),
    error_message: z.string().nullish(),
    credit_cost: z.number().nullish(),
    metadata: z.object({ audio_url: z.string().nullish() }).passthrough().nullish(),
    output_uri: z.string().nullish()
  })
  .passthrough()
const Cloned = z.object({ data: z.object({ voice_id: z.union([z.string().min(1), z.number()]) }).passthrough() }).passthrough()

export interface Ai33Options extends HttpOptions {
  id?: string
  baseUrl?: string
  /** Between two polls of a task (default 2 s). */
  pollMs?: number
  /** The longest a task may run (default 15 min). */
  maxWaitMs?: number
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason ?? new Error('aborted'))), { once: true })
  })

export function ai33Adapter(o: Ai33Options = {}): ProviderAdapter {
  const base = (o.baseUrl ?? AI33_BASE).replace(/\/+$/, '')
  const pollMs = o.pollMs ?? 2000
  const maxWaitMs = o.maxWaitMs ?? 15 * 60_000

  async function waitTask(id: string, secret: string, ctx: ProviderContext): Promise<z.infer<typeof Task>> {
    const label = 'ai33 task'
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      throwIfAborted(ctx.signal)
      const res = await call({ label, url: `${base}/v1/task/${encodeURIComponent(id)}`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'GET', headers: { 'xi-api-key': secret, accept: 'application/json' } } }, o)
      const task = Task.safeParse(await readJson(res, label, ctx.signal))
      if (!task.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      if (task.data.status === 'done') return task.data
      if (task.data.status === 'error') {
        // a failed task is refunded by the provider: a new attempt may start a new one
        ctx.setProviderRef(null)
        throw new Error(`${label}: failed (${(task.data.error_message ?? 'no reason').slice(0, 80)})`)
      }
      if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still running after ${Math.round(maxWaitMs / 60_000)} min`)
      await sleep(pollMs, ctx.signal)
    }
  }

  return {
    id: o.id ?? 'ai33',
    kind: 'real',
    secretName: 'AI33_API_KEY',
    async synthesize(input, ctx) {
      const secret = ctx.secret()
      const label = 'ai33 synthesis'
      let taskId = ctx.providerRef()
      if (!taskId) {
        const form = new FormData()
        form.set('voice_id', input.voiceId)
        form.set('text', input.text)
        form.set('with_transcript', 'false')
        const res = await call(
          { label, url: `${base}/v3/text-to-speech`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: { 'xi-api-key': secret, accept: 'application/json' }, body: form } },
          o
        )
        const created = Created.safeParse(await readJson(res, label, ctx.signal))
        if (!created.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
        taskId = String(created.data.task_id)
        ctx.setProviderRef(taskId)
      }
      ctx.progress(0.2)
      const task = await waitTask(taskId, secret, ctx)
      const url = task.metadata?.audio_url ?? task.output_uri
      if (!url || !/^https:\/\//i.test(url)) throw new RetryableProviderError(`${label}: the task gives no audio link`)
      // the provider's file link: the key is not sent to it
      const file = await call({ label: 'ai33 audio download', url, secret, signal: ctx.signal, init: { method: 'GET' } }, o)
      const bytes = await readBytes(file, 'ai33 audio download', ctx.signal)
      if (bytes.length === 0) throw new RetryableProviderError(`${label}: the audio is empty`)
      ctx.progress(1)
      return {
        files: [{ name: 'voice.mp3', mime: 'audio/mpeg', bytes: Buffer.from(bytes) }],
        data: { voiceId: input.voiceId, durationS: +(bytes.length / MP3_BYTES_PER_SECOND).toFixed(3), words: [], wordTimings: 'unavailable', creditCost: task.credit_cost ?? null },
        costUsd: (task.credit_cost ?? 0) * AI33_USD_PER_CREDIT,
        // no `credit_cost` in the answer: the price is not guessed, the job is charged on the grid as before
        ...(typeof task.credit_cost === 'number' ? {} : { costUnknown: true as const }),
        measure: [{ item: USAGE_ITEM.synthesize, quantity: input.text.length }]
      }
    },
    async cloneVoice(input, ctx) {
      const secret = ctx.secret()
      const label = 'ai33 voice clone'
      const clip = await fetchClip(ctx, input.audioArtefactId, { label, extensions: ['mp3', 'm4a', 'wav', 'flac', 'ogg'], maxBytes: AI33_CLONE_MAX_BYTES }, secret, o)
      ctx.progress(0.4)
      const form = new FormData()
      form.set('voice_name', input.name)
      form.set('audio_file', clip.blob, clip.name)
      form.set('remove_background', 'false')
      const res = await call(
        { label, url: `${base}/v3/text-to-speech/voice-clone`, secret, signal: ctx.signal, detail: errorDetail, init: { method: 'POST', headers: { 'xi-api-key': secret, accept: 'application/json' }, body: form } },
        { timeoutMs: 120_000, ...o }
      )
      const parsed = Cloned.safeParse(await readJson(res, label, ctx.signal))
      if (!parsed.success) throw new RetryableProviderError(`${label}: unexpected answer shape`)
      ctx.progress(1)
      return { files: [], data: { voiceId: `clone_${String(parsed.data.data.voice_id)}`, name: input.name, language: input.language }, costUsd: 0, measure: [{ item: USAGE_ITEM.cloneVoice, quantity: 1 }] }
    }
  }
}
