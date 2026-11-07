// The fake remote render provider as a program (vps-rendu): `node --import ./scripts/ts-resolve.mjs scripts/fake-render-remote.ts
// [--runner docker|process] [--slots 6] [--cpus 4] [--memory 8g] [--cold-ms 0] [--down] [--port 0] [--mount <host:container>]...`
// Prints one JSON line {url, token} once listening, then a JSON line per finished run; stops on stdin end or SIGINT.
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFakeRemote } from '../src/engine/remote-render/fake-remote'

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : dflt
}
const mounts = argv.flatMap((a, i) => (a === '--mount' && argv[i + 1] ? [argv[i + 1] as string] : []))
const runner = arg('runner', 'docker') as 'docker' | 'process'
const fake = await startFakeRemote({
  dir: mkdtempSync(path.join(os.tmpdir(), 'atelier-fake-remote-')),
  runner,
  root: path.resolve(import.meta.dirname, '..'),
  slots: Number(arg('slots', '6')),
  coldStartMs: Number(arg('cold-ms', '0')),
  down: argv.includes('--down'),
  port: Number(arg('port', '0')),
  docker: { image: arg('image', 'atelier-render-worker:dev'), cpus: arg('cpus', '4'), memory: arg('memory', '8g'), mounts }
})
process.stdout.write(`${JSON.stringify({ url: fake.url, token: fake.token })}\n`)
const seen = new Set<string>()
const timer = setInterval(() => {
  for (const r of fake.runs()) {
    if (!seen.has(r.id) && r.endedAt) {
      seen.add(r.id)
      process.stdout.write(`${JSON.stringify({ run: r.id, state: r.state, billedS: r.billedS, queuedS: r.startedAt ? (r.startedAt - r.createdAt) / 1000 : null, error: r.error })}\n`)
    }
  }
}, 500)
const stop = async (): Promise<void> => {
  clearInterval(timer)
  await fake.close()
  process.exit(0)
}
process.stdin.on('end', () => void stop())
process.stdin.resume()
process.on('SIGINT', () => void stop())
