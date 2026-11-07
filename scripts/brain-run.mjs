// THE sanctioned way a Claude session makes a real (paid) run (docs/BRAIN-HEADLESS.md §11, COMMUN.md « Vraies
// fabrications »). It starts or reuses a headless brain signed in with a test team's key (--token-file, record 0066),
// calls its RPC, quotes a project, REFUSES to start above --max-usd, runs it, watches it (spend cap, stall, gates), and
// prints ONE JSON report on stdout (progress goes to stderr). Plain Node, no TypeScript, so one permission rule covers
// every real run: `Bash(node scripts/brain-run.mjs:*)`.
//
//   node scripts/brain-run.mjs start  --data <dir> --token-file <test-team key> [--port n] [--mcp: the agents get Atelier's tools]  (default: a free port, kept in
//     <dir>/brain-run.state.json; every call first checks that the brain serves <dir>, so sessions never cross brains)
//   node scripts/brain-run.mjs call   --data <dir> <method> ['<json args array>'] [--max-usd X for a spending method]
//   node scripts/brain-run.mjs quote  --data <dir> <projectId>
//   node scripts/brain-run.mjs run    --data <dir> <projectId> --max-usd X [--wait-min 120] [--stall-min 20]
//   node scripts/brain-run.mjs run    --data <dir> <projectId> --demo   (free demo run: refused unless the quote debits nothing;
//     the cap is 0 $, so any spend cancels it)
//   node scripts/brain-run.mjs wait   --data <dir> <runId> --max-usd X
//   node scripts/brain-run.mjs approve --data <dir> <runId> <nodeId> --max-usd X
//   node scripts/brain-run.mjs stop   --data <dir>
//   « Créer une pipeline » as a user does it (the cloning engine P0→P10, moteur-assemblage):
//   node scripts/brain-run.mjs clone say    --data <dir> "<message>" [--intake <file>]   (one intake turn; the draft is kept
//     in <file>, default <dir>/clone-intake.json; prints the agent's French answer and what is still missing)
//   node scripts/brain-run.mjs clone start  --data <dir> --max-usd X [--intake <file>]   (refused when the brief's test budget
//     is above X; the clone then works in the brain's background, within that budget)
//   node scripts/brain-run.mjs clone follow --data <dir> <cloneId> [--wait-min 600]      (until a report or a stop)
//   node scripts/brain-run.mjs clone answer --data <dir> <cloneId> "<style>" --max-usd X (optional: override the style P2 picked)
//   node scripts/brain-run.mjs clone resume --data <dir> <cloneId> --max-usd X [--budget Y]
//     Nothing inside a clone waits for a person (decision 0110): the free gate passed, the paid rounds start; only the test
//     budget stops it (resume with a bigger --budget).
//   node scripts/brain-run.mjs clone report --data <dir> <cloneId>   ·   clone list --data <dir>
//   Charlie's video order (equipe-3-chaines, brain-run-order.mjs): his message to Atlas, the videos followed under ONE cap:
//   node scripts/brain-run.mjs order --data <dir> --message-file <file> --max-usd X [--demo] [--direct --each-usd Y] [--wait-min 240]
//   A channel's production pipeline reverse-engineered (reverse-pipeline, brain-run-reverse.mjs; ids are clone ids):
//   node scripts/brain-run.mjs reverse start --data <dir> --max-usd X --request-file <json>   (refused when its testBudgetUsd > X)
//   node scripts/brain-run.mjs reverse follow <id> [--wait-min N] · reverse result <id> [--out <file>] · reverse list
//   node scripts/brain-run.mjs reverse transform <id> --transform-file <json> --max-usd X · reverse prove <id> --budget Y --max-usd X
//
// Exit codes: 0 done, 1 error, 2 bad usage, 3 quote above --max-usd (nothing started), 4 waiting at a gate (a run's review
// gate; a clone never waits for a person),
// 5 spend passed --max-usd (run cancelled), 6 run failed / cancelled / interrupted, 7 stalled or --wait-min reached.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { orderCommand } from './brain-run-order.mjs'
import { reverseCommand } from './brain-run-reverse.mjs'

export const STATE_FILE = 'brain-run.state.json'
export const ACCESS_FILE = 'brain-run.access'
export const PID_FILE = 'brain-run.pid'
export const LOG_FILE = 'brain-run.log'
export const EXIT = { ok: 0, error: 1, usage: 2, overQuote: 3, gate: 4, overSpend: 5, runFailed: 6, stalled: 7 }

/** Methods that can spend money on Atelier Cloud: `call` refuses them without --max-usd; `run`/`approve` watch them. */
export const SPENDING = [
  /^projects\.run$/,
  /^production\.(start|retry|resume|redo|approve|requestChanges)$/,
  /^channelVoices\.(design|clone|fromChannelVideo|cloneOn|blindTest)$/,
  /^channelPresenters\.(portrait|clone|angles|clean|register)$/,
  /^channelClips\.fromStock$/,
  /^analysis\.(start|answer|chat|createPipeline)$/,
  /^eyes\./,
  /^styleAgent\./,
  // « Créer une pipeline » (essais-utilisateur): the eyes watch the references, a sample is a real run
  /^style\.(study|sample)$/,
  // « Créer une pipeline » on the cloning engine: a clone reads videos and runs rounds within its brief's test budget
  /^clone\.(start|resume|answer)$/,
  /^pipelineAgent\./,
  // Charlie's video orders: each ordered video is a real run (use `order`)
  /^orders\.place$/,
  // reverse-pipeline: a reverse-engineered pipeline reads videos and proves itself with paid rounds (use `reverse`)
  /^reverse\.(start|transform|prove)$/
]
export const isSpending = (method) => SPENDING.some((re) => re.test(method))
/** Methods that start a run outside the runner's watch: refused by `call` (use `run`, `wait`, `approve`). */
export const RUN_STARTERS = /^(projects\.run|production\.(start|retry|resume|redo|remake)|clone\.(start|resume|answer)|orders\.place|reverse\.(start|transform|prove))$/

/**
 * The credits a call can spend from: the team's Atelier Cloud wallet when the brain is signed in (the eyes and the engines
 * bill it), else the local ledger (essais-utilisateur: `credits.balance` alone read 0 -> 0 on a connected brain).
 */
export async function available(brain) {
  try {
    const a = await brain.call('cloud.account')
    if (a && typeof a.wallet?.available === 'number') return a.wallet.available
  } catch {
    // not signed in: the local ledger below
  }
  return (await brain.call('credits.balance')).available
}

export class UsageError extends Error {}

/**
 * The brain's options: no backup; without the MCP bridge (the agents' tools) unless --mcp — a production run needs no
 * agent, the team at work does (production-equipe: without it the agents could not prepare or launch a project).
 */
export function brainExtra(o) {
  return ['--token-file', o.tokenFile, ...(o.mcp ? [] : ['--no-mcp']), '--no-backup', ...(o.cloudUrl ? ['--cloud-url', o.cloudUrl] : [])]
}

export function parseArgs(argv) {
  const o = { command: argv[0], rest: [], intake: null, budget: null, data: null, tokenFile: null, keyFile: null, port: null, cloudUrl: null, accessFile: null, maxUsd: null, waitMin: 120, stallMin: 20, pollS: 10, mode: null, demo: false, mcp: false, messageFile: null, direct: false, eachUsd: null }
  if (!o.command || o.command.startsWith('--')) throw new UsageError('commande manquante : start | call | quote | run | wait | approve | clone | order | stop')
  const num = (raw, flag) => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) throw new UsageError(`${flag} : un nombre positif (reçu ${raw})`)
    return n
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new UsageError(`${a} attend une valeur`)
      return v
    }
    if (a === '--data') o.data = path.resolve(value())
    else if (a === '--token-file') o.tokenFile = path.resolve(value())
    else if (a === '--key-file') o.keyFile = path.resolve(value())
    else if (a === '--access-file') o.accessFile = path.resolve(value())
    else if (a === '--port') o.port = num(value(), a)
    else if (a === '--cloud-url') o.cloudUrl = value()
    else if (a === '--max-usd') o.maxUsd = num(value(), a)
    else if (a === '--intake') o.intake = path.resolve(value())
    else if (a === '--budget') o.budget = num(value(), a)
    else if (a === '--wait-min') o.waitMin = num(value(), a)
    else if (a === '--stall-min') o.stallMin = num(value(), a)
    else if (a === '--poll-s') o.pollS = num(value(), a)
    else if (a === '--mode') o.mode = value()
    else if (a === '--demo') o.demo = true
    else if (a === '--mcp') o.mcp = true
    else if (a === '--message-file') o.messageFile = path.resolve(value())
    else if (a === '--direct') o.direct = true
    else if (a === '--each-usd') o.eachUsd = num(value(), a)
    else if (a === '--request-file') o.requestFile = path.resolve(value())
    else if (a === '--transform-file') o.transformFile = path.resolve(value())
    else if (a === '--out') o.out = path.resolve(value())
    else if (a.startsWith('--')) throw new UsageError(`option inconnue : ${a}`)
    else o.rest.push(a)
  }
  if (!o.data) throw new UsageError('--data <dossier du cerveau> est obligatoire (hors du dépôt git)')
  if (o.mode !== null && o.mode !== 'usage_max' && o.mode !== 'qualite_max') throw new UsageError('--mode : usage_max ou qualite_max')
  if (o.demo) o.maxUsd = 0
  if (o.command === 'order' && o.maxUsd === null) throw new UsageError('order : --max-usd est obligatoire (plafond de toute la commande)')
  if (['run', 'wait', 'approve'].includes(o.command) && o.maxUsd === null) throw new UsageError(`${o.command} : --max-usd est obligatoire`)
  if (o.command === 'clone' && ['start', 'resume', 'answer'].includes(o.rest[0]) && o.maxUsd === null) throw new UsageError(`clone ${o.rest[0]} : --max-usd est obligatoire`)
  if (o.command === 'reverse' && ['start', 'transform', 'prove'].includes(o.rest[0]) && o.maxUsd === null) throw new UsageError(`reverse ${o.rest[0]} : --max-usd est obligatoire`)
  return o
}

/** Credits are euro cents (1 credit = 0,01 €); `usdToEur` is the brain's rate (money.overview). */
export const creditsToUsd = (credits, usdToEur) => credits / 100 / (usdToEur > 0 ? usdToEur : 0.92)

/** The quote's total in the run's budget mode, and whether it fits the cap. */
export function judgeQuote(quote, maxUsd, usdToEur, mode = null) {
  const m = mode ?? quote.budgetMode ?? 'usage_max'
  const credits = quote.modes?.[m]?.totalCredits ?? Math.max(...Object.values(quote.modes ?? {}).map((q) => q.totalCredits))
  const usd = creditsToUsd(credits, usdToEur)
  const problems = []
  if (quote.demo) problems.push(`devis en démo : ${quote.demoReason || 'Atelier Cloud non relié'}`)
  if (quote.real && !quote.real.available) problems.push(`moteur réel indisponible : ${quote.real.reason}`)
  for (const w of quote.modes?.[m]?.warnings ?? []) problems.push(w)
  if (usd > maxUsd) problems.push(`devis ${usd.toFixed(3)} $ au-dessus du plafond ${maxUsd} $`)
  return { mode: m, credits, usd: round(usd), ok: problems.length === 0, problems }
}

/** A demo run (stand-in voice, drawn pictures, real editing and render) is started only when it debits nothing. */
export function judgeDemoQuote(quote) {
  const problems = []
  if (quote.demo !== true) problems.push('le devis n’est pas une démo : utilise run --max-usd')
  if (quote.debited !== false) problems.push('la démo débiterait des crédits')
  return { ok: problems.length === 0, problems }
}

/** What one poll of a run says: done, stop (with exit code) or keep waiting. Pure, for the tests. */
export function judgeRun(run, s) {
  const spentUsd = creditsToUsd(run.spentCredits, s.usdToEur)
  if (spentUsd > s.maxUsd) return { stop: EXIT.overSpend, reason: `dépense ${spentUsd.toFixed(3)} $ au-dessus du plafond ${s.maxUsd} $ : arrêt` }
  if (run.status === 'succeeded') return { stop: EXIT.ok, reason: 'terminé' }
  if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') return { stop: EXIT.runFailed, reason: `${run.status} : ${run.error ?? 'sans raison donnée'}` }
  if (run.status === 'waiting') return { stop: EXIT.gate, reason: `attend une validation : ${run.waitingNodes.join(', ')}` }
  const sign = JSON.stringify([run.status, run.progress, run.current?.nodeId, run.current?.step, run.spentCredits])
  const now = s.now
  if (sign !== s.lastSign) return { stop: null, sign, since: now }
  if (now - s.since > s.stallMin * 60_000) return { stop: EXIT.stalled, reason: `rien n’a bougé depuis ${s.stallMin} min (${run.current?.label ?? 'aucune étape'} : ${run.current?.step ?? '—'})` }
  if (now - s.started > s.waitMin * 60_000) return { stop: EXIT.stalled, reason: `pas fini après ${s.waitMin} min` }
  return { stop: null, sign, since: s.since }
}

/** The report of a run: spend, outputs, which engines were real, any demo item (a real run must have none). */
export function report(run, usdToEur, quote) {
  const demoItems = []
  for (const n of run.nodes ?? []) for (const e of n.engines ?? []) if (!e.real) demoItems.push(`${n.nodeId}: ${e.id}`)
  return {
    runId: run.id,
    status: run.status,
    demo: run.demo,
    cloud: run.cloud,
    error: run.error,
    quote: quote ?? { credits: run.quoteCredits, usd: round(creditsToUsd(run.quoteCredits, usdToEur)) },
    spent: { credits: run.spentCredits, usd: round(creditsToUsd(run.spentCredits, usdToEur)) },
    captureOverQuote: run.quoteCredits > 0 ? round(run.spentCredits / run.quoteCredits) : null,
    durationS: run.durationS,
    videoFileRef: run.videoFileRef,
    packageDir: run.packageDir,
    demoItems,
    notes: run.notes ?? [],
    nodes: (run.nodes ?? []).map((n) => ({ id: n.nodeId, state: n.state, quote: n.quoteCredits, credits: n.credits, engines: (n.engines ?? []).map((e) => `${e.id}${e.real ? '' : ' (démo)'}`), error: n.error?.message ?? null }))
  }
}

const round = (n) => Math.round(n * 1000) / 1000
const say = (line) => void process.stderr.write(`[brain-run] ${line}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export class Brain {
  /** `seenAs`: the data folder as the brain itself sees it, when it runs in a container with the folder mounted
   *  (scripts/vps-brain.mjs writes it as `brainData` in the state file). */
  constructor(url, token, fetchImpl = fetch, expectData = null, seenAs = null) {
    this.url = url
    this.token = token
    this.fetch = fetchImpl
    this.expectData = expectData
    this.seenAs = seenAs
    this.checked = false
  }

  async call(method, args = [], timeoutMs = 120_000) {
    if (this.expectData && !this.checked) await this.checkData()
    const res = await this.fetch(`${this.url}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    // a brain of another data folder (another session on that port) refuses this folder's token: never talk to it
    if (res.status === 401) throw new Error(`le cerveau sur ${this.url} n’est pas celui de ce dossier --data (jeton refusé) : rien n’est envoyé`)
    const body = await res.json()
    if (!body.ok) throw new Error(`${method} : ${body.error?.detail ?? body.error?.message ?? 'erreur'} (${body.error?.code ?? '?'})`)
    return body.value
  }

  /** The brain serves the expected data folder (its database is inside it), else nothing is sent (sessions' ports collide). */
  async checkData() {
    this.checked = true
    const info = await this.call('app.info')
    const folder = this.seenAs ?? this.expectData
    // a brain in a Linux container answers a POSIX path whatever the host is
    const p = folder.startsWith('/') ? path.posix : path
    const db = p.resolve(info.dbPath ?? '')
    if (!db.toLowerCase().startsWith(p.resolve(folder).toLowerCase() + p.sep)) {
      this.checked = false
      throw new Error(`le cerveau sur ${this.url} sert ${p.dirname(db)}, pas ${folder} : refusé`)
    }
  }

  async rate() {
    try {
      return (await this.call('money.overview')).usdToEur || 0.92
    } catch {
      return 0.92
    }
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function healthy(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

function insideGit(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git'))) return true
    if (path.dirname(d) === d) return false
  }
}

function headlessCommand(o, extra) {
  const args = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/ts-transpile.mjs', 'src/main/headless/main.ts', '--data', o.data, '--key-file', o.keyFile ?? path.join(path.dirname(o.data), 'machine.key'), '--port', String(o.port)]
  return [...args, ...extra]
}

function saveAccess(o, token) {
  const file = o.accessFile ?? path.join(o.data, ACCESS_FILE)
  writeFileSync(file, token + '\n', { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows: ACLs of the user's profile */
  }
}

const tokenIn = (text) => /\b(atb_[A-Za-z0-9_-]{20,})\b/.exec(text)?.[1] ?? null

/** Starts the brain (or reuses the one on --port) and returns a client. The access token is made offline first
 *  (--rotate-token, read from that short process's pipe) and kept in <data>/brain-run.access: the brain itself then
 *  prints no token, and its output goes straight to <data>/brain-run.log (it outlives this process). */
export async function ensureBrain(o) {
  const stateFile = path.join(o.data, STATE_FILE)
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null
  // the port: given, else the one this folder's brain used, else a free one (fixed ports collided between sessions)
  o.port = o.port ?? state?.port ?? (await freePort())
  const url = `http://127.0.0.1:${o.port}`
  const accessFile = o.accessFile ?? path.join(o.data, ACCESS_FILE)
  if (insideGit(o.data)) throw new UsageError(`--data ${o.data} est dans un dépôt git : choisis un dossier hors du dépôt (données et jeton)`)
  if (await healthy(url)) {
    if (!existsSync(accessFile)) throw new UsageError(`un cerveau tourne déjà sur ${o.port} mais ${accessFile} n’existe pas : --access-file <son jeton>, ou un autre --port`)
    const brain = new Brain(url, readFileSync(accessFile, 'utf8').trim(), fetch, o.data, state?.brainData ?? null)
    await brain.checkData()
    return brain
  }
  if (state?.brainData) throw new UsageError(`le cerveau de ${o.data} tourne dans un conteneur (${state.container ?? '?'}) et ne répond pas sur ${o.port} : node scripts/vps-brain.mjs start`)
  if (state?.port === o.port && !(await portFree(o.port))) throw new UsageError(`le port ${o.port} est pris par un autre programme : supprime ${stateFile} ou passe --port`)
  if (!o.tokenFile) throw new UsageError('aucun cerveau sur ce port : --token-file <clé de l’équipe de test> pour le démarrer')
  mkdirSync(o.data, { recursive: true })
  const node = process.execPath
  if (!existsSync(accessFile)) {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(node, headlessCommand(o, ['--rotate-token']), { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let text = ''
      p.stdout.on('data', (b) => (text += b))
      p.stderr.on('data', (b) => (text += b))
      p.on('exit', (code) => (code === 0 ? resolve(text) : reject(new Error(`--rotate-token a échoué (${code}) : ${text.replace(/atb_[A-Za-z0-9_-]+/g, 'atb_…').trim()}`))))
    })
    const t = tokenIn(out)
    if (!t) throw new Error('--rotate-token : jeton introuvable dans la sortie')
    saveAccess(o, t)
  }
  const log = path.join(o.data, LOG_FILE)
  const fd = openSync(log, 'a')
  const extra = brainExtra(o)
  const child = spawn(node, headlessCommand(o, extra), { cwd: repoRoot, detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
  closeSync(fd)
  writeFileSync(path.join(o.data, PID_FILE), String(child.pid))
  writeFileSync(stateFile, JSON.stringify({ port: o.port, data: o.data, pid: child.pid }, null, 2))
  let exited = null
  child.on('exit', (code) => (exited = code ?? -1))
  child.unref()
  const deadline = Date.now() + 120_000
  while (!(await healthy(url))) {
    if (exited !== null) throw new Error(`le cerveau s’est arrêté au démarrage (code ${exited}) : voir ${log}`)
    if (Date.now() > deadline) throw new Error(`le cerveau n’a pas démarré en 2 min : voir ${log}`)
    await sleep(500)
  }
  say(`cerveau prêt sur ${url} (journal ${log})`)
  const brain = new Brain(url, readFileSync(accessFile, 'utf8').trim(), fetch, o.data)
  await brain.checkData()
  return brain
}

/** Watches a run until it ends, stops at a gate, passes the cap (then cancels it) or stalls. */
/**
 * « Je te crée un exemple ? » answered « oui » the way the user does (essais-marcel): `run <project>` skipped the conversation's own
 * yes, so the placeholders it makes first (a generated presenter, the default voice) were never made. The project's real quote is
 * checked against the cap first (nothing is said above it), then the conversation's yes starts the run, followed under the cap.
 */
/** Where `clone say` keeps the intake draft between two messages. */
export const intakeFile = (o) => o.intake ?? path.join(o.data, 'clone-intake.json')

/** What a clone's state means for the runner: done, a stop, or keep waiting. Pure. */
export function judgeClone(progress) {
  const st = progress.state ?? { kind: 'idle' }
  if (st.kind === 'done') return { stop: EXIT.ok, reason: `fini : ${st.outcome}` }
  if (st.kind === 'stopped') return { stop: EXIT.runFailed, reason: `arrêté : ${st.why}` }
  if (st.kind === 'idle') return { stop: EXIT.runFailed, reason: 'ne travaille pas (reprends-le avec clone resume)' }
  return { stop: null, reason: null }
}

const fileIo = {
  read: (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null),
  write: (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n'),
  clock: Date.now
}

/** The clone commands (« Créer une pipeline » as a user does it). `io` reads and writes the intake draft. */
export async function cloneCommand(brain, o, io = fileIo) {
  const [sub, ...args] = o.rest
  const file = intakeFile(o)
  if (sub === 'say') {
    const message = args.join(' ').trim()
    if (!message) throw new UsageError('clone say "<message>"')
    const state = io.read(file) ?? (await brain.call('clone.intakeStart'))
    const turn = await brain.call('clone.intakeTurn', [state, message])
    io.write(file, turn.state)
    return { code: EXIT.ok, report: { text: turn.text, ready: turn.ready, missing: turn.missing, changes: turn.changes, draft: turn.state.draft, intake: file } }
  }
  if (sub === 'start') {
    const state = io.read(file)
    if (!state) throw new UsageError(`aucun brief en cours (${file}) : commence par clone say`)
    const budget = state.draft?.testBudgetUsd
    if (typeof budget === 'number' && budget > o.maxUsd) return { code: EXIT.overQuote, report: { started: false, problems: [`le budget d’essai du brief (${budget} $) dépasse le plafond ${o.maxUsd} $`] } }
    const r = await brain.call('clone.start', [state])
    io.write(file, null)
    return { code: EXIT.ok, report: { started: true, cloneId: r.cloneId, budgetUsd: budget } }
  }
  if (sub === 'list') return { code: EXIT.ok, report: await brain.call('clone.list') }
  const id = args[0]
  if (!id) throw new UsageError(`clone ${sub} <cloneId>`)
  if (sub === 'report') {
    const [report, progress] = await Promise.all([brain.call('clone.report', [id]), brain.call('clone.progress', [id])])
    return { code: report ? EXIT.ok : EXIT.runFailed, report: { cloneId: id, folder: path.join(o.data, 'clones', id), state: progress.state, spentUsd: progress.spentUsd, report } }
  }
  if (sub === 'answer' || sub === 'resume') {
    const budget = o.budget ?? (await brain.call('clone.progress', [id])).budgetUsd
    if (typeof budget === 'number' && budget > o.maxUsd) return { code: EXIT.overQuote, report: { cloneId: id, started: false, problems: [`le budget d’essai du clonage (${budget} $) dépasse le plafond ${o.maxUsd} $ : donne --budget ≤ ${o.maxUsd}`] } }
  }
  if (sub === 'answer') {
    const style = args.slice(1).join(' ').trim()
    if (!style) throw new UsageError('clone answer <cloneId> "<style>"')
    return { code: EXIT.ok, report: await brain.call('clone.answer', [id, style]) }
  }
  if (sub === 'resume') {
    return { code: EXIT.ok, report: await brain.call('clone.resume', [id, o.budget ?? undefined]) }
  }
  if (sub === 'follow') {
    const started = io.clock()
    let last = ''
    for (;;) {
      const p = await brain.call('clone.progress', [id])
      const line = `${p.now?.key ?? ''} ${JSON.stringify(p.now?.vars ?? {})} · ${p.spentUsd} $`
      if (line !== last) { say(`clone ${id} ${line}`); last = line }
      const v = judgeClone(p)
      const out = () => ({ cloneId: id, reason: v.reason, state: p.state, spentUsd: p.spentUsd, budgetUsd: p.budgetUsd, steps: p.steps.map((s) => `${s.step}: ${s.status}`), recent: p.recent })
      if (v.stop !== null) return { code: v.stop, report: out() }
      if (io.clock() - started > o.waitMin * 60_000) return { code: EXIT.stalled, report: { ...out(), reason: `pas fini après ${o.waitMin} min (il continue dans le cerveau)` } }
      await sleep(o.pollS * 1000)
    }
  }
  throw new UsageError(`clone ${sub ?? ''} : say | start | follow | answer | resume | report | list`)
}

export async function watch(brain, runId, o, quote, clock = Date.now) {
  const usdToEur = await brain.rate()
  const s = { maxUsd: o.maxUsd, usdToEur, stallMin: o.stallMin, waitMin: o.waitMin, lastSign: null, since: clock(), started: clock(), now: clock() }
  for (;;) {
    const run = await brain.call('production.get', [runId])
    s.now = clock()
    const v = judgeRun(run, s)
    if (v.stop === null) {
      if (v.sign !== s.lastSign) say(`run ${runId} ${run.status} ${Math.round(run.progress * 100)} % ${run.current?.label ?? ''} ${run.current?.step ?? ''} · ${creditsToUsd(run.spentCredits, usdToEur).toFixed(3)} $`)
      s.lastSign = v.sign
      s.since = v.since
      await sleep(o.pollS * 1000)
      continue
    }
    if (v.stop === EXIT.overSpend) await brain.call('production.cancel', [runId]).catch((e) => say(`annulation impossible : ${e.message}`))
    const final = v.stop === EXIT.overSpend ? await brain.call('production.get', [runId]) : run
    return { code: v.stop, reason: v.reason, report: report(final, usdToEur, quote) }
  }
}

async function main(argv) {
  const o = parseArgs(argv)
  const print = (v) => void process.stdout.write(JSON.stringify(v, null, 2) + '\n')
  if (o.command === 'stop') {
    const pidFile = path.join(o.data, PID_FILE)
    if (!existsSync(pidFile)) return print({ stopped: false, reason: 'aucun cerveau lancé par brain-run ici' }), EXIT.ok
    const pid = Number(readFileSync(pidFile, 'utf8'))
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    return print({ stopped: true, pid }), EXIT.ok
  }
  const brain = await ensureBrain(o)
  if (o.command === 'start') return print({ url: brain.url, port: o.port, data: o.data }), EXIT.ok
  if (o.command === 'call') {
    const [method, raw] = o.rest
    if (!method) throw new UsageError('call <méthode> [\'[arguments JSON]\']')
    if (RUN_STARTERS.test(method)) throw new UsageError(`${method} lance une fabrication : utilise « run » (devis, plafond, suivi)`)
    if (isSpending(method) && o.maxUsd === null) throw new UsageError(`${method} peut dépenser : --max-usd est obligatoire`)
    // '@<file>' reads the JSON arguments from a file (an audio sample's bytes do not fit a command line)
    const args = raw ? JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw) : []
    if (!Array.isArray(args)) throw new UsageError('les arguments sont un tableau JSON')
    const before = isSpending(method) ? await available(brain) : null
    const value = await brain.call(method, args, 600_000)
    if (before === null) return print({ method, value }), EXIT.ok
    const after = await available(brain)
    const usdToEur = await brain.rate()
    const spentUsd = round(creditsToUsd(Math.max(0, before - after), usdToEur))
    print({ method, value, spent: { usd: spentUsd, overCap: spentUsd > o.maxUsd } })
    return spentUsd > o.maxUsd ? EXIT.overSpend : EXIT.ok
  }
  if (o.command === 'order') {
    const r = await orderCommand(brain, o, { EXIT, creditsToUsd, UsageError, readText: (f) => readFileSync(f, 'utf8') })
    print(r.report)
    return r.code
  }
  if (o.command === 'clone') {
    const r = await cloneCommand(brain, o)
    print(r.report)
    return r.code
  }
  if (o.command === 'reverse') {
    const r = await reverseCommand(brain, o, { EXIT, UsageError, readJson: (f) => JSON.parse(readFileSync(f, 'utf8')), writeJson: (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n') })
    print(r.report)
    return r.code
  }
  const id = Number(o.rest[0])
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`${o.command} <identifiant>`)
  if (o.command === 'run' && o.demo) {
    const quote = await brain.call('projects.quote', [id, { real: false }])
    const verdict = judgeDemoQuote(quote)
    if (!verdict.ok) return print({ projectId: id, started: false, ...verdict }), EXIT.overQuote
    say('démo gratuite : lancement')
    const project = await brain.call('projects.run', [id])
    if (!project.runId) throw new Error('projects.run n’a pas donné de run')
    const w = await watch(brain, project.runId, o, { credits: 0, usd: 0 })
    print({ projectId: id, demo: true, reason: w.reason, ...w.report })
    return w.code
  }
  if (o.command === 'quote' || o.command === 'run') {
    const quote = await brain.call('projects.quote', [id, { real: true }])
    const usdToEur = await brain.rate()
    const verdict = judgeQuote(quote, o.maxUsd ?? Infinity, usdToEur, o.mode)
    if (o.command === 'quote') return print({ projectId: id, ...verdict, minutes: quote.minutes, pipeline: quote.pipelineId }), EXIT.ok
    if (!verdict.ok) return print({ projectId: id, started: false, ...verdict }), EXIT.overQuote
    say(`devis ${verdict.usd} $ (${verdict.credits} crédits) ≤ ${o.maxUsd} $ : lancement`)
    const project = await brain.call('projects.run', [id, { real: true }])
    if (!project.runId) throw new Error('projects.run n’a pas donné de run')
    const w = await watch(brain, project.runId, o, { credits: verdict.credits, usd: verdict.usd })
    print({ projectId: id, reason: w.reason, ...w.report })
    return w.code
  }
  if (o.command === 'wait' || o.command === 'approve') {
    if (o.command === 'approve') {
      const nodeId = o.rest[1]
      if (!nodeId) throw new UsageError('approve <runId> <nodeId>')
      await brain.call('production.approve', [id, nodeId])
    }
    const w = await watch(brain, id, o, null)
    print({ reason: w.reason, ...w.report })
    return w.code
  }
  throw new UsageError(`commande inconnue : ${o.command}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    // exitCode, not process.exit(): exiting with fetch's sockets still open trips a libuv assertion on Windows
    (code) => void (process.exitCode = code),
    (err) => {
      process.stderr.write(`[brain-run] ${err instanceof UsageError ? 'usage' : 'erreur'} : ${err.message}\n`)
      process.exitCode = err instanceof UsageError ? EXIT.usage : EXIT.error
    }
  )
}
