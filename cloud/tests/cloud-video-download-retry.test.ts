// Cloud-3, a retry never bills twice: a presenter or clip video the provider FINISHED (and bills) must not be lost to a download
// that fails. A big presenter call (162 s at 1080p is about 97 MB) used to be refused by the 40 MB stock cap, the job failed, and the
// client's retry made a second generation. Now videos have their own, higher cap, and a download that fails keeps the provider
// handle and throws a retryable error, so the job's retry downloads the same video again. Fake fetch only, never the network.
import { describe, expect, it } from 'vitest'
import { heygenMcpAdapter } from '../src/providers/heygen-mcp.ts'
import { hedraAdapter, HEDRA_BASE } from '../src/providers/hedra.ts'
import { downloadFile, downloadVideo, STOCK_MAX_FILE_BYTES, VIDEO_MAX_FILE_BYTES } from '../src/providers/stock-common.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'
import { CDN, fakeHeygen, MCP_URL } from './fake-heygen-mcp.ts'

const outcome = (p: Promise<unknown>): Promise<Error> => p.then(() => { throw new Error('it should have failed') }, (e: unknown) => e as Error)
const MB = 1024 * 1024

/** A video answer that claims `size` bytes (the body itself stays small: the cap is judged on the announced length). */
const video = (size: number, mime = 'video/mp4'): Response => new Response(Buffer.alloc(64, 7), { status: 200, headers: { 'content-type': mime, 'content-length': String(size) } })

describe('the video download cap', () => {
  it('a presenter or clip video may be 400 MB; a stock file keeps its 40 MB', async () => {
    expect(STOCK_MAX_FILE_BYTES).toBe(40 * MB)
    expect(VIDEO_MAX_FILE_BYTES).toBe(400 * MB)
    const o = (size: number) => ({ fetchImpl: (async () => video(size)) as typeof fetch })
    const signal = new AbortController().signal
    expect(await downloadFile('x', 'https://cdn.example/a.mp4', ['video/mp4'], signal, o(97 * MB))).toBeNull()
    expect(await downloadVideo('x', 'https://cdn.example/a.mp4', ['video/mp4'], signal, o(97 * MB))).not.toBeNull()
    expect(await downloadVideo('x', 'https://cdn.example/a.mp4', ['video/mp4'], signal, o(401 * MB))).toBeNull()
  })
})

describe('HeyGen MCP: a finished video is downloaded, or retried, never regenerated', () => {
  const STORED = JSON.stringify({ v: 1, client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:8791/callback'] }, tokens: { access_token: 'AT1', token_type: 'Bearer', refresh_token: 'RT1', expires_in: 3600 }, savedAt: '2026-11-01T10:00:00.000Z' })
  const input = { avatarId: 'portrait', audioArtefactId: 'art_voice', portraitArtefactId: 'art_face', seconds: 5, aspect: '16:9' as const }
  function ctxWith(): { ctx: ProviderContext; ref: () => string | null } {
    let current: string | null = null
    const ctx: ProviderContext = {
      ...ctxFor(STORED),
      artefact: (id) => (id === 'art_face' ? { name: 'visage.png', url: 'https://files.example/art_face?sig=a' } : { name: 'voix.mp3', url: 'https://files.example/art_voice?sig=b' }),
      providerRef: () => current,
      setProviderRef: (r) => {
        current = r
      }
    }
    return { ctx, ref: () => current }
  }
  /** The fake HeyGen with a CDN answering `cdn()`. */
  function withCdn(cdn: () => Response) {
    const f = fakeHeygen()
    const fetchImpl = ((u: string | URL | Request, init?: RequestInit) => (String(u) === CDN ? Promise.resolve(cdn()) : f.fetch(u, init))) as typeof fetch
    return { f, adapter: heygenMcpAdapter({ fetchImpl, serverUrl: MCP_URL, pollMs: 0 }) }
  }

  it('takes a 97 MB presenter call (162 s at 1080p)', async () => {
    const { adapter } = withCdn(() => video(97 * MB))
    const out = await runUsage(adapter, 'talkingAvatar', input, ctxWith().ctx)
    expect(out.files).toHaveLength(1)
  })

  it('a video that cannot be downloaded keeps its id and is a retry, and the retry downloads it without creating another', async () => {
    let broken = true
    const { f, adapter } = withCdn(() => (broken ? video(500 * MB) : video(1 * MB)))
    const { ctx, ref } = ctxWith()
    const err = await outcome(runUsage(adapter, 'talkingAvatar', input, ctx))
    expect(err).toBeInstanceOf(RetryableProviderError)
    expect(err.message).toMatch(/could not be downloaded/)
    expect(JSON.parse(ref() as string)).toMatchObject({ v: 'vid-1' })
    expect(f.rpcs().filter((r) => r === 'call create_video_from_image')).toHaveLength(1)
    broken = false
    const out = await runUsage(adapter, 'talkingAvatar', input, ctx)
    expect(out.files).toHaveLength(1)
    // one video made for the two attempts
    expect(f.rpcs().filter((r) => r === 'call create_video_from_image')).toHaveLength(1)
    expect(ref()).toBeNull()
  })
})

describe('Hedra: the same rule', () => {
  const AUDIO_URL = 'https://cloud.test/v1/files/aud-1?sig=xyz'
  const CDN_URL = 'https://cdn.hedra.example/out/avatar.mp4'
  it('a finished generation that cannot be downloaded keeps its handle; the retry downloads and does not start another', async () => {
    let cdnOk = false
    const f = fakeFetch((req) => {
      if (req.url === AUDIO_URL) return new Response(Buffer.from('ID3-voice'), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      if (req.method === 'POST' && req.url === `${HEDRA_BASE}/assets`) return json({ id: 'aud-1', name: 'hook.mp3', type: 'audio' })
      if (req.method === 'POST' && req.url === `${HEDRA_BASE}/assets/aud-1/upload`) return json({ id: 'aud-1' })
      if (req.method === 'POST' && req.url === `${HEDRA_BASE}/generations`) return json({ id: 'gen-9', asset_id: 'vid-9', status: 'queued' })
      if (req.url === `${HEDRA_BASE}/generations/gen-9/status`) return json({ id: 'gen-9', status: 'complete', url: CDN_URL, duration_ms: 5000 })
      return cdnOk ? new Response(Buffer.alloc(300, 5), { status: 200, headers: { 'content-type': 'video/mp4' } }) : new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    let current: string | null = null
    const ctx: ProviderContext = {
      ...ctxFor('hedra-test-SECRET-7c8d9e0f1a'),
      artefact: () => ({ name: 'hook.mp3', url: AUDIO_URL }),
      providerRef: () => current,
      setProviderRef: (r) => {
        current = r
      }
    }
    const adapter = hedraAdapter({ fetchImpl: f.fetch, pollMs: 0 })
    const input = { avatarId: 'img-avatar-1', audioArtefactId: 'art_voice', seconds: 5, aspect: '16:9' as const }
    const err = await outcome(runUsage(adapter, 'talkingAvatar', input, ctx))
    expect(err).toBeInstanceOf(RetryableProviderError)
    expect(current).not.toBeNull()
    cdnOk = true
    const out = await runUsage(adapter, 'talkingAvatar', input, ctx)
    expect(out.files).toHaveLength(1)
    expect(f.calls.filter((c) => c.method === 'POST' && c.url === `${HEDRA_BASE}/generations`)).toHaveLength(1)
    expect(current).toBeNull()
  })
})
