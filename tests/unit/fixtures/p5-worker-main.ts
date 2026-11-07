// The worker program with lot P5's proof nodes (p5-nodes.ts): the local worker and the fake RunPod's pod run it under
// plain Node (tests/unit/p5-executors.test.ts).
import { workerMain } from '../../../src/engine/worker/cli'
import { registry } from './p5-nodes'

workerMain(process.argv.slice(2), registry()).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exit(1)
})
