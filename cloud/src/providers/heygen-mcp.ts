// HeyGen Avatar IV « Photo Look » through HeyGen's remote MCP server (usage `talkingAvatar`, engine `presenter:heygen-mcp`,
// production-10): the presenter's portrait and our voice audio become a talking video, paid with the credits of the founder's
// HeyGen web plan (16 credits a minute, 0.0133 USD a second at the 0.05 USD top-up credit; the plan is a fixed cost). The
// Cloud is the MCP client (official TypeScript SDK, streamable HTTP); the sign-in is heygen-oauth.ts (vault HEYGEN_MCP_OAUTH).
// Read on 2026-11-01 (developers.heygen.com/mcp/overview): server https://mcp.heygen.com/mcp/v1/, OAuth (the server metadata
// lists PKCE S256 and dynamic registration), tools `create_video` (« an avatar or an image speaks your script or audio with
// lip-sync », engine chosen by `engine`, Avatar IV by default) and `get_video` (status, video_url, duration, failure). The
// tools' INPUT SCHEMAS ARE NOT PUBLISHED: the arguments below mirror HeyGen's HTTP API v3 (`POST /v3/videos`: type "image",
// image { type "url", url }, audio_url, resolution, aspect_ratio, motion_prompt). Before ANY paid call the adapter reads the
// tool's schema from the server (`tools/list`, free) and refuses, without calling, when an argument it sends is not in it.
// SEEN ON THE LIVE SERVER (vrais-tests, 2026-11-01, `providers heygen-tools`): the server does NOT list `create_video`; a photo
// speaks through `create_video_from_image` { image { type "asset_id", asset_id } | { type "url", url }, audioAssetId | audioUrl,
// resolution 720p | 1080p | 4k, aspectRatio, fit, motionPrompt, expressiveness, title, ... } and is polled with `get_video`
// { videoId }. Pictures and audio go to HeyGen's own storage first: `create_asset_upload` { filename, contentType, sizeBytes }
// -> { asset_id, upload_url }, a PUT of the bytes to that presigned link, then `complete_asset_upload` { assetId } (providers'
// workers could not read the beta's signed links on port 8443). `get_current_user` (free) gives the plan's remaining credits,
// kept in the job's data. TO CONFIRM on the first calls: the answers' key names, the credits per minute (16 or 20), the longest
// audio one call takes (180 s assumed).
// Resuming: the video id is stored with the job as soon as HeyGen gives it; a retry polls the SAME video, never pays twice. A
// start whose answer was lost is not retried (it may have been accepted and billed).
// The look (production-17): the portrait's HeyGen asset is the presenter's registration (`heygen-look:<asset>#<sha>`, the
// sha being the portrait's bytes), handed back in `data.registration`; the app keeps it on the channel's presenter and sends it
// back as `avatarId`. A call whose avatarId is the look of the SAME portrait reuses the asset; a changed portrait is uploaded again.
import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import { HeygenSignInNeeded, HEYGEN_MCP_SECRET, HEYGEN_MCP_URL, jobOAuthProvider } from './heygen-oauth.ts'
import { resolveFetch, throwIfAborted, type HttpOptions } from './http.ts'
import { billedSeconds, checkCall, engineCostUsd, resolutionOf, savedRef, sleep, startOnce, type AvatarInput } from './presenter-common.ts'
import { downloadFile, downloadVideo, undownloadable } from './stock-common.ts'
import { RetryableProviderError, type ProviderAdapter, type ProviderContext } from './types.ts'

export const HEYGEN_MCP_ENGINE = 'presenter:heygen-mcp'
export const HEYGEN_MCP_TOOLS = { create: 'create_video_from_image', status: 'get_video', upload: 'create_asset_upload', complete: 'complete_asset_upload', user: 'get_current_user' } as const

export interface HeygenMcpOptions extends HttpOptions {
  serverUrl?: string
  /** Between two polls (default 10 s; tests use 0). */
  pollMs?: number
  /** Give up polling after this long with a retryable error that a retry resumes (default 45 minutes). */
  maxWaitMs?: number
}

/** `v`: the video; `r`: the portrait's look, kept so a resumed job still hands it back. */
const Ref = z.object({ v: z.string().min(1), r: z.string().min(1).max(200).optional() })
const DONE = new Set(['completed', 'complete', 'succeeded', 'success'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled'])

/** The answer of a tool as one object: its structured content, else the first text part parsed as JSON (HeyGen's `data` unwrapped). */
export function toolPayload(result: unknown): Record<string, unknown> {
  const r = (result ?? {}) as { structuredContent?: unknown; content?: unknown; isError?: unknown }
  let body: unknown = r.structuredContent
  if (body === undefined && Array.isArray(r.content)) {
    const text = r.content.find((c): c is { type: 'text'; text: string } => typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'text')
    if (text) {
      try {
        body = JSON.parse(text.text)
      } catch {
        body = { message: text.text }
      }
    }
  }
  const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const data = obj.data
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? { ...obj, ...(data as Record<string, unknown>) } : obj
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

const LOOK = /^heygen-look:([A-Za-z0-9_.:-]{1,120})#([0-9a-f]{16})$/

/** The registration of a portrait uploaded to HeyGen: its asset id and the first 16 hex digits of the portrait's sha-256. */
export const heygenLook = (assetId: string, portrait: Uint8Array): string => `heygen-look:${assetId}#${createHash('sha256').update(portrait).digest('hex').slice(0, 16)}`

/** The asset of a look when it was made from these very bytes (null: not a look, or another portrait). */
export function lookAsset(avatarId: string, portrait: Uint8Array): string | null {
  const m = LOOK.exec(avatarId)
  return m && heygenLook(m[1] as string, portrait) === avatarId ? (m[1] as string) : null
}

/** The arguments of `create_video_from_image` (the live server's schema) for one call, from HeyGen asset ids. */
export function createArgs(imageAssetId: string, audioAssetId: string, resolution: string, aspect: string, prompt: string | undefined): Record<string, unknown> {
  return {
    image: { type: 'asset_id', asset_id: imageAssetId },
    audioAssetId,
    resolution,
    aspectRatio: aspect === '9:16' ? '9:16' : '16:9',
    fit: 'cover',
    title: 'Atelier',
    ...(prompt ? { motionPrompt: prompt.slice(0, 300) } : {})
  }
}

/** The headers a presigned upload link was signed with, whatever the answer calls them (`headers`, `upload_headers`, …). */
export function uploadHeaders(answer: Record<string, unknown>): Record<string, string> {
  for (const key of ['headers', 'upload_headers', 'uploadHeaders', 'required_headers', 'requiredHeaders']) {
    const v = answer[key]
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
  }
  return {}
}

const PICTURES = ['image/png', 'image/jpeg', 'image/webp'] as const
const SOUNDS = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/aac', 'audio/ogg'] as const

/** The arguments we send that the server's schema of the tool does not list (empty when it lists them all or says nothing). */
export function unknownArgs(schema: unknown, args: Record<string, unknown>): string[] {
  const props = typeof schema === 'object' && schema !== null ? (schema as { properties?: unknown }).properties : undefined
  if (typeof props !== 'object' || props === null) return []
  return Object.keys(args).filter((k) => !(k in (props as Record<string, unknown>)))
}

export interface HeygenTool {
  name: string
  description?: string
  inputSchema: unknown
}

export function heygenMcpAdapter(o: HeygenMcpOptions = {}): ProviderAdapter & { tools: (ctx: ProviderContext) => Promise<HeygenTool[]> } {
  const serverUrl = o.serverUrl ?? HEYGEN_MCP_URL
  const pollMs = o.pollMs ?? 10_000
  const maxWaitMs = o.maxWaitMs ?? 45 * 60_000
  const label = 'HeyGen (MCP)'

  async function connect(ctx: ProviderContext): Promise<Client> {
    const alert = ctx.alert ?? (() => undefined)
    const provider = jobOAuthProvider(ctx.secret, (json) => {
      if (!ctx.saveSecret) throw new Error(`${label}: the refreshed sign-in cannot be stored here`)
      ctx.saveSecret(json)
    }, alert)
    const fetchFn = resolveFetch(o)
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider, fetch: (url, init) => fetchFn(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, ctx.signal]) : ctx.signal }) })
    const client = new Client({ name: 'atelier-cloud', version: '1.0.0' })
    try {
      await client.connect(transport)
    } catch (err) {
      await client.close().catch(() => undefined)
      throw mapError(err, ctx)
    }
    return client
  }

  /** SDK failures to job errors: the sign-in is the founder's to fix (fatal), a network or server failure is retryable. */
  function mapError(err: unknown, ctx: ProviderContext): Error {
    if (ctx.signal.aborted) return (ctx.signal.reason as Error) ?? new Error('aborted')
    if (err instanceof HeygenSignInNeeded) return err
    const msg = err instanceof Error ? err.message : String(err)
    if (/unauthorized|invalid_grant|invalid_token/i.test(msg)) {
      ctx.alert?.(new HeygenSignInNeeded().message)
      return new HeygenSignInNeeded()
    }
    if (err instanceof RetryableProviderError) return err
    return new RetryableProviderError(`${label}: ${msg.slice(0, 120)}`)
  }

  async function callTool(client: Client, name: string, args: Record<string, unknown>, ctx: ProviderContext): Promise<Record<string, unknown>> {
    let result: unknown
    try {
      result = await client.callTool({ name, arguments: args }, undefined, { signal: ctx.signal, timeout: o.timeoutMs ?? 120_000 })
    } catch (err) {
      throw mapError(err, ctx)
    }
    const payload = toolPayload(result)
    if ((result as { isError?: unknown }).isError === true) {
      const why = str(payload.message) ?? str(payload.error) ?? 'tool error'
      throw new Error(`${label}: ${name} failed (${why.slice(0, 120)})`)
    }
    return payload
  }

  /** One team file, read through the Cloud's signed link. */
  async function readArtefact(artefactId: string, allowed: readonly string[], ctx: ProviderContext): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
    const art = ctx.artefact(artefactId)
    const got = await downloadFile(`${label} read`, art.url, allowed, ctx.signal, o)
    if (!got) throw new Error(`${label}: ${art.name} could not be read (type or size)`)
    return { name: art.name, mime: got.mime, bytes: got.bytes }
  }

  /** One team file into HeyGen's asset storage: PUT to HeyGen's presigned link, finalized. */
  async function uploadAsset(client: Client, art: { name: string; mime: string; bytes: Uint8Array }, ctx: ProviderContext): Promise<string> {
    const started = await callTool(client, HEYGEN_MCP_TOOLS.upload, { filename: art.name, contentType: art.mime, sizeBytes: art.bytes.length }, ctx)
    const asset = str(started.asset_id) ?? str(started.assetId) ?? str(started.id)
    const put = str(started.upload_url) ?? str(started.uploadUrl) ?? str(started.url)
    if (!asset || !put) throw new Error(`${label}: ${HEYGEN_MCP_TOOLS.upload} gave no asset id or upload link`)
    const extra = uploadHeaders(started)
    // HeyGen's presigned storage link: no token is sent with it; the headers it was signed with go along exactly
    const res = await resolveFetch(o)(put, { method: 'PUT', headers: { 'content-type': art.mime, ...extra }, body: new Uint8Array(art.bytes), signal: ctx.signal }).catch(() => null)
    if (!res?.ok) {
      // what helps the next fix and holds no secret: the answer's field names and the storage's own error code
      const code = res ? /<Code>([A-Za-z]{1,60})<\/Code>/.exec(await res.text().catch(() => ''))?.[1] : undefined
      const why = `${label}: the upload of ${art.name} failed (${res ? `HTTP ${res.status}${code ? ` ${code}` : ''}` : 'unreachable'}; ${HEYGEN_MCP_TOOLS.upload} answered ${Object.keys(started).slice(0, 12).join(', ')})`
      throw !res || res.status >= 500 ? new RetryableProviderError(why) : new Error(why)
    }
    await callTool(client, HEYGEN_MCP_TOOLS.complete, { assetId: asset }, ctx)
    return asset
  }

  async function talkingAvatar(input: AvatarInput, ctx: ProviderContext) {
    if (!ctx.secret()) throw new HeygenSignInNeeded()
    checkCall(HEYGEN_MCP_ENGINE, input, label)
    const resolution = resolutionOf(HEYGEN_MCP_ENGINE, input, label)
    const saved = savedRef(ctx, Ref)
    let video = saved?.v ?? null
    let registration = saved?.r ?? null
    const client = await connect(ctx)
    try {
      if (!video) {
        if (!input.audioArtefactId) throw new Error(`${label}: the voice audio is missing (audioArtefactId)`)
        if (!input.portraitArtefactId) throw new Error(`${label}: the presenter's portrait is missing (portraitArtefactId)`)
        ctx.progress(0.05)
        // free: the server's own description of the tool, checked before anything is paid
        let tools: Awaited<ReturnType<Client['listTools']>>['tools']
        try {
          tools = (await client.listTools(undefined, { signal: ctx.signal })).tools
        } catch (err) {
          throw mapError(err, ctx)
        }
        const create = tools.find((t) => t.name === HEYGEN_MCP_TOOLS.create)
        const missing = [HEYGEN_MCP_TOOLS.status, HEYGEN_MCP_TOOLS.upload, HEYGEN_MCP_TOOLS.complete].filter((n) => !tools.some((t) => t.name === n))
        if (!create || missing.length > 0) throw new Error(`${label}: the server lacks ${[...(create ? [] : [HEYGEN_MCP_TOOLS.create]), ...missing].join(', ')} (it lists: ${tools.map((t) => t.name).slice(0, 12).join(', ')}): nothing was paid`)
        // the shape is checked before the (free) uploads and before anything is paid
        const unknown = unknownArgs(create.inputSchema, createArgs('check', 'check', resolution, input.aspect, input.prompt))
        if (unknown.length > 0) {
          const known = Object.keys((create.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})
          throw new Error(`${label}: ${HEYGEN_MCP_TOOLS.create} does not take ${unknown.join(', ')} (it takes ${known.slice(0, 20).join(', ')}): nothing was paid, update heygen-mcp.ts`)
        }
        ctx.progress(0.1)
        // the presenter's look: the same portrait reuses its HeyGen asset, a new one is uploaded (and becomes the look)
        const portrait = await readArtefact(input.portraitArtefactId, PICTURES, ctx)
        const image = lookAsset(input.avatarId, portrait.bytes) ?? (await uploadAsset(client, portrait, ctx))
        registration = heygenLook(image, portrait.bytes)
        const args = createArgs(image, await uploadAsset(client, await readArtefact(input.audioArtefactId, SOUNDS, ctx), ctx), resolution, input.aspect, input.prompt)
        throwIfAborted(ctx.signal)
        ctx.progress(0.15)
        const started = await startOnce(() => callTool(client, HEYGEN_MCP_TOOLS.create, args, ctx))
        video = str(started.video_id) ?? str(started.id)
        if (!video) throw new Error(`${label}: the start carries no video id, not retried`)
        ctx.setProviderRef(JSON.stringify({ v: video, ...(registration ? { r: registration } : {}) }))
      }

      const deadline = Date.now() + maxWaitMs
      let done: Record<string, unknown> | null = null
      while (!done) {
        throwIfAborted(ctx.signal)
        const st = await callTool(client, HEYGEN_MCP_TOOLS.status, { videoId: video }, ctx)
        const state = (str(st.status) ?? '').toLowerCase()
        if (DONE.has(state)) done = st
        else if (FAILED.has(state)) {
          ctx.setProviderRef(null)
          const why = str(st.failure_message) ?? str(st.failure_code) ?? str(st.error) ?? ''
          throw new Error(`${label}: the video failed${why ? ` (${why.slice(0, 80)})` : ''}`)
        } else {
          ctx.progress(state === 'processing' ? 0.55 : 0.3)
          if (Date.now() > deadline) throw new RetryableProviderError(`${label}: still not finished, will resume`)
          await sleep(pollMs, ctx.signal)
        }
      }
      const url = str(done.video_url)
      if (!url) {
        ctx.setProviderRef(null)
        throw new Error(`${label}: the finished video carries no link`)
      }
      ctx.progress(0.9)
      // HeyGen's presigned link: no token is sent with it
      const got = await downloadVideo(`${label} download`, url, ['video/mp4', 'application/octet-stream', 'binary/octet-stream'], ctx.signal, o)
      // the video exists and is paid: keep its id, the job's retry downloads it again (a new generation would be billed twice)
      if (!got) throw undownloadable(label)
      ctx.setProviderRef(null)
      ctx.alert?.(null)
      const duration = typeof done.duration === 'number' ? done.duration : null
      const seconds = Math.min(input.seconds, billedSeconds(duration, input.seconds))
      // free: what the plan has left, kept with the job so the founder sees the credits a video took
      const account = await callTool(client, HEYGEN_MCP_TOOLS.user, {}, ctx).catch(() => null)
      const left = account ? Object.fromEntries(Object.entries(account).filter(([k, v]) => typeof v === 'number' && /credit|quota|balance|remaining/i.test(k))) : null
      ctx.progress(1)
      return {
        files: [{ name: 'avatar.mp4', mime: 'video/mp4', bytes: Buffer.from(got.bytes) }],
        data: { engine: HEYGEN_MCP_ENGINE, resolution, seconds, requestedSeconds: input.seconds, avatarId: input.avatarId, videoId: video, ...(registration ? { registration } : {}), ...(left ? { planLeft: left } : {}) },
        costUsd: engineCostUsd(HEYGEN_MCP_ENGINE, resolution, seconds)
      }
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  /** The server's tools with their input schemas (free: `tools/list`), for `providers heygen-tools` (vrais-tests: the live server's
   *  tool names were not the documented ones). */
  async function tools(ctx: ProviderContext): Promise<{ name: string; description?: string; inputSchema: unknown }[]> {
    const client = await connect(ctx)
    try {
      return (await client.listTools(undefined, { signal: ctx.signal })).tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), inputSchema: t.inputSchema }))
    } catch (err) {
      throw mapError(err, ctx)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  const adapter: ProviderAdapter & { tools: typeof tools } = { id: HEYGEN_MCP_ENGINE, kind: 'real', secretName: HEYGEN_MCP_SECRET, talkingAvatar, tools }
  return adapter
}
