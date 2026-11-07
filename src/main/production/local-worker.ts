// The local executor (PLAN-V2-PRODUCTION §1.5, lot P5): "l'ouvrier local". Each attempt of a node placed `local` runs
// in its own child process (src/engine/worker/main.ts), speaking the worker protocol (src/shared/worker-protocol.ts).
// The child asks this process for Claude and Atelier Cloud (`call` lines), so no token lives in it. Cancel kills the
// child's whole process tree at once (taskkill /T /F on Windows, SIGKILL to the process group on macOS). A child that
// dies without an answer is a transient error: the scheduler retries it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AbortError, EngineError, ERROR_CODES, toEngineError, type ErrorCode } from '../../engine/errors'
import type { NodeExecution, NodeExecutor } from '../../engine/executor'
import type { NodeOutputs } from '../../engine/artefacts'
import type { RunCtx } from '../../engine/registry'
import { need, type EngineServices } from '../../engine/services'
import { ESTIMATE_UNITS, type EstimateUnit, type Json } from '../../engine/types'
import {
  WORKER_PROTOCOL_VERSION,
  decodeChildLine,
  encodeParentLine,
  type ChildLine,
  type ParentLine,
  type WireArtefact,
  type WorkerJob
} from '../../shared/worker-protocol'
import { killTree as defaultKillTree, killTreeSync as defaultKillTreeSync } from '../platform/process'
import { boundedLines, workerEnv } from './worker-io'

export type SpawnImpl = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface LocalWorkerOptions {
  command: string
  /** The worker program and its command line (with `--parent-services`). */
  args: string[]
  /** Passed through the allow-list of `workerEnv` (no secret reaches the worker). Default: this process's. */
  env?: NodeJS.ProcessEnv
  /** Each attempt gets a folder `<workRoot>/<random>` for its downloads, scratch and outputs. */
  workRoot: string
  /** The parent's services the child may call (cloud, claude, videos). */
  services: () => EngineServices
  platform?: NodeJS.Platform
  spawnImpl?: SpawnImpl
  killTree?: (pid: number, platform: NodeJS.Platform) => void
  /** Used by `killAll` (quitting): returns once the tree is gone. */
  killTreeSync?: (pid: number, platform: NodeJS.Platform) => void
}

export interface LocalWorkerExecutor extends NodeExecutor {
  /** Removes every attempt folder this executor made (call it once the outputs are stored). */
  cleanup(): Promise<void>
  /** Pids of the worker processes still running. */
  pids(): number[]
  /** Kills every running worker with its tree, synchronously (app quit: nothing may outlive the app). */
  killAll(): void
}

/** How long a child that answered may take to exit before its tree is killed. */
const EXIT_GRACE_MS = 2_000
/** How long to wait for the child's pipes to close after it exited (a grandchild may hold them). */
const CLOSE_GRACE_MS = 1_000
const STDERR_TAIL = 400

const asCode = (c: string): ErrorCode => ((ERROR_CODES as readonly string[]).includes(c) ? (c as ErrorCode) : 'internal')

function wireInput(a: NodeExecution['inputs'][string]): WireArtefact {
  return {
    type: a.type,
    fingerprint: a.fingerprint,
    ...(a.value !== undefined ? { value: a.value } : {}),
    ...(a.meta ? { meta: a.meta } : {}),
    ...(a.files ? { files: a.files.map((f) => path.resolve(f)) } : {})
  }
}

/** Runs one `call` line on the parent's services, with the attempt's signal. */
async function runCall(l: Extract<ChildLine, { t: 'call' }>, services: EngineServices, signal: AbortSignal): Promise<unknown> {
  // `need` throws services.ts's own French missing_tool message when the host has no such service
  const holder = { services } as unknown as RunCtx
  const opts = (l.opts ?? {}) as { idempotencyKey: string; dir: string }
  switch (l.name) {
    case 'cloud.synthesize':
      return need(holder, 'cloud').synthesize(l.req as Parameters<NonNullable<EngineServices['cloud']>['synthesize']>[0], { ...opts, signal })
    case 'cloud.generateImage':
      return need(holder, 'cloud').generateImage(l.req as Parameters<NonNullable<EngineServices['cloud']>['generateImage']>[0], { ...opts, signal })
    case 'cloud.generateVideo':
      return need(holder, 'cloud').generateVideo(l.req as Parameters<NonNullable<EngineServices['cloud']>['generateVideo']>[0], { ...opts, signal })
    case 'cloud.talkingAvatar':
      return need(holder, 'cloud').talkingAvatar(l.req as Parameters<NonNullable<EngineServices['cloud']>['talkingAvatar']>[0], { ...opts, signal })
    case 'cloud.searchStock':
      return need(holder, 'cloud').searchStock(l.req as Parameters<NonNullable<EngineServices['cloud']>['searchStock']>[0], { ...opts, signal })
    case 'claude.ask':
      return need(holder, 'claude').ask({ ...(l.req as Omit<Parameters<NonNullable<EngineServices['claude']>['ask']>[0], 'signal'>), signal })
    case 'videos.read':
      return need(holder, 'videos').read(l.req as Parameters<NonNullable<EngineServices['videos']>['read']>[0], signal)
  }
}

export function localWorkerExecutor(o: LocalWorkerOptions): LocalWorkerExecutor {
  const platform = o.platform ?? process.platform
  const spawnImpl: SpawnImpl = o.spawnImpl ?? ((c, a, opts) => spawn(c, a, opts))
  const kill = o.killTree ?? ((pid: number, p: NodeJS.Platform) => defaultKillTree(pid, p))
  const killSync = o.killTreeSync ?? ((pid: number, p: NodeJS.Platform) => defaultKillTreeSync(pid, p))
  const env = workerEnv(o.env ?? process.env)
  const outDirs = new Set<string>()
  const live = new Set<number>()

  function run(x: NodeExecution): Promise<NodeOutputs> {
    const signal = x.ctx.signal
    if (signal.aborted) return Promise.reject(new AbortError())
    const outDir = path.join(o.workRoot, randomUUID())
    outDirs.add(outDir)
    const job: WorkerJob = {
      v: WORKER_PROTOCOL_VERSION,
      nodeType: x.def.type,
      params: x.params,
      inputs: Object.fromEntries(Object.entries(x.inputs).map(([port, a]) => [port, wireInput(a)])),
      seed: x.ctx.seed,
      where: x.ctx.where,
      attempt: x.ctx.attempt,
      notes: [...x.ctx.notes],
      settings: { minutes: x.settings.minutes, budgetMode: x.settings.budgetMode },
      fake: x.useFake,
      outDir
    }

    return new Promise<NodeOutputs>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawnImpl(o.command, o.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: platform !== 'win32', // its own process group on macOS, so the whole group can be killed
          windowsHide: true,
          shell: false,
          env
        })
      } catch (e) {
        reject(new EngineError('missing_tool', `L’ouvrier local n’a pas pu démarrer : ${e instanceof Error ? e.message : String(e)}`))
        return
      }
      const pid = child.pid
      if (pid !== undefined) live.add(pid)
      let settled = false
      let exited = false
      let exitCode: number | null = null
      let exitSignal: NodeJS.Signals | null = null
      let stderr = ''
      let closeTimer: NodeJS.Timeout | undefined
      let exitTimer: NodeJS.Timeout | undefined
      /** The child's answer (`done` or `error`), delivered once the child has exited. */
      let answer: (() => void) | undefined

      const killNow = (): void => {
        if (pid !== undefined && !exited) kill(pid, platform)
      }
      const finish = (f: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (closeTimer) clearTimeout(closeTimer)
        if (exitTimer) clearTimeout(exitTimer)
        f()
      }
      const onAbort = (): void => {
        killNow()
        finish(() => reject(new AbortError()))
      }
      /** A child that answered exits by itself; one that lingers is killed with its tree, then the answer is given. */
      const answered = (f: () => void): void => {
        if (answer || settled) return
        answer = f
        if (exited) finish(f)
        else {
          exitTimer = setTimeout(() => {
            killNow()
            finish(f)
          }, EXIT_GRACE_MS)
        }
      }
      const write = (l: ParentLine): void => {
        if (exited || !child.stdin || child.stdin.destroyed) return
        child.stdin.write(encodeParentLine(l))
      }

      const handle = (l: ChildLine): void => {
        if (settled || answer) return
        switch (l.t) {
          case 'progress':
            x.ctx.emit({ kind: 'progress', frac: l.frac, ...(l.text ? { text: l.text } : {}) })
            return
          case 'log':
            x.ctx.emit({ kind: 'log', level: l.level, text: l.text })
            return
          case 'cost':
            x.ctx.reportCost({
              units: l.cost.units.filter((u) => (ESTIMATE_UNITS as readonly string[]).includes(u.unit)).map((u) => ({ unit: u.unit as EstimateUnit, qty: u.qty })),
              ...(l.cost.provider ? { provider: l.cost.provider } : {})
            })
            return
          case 'call': {
            let services: EngineServices
            try {
              services = o.services()
            } catch {
              services = {}
            }
            runCall(l, services, signal).then(
              (value) => write({ t: 'reply', id: l.id, ok: true, value: (value ?? null) as Json }),
              (e: unknown) => {
                const err = toEngineError(e)
                write({ t: 'reply', id: l.id, ok: false, error: { code: err.code, message: err.message, permanent: err.permanent } })
              }
            )
            return
          }
          case 'done':
            answered(() =>
              resolve(
                Object.fromEntries(
                  Object.entries(l.outputs).map(([name, out]) => [
                    name,
                    {
                      ...(out.files ? { files: out.files } : {}),
                      ...(out.value !== undefined ? { value: out.value as Json } : {}),
                      ...(out.meta ? { meta: out.meta as Record<string, Json> } : {})
                    }
                  ])
                )
              )
            )
            return
          case 'error':
            answered(() => reject(new EngineError(asCode(l.error.code), l.error.message, l.error.permanent)))
            return
        }
      }

      const onGone = (): void => {
        stopLines()
        if (answer) {
          finish(answer)
          return
        }
        const how = exitSignal ? `signal ${exitSignal}` : `code ${String(exitCode)}`
        const tail = stderr.trim().slice(-STDERR_TAIL)
        finish(() => reject(new EngineError('transient', `L’ouvrier local s’est arrêté en cours de route (${how}).${tail ? ` ${tail}` : ''}`)))
      }

      // bounded: a node printing one endless line cannot make this process keep it all
      const stopLines = child.stdout
        ? boundedLines(child.stdout, (line) => {
            const l = line ? decodeChildLine(line) : null
            if (l) handle(l)
          })
        : () => undefined
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d: string) => {
        stderr = (stderr + d).slice(-4 * STDERR_TAIL)
      })
      child.stdin?.on('error', () => undefined) // the child may be gone before a reply is written
      child.on('error', (e) => {
        exited = true
        if (pid !== undefined) live.delete(pid)
        stopLines()
        finish(() => reject(new EngineError('missing_tool', `L’ouvrier local n’a pas pu démarrer : ${e.message}`)))
      })
      child.on('exit', (code, sig) => {
        exited = true
        exitCode = code
        exitSignal = sig
        if (pid !== undefined) live.delete(pid)
        if (answer) {
          finish(answer)
          return
        }
        // the last lines may still be in the pipe: wait for it to close (not forever, a grandchild may hold it)
        closeTimer = setTimeout(onGone, CLOSE_GRACE_MS)
        closeTimer.unref?.()
      })
      child.on('close', () => {
        if (exited) onGone()
      })

      signal.addEventListener('abort', onAbort, { once: true })
      write({ t: 'job', job })
    })
  }

  return {
    run,
    cleanup: async () => {
      const dirs = [...outDirs]
      outDirs.clear()
      await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
    },
    pids: () => [...live],
    killAll: () => {
      for (const pid of [...live]) killSync(pid, platform)
    }
  }
}

/** The worker of the packaged (or built) app: Electron's own binary run as Node on `out/main/worker.js`. */
export function appWorkerCommand(o: { electronPath: string; outMainDir: string; dataDir: string; resourcesDir: string }): {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
} {
  // packaged: worker.js is unpacked next to app.asar (asarUnpack), a child process needs a real file
  const script = path.join(o.outMainDir, 'worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return {
    command: o.electronPath,
    args: [script, '--data', o.dataDir, '--resources', o.resourcesDir, '--parent-services'],
    env: workerEnv(process.env, { ELECTRON_RUN_AS_NODE: '1' })
  }
}

/**
 * The worker under plain Node (tests, dev scripts), running the engine's TypeScript through scripts/ts-resolve.mjs.
 * `entry` = a program calling `workerMain` (default: src/engine/worker/main.ts, the production catalogue).
 */
export function nodeWorkerCommand(
  repoRoot: string,
  dataDir: string,
  resourcesDir: string,
  entry: string = path.join(repoRoot, 'src', 'engine', 'worker', 'main.ts')
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    command: process.execPath,
    args: [
      '--experimental-transform-types',
      '--no-warnings',
      '--import',
      pathToFileURL(path.join(repoRoot, 'scripts', 'ts-resolve.mjs')).href, // --import wants a URL, not C:\…
      entry,
      '--data',
      dataDir,
      '--resources',
      resourcesDir,
      '--parent-services'
    ],
    env: workerEnv(process.env)
  }
}

/** Where Atelier's resources (fonts, music, skills) are: next to the app when packaged (extraResources), else the repo. */
export function resourcesDirFor(o: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  return o.isPackaged ? path.join(o.resourcesPath, 'resources') : path.join(o.appPath, 'resources')
}
