// production-10: HeyGen Avatar IV on the founder's plan through HeyGen's MCP server. The one-time OAuth sign-in (discovery,
// dynamic registration, PKCE, code exchange, tokens in the vault), the job-time refresh (new tokens written back; a failed
// refresh stops the job with « sign in again » and raises the founder's alert), the schema check before any paid call, the
// create / poll / download flow, resume, the CLI and the accounts status. Never the network, never a real account.
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { accountsStatus, PROVIDER_ACCOUNTS } from '../src/providers/accounts.ts'
import { createArgs, heygenLook, heygenMcpAdapter, lookAsset, toolPayload, unknownArgs, uploadHeaders } from '../src/providers/heygen-mcp.ts'
import { codeFromRedirect, heygenSignIn, HeygenSignInNeeded, HEYGEN_MCP_SECRET, readSignIn } from '../src/providers/heygen-oauth.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor } from './fake-fetch.ts'
import { fakeHeygen, MCP_URL, S3 } from './fake-heygen-mcp.ts'
import { makeCloud } from './helpers.ts'

const FACE = 'https://files.example/art_face?sig=a'
const VOICE = 'https://files.example/art_voice?sig=b'
const FACE2 = 'https://files.example/art_face2?sig=c'
const RATE = (16 * 0.05) / 60

/** A sign-in as the vault holds it (tokens AT1 / RT1 unless said). */
const stored = (access = 'AT1'): string =>
  JSON.stringify({ v: 1, client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:8791/callback'] }, tokens: { access_token: access, token_type: 'Bearer', refresh_token: 'RT1', expires_in: 3600 }, savedAt: '2026-11-01T10:00:00.000Z' })

function ctxWith(secret: string, ref: string | null = null) {
  const saved: string[] = []
  const alerts: (string | null)[] = []
  const refs: (string | null)[] = []
  let current = ref
  const ctx: ProviderContext = {
    ...ctxFor(secret),
    artefact: (id) => (id === 'art_face' ? { name: 'visage.png', url: FACE } : id === 'art_face2' ? { name: 'visage2.png', url: FACE2 } : id === 'art_voice' ? { name: 'voix.mp3', url: VOICE } : (() => { throw new Error('not found') })()),
    providerRef: () => current,
    setProviderRef: (r) => {
      current = r
      refs.push(r)
    },
    saveSecret: (v) => void saved.push(v),
    alert: (m) => void alerts.push(m)
  }
  return { ctx, saved, alerts, refs }
}

const input = { avatarId: 'portrait', audioArtefactId: 'art_voice', portraitArtefactId: 'art_face', seconds: 5, aspect: '16:9' as const }

describe('HeyGen MCP sign-in (OAuth 2.1 + PKCE through the SDK)', () => {
  it('discovers, registers the client, prints the link, exchanges the code and stores client and tokens', async () => {
    const f = fakeHeygen()
    const lines: string[] = []
    let stored: string | null = null
    await heygenSignIn({
      out: (l) => void lines.push(l),
      store: (json) => void (stored = json),
      serverUrl: MCP_URL,
      fetchFn: f.fetch,
      waitForCode: async (redirect, state) => {
        const link = new URL(lines.find((l) => l.startsWith('https://')) as string)
        expect(link.origin + link.pathname).toBe('https://auth.heygen.test/v1/oauth/authorize')
        expect(link.searchParams.get('code_challenge_method')).toBe('S256')
        expect(link.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(link.searchParams.get('client_id')).toBe('client-1')
        expect(link.searchParams.get('redirect_uri')).toBe(redirect)
        expect(link.searchParams.get('state')).toBe(state)
        return 'CODE-1'
      }
    })
    const saved = readSignIn(stored)
    expect(saved?.client.client_id).toBe('client-1')
    expect(saved?.tokens).toMatchObject({ access_token: 'AT1', refresh_token: 'RT1' })
    const exchange = f.calls.find((c) => c.form?.grant_type === 'authorization_code')
    expect(exchange?.form?.code_verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    expect(lines.join('\n')).not.toContain('AT1')
  })

  it('reads the code from a pasted address and refuses a wrong state or a refusal', () => {
    expect(codeFromRedirect('http://127.0.0.1:8791/callback?code=CODE-1&state=s1', 's1')).toBe('CODE-1')
    expect(() => codeFromRedirect('http://127.0.0.1:8791/callback?code=CODE-1&state=other', 's1')).toThrow(/state/)
    expect(() => codeFromRedirect('http://127.0.0.1:8791/callback?error=access_denied&state=s1', 's1')).toThrow(/refused/)
    expect(() => codeFromRedirect('pas une adresse', 's1')).toThrow(/address/)
  })
})

describe('HeyGen MCP engine (presenter:heygen-mcp)', () => {
  const adapter = (f: ReturnType<typeof fakeHeygen>) => heygenMcpAdapter({ fetchImpl: f.fetch, serverUrl: MCP_URL, pollMs: 0 })

  it('checks the tool schema, uploads the portrait and the voice to HeyGen, creates, polls, downloads and bills the plan rate', async () => {
    const f = fakeHeygen({ statuses: ['pending', 'processing', 'completed'] })
    const { ctx, refs, alerts, saved } = ctxWith(stored())
    const out = await runUsage(adapter(f), 'talkingAvatar', input, ctx)
    expect(f.rpcs()).toEqual([
      'initialize', 'notifications/initialized', 'tools/list',
      'call create_asset_upload', 'call complete_asset_upload', 'call create_asset_upload', 'call complete_asset_upload',
      'call create_video_from_image', 'call get_video', 'call get_video', 'call get_video', 'call get_current_user'
    ])
    const upload = f.calls.find((c) => c.rpc?.method === 'tools/call')?.rpc?.params as { arguments: Record<string, unknown> }
    expect(upload.arguments).toEqual({ filename: 'visage.png', contentType: 'image/png', sizeBytes: 64 })
    expect(f.calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([`${S3}/as-1?X-Amz-Signature=x`, `${S3}/as-2?X-Amz-Signature=x`])
    const create = f.calls.find((c) => (c.rpc?.params as { name?: string } | undefined)?.name === 'create_video_from_image')?.rpc?.params as { arguments: Record<string, unknown> }
    expect(create.arguments).toEqual({ image: { type: 'asset_id', asset_id: 'as-1' }, audioAssetId: 'as-2', resolution: '1080p', aspectRatio: '16:9', fit: 'cover', title: 'Atelier' })
    expect(out.data.planLeft).toEqual({ remaining_credits: 998 })
    expect(out.files[0]?.mime).toBe('video/mp4')
    expect(out.data).toMatchObject({ engine: 'presenter:heygen-mcp', resolution: '1080p', seconds: 5, videoId: 'vid-1' })
    expect(out.costUsd).toBeCloseTo(5 * RATE, 10)
    // production-17: the portrait's look is kept with the video id, and handed back as the registration
    const look = heygenLook('as-1', Buffer.alloc(64, 1))
    expect(look).toMatch(/^heygen-look:as-1#[0-9a-f]{16}$/)
    expect(out.data.registration).toBe(look)
    expect(refs).toEqual([JSON.stringify({ v: 'vid-1', r: look }), null])
    expect(alerts).toEqual([null])
    expect(saved).toEqual([])
    // the token only ever goes to the MCP endpoint, never to the file host or the CDN
    for (const c of f.calls.filter((c) => !c.url.startsWith(MCP_URL))) expect(c.authorization).toBeNull()
  })

  it('sends the headers the upload link was signed with, and says the answer fields and the storage code when a PUT is refused', async () => {
    const f = fakeHeygen({ signedHeader: true })
    const out = await runUsage(adapter(f), 'talkingAvatar', input, ctxWith(stored()).ctx)
    expect(out.files).toHaveLength(1)
    expect(uploadHeaders({ upload_headers: { a: 'b', n: 1 } })).toEqual({ a: 'b' })
    expect(uploadHeaders({ upload_url: 'x' })).toEqual({})
    // a storage that refuses: a fatal error naming the fields and the code, and nothing created
    const refusing = fakeHeygen({ signedHeader: true })
    const real = refusing.fetch
    const stripped = ((u: string | URL | Request, init?: RequestInit) => real(u, String(u).includes('s3.heygen.test') ? { ...init, headers: {} } : init)) as typeof fetch
    const err = await runUsage(heygenMcpAdapter({ fetchImpl: stripped, serverUrl: MCP_URL, pollMs: 0 }), 'talkingAvatar', input, ctxWith(stored()).ctx).then(() => new Error('it should have failed'), (e: unknown) => e as Error)
    expect(err.message).toMatch(/HTTP 403 SignatureDoesNotMatch; create_asset_upload answered .*asset_id, upload_url, upload_headers/)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect(refusing.rpcs()).not.toContain('call create_video_from_image')
  })

  it('refreshes a refused access token and writes the new tokens back, keeping the refresh token', async () => {
    const f = fakeHeygen({ validToken: 'AT-NEVER' })
    f.state.validToken = 'AT2-pending'
    // the server refuses AT0; the refresh makes AT2 the valid one
    const { ctx, saved } = ctxWith(stored('AT0'))
    const out = await runUsage(adapter(f), 'talkingAvatar', input, ctx)
    expect(out.files).toHaveLength(1)
    expect(f.calls.some((c) => c.form?.grant_type === 'refresh_token' && c.form.refresh_token === 'RT1')).toBe(true)
    const last = readSignIn(saved.at(-1) ?? null)
    expect(last?.tokens).toMatchObject({ access_token: 'AT2', refresh_token: 'RT1' })
    expect(last?.client.client_id).toBe('client-1')
  })

  it('stops with « sign in again » and raises the alert when the refresh fails, before anything is paid', async () => {
    const f = fakeHeygen({ refresh: 'invalid_grant' })
    f.state.validToken = 'AT-OTHER'
    const { ctx, alerts, saved } = ctxWith(stored('AT0'))
    const err = await runUsage(adapter(f), 'talkingAvatar', input, ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HeygenSignInNeeded)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect(alerts.at(-1)).toMatch(/providers signin heygen/)
    expect(saved).toEqual([])
    expect(f.rpcs()).not.toContain('call create_video_from_image')
  })

  it('refuses without calling or uploading when create_video_from_image does not take our arguments', async () => {
    const f = fakeHeygen({ createProps: ['avatar_id', 'script', 'voice_id'] })
    const { ctx } = ctxWith(stored())
    await expect(runUsage(adapter(f), 'talkingAvatar', input, ctx)).rejects.toThrow(/nothing was paid/)
    expect(f.rpcs()).not.toContain('call create_video_from_image')
    expect(f.rpcs()).not.toContain('call create_asset_upload')
  })

  it('reuses the presenter’s look: the same portrait is not uploaded again, a changed portrait is (production-17)', async () => {
    const first = await runUsage(adapter(fakeHeygen()), 'talkingAvatar', input, ctxWith(stored()).ctx)
    const look = first.data.registration as string
    expect(lookAsset(look, Buffer.alloc(64, 1))).toBe('as-1')
    expect(lookAsset(look, Buffer.alloc(64, 3))).toBeNull()
    expect(lookAsset('portrait', Buffer.alloc(64, 1))).toBeNull()

    // the next call of the channel's presenter sends the look back as its avatar id: only the voice goes to HeyGen
    const again = fakeHeygen()
    const out = await runUsage(adapter(again), 'talkingAvatar', { ...input, avatarId: look }, ctxWith(stored()).ctx)
    expect(again.rpcs().filter((r) => r === 'call create_asset_upload')).toHaveLength(1)
    const upload = again.calls.find((c) => (c.rpc?.params as { name?: string } | undefined)?.name === 'create_asset_upload')?.rpc?.params as { arguments: Record<string, unknown> }
    expect(upload.arguments).toMatchObject({ filename: 'voix.mp3' })
    const create = again.calls.find((c) => (c.rpc?.params as { name?: string } | undefined)?.name === 'create_video_from_image')?.rpc?.params as { arguments: Record<string, unknown> }
    expect(create.arguments).toMatchObject({ image: { type: 'asset_id', asset_id: 'as-1' }, audioAssetId: 'as-1' })
    expect(out.data.registration).toBe(look)

    // a new portrait (other bytes) with the old look: uploaded again, and a new look comes back
    const changed = fakeHeygen()
    const next = await runUsage(adapter(changed), 'talkingAvatar', { ...input, avatarId: look, portraitArtefactId: 'art_face2' }, ctxWith(stored()).ctx)
    expect(changed.rpcs().filter((r) => r === 'call create_asset_upload')).toHaveLength(2)
    expect(next.data.registration).toBe(heygenLook('as-1', Buffer.alloc(64, 3)))
    expect(next.data.registration).not.toBe(look)
  })

  it('resumes the stored video instead of paying a second one, and fails cleanly on a failed video', async () => {
    const f = fakeHeygen()
    const { ctx } = ctxWith(stored(), JSON.stringify({ v: 'vid-9' }))
    await runUsage(adapter(f), 'talkingAvatar', input, ctx)
    // no new upload, no new video: only the poll, then the free read of the plan's credits left
    expect(f.rpcs()).toEqual(['initialize', 'notifications/initialized', 'call get_video', 'call get_current_user'])
    expect((f.calls.find((c) => c.rpc?.method === 'tools/call')?.rpc?.params as { arguments: unknown }).arguments).toEqual({ videoId: 'vid-9' })
    const bad = fakeHeygen({ statuses: ['failed'] })
    const b = ctxWith(stored())
    await expect(runUsage(adapter(bad), 'talkingAvatar', input, b.ctx)).rejects.toThrow(/the video failed \(audio too long\)/)
    expect(b.refs.at(-1)).toBeNull()
  })

  it('refuses a call longer than the engine takes and a missing sign-in, before connecting', async () => {
    const f = fakeHeygen()
    await expect(runUsage(adapter(f), 'talkingAvatar', { ...input, seconds: 181 }, ctxWith(stored()).ctx)).rejects.toThrow(/at most 180 seconds/)
    await expect(runUsage(adapter(f), 'talkingAvatar', input, ctxWith('').ctx)).rejects.toBeInstanceOf(HeygenSignInNeeded)
    expect(f.calls).toHaveLength(0)
  })

  it('lists the server tools and their input schemas for `providers heygen-tools`, without calling any', async () => {
    const f = fakeHeygen({ statuses: [] })
    const tools = await heygenMcpAdapter({ fetchImpl: f.fetch, serverUrl: MCP_URL, pollMs: 0 }).tools(ctxWith(stored()).ctx)
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['create_video_from_image', 'get_video']))
    expect(tools.find((t) => t.name === 'create_video_from_image')?.inputSchema).toMatchObject({ type: 'object' })
    expect(f.rpcs()).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  })

  it('reads tool answers as structured content or JSON text, and lists unknown arguments', () => {
    expect(toolPayload({ structuredContent: { data: { video_id: 'a' } } })).toMatchObject({ video_id: 'a' })
    expect(toolPayload({ content: [{ type: 'text', text: '{"video_id":"b"}' }] })).toMatchObject({ video_id: 'b' })
    expect(toolPayload({ content: [{ type: 'text', text: 'plain words' }] })).toEqual({ message: 'plain words' })
    const args = createArgs('as-a', 'as-b', '1080p', '9:16', 'calm')
    expect(args).toMatchObject({ aspectRatio: '9:16', motionPrompt: 'calm', audioAssetId: 'as-b' })
    expect(unknownArgs({ type: 'object', properties: { image: {}, audioAssetId: {} } }, args)).toEqual(['resolution', 'aspectRatio', 'fit', 'title', 'motionPrompt'])
    expect(unknownArgs(undefined, args)).toEqual([])
  })
})

describe('provider accounts and the sign-in command', () => {
  function io() {
    const stdin = Object.assign(new PassThrough(), { isTTY: false })
    const out: string[] = []
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.on('data', (d) => out.push(String(d)))
    stderr.on('data', (d) => out.push(String(d)))
    return { stdin, stdout, stderr, text: () => out.join('') }
  }

  it('lists which keys and sign-ins are present, never a value', () => {
    const vault = { available: true, has: (n: string) => n === 'OPENAI_API_KEY' || n === HEYGEN_MCP_SECRET }
    const rows = accountsStatus(vault, ['image:gpt-image-25-low'])
    expect(rows.find((r) => r.provider.startsWith('OpenAI'))).toMatchObject({ present: true, enabled: ['image:gpt-image-25-low'] })
    expect(rows.find((r) => r.provider.startsWith('HeyGen (forfait'))).toMatchObject({ present: true, priority: 'P0', enabled: [] })
    expect(rows.find((r) => r.provider.startsWith('Cloudflare'))).toMatchObject({ present: false, missing: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] })
    // every engine of the default chains has an account
    const engines = PROVIDER_ACCOUNTS.flatMap((a) => a.engines)
    for (const e of ['presenter:heygen-mcp', 'presenter:heygen-avatar4', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie', 'presenter:infinitetalk-gpu', 'clip:veo31-lite-relaxed', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie', 'image:gpt-image-25-low', 'image:gpt-image-25-fal-low', 'image:gpt-image-25-kie', 'voice:ai33', 'voice:minimax-28-hd']) expect(engines).toContain(e)
  })

  it('`providers signin heygen` stores the sign-in in the vault, clears the alert, and `providers status` shows it', async () => {
    const t = makeCloud()
    t.cloud.providerAlerts.set('presenter:heygen-mcp', 'old alert')
    const f = fakeHeygen()
    const a = io()
    const code = await runCli(['providers', 'signin', 'heygen'], { ...a, env: {}, cloud: t.cloud, signIn: { fetchFn: f.fetch, serverUrl: MCP_URL, waitForCode: async () => 'CODE-1' } })
    expect(a.text()).toContain('https://auth.heygen.test/v1/oauth/authorize?')
    expect(code).toBe(0)
    expect(t.cloud.vault.has(HEYGEN_MCP_SECRET)).toBe(true)
    expect(a.text()).not.toContain('AT1')
    expect(t.cloud.providerAlerts.list()).toEqual([])
    t.cloud.providerAlerts.set('presenter:heygen-mcp', 'refresh failed')
    const s = io()
    expect(await runCli(['providers', 'status'], { ...s, env: {}, cloud: t.cloud })).toBe(0)
    expect(s.text()).toMatch(/P0\tHeyGen \(forfait, MCP\)\tprésent/)
    expect(s.text()).toMatch(/P0\tOpenAI \(GPT Image 2\.5\)\tmanque OPENAI_API_KEY/)
    expect(s.text()).toMatch(/ALERTE\tpresenter:heygen-mcp\trefresh failed/)
    const overview = (await t.app.inject({ url: '/v1/admin/overview' })).statusCode
    expect(overview).toBe(401)
  })
})
