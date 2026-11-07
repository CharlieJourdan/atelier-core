// The local worker's command line: `--data <dir> --resources <dir> [--parent-services]`. `main.ts` runs it with the
// production catalogue; tests run it with their own registry from a small entry script of theirs.
import path from 'node:path'
import type { NodeRegistry } from '../registry'
import { runWorkerChild } from './child'

export interface WorkerArgs {
  dataDir: string
  resourcesDir: string
  parentServices: boolean
}

/** Parses the worker's arguments; throws a plain message on a bad command line. */
export function parseWorkerArgs(argv: readonly string[]): WorkerArgs {
  let dataDir: string | undefined
  let resourcesDir: string | undefined
  let parentServices = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--parent-services') parentServices = true
    else if (a === '--data' || a === '--resources') {
      const v = argv[++i]
      if (!v) throw new Error(`${a} needs a folder`)
      if (a === '--data') dataDir = path.resolve(v)
      else resourcesDir = path.resolve(v)
    } else throw new Error(`unknown argument: ${a}`)
  }
  if (!dataDir || !resourcesDir) throw new Error('usage: worker --data <dir> --resources <dir> [--parent-services]')
  return { dataDir, resourcesDir, parentServices }
}

/** Runs one job read on stdin, then exits once stdout is flushed. */
export async function workerMain(argv: readonly string[], registry: NodeRegistry): Promise<void> {
  let args: WorkerArgs
  try {
    args = parseWorkerArgs(argv)
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(2)
  }
  const code = await runWorkerChild({
    registry,
    ...args,
    stdin: process.stdin,
    stdout: process.stdout,
    pathEnv: process.env.PATH ?? process.env.Path ?? ''
  })
  // the last protocol line must reach the parent before the process ends
  process.stdout.write('', () => process.exit(code))
}
