// `npm run cloud -- providers signin heygen [--port N]` (production-10): the founder signs in to HeyGen once; the tokens go to the
// vault (HEYGEN_MCP_OAUTH) and the Cloud refreshes them by itself afterwards. The link is printed; the code comes back either to
// a listener on this computer's loopback (the browser is on this computer) or as the address the browser landed on, pasted
// here (the browser is on another computer: the page will not load, its address still carries the code).
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { Cloud } from '../cloud.ts'
import { heygenSignIn, HEYGEN_MCP_SECRET, HEYGEN_SIGNIN_PORT, listenForCode, type SignInIo } from './heygen-oauth.ts'
import { HEYGEN_MCP_ENGINE } from './heygen-mcp.ts'

/** The first line typed on `stdin` (a pasted address), or never when stdin closes first. */
function firstLine(stdin: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stdin, terminal: false })
    rl.once('line', (line) => {
      rl.close()
      resolve(line)
    })
    rl.once('close', () => reject(new Error('stdin closed')))
  })
}

export interface SignInCliOptions {
  port?: number
  /** Tests: the fake HeyGen and the code without a browser. */
  overrides?: Partial<Pick<SignInIo, 'fetchFn' | 'waitForCode' | 'serverUrl'>>
}

export async function signInHeygen(cloud: Cloud, stdin: Readable, out: (line: string) => void, actor: string, o: SignInCliOptions = {}): Promise<void> {
  if (!cloud.vault.available) throw new Error('the vault has no master key: set ATELIER_CLOUD_MASTER_KEY_FILE first')
  const waitForCode =
    o.overrides?.waitForCode ??
    ((redirectUrl: string, state: string) => {
      out(`Après la connexion, la page ${redirectUrl} s'ouvre. Si elle ne charge pas (navigateur sur un autre ordinateur), colle ici l'adresse complète de cette page puis Entrée :`)
      return listenForCode(redirectUrl, state, firstLine(stdin))
    })
  await heygenSignIn({
    out,
    waitForCode,
    store: (json) => cloud.vault.set(HEYGEN_MCP_SECRET, json, actor),
    port: o.port ?? HEYGEN_SIGNIN_PORT,
    ...(o.overrides?.fetchFn ? { fetchFn: o.overrides.fetchFn } : {}),
    ...(o.overrides?.serverUrl ? { serverUrl: o.overrides.serverUrl } : {})
  })
  cloud.providerAlerts.set(HEYGEN_MCP_ENGINE, null)
  out(`HeyGen connecté (${HEYGEN_MCP_SECRET} chiffré dans le coffre). Le Cloud renouvelle le jeton tout seul.`)
}
