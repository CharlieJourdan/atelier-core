// A stand-in for the app process in lot P5's crash proof (p5-resume.test.ts): it opens an Atelier database, builds the
// production host on a data folder and runs the proof's pipeline (local → Cloud → GPU), copying every Cloud job into
// its ledger. The test kills it (whole process tree) in the middle of the GPU job, then resumes in its own process.
// Configuration: the P5_APP environment variable (JSON).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRun, validatePipeline } from '../../../src/engine'
import { CloudSpendMirror } from '../../../src/main/cloud/mirror'
import { openDatabase } from '../../../src/main/db'
import { createProductionHost } from '../../../src/main/production/host'
import { nodeWorkerCommand } from '../../../src/main/production/local-worker'
import { mixedPipeline, registry } from './p5-nodes'

interface Config {
  base: string
  token: string
  dataDir: string
  dbPath: string
  runId: string
  delayMs: number
}

async function main(): Promise<void> {
  const c = JSON.parse(process.env.P5_APP ?? '{}') as Config
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.join(here, '..', '..', '..')
  const resources = path.join(root, 'resources')
  const db = openDatabase(c.dbPath)
  const mirror = new CloudSpendMirror(db)
  const host = createProductionHost({
    dataDir: c.dataDir,
    resourcesDir: resources,
    worker: nodeWorkerCommand(root, path.join(c.dataDir, 'worker-data'), resources, path.join(here, 'p5-worker-main.ts')),
    cloud: { baseUrl: () => c.base, token: () => Promise.resolve(c.token), pollMs: 40 },
    onJob: (e, tags) => {
      mirror.record(e, tags)
      process.stdout.write(`JOB ${e.phase} ${e.job.usage}
`)
    }
  })
  const v = validatePipeline(mixedPipeline('ok', c.delayMs), registry())
  if (!v.ok) throw new Error('invalid pipeline')
  const rh = host.forRun({ capCredits: 400 })
  const run = startRun({
    plan: v.plan,
    store: host.store,
    runId: c.runId,
    inputs: { topic: { value: 'les phares bretons' } },
    services: rh.services,
    executors: rh.executors,
    spender: rh.spender,
    onEvent: (e) => {
      if (e.kind === 'start' || e.kind === 'done' || e.kind === 'cached') process.stdout.write(`EVENT ${e.kind} ${e.nodeId}\n`)
    }
  })
  const r = await run.done
  process.stdout.write(`RUN ${r.status}\n`)
  db.close()
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exit(1)
})
