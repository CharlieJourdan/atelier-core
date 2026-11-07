// HeyGen's remote MCP server signs in with OAuth 2.1 + PKCE, no API key (production-10): the Cloud is the MCP client (the
// official TypeScript SDK, streamable HTTP) and spends the credits of Charlie's HeyGen web plan. This file keeps the sign-in:
//   - ONE vault entry, HEYGEN_MCP_OAUTH, holds JSON { v: 1, client (the registered OAuth client), tokens, savedAt }; it is
//     written on sign-in and again each time the SDK refreshes the tokens (encrypted, audited, never logged or printed);
//   - `heygenSignIn` (npm run cloud -- providers signin heygen) discovers the authorization server, registers the client
//     (dynamic registration), prints the sign-in link, waits for the code (a loopback listener on 127.0.0.1, or the address the
//     browser landed on, pasted), exchanges it and stores the tokens;
//   - at job time `jobOAuthProvider` gives the SDK the stored tokens; when the access token is refused the SDK refreshes it and
//     the new tokens go back to the vault (`ctx.saveSecret`); when the refresh fails the SDK would start a new sign-in, which a
//     job cannot do: it stops with « sign in again » and raises the founder console's alert (`ctx.alert`).
// The discovery, registration, PKCE and token exchange are the SDK's (`auth`); nothing here builds an OAuth request by hand.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { z } from 'zod'

export const HEYGEN_MCP_URL = 'https://mcp.heygen.com/mcp/v1/'
export const HEYGEN_MCP_SECRET = 'HEYGEN_MCP_OAUTH'
/** The loopback port the sign-in listens on for HeyGen's redirect (any free port works: it is registered with the client). */
export const HEYGEN_SIGNIN_PORT = 8791

const Saved = z.object({
  v: z.literal(1),
  client: z.object({ client_id: z.string().min(1) }).passthrough(),
  tokens: z.object({ access_token: z.string().min(1), token_type: z.string(), refresh_token: z.string().optional() }).passthrough(),
  savedAt: z.string()
})
export type SavedSignIn = z.infer<typeof Saved>

/** The stored sign-in, or null when the vault value is not one (never throws: a bad value means « sign in again »). */
export function readSignIn(json: string | null): SavedSignIn | null {
  if (!json) return null
  try {
    const r = Saved.safeParse(JSON.parse(json))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** What a job tells the founder when HeyGen wants a new sign-in (the refresh failed or the stored value is unusable). */
export const SIGN_IN_AGAIN = 'HeyGen (MCP): the sign-in has expired and could not be refreshed; run `npm run cloud -- providers signin heygen`'

export class HeygenSignInNeeded extends Error {
  constructor(message = SIGN_IN_AGAIN) {
    super(message)
    this.name = 'HeygenSignInNeeded'
  }
}

interface ProviderOptions {
  redirectUrl: string
  /** The vault value as it is now (null: none). */
  read: () => string | null
  /** Writes the new vault value (after a sign-in or a refresh). */
  write: (json: string) => void
  /** The SDK wants the user to open this link. */
  onRedirect: (url: URL) => void
  now?: () => number
}

/** The SDK's view of our stored sign-in. Client and verifier are kept in memory until tokens exist, then written together. */
export class VaultOAuthProvider implements OAuthClientProvider {
  private readonly o: ProviderOptions
  private client: OAuthClientInformationMixed | undefined
  private current: OAuthTokens | undefined
  private verifier: string | undefined
  private readonly stateValue = randomBytes(16).toString('hex')

  constructor(o: ProviderOptions) {
    this.o = o
    const saved = readSignIn(o.read())
    if (saved) {
      this.client = saved.client as OAuthClientInformationMixed
      this.current = saved.tokens as OAuthTokens
    }
  }

  get redirectUrl(): string {
    return this.o.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Atelier Cloud',
      redirect_uris: [this.o.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.stateValue
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.client
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.client = info
  }

  tokens(): OAuthTokens | undefined {
    return this.current
  }

  saveTokens(tokens: OAuthTokens): void {
    if (!this.client) throw new Error('HeyGen (MCP): tokens without a registered client')
    // a refresh answer may omit the refresh token: the one we had stays valid
    const keep = tokens.refresh_token === undefined && this.current?.refresh_token ? { refresh_token: this.current.refresh_token } : {}
    this.current = { ...tokens, ...keep }
    const saved: SavedSignIn = { v: 1, client: this.client as SavedSignIn['client'], tokens: this.current as SavedSignIn['tokens'], savedAt: new Date((this.o.now ?? Date.now)()).toISOString() }
    this.o.write(JSON.stringify(saved))
  }

  redirectToAuthorization(url: URL): void {
    this.o.onRedirect(url)
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    if (!this.verifier) throw new HeygenSignInNeeded()
    return this.verifier
  }

  /** The SDK drops what the server refused; the vault keeps its value until a new sign-in or refresh writes one. */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'client') this.client = undefined
    if (scope === 'all' || scope === 'tokens') this.current = undefined
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined
  }
}

/** The provider a job uses: the vault's sign-in, refreshed tokens written back, never a new sign-in (that needs the founder). */
export function jobOAuthProvider(read: () => string | null, write: (json: string) => void, alert: (message: string | null) => void): VaultOAuthProvider {
  return new VaultOAuthProvider({
    redirectUrl: `http://127.0.0.1:${HEYGEN_SIGNIN_PORT}/callback`,
    read,
    write,
    onRedirect: () => {
      alert(SIGN_IN_AGAIN)
      throw new HeygenSignInNeeded()
    }
  })
}

export interface SignInIo {
  /** Prints a line for the founder (the link, then the result). Never given a token. */
  out: (line: string) => void
  /** The code HeyGen redirected to `redirectUrl` with (state checked), from the loopback listener or a pasted address. */
  waitForCode: (redirectUrl: string, state: string) => Promise<string>
  /** Stores the vault value (`vault.set(HEYGEN_MCP_SECRET, …)`). */
  store: (json: string) => void
  serverUrl?: string
  port?: number
  fetchFn?: typeof fetch
}

/** The one-time sign-in of the founder's HeyGen account (OAuth 2.1 + PKCE through the SDK). */
export async function heygenSignIn(io: SignInIo): Promise<void> {
  const serverUrl = io.serverUrl ?? HEYGEN_MCP_URL
  const redirectUrl = `http://127.0.0.1:${io.port ?? HEYGEN_SIGNIN_PORT}/callback`
  let link: URL | null = null
  const provider = new VaultOAuthProvider({ redirectUrl, read: () => null, write: io.store, onRedirect: (u) => void (link = u) })
  const opts = { serverUrl, ...(io.fetchFn ? { fetchFn: io.fetchFn } : {}) }
  const first = await auth(provider, opts)
  if (first === 'AUTHORIZED') return
  if (!link) throw new Error('HeyGen (MCP): no sign-in link was produced')
  io.out('Ouvre ce lien et connecte-toi à ton compte HeyGen :')
  io.out(String(link))
  const code = await io.waitForCode(redirectUrl, provider.state())
  const done = await auth(provider, { ...opts, authorizationCode: code })
  if (done !== 'AUTHORIZED') throw new Error('HeyGen (MCP): the code was not accepted, start the sign-in again')
}

/** The code from an address HeyGen redirected to (pasted by the founder), the state checked. */
export function codeFromRedirect(address: string, state: string): string {
  let u: URL
  try {
    u = new URL(address.trim())
  } catch {
    throw new Error('this is not the address of the page you landed on')
  }
  const error = u.searchParams.get('error')
  if (error) throw new Error(`HeyGen refused the sign-in (${error.slice(0, 60)})`)
  if (u.searchParams.get('state') !== state) throw new Error('the sign-in state does not match: start again')
  const code = u.searchParams.get('code')
  if (!code) throw new Error('the address carries no code')
  return code
}

/**
 * Waits for HeyGen's redirect on the loopback (`redirectUrl`), or for the address pasted on `pasted` (the browser on another
 * computer cannot reach this one's 127.0.0.1). Gives up after `timeoutMs`.
 */
export function listenForCode(redirectUrl: string, state: string, pasted: Promise<string> | null, timeoutMs = 10 * 60_000): Promise<string> {
  const u = new URL(redirectUrl)
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, code?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      if (err) reject(err)
      else resolve(code as string)
    }
    const server = createServer((req, res) => {
      const at = new URL(req.url ?? '/', `http://${u.host}`)
      if (at.pathname !== u.pathname) {
        res.writeHead(404).end()
        return
      }
      try {
        const code = codeFromRedirect(at.toString(), state)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Connexion HeyGen réussie. Tu peux fermer cet onglet.')
        finish(null, code)
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Connexion HeyGen refusée. Relance la commande.')
        finish(err as Error)
      }
    })
    server.on('error', (err) => finish(err))
    server.listen(Number(u.port), u.hostname)
    const timer = setTimeout(() => finish(new Error('no answer from HeyGen within 10 minutes: start the sign-in again')), timeoutMs)
    pasted?.then(
      (address) => {
        try {
          finish(null, codeFromRedirect(address, state))
        } catch (err) {
          finish(err as Error)
        }
      },
      () => undefined
    )
  })
}
