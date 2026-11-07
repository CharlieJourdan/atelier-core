// A fake of HeyGen's remote MCP server and of its OAuth authorization server, as a fetch that never leaves the process
// (production-10): protected-resource and authorization-server metadata, dynamic client registration, the token endpoint
// (authorization code with PKCE, refresh), and the MCP endpoint answering JSON-RPC in plain JSON (initialize, tools/list,
// tools/call create_asset_upload / complete_asset_upload / create_video_from_image / get_video / get_current_user, the tool names
// of the live server seen on 2026-11-01), the presigned storage PUT, and the Cloud's own file links. It records every request; the
// access token it accepts can be changed by a test.
export const MCP_URL = 'https://mcp.heygen.test/mcp/v1/'
export const AUTH = 'https://auth.heygen.test'
export const CDN = 'https://cdn.heygen.test/out/v.mp4'
export const S3 = 'https://s3.heygen.test/upload'
/** The Cloud's signed links of the portrait and the voice. */
export const FILES = 'https://files.example'

export interface McpCall {
  method: string
  url: string
  authorization: string | null
  rpc?: { method: string; params?: Record<string, unknown> }
  form?: Record<string, string>
}

export interface FakeHeygenOptions {
  /** The access token the MCP endpoint accepts (others get 401). */
  validToken?: string
  /** What the token endpoint answers to a refresh: new tokens, or a refusal. */
  refresh?: 'ok' | 'invalid_grant'
  /** `get_video` statuses in turn (the last one repeats). */
  statuses?: string[]
  /** The properties `create_video_from_image` declares (default: the live server's names). */
  createProps?: string[]
  duration?: number
  /** The upload answer carries `upload_headers` and the storage PUT refuses (403, an S3 XML error) without them. */
  signedHeader?: boolean
}

const headerOf = (init: RequestInit | undefined, name: string): string | null => {
  const h = init?.headers
  if (!h) return null
  if (h instanceof Headers) return h.get(name)
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? null
  const found = Object.entries(h as Record<string, string>).find(([k]) => k.toLowerCase() === name)
  return found ? found[1] : null
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export function fakeHeygen(o: FakeHeygenOptions = {}) {
  const calls: McpCall[] = []
  const state = { validToken: o.validToken ?? 'AT1', polls: 0, issued: 0 }
  const props = o.createProps ?? ['image', 'title', 'folderId', 'resolution', 'aspectRatio', 'fit', 'audioUrl', 'audioAssetId', 'motionPrompt', 'expressiveness']
  let assets = 0
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const authorization = headerOf(init, 'authorization')
    const body = init?.body === undefined || init.body === null ? '' : String(init.body)
    const call: McpCall = { method, url, authorization }
    calls.push(call)
    const u = new URL(url)

    if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return u.origin === new URL(MCP_URL).origin ? json({ resource: MCP_URL, authorization_servers: [AUTH] }) : new Response('', { status: 404 })
    }
    if (u.origin === AUTH && u.pathname.startsWith('/.well-known/')) {
      if (!u.pathname.includes('oauth-authorization-server')) return new Response('', { status: 404 })
      return json({
        issuer: AUTH,
        authorization_endpoint: `${AUTH}/v1/oauth/authorize`,
        token_endpoint: `${AUTH}/v1/oauth/token`,
        registration_endpoint: `${AUTH}/v1/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      })
    }
    if (url === `${AUTH}/v1/oauth/register` && method === 'POST') {
      const meta = JSON.parse(body) as Record<string, unknown>
      return json({ ...meta, client_id: 'client-1', client_id_issued_at: 1 }, 201)
    }
    if (url === `${AUTH}/v1/oauth/token` && method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(body))
      call.form = form
      if (form.grant_type === 'authorization_code') {
        if (form.code !== 'CODE-1' || !form.code_verifier) return json({ error: 'invalid_grant' }, 400)
        state.validToken = 'AT1'
        return json({ access_token: 'AT1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT1' })
      }
      if (form.grant_type === 'refresh_token') {
        if (o.refresh === 'invalid_grant' || form.refresh_token !== 'RT1') return json({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400)
        state.validToken = 'AT2'
        return json({ access_token: 'AT2', token_type: 'Bearer', expires_in: 3600 })
      }
      return json({ error: 'unsupported_grant_type' }, 400)
    }
    if (url === MCP_URL) {
      if (method !== 'POST') return new Response('', { status: 405 })
      if (authorization !== `Bearer ${state.validToken}`) {
        return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${new URL(MCP_URL).origin}/.well-known/oauth-protected-resource/mcp/v1/"` } })
      }
      const rpc = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> }
      call.rpc = { method: rpc.method, ...(rpc.params ? { params: rpc.params } : {}) }
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      const reply = (result: unknown): Response => json({ jsonrpc: '2.0', id: rpc.id, result })
      if (rpc.method === 'initialize') {
        return reply({ protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-heygen', version: '0' } })
      }
      if (rpc.method === 'tools/list') {
        const schema = (keys: string[]) => ({ type: 'object', properties: Object.fromEntries(keys.map((k) => [k, {}])) })
        return reply({
          tools: [
            { name: 'create_video_from_image', inputSchema: schema(props) },
            { name: 'get_video', inputSchema: schema(['videoId']) },
            { name: 'create_asset_upload', inputSchema: schema(['filename', 'contentType', 'sizeBytes', 'checksumSha256']) },
            { name: 'complete_asset_upload', inputSchema: schema(['assetId', 'checksumSha256']) },
            { name: 'get_current_user', inputSchema: schema([]) },
            { name: 'list_avatar_groups', inputSchema: schema([]) }
          ]
        })
      }
      if (rpc.method === 'tools/call') {
        const name = (rpc.params as { name: string }).name
        if (name === 'create_asset_upload') {
          assets++
          return reply({ structuredContent: { data: { asset_id: `as-${assets}`, upload_url: `${S3}/as-${assets}?X-Amz-Signature=x`, ...(o.signedHeader ? { upload_headers: { 'x-amz-server-side-encryption': 'AES256' } } : {}) } }, content: [] })
        }
        if (name === 'complete_asset_upload') return reply({ structuredContent: { data: { asset_id: (rpc.params as { arguments: { assetId: string } }).arguments.assetId, status: 'completed' } }, content: [] })
        if (name === 'get_current_user') return reply({ structuredContent: { data: { email: 'x@y', remaining_credits: 998 } }, content: [] })
        if (name === 'create_video_from_image') return reply({ content: [{ type: 'text', text: JSON.stringify({ data: { video_id: 'vid-1', status: 'pending' } }) }] })
        if (name === 'get_video') {
          const list = o.statuses ?? ['completed']
          const status = list[Math.min(state.polls, list.length - 1)] as string
          state.polls++
          const done = status === 'completed'
          return reply({ structuredContent: { data: { id: 'vid-1', status, ...(done ? { video_url: CDN, duration: o.duration ?? 4.6 } : {}), ...(status === 'failed' ? { failure_message: 'audio too long' } : {}) } }, content: [] })
        }
      }
      return json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'no such method' } })
    }
    if (url === CDN) return new Response(Buffer.alloc(200, 7), { status: 200, headers: { 'content-type': 'video/mp4' } })
    if (url.startsWith(`${S3}/`) && method === 'PUT') {
      if (o.signedHeader && headerOf(init, 'x-amz-server-side-encryption') !== 'AES256') return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })
      return new Response(null, { status: 200 })
    }
    if (url.startsWith(`${FILES}/art_face2`)) return new Response(Buffer.alloc(64, 3), { status: 200, headers: { 'content-type': 'image/png' } })
    if (url.startsWith(`${FILES}/art_face`)) return new Response(Buffer.alloc(64, 1), { status: 200, headers: { 'content-type': 'image/png' } })
    if (url.startsWith(`${FILES}/art_voice`)) return new Response(Buffer.alloc(64, 2), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    return new Response('not found', { status: 404 })
  }
  const rpcs = (): string[] => calls.filter((c) => c.rpc).map((c) => (c.rpc?.method === 'tools/call' ? `call ${(c.rpc.params as { name: string }).name}` : (c.rpc?.method as string)))
  return { fetch: impl as typeof fetch, calls, state, rpcs }
}
