#!/usr/bin/env node
// The test team's headless brain INSIDE the simulated team VPS (vps-essai, decisions 0084 / 0087): the render-worker image
// limited to 4 vCPU / 8 GB (no swap, no GPU), the brain under its keeper, its data on a Docker volume (a VPS's own disk, not
// a Windows bind mount), this checkout's code mounted read-only. It writes the state and access files that
// `scripts/brain-run.mjs` reuses (`brainData` = the folder as the container sees it), so real runs still go through
// brain-run's quote and spend cap. This script never calls a paid method: it starts, stops, kills and measures the box.
//   node scripts/vps-brain.mjs start  --data <host dir> --token-file <test-team key> --cloud-url <url>
//                                      [--port n] [--name atelier-vps] [--image atelier-team-vps:dev] [--cpus 4] [--memory 8g]
//   node scripts/vps-brain.mjs status|stop|kill|restart|kill-brain|disk|remove  --data <host dir>   (remove: the container, never
//     its volume: the box's disk and the brain's data stay)
//   node scripts/vps-brain.mjs login  --data <host dir> <configDir>   prints the command the owner types to sign in to his own
//     Claude subscription in the box (orchestra.addCliAccount gives <configDir>); this script never signs in
//   node scripts/vps-brain.mjs meter  --data <host dir> [--every-s 2]   (detached sampler → <data>/meter.jsonl; meter-stop ends it)
//   node scripts/vps-brain.mjs copy   --data <host dir> <container path> <host path>
// kill = `docker kill` (the whole box, SIGKILL, like a VPS losing power); restart = `docker start` (the box boots again and
// the keeper starts the brain); kill-brain = SIGKILL of the brain process only (the keeper restarts it).
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BOX_ROOT = '/vps'
export const BOX_DATA = `${BOX_ROOT}/brain`
const STATE_FILE = 'brain-run.state.json'
const ACCESS_FILE = 'brain-run.access'
const METER_FILE = 'meter.jsonl'
const METER_PID = 'meter.pid'
const NODE_FLAGS = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/ts-transpile.mjs']

export function parseArgs(argv) {
  const o = { command: argv[0], rest: [], data: null, tokenFile: null, cloudUrl: null, port: null, name: null, image: 'atelier-team-vps:dev', cpus: '4', memory: '8g', everyS: 2 }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const v = () => {
      const x = argv[++i]
      if (x === undefined) throw new Error(`${a} attend une valeur`)
      return x
    }
    if (a === '--data') o.data = path.resolve(v())
    else if (a === '--token-file') o.tokenFile = path.resolve(v())
    else if (a === '--cloud-url') o.cloudUrl = v()
    else if (a === '--port') o.port = Number(v())
    else if (a === '--name') o.name = v()
    else if (a === '--image') o.image = v()
    else if (a === '--cpus') o.cpus = v()
    else if (a === '--memory') o.memory = v()
    else if (a === '--every-s') o.everyS = Number(v())
    else o.rest.push(a)
  }
  if (!o.data) throw new Error('--data <dossier hôte> est obligatoire')
  o.name ??= `atelier-vps-${path.basename(path.dirname(o.data)).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
  return o
}

/** The docker arguments of the box: limits of decision 0084, the volume as its disk, the code read-only. */
export function boxArgs(o, port) {
  const mount = (rel) => ['-v', `${path.join(repoRoot, rel)}:/app/${rel}:ro`]
  return [
    // an init as PID 1 reaps orphans (the keeper is not one: a brain killed mid-render left its ffmpeg as zombies);
    // on a real VPS systemd does it
    '--init',
    '--cpus', o.cpus, '--memory', o.memory, '--memory-swap', o.memory, '--shm-size', '1g',
    '-v', `${o.name}:${BOX_ROOT}`,
    '-v', `${o.tokenFile}:/secrets/test-brain.token:ro`,
    ...mount('src'), ...mount('scripts'), ...mount('resources'), ...mount('cloud'),
    ...(port ? ['-p', `127.0.0.1:${port}:8790`] : [])
  ]
}

export function brainArgs(o) {
  return ['--data', BOX_DATA, '--key-file', `${BOX_ROOT}/machine.key`, '--host', '0.0.0.0', '--port', '8790', '--token-file', '/secrets/test-brain.token', '--no-mcp', '--no-backup', ...(o.cloudUrl ? ['--cloud-url', o.cloudUrl] : [])]
}

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, ...opts })
const say = (line) => void process.stderr.write(`[vps-brain] ${line}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readState = (o) => (existsSync(path.join(o.data, STATE_FILE)) ? JSON.parse(readFileSync(path.join(o.data, STATE_FILE), 'utf8')) : null)

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
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

async function waitHealthy(url, o) {
  const deadline = Date.now() + 180_000
  while (!(await healthy(url))) {
    if (Date.now() > deadline) throw new Error(`le cerveau du conteneur ${o.name} n’a pas répondu en 3 min (docker logs ${o.name})`)
    await sleep(1000)
  }
}

async function start(o) {
  if (!o.tokenFile) throw new Error('--token-file <clé de l’équipe de test> est obligatoire')
  mkdirSync(o.data, { recursive: true })
  const state = readState(o)
  const running = docker(['inspect', '-f', '{{.State.Running}}', o.name]).stdout.trim()
  if (running === 'true' && state?.port) {
    await waitHealthy(`http://127.0.0.1:${state.port}`, o)
    return { url: `http://127.0.0.1:${state.port}`, container: o.name, reused: true }
  }
  if (running === 'false') {
    // the box exists, stopped (killed): boot it again
    return restart(o)
  }
  const port = o.port ?? state?.port ?? (await freePort())
  const access = path.join(o.data, ACCESS_FILE)
  if (!existsSync(access)) {
    // the access token is made offline, inside the box (its hash lives in the box's database), read from the pipe only
    const r = docker(['run', '--rm', ...boxArgs(o, null), '--entrypoint', 'node', o.image, ...NODE_FLAGS, 'src/main/headless/main.ts', '--data', BOX_DATA, '--key-file', `${BOX_ROOT}/machine.key`, '--rotate-token'])
    const token = /\b(atb_[A-Za-z0-9_-]{20,})\b/.exec(`${r.stdout}${r.stderr}`)?.[1]
    if (r.status !== 0 || !token) throw new Error(`--rotate-token dans le conteneur a échoué (${r.status}) : ${`${r.stdout}${r.stderr}`.replace(/atb_[A-Za-z0-9_-]+/g, 'atb_…').trim().slice(-600)}`)
    writeFileSync(access, token + '\n', { mode: 0o600 })
    try {
      chmodSync(access, 0o600)
    } catch {
      /* Windows ACLs */
    }
  }
  const r = docker(['run', '-d', '--name', o.name, ...boxArgs(o, port), '--entrypoint', 'node', o.image, ...NODE_FLAGS, 'src/main/headless/keeper-main.ts', ...brainArgs(o)])
  if (r.status !== 0) throw new Error(`docker run a échoué : ${r.stderr.trim()}`)
  writeFileSync(path.join(o.data, STATE_FILE), JSON.stringify({ port, data: o.data, brainData: BOX_DATA, container: o.name }, null, 2))
  const url = `http://127.0.0.1:${port}`
  await waitHealthy(url, o)
  say(`cerveau prêt dans ${o.name} sur ${url}`)
  return { url, container: o.name, port }
}

async function restart(o) {
  const state = readState(o)
  const t0 = Date.now()
  const r = docker(['start', o.name])
  if (r.status !== 0) throw new Error(`docker start a échoué : ${r.stderr.trim()}`)
  await waitHealthy(`http://127.0.0.1:${state.port}`, o)
  return { restarted: true, container: o.name, healthyAfterS: (Date.now() - t0) / 1000 }
}

/** One sample of the box: working set (as docker stats: memory.current − inactive_file), CPU %, cgroup peak. */
function sample(o) {
  const r = docker(['stats', '--no-stream', '--format', '{{json .}}', o.name])
  if (r.status !== 0 || !r.stdout.trim()) return { t: Date.now(), up: false }
  const s = JSON.parse(r.stdout.trim().split('\n')[0])
  const unit = { B: 1 / 2 ** 20, KiB: 1 / 1024, MiB: 1, GiB: 1024, kB: 1 / 1024, MB: 1, GB: 1024 }
  const mb = (txt) => {
    const m = /([\d.]+)\s*([A-Za-z]+)/.exec(txt)
    return m ? Number(m[1]) * (unit[m[2]] ?? 1) : null
  }
  return { t: Date.now(), up: true, memMB: Math.round(mb(s.MemUsage.split('/')[0]) ?? 0), cpuPct: Number.parseFloat(s.CPUPerc) || 0, pids: Number(s.PIDs) || 0 }
}

async function meterLoop(o) {
  const file = path.join(o.data, METER_FILE)
  for (;;) {
    appendFileSync(file, JSON.stringify(sample(o)) + '\n')
    await sleep(o.everyS * 1000)
  }
}

function disk(o) {
  const r = docker(['exec', o.name, 'sh', '-c', `du -sm ${BOX_DATA} ${BOX_DATA}/production 2>/dev/null; df -m ${BOX_ROOT} | tail -1`])
  return { out: r.stdout.trim(), status: r.status }
}

async function main(argv) {
  const o = parseArgs(argv)
  const print = (v) => void process.stdout.write(JSON.stringify(v, null, 2) + '\n')
  switch (o.command) {
    case 'start':
      return print(await start(o)), 0
    case 'status': {
      const st = readState(o)
      return print({ container: o.name, running: docker(['inspect', '-f', '{{.State.Running}} {{.RestartCount}} {{.State.OOMKilled}}', o.name]).stdout.trim(), healthy: st ? await healthy(`http://127.0.0.1:${st.port}`) : false, sample: sample(o) }), 0
    }
    case 'stop':
      return print({ stopped: docker(['stop', '-t', '20', o.name]).status === 0 }), 0
    case 'kill':
      return print({ killed: docker(['kill', o.name]).status === 0, at: new Date().toISOString() }), 0
    case 'restart':
      return print(await restart(o)), 0
    case 'kill-brain': {
      // the brain is the keeper's child: SIGKILL it, never the keeper (pid 1)
      const r = docker(['exec', o.name, 'sh', '-c', "for p in $(pgrep -f 'src/main/headless/main.ts'); do kill -9 $p && echo $p; done"])
      return print({ killed: r.stdout.trim().split(/\s+/).filter(Boolean), at: new Date().toISOString() }), 0
    }
    case 'disk':
      return print(disk(o)), 0
    case 'remove':
      docker(['stop', '-t', '20', o.name])
      return print({ removed: docker(['rm', o.name]).status === 0, volumeKept: o.name }), 0
    case 'login': {
      const dir = o.rest[0]
      if (!dir || !dir.startsWith(`${BOX_DATA}/`)) throw new Error(`login <dossier du compte, sous ${BOX_DATA}/> (orchestra.addCliAccount le donne)`)
      return print({ type: `docker exec -it -e CLAUDE_CONFIG_DIR=${dir} ${o.name} claude`, then: 'dans Claude Code : /login, connecte-toi avec ton compte, puis /exit ; ensuite orchestra.checkAccount' }), 0
    }
    case 'meter': {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'meter-loop', '--data', o.data, '--name', o.name, '--every-s', String(o.everyS)], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      writeFileSync(path.join(o.data, METER_PID), String(child.pid))
      return print({ meter: child.pid, file: path.join(o.data, METER_FILE) }), 0
    }
    case 'meter-loop':
      return meterLoop(o)
    case 'meter-stop': {
      const pidFile = path.join(o.data, METER_PID)
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, 'utf8')))
        } catch {
          /* gone */
        }
        rmSync(pidFile, { force: true })
      }
      return print({ stopped: true }), 0
    }
    case 'copy': {
      const [from, to] = o.rest
      mkdirSync(path.dirname(path.resolve(to)), { recursive: true })
      const r = docker(['cp', `${o.name}:${from}`, path.resolve(to)])
      return print({ copied: r.status === 0, err: r.stderr.trim() }), r.status === 0 ? 0 : 1
    }
    default:
      throw new Error(`commande inconnue : ${o.command}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => code !== undefined && process.exit(code),
    (err) => {
      say(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  )
}
