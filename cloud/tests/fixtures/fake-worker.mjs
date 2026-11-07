/* global process, console, fetch, Buffer, setInterval */
// A stand-in worker program for the fake RunPod tests: plain Node, speaks the worker protocol (src/shared/worker-protocol.ts)
// without importing it. Reads the job line on stdin, then by `job.nodeType`:
//   ok@1     downloads the inputs' remoteFiles, writes result.txt in outDir, reports a cost, answers done (value = sizes)
//   slow@1   starts a grandchild that never ends, logs "grandchild <pid>", reports progress, then waits forever
//   boom@1   answers an error line
//   die@1    writes to stderr and exits 3 without an answer
//   call@1   asks the parent for a service and answers done with the reply it got
//   escape@1 answers done with a file outside its folder (the Cloud must refuse it)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const PREFIX = '\u001eatelier-worker '
const send = (line) => process.stdout.write(`${PREFIX}${JSON.stringify(line)}\n`)
const finish = (line) => process.stdout.write(`${PREFIX}${JSON.stringify(line)}\n`, () => process.exit(0))

const rl = createInterface({ input: process.stdin })
const lines = rl[Symbol.asyncIterator]()

async function next() {
  const r = await lines.next()
  if (r.done) process.exit(4)
  return JSON.parse(r.value)
}

const first = await next()
const job = first.job
mkdirSync(job.outDir, { recursive: true })
console.log('a line that is not part of the protocol')

switch (job.nodeType) {
  case 'ok@1': {
    const sizes = {}
    for (const [name, input] of Object.entries(job.inputs)) {
      for (const [i, f] of (input.remoteFiles ?? []).entries()) {
        const res = await fetch(f.url)
        if (!res.ok) throw new Error(`download ${res.status}`)
        const bytes = Buffer.from(await res.arrayBuffer())
        writeFileSync(join(job.outDir, `in-${i}-${f.name}`), bytes)
        sizes[`${name}_${i}`] = { name: f.name, size: bytes.length }
      }
    }
    send({ t: 'progress', frac: 0.5, text: 'à mi-course' })
    writeFileSync(join(job.outDir, 'result.txt'), 'bonjour')
    send({ t: 'cost', cost: { units: [{ unit: 'gpu.seconds', qty: 1 }], provider: 'fake-worker' } })
    finish({ t: 'done', outputs: { video: { files: [join(job.outDir, 'result.txt')], value: { sizes, where: job.where, v: job.v } }, note: { value: 'ok' } } })
    break
  }
  case 'slow@1': {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    send({ t: 'log', level: 'info', text: `grandchild ${child.pid}` })
    send({ t: 'progress', frac: 0.3, text: 'longue tâche' })
    setInterval(() => {}, 1000)
    break
  }
  case 'boom@1':
    finish({ t: 'error', error: { code: 'boom', message: 'Le nœud a échoué.', permanent: true } })
    break
  case 'die@1':
    process.stderr.write('fatal: plus de mémoire\n', () => process.exit(3))
    break
  case 'call@1': {
    send({ t: 'call', id: 1, name: 'claude.ask', req: { prompt: 'x' } })
    const reply = await next()
    finish({ t: 'done', outputs: { answer: { value: reply } } })
    break
  }
  case 'escape@1': {
    // Two levels up: beside the fake RunPod's work folder (tests give it <tmp>/work), never inside it.
    const outside = join(job.outDir, '..', '..', 'escape.txt')
    writeFileSync(outside, 'secret')
    finish({ t: 'done', outputs: { leak: { files: [outside] } } })
    break
  }
  default:
    finish({ t: 'error', error: { code: 'unknown', message: `unknown node ${job.nodeType}`, permanent: true } })
}
