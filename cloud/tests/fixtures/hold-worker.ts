// A worker thread with its OWN SQLite connection to the same file: it races the other workers to place holds.
// Run by cloud-wallet.test.ts (plain Node type stripping, no vitest transform).
import { parentPort, workerData } from 'node:worker_threads'
import { Audit } from '../../src/audit.ts'
import { systemClock } from '../../src/clock.ts'
import { openCloudDb } from '../../src/db/index.ts'
import { CloudError } from '../../src/errors.ts'
import { Wallet } from '../../src/wallet.ts'

const { path, teamId, worker, holds, credits, barrier, parties } = workerData as {
  path: string
  teamId: string
  worker: number
  holds: number
  credits: number
  /** Int32Array over a SharedArrayBuffer: [0] = workers arrived, [1] = go flag. */
  barrier: SharedArrayBuffer
  parties: number
}
const db = openCloudDb(path)
const wallet = new Wallet(db, systemClock, new Audit(db, systemClock))
// Start barrier: nobody places a hold before every worker has opened its connection and arrived.
const gate = new Int32Array(barrier)
if (Atomics.add(gate, 0, 1) + 1 === parties) {
  Atomics.store(gate, 1, 1)
  Atomics.notify(gate, 1)
} else {
  while (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0, 1000)
}
let ok = 0
let refused = 0
for (let i = 0; i < holds; i++) {
  try {
    wallet.hold({ teamId, accountId: null, credits, idemKey: `w${worker}-${i}` })
    ok++
  } catch (err) {
    if (err instanceof CloudError && err.code === 'insufficient_credits') refused++
    else throw err
  }
}
db.close()
parentPort?.postMessage({ ok, refused })
