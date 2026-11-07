// `npm run release`: the command that pushes the current version to the testers, run against an in-process Atelier Cloud
// (fakes, loopback, nothing paid): dry run, the full run (build → draft → streamed upload → publish → the feed serves it),
// a version the Cloud already has, the device login, and the command line.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseError, checkCloudUrl, deviceLogin, expectedFiles, parseArgs, runRelease, type ReleaseOptions } from '../../scripts/release'
import type { ReleaseListResponse } from '../../src/shared/cloud-releases'
import { approveInBrowser, cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

let rig: CloudRig
let root: string
let token: string
let lines: string[]

const helpers = cloudHelpers as unknown as {
  signUpAndIn(t: CloudRig['t'], p: { email?: string; platformAdmin?: boolean }): Promise<{ accessToken: string }>
}

// uploads of a few MB over a real socket: allow for a loaded machine (the whole suite runs in parallel)
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const EXE = randomBytes(2_000_000)
const MAP = randomBytes(2000)

function project(version: string): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'atelier', version }))
}
/** What `npm run dist` leaves behind. */
function fakeDist(version: string): void {
  const [exe, map] = expectedFiles('win', version) as [string, string]
  mkdirSync(path.join(root, 'dist', 'win'), { recursive: true })
  writeFileSync(path.join(root, 'dist', 'win', exe), EXE)
  writeFileSync(path.join(root, 'dist', 'win', map), MAP)
}
const options = (o: Partial<ReleaseOptions> = {}): ReleaseOptions => ({
  channel: 'beta',
  platform: 'win',
  notes: 'Le panneau Versions arrive',
  cloudUrl: rig.baseUrl,
  dryRun: false,
  skipBuild: false,
  root,
  token,
  ...o
})
const env = (build?: () => Promise<void>) => ({ log: (s: string) => void lines.push(s), ...(build ? { build } : {}) })
const listing = async (): Promise<ReleaseListResponse> =>
  (await (await fetch(`${rig.baseUrl}/v1/admin/releases`, { headers: { authorization: `Bearer ${token}` } })).json()) as ReleaseListResponse

beforeEach(async () => {
  rig = await startCloud(0)
  const admin = await helpers.signUpAndIn(rig.t, { platformAdmin: true, email: 'founder@example.com' })
  token = admin.accessToken
  root = mkdtempSync(path.join(tmpdir(), 'atelier-release-'))
  lines = []
  project('0.4.0')
})
afterEach(async () => {
  // keep-alive connections of fetch may still be finishing their last response: cut them, or close() waits for them
  const app = rig.t.app as unknown as { close(): Promise<void>; server: { closeAllConnections(): void } }
  app.server.closeAllConnections()
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('npm run release', () => {
  it('--dry-run says what it would do and changes nothing (no build, no draft)', async () => {
    let built = 0
    const res = await runRelease(options({ dryRun: true }), env(async () => void built++))
    expect(res).toMatchObject({ version: '0.4.0', dryRun: true, releaseId: null, files: ['Atelier-Setup-0.4.0.exe', 'Atelier-Setup-0.4.0.exe.blockmap'] })
    const out = lines.join('\n')
    expect(out).toContain('Version 0.4.0 → canal beta, plateforme win')
    expect(out).toContain('Notes : Le panneau Versions arrive')
    expect(out).toContain('lancerait « npm run dist »')
    expect(out).toContain('Atelier-Setup-0.4.0.exe (pas encore construit)')
    expect(out).toContain('Rien n’a été modifié')
    expect(out).toContain(`${rig.baseUrl}/v1/updates/beta/win/latest.yml`)
    expect(built).toBe(0)
    expect((await listing()).releases).toEqual([])
  })

  it('--dry-run without a token does not even sign in', async () => {
    let logins = 0
    await runRelease(options({ dryRun: true, token: undefined }), { ...env(), login: async () => (logins++, token) })
    expect(logins).toBe(0)
    expect(lines.join('\n')).toContain('non faite')
  })

  it('--dry-run reports a version the Cloud already has', async () => {
    fakeDist('0.4.0')
    await runRelease(options(), env(async () => undefined))
    await expect(runRelease(options({ dryRun: true }), env())).rejects.toThrow(/La version 0\.4\.0 existe déjà sur beta\/win \(publiée\)/)
  })

  it('builds, uploads the installer and its blockmap by stream, publishes, and the feed serves them', async () => {
    let built = 0
    const res = await runRelease(
      options(),
      env(async () => {
        built++
        fakeDist('0.4.0')
      })
    )
    expect(built).toBe(1)
    expect(res).toMatchObject({ version: '0.4.0', dryRun: false, files: ['Atelier-Setup-0.4.0.exe', 'Atelier-Setup-0.4.0.exe.blockmap'] })
    expect(res.releaseId).toMatch(/^rel_/)
    expect(lines.join('\n')).toContain('Publié : 0.4.0 sur beta/win')

    const list = await listing()
    expect(list.releases).toHaveLength(1)
    expect(list.releases[0]).toMatchObject({ version: '0.4.0', state: 'published', notes: 'Le panneau Versions arrive' })
    expect(list.releases[0]?.files.find((f) => f.name === 'Atelier-Setup-0.4.0.exe')).toMatchObject({ size: EXE.length, sha512: createHash('sha512').update(EXE).digest('base64') })

    const yml = await (await fetch(`${rig.baseUrl}/v1/updates/beta/win/latest.yml`)).text()
    expect(yml).toContain('version: "0.4.0"')
    expect(yml).toContain('path: "Atelier-Setup-0.4.0.exe"')
    const file = Buffer.from(await (await fetch(`${rig.baseUrl}/v1/updates/beta/win/Atelier-Setup-0.4.0.exe`)).arrayBuffer())
    expect(file.equals(EXE)).toBe(true)
  })

  it('refuses a version the Cloud already has, before building anything', async () => {
    fakeDist('0.4.0')
    await runRelease(options(), env(async () => undefined))
    let built = 0
    await expect(runRelease(options(), env(async () => void built++))).rejects.toThrow(/existe déjà.*npm version patch/)
    expect(built).toBe(0)
    // the same number on the other channel is free
    await runRelease(options({ channel: 'stable', skipBuild: true }), env())
    expect((await listing()).latest.map((l) => l.channel).sort()).toEqual(['beta', 'stable'])
  })

  it('a retried command reuses the draft left by a failed one', async () => {
    fakeDist('0.4.0')
    const draft = await fetch(`${rig.baseUrl}/v1/admin/releases`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: '0.4.0', channel: 'beta', platform: 'win', notes: '' })
    })
    const id = ((await draft.json()) as { id: string }).id
    const res = await runRelease(options({ skipBuild: true }), env())
    expect(res.releaseId).toBe(id)
  })

  it('warns when a higher version is already published', async () => {
    project('0.5.0')
    fakeDist('0.5.0')
    await runRelease(options({ skipBuild: true }), env())
    project('0.4.1')
    fakeDist('0.4.1')
    lines = []
    await runRelease(options({ skipBuild: true }), env())
    expect(lines.join('\n')).toContain('la version 0.5.0 est déjà publiée et plus haute')
  })

  it('says so when the installer of this version is not in dist/', async () => {
    await expect(runRelease(options({ skipBuild: true }), env())).rejects.toThrow(/Atelier-Setup-0\.4\.0\.exe est introuvable/)
    expect((await listing()).releases).toEqual([])
  })

  it('tells a token that is not an admin\'s, or has expired, what is wrong', async () => {
    const user = await helpers.signUpAndIn(rig.t, { email: 'tester@example.com' })
    await expect(runRelease(options({ token: user.accessToken, dryRun: true }), env())).rejects.toThrow(/n’est pas administrateur/)
    await expect(runRelease(options({ token: 'atk_unknowntoken', dryRun: true }), env())).rejects.toThrow(/refuse le jeton/)
  })

  it('signs in with the device login when there is no token', async () => {
    fakeDist('0.4.0')
    const asked: string[] = []
    const res = await runRelease(options({ token: undefined, skipBuild: true }), { ...env(), login: async (url) => (asked.push(url), token) })
    expect(asked).toEqual([rig.baseUrl])
    expect(res.releaseId).not.toBeNull()
  })

  it('refuses a Cloud that does not answer', async () => {
    await expect(runRelease(options({ cloudUrl: 'http://127.0.0.1:1', dryRun: true }), env())).rejects.toThrow(/ne répond pas/)
  })
})

describe('the device login of the command', () => {
  it('prints the code, waits for the approval in the browser, and answers a token the admin routes accept', async () => {
    // the founder's account approves the code the command shows
    const founder = rig.t.cloud.accounts.createAccount({ email: 'boss@example.com', name: 'Boss', password: cloudHelpers.PASSWORD, platformAdmin: true, actor: 'test' } as never)
    expect(founder.account.id).toBeTruthy()
    const shown: string[] = []
    let polls = 0
    const accessToken = await deviceLogin(
      rig.baseUrl,
      (line) => shown.push(line),
      fetch,
      async () => {
        // the first wait: the person approves in the browser
        if (polls++ === 0) {
          const code = /code (\S+) avec/.exec(shown.join(' '))?.[1] ?? ''
          await approveInBrowser({ ...rig, email: 'boss@example.com' }, code)
        }
      }
    )
    expect(shown.join(' ')).toContain(`${rig.baseUrl}/device?code=`)
    const res = await fetch(`${rig.baseUrl}/v1/admin/releases`, { headers: { authorization: `Bearer ${accessToken}` } })
    expect(res.status).toBe(200)
  })

  it('stops when the login is refused', async () => {
    const fake = (async (url: string) => {
      if (String(url).endsWith('/device/start')) return Response.json({ deviceCode: 'd', userCode: 'ABCD-EFGH', verificationUri: 'http://x/device', expiresIn: 600, interval: 1 })
      return Response.json({ error: { code: 'gone', message: 'expired' } }, { status: 410 })
    }) as unknown as typeof fetch
    await expect(deviceLogin('http://127.0.0.1:1', () => undefined, fake, async () => undefined)).rejects.toBeInstanceOf(ReleaseError)
  })
})

describe('the command line', () => {
  const none: NodeJS.ProcessEnv = {}
  it('has beta, Windows and the local Cloud by default, and reads the token from the environment only', () => {
    const o = parseArgs([], { ATELIER_ADMIN_TOKEN: ' atk_secret ' }, '/repo')
    expect(o).toMatchObject({ channel: 'beta', platform: 'win', notes: '', cloudUrl: 'http://127.0.0.1:8787', dryRun: false, skipBuild: false, token: 'atk_secret' })
    expect(parseArgs([], none, '/repo').token).toBeUndefined()
  })

  it('reads the options, the notes from a file, and the Cloud from the environment', () => {
    mkdirSync(path.join(root, 'notes'), { recursive: true })
    writeFileSync(path.join(root, 'notes', 'v4.txt'), 'Ligne un\nLigne deux\n')
    const o = parseArgs(['--channel', 'stable', '--platform', 'mac', '--notes-file', 'notes/v4.txt', '--dry-run', '--skip-build'], { ATELIER_CLOUD_URL: 'https://api.example.org/' }, root)
    expect(o).toMatchObject({ channel: 'stable', platform: 'mac', notes: 'Ligne un\nLigne deux', cloudUrl: 'https://api.example.org', dryRun: true, skipBuild: true })
    expect(parseArgs(['--notes', 'Correctifs'], none, root).notes).toBe('Correctifs')
  })

  it('refuses unknown options, channels, platforms and a Cloud address that would send the token in clear', () => {
    expect(() => parseArgs(['--channel', 'nightly'], none, root)).toThrow(/Canal inconnu/)
    expect(() => parseArgs(['--platform', 'linux'], none, root)).toThrow(/Plateforme inconnue/)
    expect(() => parseArgs(['--token', 'x'], none, root)).toThrow(/Option inconnue/)
    expect(() => parseArgs(['--notes'], none, root)).toThrow(/attend une valeur/)
    expect(() => parseArgs(['beta'], none, root)).toThrow(/Argument inattendu/)
    expect(() => checkCloudUrl('http://api.example.org')).toThrow(/https/)
    expect(() => checkCloudUrl('nope')).toThrow(/invalide/)
    expect(checkCloudUrl('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(checkCloudUrl('https://api.example.org/path')).toBe('https://api.example.org')
  })

  it('macOS needs the .zip of a signed app', async () => {
    await expect(runRelease(options({ platform: 'mac', dryRun: true }), env())).rejects.toThrow(/sans \.zip/)
  })
})
