// The headless brain (docs/BRAIN-HEADLESS.md): the same core as the desktop app (database, migrations, agent runtime,
// production runs, chat, settings…) built in plain Node, with the Electron-only pieces replaced — secrets with the
// machine-key cipher, paths from the configuration, window/tray/shell calls gone (or refused by the remote API) — and
// the remote API in front. Nothing on this path imports `electron` (tests/unit/headless-boot.test.ts checks it).
import { mkdirSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type http from 'node:http'
import { createCore, type Core, type CoreOptions } from '../core'
import { fakeTeamReply } from '../agents/fake-team'
import { e2eDiscord } from '../discord'
import { exampleAtStart } from '../example'
import { FakeProvider } from '../llm/fake'
import { nodeWorkerCommand } from '../production/local-worker'
import type { BrainHealth } from '../../shared/api/app'
import { backupKey } from './backup-archive'
import { readBackupState, runBackup } from './backup'
import { BackupScheduler, type BackupAt } from './backup-schedule'
import { fileKeyCipher, loadMachineKey } from './cipher'
import { readStoredLink } from './cloud-link'
import { startCloudLink, type CloudLinkHandle, type CloudStartOptions } from './cloud-start'
import { EventHub } from './events'
import { createBrainServer, dispatchRemote } from './server'
import { BrainTokens } from './token'

export interface HeadlessOptions {
  dataDir: string
  keyFile: string
  host: string
  port: number
  origins: readonly string[]
  maxBodyBytes?: number
  /** The repository (resources/, scripts/, src/): the worker and the MCP server run from its sources. */
  repoRoot: string
  /** Start the MCP bridge for Claude Code agents (the CLI does; tests leave it off). */
  mcp?: boolean
  env?: NodeJS.ProcessEnv
  /** Lines for the operator (stdout); never given a secret except the new token, once, by the CLI. */
  log?: (line: string) => void
  /** Test seams merged over the computed core options (e.g. a fixed clock). */
  core?: Partial<CoreOptions>
  /** The Atelier Cloud link (docs/BRAIN-HEADLESS.md §7): off unless an enrolment file path is given (the CLI does). */
  enrolFile?: string
  /** `--cloud-enrol`: refuse to start without an enrolment file or a stored credential. */
  cloudEnrol?: boolean
  /** false = no Cloud link at all (`--no-cloud`). */
  cloud?: boolean
  /** Test seams of the Cloud link. */
  cloudLink?: Pick<CloudStartOptions, 'fetchImpl' | 'retryMs' | 'relay'>
  /** Nightly backups (docs/BRAIN-HEADLESS.md §10): off unless given (the CLI turns them on, `--no-backup` off). */
  backup?: { at: BackupAt; fetchImpl?: typeof fetch }
  /** `--token-file`: a test team's brain key (record 0066), read at start and kept in memory only. */
  tokenFile?: string | null
  /** `--cloud-url`: the Atelier Cloud this brain uses. */
  cloudUrl?: string | null
}

export interface HeadlessBrain {
  core: Core
  server: http.Server
  hub: EventHub
  tokens: BrainTokens
  url: string
  /** The plain token when it was made by this start (the first one), else null. (`--rotate-token` is offline: token.ts.) */
  newToken: string | null
  /** The Atelier Cloud link (enrolment + relay), null when this brain has none. */
  cloud: CloudLinkHandle | null
  /** The nightly backups, null when off. */
  backups: BackupScheduler | null
  /** Uptime, restarts and backups, as « Ordinateur d'équipe » shows them (also in `app.machine`). */
  health(): BrainHealth
  close(): Promise<void>
}

function appVersion(repoRoot: string): string {
  try {
    return (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** A test brain (record 0066): its team's key from the file, exchanged now; when the Cloud cannot be reached yet, the first
 *  call that needs a token exchanges it. Neither the key nor a token is ever written to the log. */
export function signInTestBrain(core: Core, file: string, log: (line: string) => void): void {
  let key: string
  try {
    key = readFileSync(file, 'utf8').trim()
  } catch {
    log(`Atelier Cloud : fichier de clé de test illisible (${file}).`)
    return
  }
  if (!key) {
    log(`Atelier Cloud : fichier de clé de test vide (${file}).`)
    return
  }
  core.cloud.session.useTestKey(key, os.hostname()).then(
    (s) => log(`Atelier Cloud : cerveau de test connecté (${s.account?.teamName ?? 'équipe de test'}).`),
    (err: unknown) => log(`Atelier Cloud : clé de test pas encore échangée (${err instanceof Error ? err.message : String(err)}).`)
  )
}

/** The core options of the team computer; mirrors src/main/index.ts without Electron. */
export function headlessCoreOptions(o: HeadlessOptions, hub: EventHub): CoreOptions {
  const env = o.env ?? process.env
  const log = o.log ?? (() => undefined)
  const resourcesDir = path.join(o.repoRoot, 'resources')
  const fake = env.ATELIER_FAKE_LLM === '1' ? new FakeProvider(fakeTeamReply) : null
  const cipher = fileKeyCipher(loadMachineKey(o.keyFile))
  return {
    paths: { userData: o.dataDir },
    cipher,
    appName: 'Atelier',
    appVersion: appVersion(o.repoRoot),
    notify: (topic) => hub.publish('atelier:changed', { topic }),
    emitStream: (payload) => hub.publish('atelier:stream', payload),
    // No window: the theme is the remote app's business (the remote API refuses app.setTheme anyway).
    setWindowTheme: () => undefined,
    loadExample: exampleAtStart(env),
    automations: env.ATELIER_AUTOMATIONS !== 'off' && env.ATELIER_RUNNER !== 'off',
    // Publication kits: the package goes to Atelier Cloud with this machine's own credential (read when a package is built;
    // the machine may be enrolled after start-up). There is no Downloads folder here: people download from the app.
    kits: {
      machine: () => {
        if (o.cloud === false) return null
        const link = readStoredLink(o.dataDir, cipher)
        return link ? { baseUrl: link.cloudUrl, credential: link.credential } : null
      }
    },
    // No `opener`: there is no screen to open a folder on (production.revealPackage is refused remotely).
    // solidite: a run a crash or a restart interrupted starts again by itself (runs/recovery.ts), nobody to click « Reprendre »
    productionRuns: { dataDir: o.dataDir, resourcesDir, autoResume: true },
    // Atelier Cloud's device login: no browser here, the operator opens the address on their own computer.
    openExternal: (url) => {
      if (/^https?:\/\//i.test(url)) log(`Atelier Cloud : ouvre cette adresse sur ton ordinateur pour relier ce cerveau : ${url}`)
    },
    // Our engine's local worker under plain Node, from the repository's TypeScript.
    productionHost: { resourcesDir, worker: nodeWorkerCommand(o.repoRoot, path.join(o.dataDir, 'production'), resourcesDir) },
    // Claude Code agents reach Atelier's tools through the MCP server, run by this Node from its sources.
    ...(o.mcp
      ? {
          agentMcp: {
            command: process.execPath,
            args: [
              '--disable-warning=ExperimentalWarning',
              '--import',
              pathToFileURL(path.join(o.repoRoot, 'scripts', 'ts-transpile.mjs')).href,
              path.join(o.repoRoot, 'src', 'main', 'mcp', 'main.ts')
            ]
          }
        }
      : {}),
    ...(fake ? { chatProvider: () => fake, retryDelayMs: 0, discord: { fetch: e2eDiscord().fetch } } : {}),
    // This is the brain: it does not link itself to another one.
    brain: { link: false },
    ...o.core
  }
}

export async function startHeadless(o: HeadlessOptions): Promise<HeadlessBrain> {
  const env = o.env ?? process.env
  const hub = new EventHub()
  // Electron creates userData itself; here the data folder is made on first start, for its owner only.
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 })
  const tokens = new BrainTokens(o.dataDir)
  // The port first: a second start while the service runs fails here (EADDRINUSE) before it opens the database or
  // touches the token. The handlers are filled in once the core exists (until then a call answers « unknown method »).
  const api = {} as Core['api']
  const server = createBrainServer({
    api,
    hub,
    tokens,
    origins: o.origins,
    ...(o.maxBodyBytes ? { maxBodyBytes: o.maxBodyBytes } : {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.port, o.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  let core: Core
  try {
    core = createCore(headlessCoreOptions(o, hub))
  } catch (err) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw err
  }
  Object.assign(api, core.api)
  if (o.cloudUrl) await core.cloud.session.setBaseUrl(o.cloudUrl)
  if (o.tokenFile && o.cloud !== false) signInTestBrain(core, o.tokenFile, o.log ?? (() => undefined))
  // made only once the port is ours: a token is never written without being printed
  const newToken = tokens.ensure()
  core.bridgeReady?.catch((err: unknown) => (o.log ?? (() => undefined))(`Pont MCP non démarré : ${err instanceof Error ? err.message : String(err)}`))
  if (env.ATELIER_RUNNER !== 'off') {
    void (core.bridgeReady ?? Promise.resolve()).catch(() => undefined).then(() => core.runner.start())
  }
  let cloud: CloudLinkHandle | null = null
  if (o.cloud !== false && o.enrolFile) {
    try {
      cloud = startCloudLink({
        dataDir: o.dataDir,
        cipher: fileKeyCipher(loadMachineKey(o.keyFile)),
        enrolFile: o.enrolFile,
        required: o.cloudEnrol === true,
        dispatch: (method, args) => dispatchRemote(core.api, method, args),
        hub,
        ...(o.log ? { log: o.log } : {}),
        ...o.cloudLink
      })
    } catch (err) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      core.close()
      throw err
    }
  }
  const log = o.log ?? (() => undefined)
  const startedAt = Date.now()
  let backups: BackupScheduler | null = null
  if (o.backup) {
    const key = backupKey(loadMachineKey(o.keyFile))
    const cipher = fileKeyCipher(loadMachineKey(o.keyFile))
    const fetchImpl = o.backup.fetchImpl
    backups = new BackupScheduler({
      at: o.backup.at,
      last: () => readBackupState(o.dataDir),
      run: () =>
        runBackup({
          dataDir: o.dataDir,
          key,
          appVersion: core.context.appInfo().version,
          // read at each backup: the machine may enrol after the start
          link: () => (o.cloud === false ? null : readStoredLink(o.dataDir, cipher)),
          log,
          ...(fetchImpl ? { fetchImpl } : {})
        })
    })
    backups.start()
  }
  const health = (): BrainHealth => {
    const last = readBackupState(o.dataDir)
    const restarts = Number(env.ATELIER_BRAIN_RESTARTS ?? 0)
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeS: Math.floor((Date.now() - startedAt) / 1000),
      restarts: Number.isInteger(restarts) && restarts > 0 ? restarts : 0,
      backup: last ? { at: last.at, ok: last.ok, sizeBytes: last.sizeBytes, cloud: last.cloud, error: last.error } : null,
      nextBackupAt: backups?.nextAt ? new Date(backups.nextAt).toISOString() : null
    }
  }
  // « Ordinateur d'équipe » reads this machine's figures through app.machine: the brain adds its own health, on both
  // ways in (its own /rpc and the Cloud relay, which dispatches on core.api)
  const machine = core.api['app.machine']
  core.api['app.machine'] = api['app.machine'] = async () => ({ ...(await machine()), brain: health() })
  const addr = server.address() as AddressInfo
  const shownHost = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address
  let closed = false
  return {
    core,
    server,
    hub,
    tokens,
    url: `http://${shownHost}:${addr.port}`,
    newToken,
    cloud,
    backups,
    health,
    close: async () => {
      if (closed) return
      closed = true
      backups?.close()
      await cloud?.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      core.close()
    }
  }
}
