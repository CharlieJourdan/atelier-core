#!/usr/bin/env node
// The simulated team VPS (vps-rendu, decision 0084): runs `tests/vps/*.vps.ts` inside the render-worker image limited to the
// VPS of the decision (4 vCPU / 8 GB, no GPU, no swap), with this checkout's code mounted read-only (no rebuild while you
// iterate). Free: stand-in engines, no network call leaves the box except the image build's.
//   node scripts/vps-sim.mjs [--cpus 4] [--memory 8g] [--n 1] [--remote off|fake|fake-down|capture] [--bases a,b] [--minutes 1]
//                            [--out <file.jsonl>] [--image atelier-render-worker:dev]
//                            [--cloud-limits today|raised] [--slots 6] [--remote-cpus 4] [--remote-memory 8g] [--cold-ms 0]
// With --remote fake / fake-down the fake remote provider (scripts/fake-render-remote.ts) runs on THIS machine and starts each
// remote job in its own container (--remote-cpus / --remote-memory, at most --slots at once), outside the VPS box.
// Build the image first:  docker build -f deploy/render-worker/Dockerfile -t atelier-render-worker:dev .
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const cpus = arg('cpus', '4')
const memory = arg('memory', '8g')
const out = path.resolve(arg('out', path.join(ROOT, 'out', 'vps-sim', `vps-${Date.now()}.jsonl`)))
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, '')

const mount = (rel) => ['-v', `${path.join(ROOT, rel)}:/app/${rel.replace(/\\/g, '/')}:ro`]
const remote = arg('remote', 'off')

// the fake remote provider, on the host
let fake = null
let remoteEnv = []
if (remote === 'fake' || remote === 'fake-down') {
  const mounts = ['src', 'scripts', 'resources'].flatMap((rel) => ['--mount', `${path.join(ROOT, rel)}:/app/${rel}:ro`])
  fake = spawn(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './scripts/ts-resolve.mjs',
      'scripts/fake-render-remote.ts',
      '--runner',
      'docker',
      '--slots',
      arg('slots', '6'),
      '--cpus',
      arg('remote-cpus', '4'),
      '--memory',
      arg('remote-memory', '8g'),
      '--cold-ms',
      arg('cold-ms', '0'),
      '--image',
      arg('image', 'atelier-render-worker:dev'),
      ...(remote === 'fake-down' ? ['--down'] : []),
      ...mounts
    ],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] }
  )
  const lines = createInterface({ input: fake.stdout })
  const first = await new Promise((resolve) => lines.once('line', resolve))
  const { url, token } = JSON.parse(first)
  remoteEnv = ['-e', `VPS_REMOTE_URL=http://host.docker.internal:${new URL(url).port}`, '-e', `VPS_REMOTE_TOKEN=${token}`]
  lines.on('line', (l) => appendFileSync(out, `${JSON.stringify({ kind: 'remote-run', ...JSON.parse(l) })}\n`))
  process.stdout.write(`fake remote provider on ${url}\n`)
}

const args = [
  'run',
  '--rm',
  '--cpus',
  cpus,
  '--memory',
  memory,
  '--memory-swap',
  memory,
  '--shm-size',
  '1g',
  ...mount('src'),
  ...mount('tests'),
  ...mount('scripts'),
  ...mount('cloud'),
  ...mount('resources'),
  ...mount('vitest.vps.config.mts'),
  '-v',
  `${path.dirname(out)}:/out`,
  '-e',
  `VPS_N=${arg('n', '1')}`,
  '-e',
  `VPS_REMOTE=${remote}`,
  '-e',
  `VPS_BASES=${arg('bases', 'avatar@1,documentary@2,pov@1,story-short@1')}`,
  '-e',
  `VPS_MINUTES=${arg('minutes', '1')}`,
  '-e',
  `VPS_OUT=/out/${path.basename(out)}`,
  '-e',
  `VPS_MAX_REMOTE=${arg('max-remote', '10')}`,
  '-e',
  `VPS_MAX_LOCAL=${arg('max-local', '1')}`,
  '-e',
  `VPS_CLOUD_LIMITS=${arg('cloud-limits', 'today')}`,
  ...remoteEnv,
  '--entrypoint',
  'npx',
  arg('image', 'atelier-render-worker:dev'),
  'vitest',
  'run',
  '-c',
  'vitest.vps.config.mts'
]
process.stdout.write(`docker ${args.join(' ')}\n`)
const code = await new Promise((resolve) => spawn('docker', args, { stdio: 'inherit' }).on('close', resolve))
if (fake) {
  fake.stdin.end()
  await new Promise((resolve) => fake.on('close', resolve))
}
process.stdout.write(`\nresults: ${out}\n`)
process.exit(code ?? 1)
