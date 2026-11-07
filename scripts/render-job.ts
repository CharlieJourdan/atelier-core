// The remote render worker's entry point (vps-rendu; the Docker image deploy/render-worker runs it). One job, then exit:
//   ATELIER_JOB_URL=<presigned GET link> node --import ./scripts/ts-resolve.mjs scripts/render-job.ts
//   node --import ./scripts/ts-resolve.mjs scripts/render-job.ts --job <file.json>
// The job and its result follow src/shared/render-job.ts. Exit 0 when the result was written (even a node that failed: the
// result says why), 1 when the job could not be read or the result could not be written.
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { productionRegistry } from '../src/engine/nodes'
import { runRenderJob } from '../src/engine/remote-render/job-runner'

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const i = argv.indexOf('--job')
const job = i >= 0 ? argv[i + 1] : process.env.ATELIER_JOB_URL
if (!job) {
  process.stderr.write('usage: render-job --job <file|url>  (or ATELIER_JOB_URL)\n')
  process.exit(2)
}
const work = process.env.ATELIER_WORK_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'atelier-render-job-'))
const t0 = Date.now()
try {
  const r = await runRenderJob({
    registry: productionRegistry(),
    job,
    dataDir: path.join(work, 'data'),
    resourcesDir: process.env.ATELIER_RESOURCES ?? path.join(ROOT, 'resources'),
    workDir: path.join(work, 'jobs'),
    onLine: (l) => {
      if (l.t === 'log') process.stderr.write(`[${l.level}] ${l.text}\n`)
    }
  })
  process.stdout.write(`${JSON.stringify({ ok: r.ok, wallS: +((Date.now() - t0) / 1000).toFixed(1), ...(r.ok ? {} : { error: r.error }) })}\n`)
  process.exit(0)
} catch (e) {
  process.stderr.write(`render-job: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}
