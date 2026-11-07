// The local worker program (lot P5): one engine node per process, production catalogue. Run by the app as
// `out/main/worker.js` with Electron as Node (ELECTRON_RUN_AS_NODE=1), or by plain Node:
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs src/engine/worker/main.ts --data <dir> --resources <dir> [--parent-services]
import { productionRegistry } from '../nodes'
import { workerMain } from './cli'

workerMain(process.argv.slice(2), productionRegistry()).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exit(1)
})
