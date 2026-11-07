// `atelier-cloud` (npm run cloud -- <command>): the local admin tool. It works on the data folder directly, so the
// server may run or not. Secrets and passwords are read from the keyboard without echo, never from argv.
//
//   key init [PATH]                        new master key file (0600; default $ATELIER_CLOUD_MASTER_KEY_FILE)
//   vault set NAME [--from-stdin] | vault list | vault delete NAME
//   admin user add --email E --name N [--from-stdin] [--platform-admin] [--internal] [--team TEAM_ID [--role member|admin]]
//   admin team list
//   admin grant --team TEAM_ID --credits N [--note TEXT] [--key IDEMPOTENCY_KEY]
//   admin caps --team TEAM_ID --email E [--daily N|none] [--monthly N|none]
//   admin price show | admin price set ITEM (--margin PCT | --fixed CREDITS) [--cost USD] [--reference EUR|none]
//   admin price credit-value EUR
//   admin pnl --from YYYY-MM-DD --to YYYY-MM-DD [--demo]
//   admin margin [show] | admin margin set MULTIPLIER|grid       the global price multiplier (1 = at cost, the beta rule; grid = each line's margin)
//   admin fx [show] | admin fx set EUR_PER_USD [--date YYYY-MM-DD]   the dated $ → € rate of the founder console
//   admin device revoke DEVICE_ID
//   admin test-team create --name N --credits C --key-file PATH | key --team T --key-file PATH | list | revoke --team T   (test-teams-cli.ts)
//   admin audit
//   providers status                       which usage is real or demo, and why; the provider accounts (keys or sign-ins present,
//                                          never their values) and the founder's provider alerts   (providers/accounts.ts)
//   providers signin heygen [--port N]     the one-time HeyGen sign-in (OAuth, its MCP server): prints the link, stores the tokens
//   providers try synthesize --voice ID [--engine voice:…] [--text T] [--out FILE]     ONE small real call (paidCalls on + key in the vault)
//   providers try analyseVideo --url YOUTUBE_URL [--minutes N]
//   providers unifically-ledger [--since ISO]                 unifically's balance and real cost per model (free reads)
//   providers heygen-tools [NAME_PART]                       the HeyGen MCP server's tools (free); with a name part, their input schemas
//   providers bench-visual --plan PLAN.json --out DIR [--budget-usd 15] [--parallel 4]   the still / clip model benchmark, budget-capped (providers/try-visual.ts)
//   providers try talkingAvatar --engine presenter:… --image P.png --audio V.mp3 [--resolution 480p|720p] [--bench] [--budget-usd 20] [--out DIR] [--team T]
//                                          ONE presenter generation (<= 60 s of audio), or the GPU benchmark (--bench, presenter:infinitetalk-gpu only,
//                                          capped by --budget-usd, at most 20); prints « Coût maximum » before any call   (providers/try-avatar.ts)
//   render status | render try --backend scaleway|modal|runpod --bundle DIR [--out DIR] [--timeout-s 900]
//                                          the remote render providers' keys (names only); ONE real remote render of a captured
//                                          job (paidCalls on, keys in the vault, S3 storage), « Coût maximum » first   (render/try.ts)
//   machines plans | list [--team T] | provision --team T --plan P | hibernate ID | resume ID | delete ID   (machines/cli.ts)
//   billing status --team T | billing auto --team T --on|--off [--threshold N] [--pack P] [--cap CENTS]   (billing/cli.ts)
//   mail list [--to ADDRESS] [--limit N] | mail show ID          the e-mails the fake mailer kept   (mail/cli.ts)
//   admin user verify --email E                                   marks an address verified (support)
//   admin token --email E                                         a one-hour access token of a platform admin, for `npm run release`
//   releases list                                                 the app releases (version, channel, platform, state) and the feeds' latest
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { PriceGridInput, Role, type PriceItem } from '../../src/shared/cloud-api.ts'
import { MIN_PASSWORD } from './accounts.ts'
import { pnl } from './admin.ts'
import { createCloud, signingKeyFor, type Cloud } from './cloud.ts'
import { dataDirFromEnv, loadConfig, mailOptions } from './config.ts'
import { CloudError } from './errors.ts'
import { billingCli } from './billing/cli.ts'
import { machinesCli } from './machines/cli.ts'
import { renderStatus, tryRender } from './render/try.ts'
import { mailCli } from './mail/cli.ts'
import { initKeyFile, keySourceFromEnv } from './keysource.ts'
import { realProviders } from './providers/real.ts'
import { tryProvider } from './providers/try.ts'
import { tryAvatar } from './providers/try-avatar.ts'
import { benchVisual } from './providers/try-visual.ts'
import { unificallyLedger } from './providers/unifically-ledger.ts'
import type { ProviderAdapter, ProviderContext } from './providers/types.ts'
import { accountLines, accountsStatus } from './providers/accounts.ts'
import { signInHeygen, type SignInCliOptions } from './providers/signin-cli.ts'
import { INFINITETALK_DEFAULTS } from './providers/infinitetalk-gpu.ts'
import { suggestedMarginPct } from './pricing.ts'
import { testTeamCli } from './test-teams-cli.ts'
import { readSecret, type SecretStdin } from './secret-input.ts'
import { SECRET_NAME } from './vault.ts'

export interface CliIo {
  stdin: SecretStdin
  stdout: Writable
  stderr: Writable
  env: NodeJS.ProcessEnv
  /** Tests hand an in-memory Cloud; otherwise the data folder's is opened. */
  cloud?: Cloud
  /** Tests: the HeyGen sign-in without a browser nor the network. */
  signIn?: SignInCliOptions['overrides']
}

const CLI_ACTOR = 'cli'

/** A secret is typed on a terminal without echo. When stdin is not a terminal (a pipe, or Git Bash's mintty on
 *  Windows, where typing would show the value), it is refused unless --from-stdin says the value is piped on purpose. */
function askSecret(prompt: string, io: CliIo, flags: Map<string, string | true>): Promise<string> {
  if (!io.stdin.isTTY && flags.get('from-stdin') !== true) {
    throw new CloudError(
      'bad_request',
      'stdin is not a terminal, so what you type would be shown: use PowerShell or Terminal.app (in Git Bash: winpty npm run cloud -- …), or pipe the value with --from-stdin'
    )
  }
  return readSecret(prompt, io.stdin, io.stdout)
}

export function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(a.slice(2), next)
        i++
      } else flags.set(a.slice(2), true)
    } else positional.push(a)
  }
  return { positional, flags }
}

const str = (flags: Map<string, string | true>, name: string): string => {
  const v = flags.get(name)
  if (typeof v !== 'string' || !v) throw new CloudError('bad_request', `--${name} is required`)
  return v
}
const capValue = (v: string | true | undefined, current: number | null): number | null => {
  if (v === undefined) return current
  if (v === 'none') return null
  const n = Number(v)
  if (!Number.isSafeInteger(n) || n < 0) throw new CloudError('bad_request', 'a cap is a whole number ≥ 0, or none')
  return n
}

/** The address new team computers enrol with: the configured public URL, else where the server listens. */
function cloudUrlOf(io: CliIo): string {
  if (io.cloud) return 'http://127.0.0.1:8787'
  const cfg = loadConfig(dataDirFromEnv(io.env), io.env)
  return cfg.publicUrl ?? `http://${cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host}:${cfg.port}`
}

/** `vaultOnly`: the vault commands open the Cloud without enforcing the file store and payment settings, so the keys they
 *  put in the vault can be set AFTER config.json asks for "s3" or "stripe" (the Cloud itself refuses to start without them). */
function openCloud(io: CliIo, vaultOnly = false): Cloud {
  if (io.cloud) return io.cloud
  const dataDir = dataDirFromEnv(io.env)
  const cfg = loadConfig(dataDir, io.env)
  const real = realProviders(cfg)
  return createCloud({
    dbPath: join(dataDir, 'cloud.db'),
    filesDir: dataDir,
    storage: vaultOnly ? { kind: 'local' } : cfg.storage,
    kits: cfg.kits,
    signingKey: signingKeyFor(dataDir),
    keySource: keySourceFromEnv(io.env),
    paidCalls: cfg.paidCalls === 'on',
    maxConcurrentJobs: cfg.maxConcurrentJobs,
    maxJobsPerProvider: cfg.maxJobsPerProvider,
    payments: vaultOnly ? 'fake' : cfg.payments,
    mail: vaultOnly ? { kind: 'fake' } : mailOptions(cfg),
    machineSshKeys: cfg.machines.sshKeys,
    ...(cfg.machines.appBundleUrl ? { machineAppBundleUrl: cfg.machines.appBundleUrl } : {}),
    relay: cfg.relay,
    realAdapters: real.adapters,
    providers: real.select,
    engines: real.engines,
    heygenPlan: cfg.heygen.plan,
    env: io.env
  })
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const out = (s: string): void => void io.stdout.write(s + '\n')
  const [group, cmd, ...rest] = argv
  const { positional, flags } = parseFlags(rest)
  let cloud: Cloud | null = null
  const c = (): Cloud => (cloud ??= openCloud(io, group === 'vault'))
  try {
    if (group === 'key' && cmd === 'init') {
      const path = positional[0] ?? io.env.ATELIER_CLOUD_MASTER_KEY_FILE
      if (!path) throw new CloudError('bad_request', 'give a path or set ATELIER_CLOUD_MASTER_KEY_FILE')
      initKeyFile(path)
      out(`master key written to ${path} (mode 0600). Keep it out of git and backups you share.`)
    } else if (group === 'vault' && cmd === 'set') {
      const name = positional[0] ?? ''
      if (positional.length !== 1 || [...flags.keys()].some((f) => f !== 'from-stdin')) throw new CloudError('bad_request', 'usage: vault set NAME (the value is asked, never passed)')
      if (!SECRET_NAME.test(name)) throw new CloudError('bad_request', 'a secret name is UPPER_SNAKE_CASE')
      const value = await askSecret(`Valeur de ${name} (rien ne s'affiche) : `, io, flags)
      if (!value) throw new CloudError('bad_request', 'empty value: nothing stored')
      c().vault.set(name, value, CLI_ACTOR)
      out(`${name} stored (encrypted).`)
    } else if (group === 'vault' && cmd === 'list') {
      const rows = c().vault.list()
      if (rows.length === 0) out('(the vault is empty)')
      for (const r of rows) out(`${r.name}\tcreated ${r.createdAt}\tupdated ${r.updatedAt}`)
    } else if (group === 'vault' && cmd === 'delete') {
      out(c().vault.delete(positional[0] ?? '', CLI_ACTOR) ? 'deleted' : 'no such secret')
    } else if (group === 'providers' && cmd === 'status') {
      out(`paidCalls: ${c().registry.paidCalls ? 'ON' : 'off'}`)
      for (const o of c().registry.overview()) out(`${o.usage}	${o.provider}	${o.status}${o.reason ? `	(${o.reason}${o.wanted ? `; configured: ${o.wanted}` : ''})` : ''}`)
      out('Comptes (clés ou connexions dans le coffre):')
      for (const line of accountLines(accountsStatus(c().vault, c().registry.enabledEngines()))) out(line)
      const alerts = c().providerAlerts.list()
      for (const a of alerts) out(`ALERTE	${a.provider}	${a.message}	(${a.raisedAt})`)
    } else if (group === 'providers' && cmd === 'signin') {
      if (positional[0] !== 'heygen') throw new CloudError('bad_request', 'usage: providers signin heygen [--port N]')
      const port = typeof flags.get('port') === 'string' ? Number(flags.get('port')) : undefined
      if (port !== undefined && !(Number.isInteger(port) && port > 1023 && port < 65536)) throw new CloudError('bad_request', '--port is a free port above 1023')
      await signInHeygen(c(), io.stdin, out, CLI_ACTOR, { ...(port !== undefined ? { port } : {}), ...(io.signIn ? { overrides: io.signIn } : {}) })
    } else if (group === 'providers' && cmd === 'try') {
      const usage = positional[0]
      const opt = (name: string): string | undefined => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : undefined)
      if (usage === 'talkingAvatar') {
        const cfg = io.cloud ? null : loadConfig(dataDirFromEnv(io.env), io.env)
        const budget = opt('budget-usd')
        await tryAvatar(
          c(),
          { engine: opt('engine'), image: opt('image'), audio: opt('audio'), resolution: opt('resolution'), bench: flags.get('bench') === true, budgetUsd: budget === undefined ? undefined : Number(budget), out: opt('out'), team: opt('team') },
          CLI_ACTOR,
          { publicUrl: cfg?.publicUrl, infinitetalk: cfg ? { ...cfg.infinitetalk } : { ...INFINITETALK_DEFAULTS } },
          out
        )
        return 0
      }
      if (usage !== 'synthesize' && usage !== 'analyseVideo') throw new CloudError('bad_request', 'usage: providers try synthesize|analyseVideo|talkingAvatar …')
      const minutes = opt('minutes')
      for (const line of await tryProvider(c(), { usage, voice: opt('voice'), engine: opt('engine'), text: opt('text'), url: opt('url'), minutes: minutes === undefined ? undefined : Number(minutes), out: opt('out') }, CLI_ACTOR)) out(line)
    } else if (group === 'providers' && cmd === 'heygen-tools') {
      // free: the HeyGen MCP server's own list of tools and their input schemas (tools/list), never a paid call
      const r = c().registry.resolveFor('talkingAvatar', { engine: 'presenter:heygen-mcp' })
      const adapter = r.adapter as ProviderAdapter & { tools?: (ctx: ProviderContext) => Promise<{ name: string; description?: string; inputSchema: unknown }[]> }
      if (r.status !== 'real' || !adapter.tools) throw new CloudError('bad_request', `presenter:heygen-mcp is not live: ${r.reason ?? 'unknown reason'}`)
      const refuse = (): never => {
        throw new CloudError('bad_request', 'not available here')
      }
      const list = await adapter.tools({
        signal: AbortSignal.timeout(60_000),
        progress: () => undefined,
        secret: () => c().vault.readForAdapter(adapter.secretName as string, adapter.id),
        saveSecret: (v: string) => c().vault.set(adapter.secretName as string, v, `adapter:${adapter.id}`),
        alert: (m: string | null) => c().providerAlerts.set(adapter.id, m),
        jobId: 'cli-heygen-tools',
        artefact: refuse,
        artefactUrl: refuse,
        callbackUrl: refuse,
        providerRef: () => null,
        setProviderRef: () => undefined
      })
      const only = positional[0]
      for (const t of list.filter((x) => !only || x.name.includes(only))) {
        out(c().vault.mask(`${t.name}\t${(t.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}`))
        if (only) out(c().vault.mask(JSON.stringify(t.inputSchema, null, 1)))
      }
    } else if (group === 'providers' && cmd === 'unifically-ledger') {
      // free reads: the balance and what each model really cost (providers/unifically-ledger.ts)
      const since = typeof flags.get('since') === 'string' ? Date.parse(flags.get('since') as string) / 1000 : Date.now() / 1000 - 86_400
      if (!Number.isFinite(since)) throw new CloudError('bad_request', '--since is a date (2026-11-01T00:00:00Z)')
      const l = await unificallyLedger(c().vault.readForAdapter('UNIFICALLY_API_KEY', 'cli:unifically-ledger'), since, AbortSignal.timeout(60_000))
      out(`balance\t$${l.balanceUsd.toFixed(4)}`)
      for (const m of l.models) out(`${m.model}\t${m.tasks} tasks (${m.failed} failed)\t$${m.costUsd.toFixed(4)}`)
      out(`total since ${new Date(since * 1000).toISOString()}\t$${l.totalUsd.toFixed(4)}`)
    } else if (group === 'providers' && cmd === 'bench-visual') {
      const opt = (name: string): string | undefined => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : undefined)
      const cfg = io.cloud ? null : loadConfig(dataDirFromEnv(io.env), io.env)
      const num = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v))
      await benchVisual(c(), { plan: opt('plan'), out: opt('out'), budgetUsd: num(opt('budget-usd')), parallel: num(opt('parallel')), team: opt('team') }, CLI_ACTOR, cfg?.publicUrl ?? opt('public-url'), out)
    } else if (group === 'admin') {
      await admin(cmd, positional, flags, c, io, out)
    } else if (group === 'releases' && cmd === 'list') {
      const latest = new Set(c().releases.latestAll().map((l) => l.releaseId))
      const all = c().releases.list()
      if (all.length === 0) out('(no release yet)')
      for (const r of all) out(`${r.version}\t${r.channel}/${r.platform}\t${r.state}${latest.has(r.id) ? ' (latest)' : ''}\t${r.files.length} files\t${r.id}`)
    } else if (group === 'billing') {
      billingCli(cmd, flags, c(), out)
    } else if (group === 'mail') {
      mailCli(cmd, positional, flags, c(), out)
    } else if (group === 'render' && cmd === 'status') {
      for (const r of renderStatus(c().vault)) out(`${r.backend}\t${r.missing.length === 0 ? 'clés présentes' : `manque : ${r.missing.join(', ')}`}`)
    } else if (group === 'render' && cmd === 'try') {
      const opt = (name: string): string | undefined => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : undefined)
      const bundle = opt('bundle')
      if (!bundle) throw new CloudError('bad_request', 'usage: render try --backend scaleway|modal|runpod --bundle DIR [--out DIR] [--timeout-s 900]')
      const timeout = opt('timeout-s')
      await tryRender(
        { vault: c().vault, blobs: c().storage.blobs, paidCalls: c().registry.paidCalls, out },
        { backend: opt('backend') ?? '', bundle, ...(opt('out') ? { outDir: opt('out') } : {}), ...(timeout ? { timeoutS: Number(timeout) } : {}) }
      )
    } else if (group === 'machines') {
      await machinesCli(cmd, positional, flags, c(), cloudUrlOf(io), CLI_ACTOR, out, io.cloud ? [] : loadConfig(dataDirFromEnv(io.env), io.env).machines.sshKeys)
    } else {
      throw new CloudError('bad_request', 'unknown command (see the header of cloud/src/cli.ts)')
    }
    return 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    io.stderr.write(`atelier-cloud: ${cloud ? (cloud as Cloud).vault.mask(msg) : msg}\n`)
    return 1
  } finally {
    if (cloud && !io.cloud) await (cloud as Cloud).close()
  }
}

async function admin(
  cmd: string | undefined,
  positional: string[],
  flags: Map<string, string | true>,
  c: () => Cloud,
  io: CliIo,
  out: (s: string) => void
): Promise<void> {
  const sub = positional[0]
  if (cmd === 'user' && sub === 'add') {
    const email = str(flags, 'email')
    const name = str(flags, 'name')
    const teamId = flags.get('team')
    const role = Role.parse(flags.get('role') ?? 'member')
    const password = await askSecret(`Mot de passe pour ${email} (${MIN_PASSWORD} caractères minimum, rien ne s'affiche) : `, io, flags)
    if (io.stdin.isTTY) {
      const again = await askSecret('Encore une fois : ', io, flags)
      if (again !== password) throw new CloudError('bad_request', 'the two passwords differ')
    }
    const { account, team } = c().accounts.createAccount({
      email,
      name,
      password,
      platformAdmin: flags.get('platform-admin') === true,
      internal: flags.get('internal') === true,
      teamId: typeof teamId === 'string' ? teamId : undefined,
      role,
      actor: CLI_ACTOR
    })
    out(`account ${account.id} (${account.email})${account.platformAdmin ? ' platform admin' : ''}`)
    out(`team ${team.id} "${team.name}"${team.internal ? ' internal (zero margin)' : ''}`)
  } else if (cmd === 'user' && sub === 'verify') {
    const account = c().accounts.accountByEmail(str(flags, 'email'))
    if (!account) throw new CloudError('not_found', 'no account with this e-mail address')
    out(c().accounts.markVerified(account.id) ? 'address marked verified' : 'this address was already verified')
  } else if (cmd === 'token') {
    const account = c().accounts.accountByEmail(str(flags, 'email'))
    if (!account) throw new CloudError('not_found', 'no account with this e-mail address')
    if (!account.platformAdmin) throw new CloudError('forbidden', 'this account is not a platform admin')
    const tokens = c().auth.issueForCli(account.id, 'Outil local (token admin)')
    // the token alone on stdout (so `$env:ATELIER_ADMIN_TOKEN = (npm run cloud --silent -- admin token …)` works); the hint goes to stderr
    out(tokens.accessToken)
    io.stderr.write(`atelier-cloud: access token of ${account.email}, valid ${Math.round(tokens.expiresIn / 60)} minutes (keep it out of git and logs)\n`)
  } else if (cmd === 'test-team') {
    testTeamCli(sub, flags, c(), CLI_ACTOR, out)
  } else if (cmd === 'team' && sub === 'list') {
    for (const t of c().accounts.teams()) {
      const w = c().wallet.state(t.id)
      out(`${t.id}\t${t.name}\t${t.test ? 'test' : t.internal ? 'internal' : 'customer'}\tmembers ${t.members}\tbalance ${w.balance}\tavailable ${w.available}`)
    }
  } else if (cmd === 'grant') {
    const teamId = str(flags, 'team')
    c().accounts.team(teamId)
    const credits = Number(str(flags, 'credits'))
    const key = typeof flags.get('key') === 'string' ? (flags.get('key') as string) : `cli:${randomBytes(9).toString('base64url')}`
    const note = flags.get('note')
    const m = c().wallet.grant({ teamId, credits, idemKey: key, note: typeof note === 'string' ? note : null, actor: CLI_ACTOR })
    out(`${m.replayed ? 'already granted' : 'granted'} ${credits} credits to ${teamId}: balance ${m.state.balance}, available ${m.state.available}`)
  } else if (cmd === 'caps') {
    const teamId = str(flags, 'team')
    const account = c().accounts.accountByEmail(str(flags, 'email'))
    if (!account) throw new CloudError('not_found', 'no account with this e-mail address')
    const m = c().accounts.membership(teamId, account.id)
    const daily = capValue(flags.get('daily'), m.dailyCap)
    const monthly = capValue(flags.get('monthly'), m.monthlyCap)
    c().db.prepare('UPDATE members SET daily_cap = ?, monthly_cap = ? WHERE team_id = ? AND account_id = ?').run(daily, monthly, teamId, account.id)
    c().audit.record(CLI_ACTOR, 'member.caps', account.id, { team: teamId, daily, monthly })
    out(`caps of ${account.email}: daily ${daily ?? 'none'}, monthly ${monthly ?? 'none'}`)
  } else if (cmd === 'price') {
    await price(sub, positional.slice(1), flags, c(), out)
  } else if (cmd === 'pnl') {
    const rows = pnl(c().db, { from: str(flags, 'from'), to: str(flags, 'to'), includeDemo: flags.get('demo') === true })
    if (rows.length === 0) out('(no settled job in this period)')
    for (const r of rows) {
      out(`${r.day}\t${r.provider}\tjobs ${r.jobs}\tcredits ${r.creditsSold}\trevenue €${r.revenueEur}\tcost €${r.costEur}\tmargin €${r.marginEur}\tloss jobs ${r.lossJobs}`)
    }
  } else if (cmd === 'margin') {
    if (sub === 'set') {
      const v = positional[1] ?? ''
      c().finance.setMultiplier(v === 'grid' ? null : Number(v), CLI_ACTOR)
    } else if (sub !== undefined && sub !== 'show') throw new CloudError('bad_request', 'admin margin [show] | admin margin set MULTIPLIER|grid')
    const m = c().finance.multiplier()
    out(m === null ? 'prices: each grid line’s own margin (admin price show)' : `prices: real cost × ${m}${m === 1 ? ' (at cost, margin 0 %)' : ''}`)
  } else if (cmd === 'fx') {
    if (sub === 'set') {
      const date = flags.get('date')
      c().finance.setFx(Number(positional[1] ?? ''), typeof date === 'string' ? date : new Date(c().clock.now()).toISOString().slice(0, 10), CLI_ACTOR)
    } else if (sub !== undefined && sub !== 'show') throw new CloudError('bad_request', 'admin fx [show] | admin fx set EUR_PER_USD [--date YYYY-MM-DD]')
    const fx = c().finance.fx()
    out(`$1 = €${fx.eurPerUsd} (rate of ${fx.asOf})`)
  } else if (cmd === 'device' && sub === 'revoke') {
    c().auth.revokeDevice(positional[1] ?? '', { accountId: CLI_ACTOR, platformAdmin: true })
    out('device revoked')
  } else if (cmd === 'audit') {
    for (const e of c().audit.list(100)) out(`${e.at}\t${e.actor}\t${e.action}\t${e.target ?? ''}`)
  } else {
    throw new CloudError('bad_request', 'unknown admin command (see the header of cloud/src/cli.ts)')
  }
}

async function price(sub: string | undefined, args: string[], flags: Map<string, string | true>, cloud: Cloud, out: (s: string) => void): Promise<void> {
  const grid = cloud.pricing.current()
  if (sub === 'show') {
    out(`grid v${grid.version}: 1 credit = €${grid.creditValueEur}, $1 = €${grid.usdToEur}, overhead ${grid.overheadPct} %`)
    for (const i of grid.items) {
      const how = i.pricing.mode === 'percent' ? `margin ${i.pricing.marginPct} %` : `fixed ${i.pricing.creditsPerUnit} credits/${i.unit}`
      out(`${i.item}\t${i.usage}\t$${i.providerCostUsd}/${i.unit}\treference ${i.referenceEur === null ? 'none' : `€${i.referenceEur}`}\t${how}`)
    }
    return
  }
  const base = { creditValueEur: grid.creditValueEur, usdToEur: grid.usdToEur, overheadPct: grid.overheadPct, items: grid.items }
  let next: unknown
  if (sub === 'credit-value') {
    next = { ...base, creditValueEur: Number(args[0]), note: `credit value €${args[0]}` }
  } else if (sub === 'set') {
    const name = args[0] ?? ''
    const item = grid.items.find((i) => i.item === name)
    if (!item) throw new CloudError('not_found', `no item ${name} in grid v${grid.version}`)
    const updated: PriceItem = { ...item }
    if (typeof flags.get('cost') === 'string') updated.providerCostUsd = Number(flags.get('cost'))
    const ref = flags.get('reference')
    if (typeof ref === 'string') updated.referenceEur = ref === 'none' ? null : Number(ref)
    const margin = flags.get('margin')
    const fixed = flags.get('fixed')
    if (typeof margin === 'string' && typeof fixed === 'string') throw new CloudError('bad_request', 'either --margin or --fixed')
    if (margin === true) {
      const costEur = updated.providerCostUsd * grid.usdToEur * (1 + grid.overheadPct / 100)
      updated.pricing = { mode: 'percent', marginPct: suggestedMarginPct(costEur, updated.referenceEur) }
    } else if (typeof margin === 'string') updated.pricing = { mode: 'percent', marginPct: Number(margin) }
    else if (typeof fixed === 'string') updated.pricing = { mode: 'fixed', creditsPerUnit: Number(fixed) }
    next = { ...base, items: grid.items.map((i) => (i.item === name ? updated : i)), note: `${name} changed` }
  } else {
    throw new CloudError('bad_request', 'usage: admin price show | set ITEM ... | credit-value EUR')
  }
  const { grid: published, warnings } = cloud.pricing.publishChecked(PriceGridInput.parse(next), CLI_ACTOR)
  out(`price grid v${published.version} published`)
  for (const w of warnings) out(`warning: ${w.item} margin ${w.marginPct} % is outside its tier (${w.tierPct} %)`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli(process.argv.slice(2), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env }).then(
    (code) => process.exit(code),
    () => process.exit(1)
  )
}
