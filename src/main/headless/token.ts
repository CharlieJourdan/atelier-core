// The remote API's bearer token. Made on first start (32 random bytes), shown once by the CLI, kept only as its SHA-256
// in `<dataDir>/brain-token.json` (0600): the plain token is never written anywhere. A 256-bit random token needs no
// slow hash; the comparison is constant-time. `--rotate-token` is an OFFLINE command (`rotateOffline`): it opens no
// database and refuses while the service holds its port; a running brain re-reads the hash when the file changes, so a
// rotation made anyway (another port, by hand) takes effect at once and the old token stops working.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const TOKEN_FILE = 'brain-token.json'
const PREFIX = 'atb_'

interface TokenFile {
  v: 1
  sha256: string
  createdAt: string
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/** What identifies one version of the token file (a rotation by another process changes it). */
function stamp(file: string): string {
  try {
    const st = statSync(file)
    return `${st.ino}:${st.size}:${st.mtimeMs}`
  } catch {
    return 'none'
  }
}

export class BrainTokens {
  private hash: Buffer | null = null
  private seen = 'none'
  readonly file: string

  constructor(
    dataDir: string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.file = path.join(dataDir, TOKEN_FILE)
    this.reload()
  }

  /** Re-reads the hash when the file changed since the last read (a rotation by another process). */
  private reload(): void {
    const now = stamp(this.file)
    if (now === this.seen) return
    this.seen = now
    this.hash = this.read()
  }

  /** True once a token exists (its hash is on disk). */
  has(): boolean {
    this.reload()
    return this.hash !== null
  }

  /** Makes a token when none exists. Returns the plain token only when it was just made (to print it once). */
  ensure(): string | null {
    this.reload()
    return this.hash ? null : this.rotate()
  }

  /** New token; the previous one is refused from now on. */
  rotate(): string {
    const token = PREFIX + randomBytes(32).toString('base64url')
    const hash = digest(token)
    const body: TokenFile = { v: 1, sha256: hash.toString('hex'), createdAt: new Date().toISOString() }
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 })
    if (this.platform !== 'win32') chmodSync(tmp, 0o600)
    renameSync(tmp, this.file)
    this.hash = hash
    this.seen = stamp(this.file)
    return token
  }

  /** Checks an `Authorization` header value (`Bearer <token>`), in constant time over the hashes. */
  verifyHeader(header: string | undefined): boolean {
    this.reload()
    if (!this.hash || typeof header !== 'string') return false
    const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header)
    if (!m?.[1]) return false
    return timingSafeEqual(digest(m[1]), this.hash)
  }

  private read(): Buffer | null {
    if (!existsSync(this.file)) return null
    try {
      const body = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<TokenFile>
      return typeof body.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) ? Buffer.from(body.sha256, 'hex') : null
    } catch {
      return null
    }
  }
}

export class RotateRefused extends Error {}

/** True when something listens on host:port (the brain's service), probed by trying to listen there ourselves. */
export function portHeld(host: string, port: number): Promise<boolean> {
  if (port === 0) return Promise.resolve(false) // a random port: no service to find there
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' ? resolve(true) : reject(err)))
    probe.listen(port, host, () => probe.close(() => resolve(false)))
  })
}

/**
 * `--rotate-token`: a new token, printed once by the CLI, WITHOUT starting a brain (no second core on the same
 * database). Refused while the service holds its port: stop it first, rotate, start it again.
 */
export async function rotateOffline(o: { dataDir: string; host: string; port: number; platform?: NodeJS.Platform }): Promise<string> {
  if (await portHeld(o.host, o.port)) {
    throw new RotateRefused(
      `Le cerveau tourne déjà sur ${o.host}:${o.port} : arrête-le d'abord (systemctl stop atelier-brain), relance --rotate-token, puis redémarre-le. Aucun jeton n'a été changé.`
    )
  }
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 })
  return new BrainTokens(o.dataDir, o.platform).rotate()
}
