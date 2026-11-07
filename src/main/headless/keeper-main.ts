// `npm run brain:keeper -- [--keeper-log <dir>] [--keeper-pid <file>] <the brain's options>`: the brain under its keeper
// (keeper.ts). The brain's options go to it as they are (docs/BRAIN-HEADLESS.md §1). Without `--keeper-log` the output is
// this process's; with it, a dated file in that folder (the last 40 kept), so a scheduled task, which has no console,
// runs node directly. This is what the team computer's scheduled task (scripts/beta/team-pc.ps1) and a systemd unit run.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Keeper, splitKeeperArgs } from './keeper'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { logDir, pidFile, brain } = splitKeeperArgs(process.argv.slice(2))

let log: WriteStream | null = null
if (logDir) {
  mkdirSync(logDir, { recursive: true })
  const old = readdirSync(logDir)
    .filter((n) => /^brain-.*\.log$/.test(n))
    .map((n) => ({ n, t: statSync(path.join(logDir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const { n } of old.slice(39)) rmSync(path.join(logDir, n), { force: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  log = createWriteStream(path.join(logDir, `brain-${stamp}.log`), { flags: 'a' })
}
const write = (text: string): void => void (log ? log.write(text) : process.stdout.write(text))
const out = (line: string): void => write(`${new Date().toISOString()} ${line}\n`)

if (pidFile) writeFileSync(pidFile, JSON.stringify({ brain: process.pid }) + '\n')
const forgetPid = (): void => {
  try {
    if (pidFile && (JSON.parse(readFileSync(pidFile, 'utf8')) as { brain?: number }).brain === process.pid) rmSync(pidFile, { force: true })
  } catch {
    // already gone
  }
}

const keeper = new Keeper({
  log: out,
  spawnBrain: (env) => {
    const child = spawn(
      process.execPath,
      [
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--disable-warning=ExperimentalWarning',
        '--import',
        pathToFileURL(path.join(repoRoot, 'scripts', 'ts-transpile.mjs')).href,
        path.join(repoRoot, 'src', 'main', 'headless', 'main.ts'),
        ...brain
      ],
      { cwd: repoRoot, stdio: log ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...env } }
    )
    child.stdout?.on('data', (b: Buffer) => write(b.toString()))
    child.stderr?.on('data', (b: Buffer) => write(b.toString()))
    return child
  }
})
process.once('SIGINT', () => keeper.stop())
process.once('SIGTERM', () => keeper.stop())
out(`Gardien du cerveau (pid ${process.pid}) : relance le cerveau s’il s’arrête sans qu’on le lui demande.`)
keeper.run().then(
  (code) => {
    forgetPid()
    if (log) log.end(() => process.exit(code))
    else process.exit(code)
  },
  (err: unknown) => {
    out(`Gardien : erreur ${err instanceof Error ? err.message : String(err)}`)
    forgetPid()
    process.exit(1)
  }
)
