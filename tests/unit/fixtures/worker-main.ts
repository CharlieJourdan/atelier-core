// The local worker program with the test catalogue (tests/unit/fixtures/worker-nodes.ts), run under plain Node by
// tests/unit/local-worker.test.ts through nodeWorkerCommand.
import { workerMain } from '../../../src/engine/worker/cli'
import { registry } from './worker-nodes'

workerMain(process.argv.slice(2), registry()).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exit(1)
})
