// The production host of the app (lot P5): what one run of our engine gets from the app. Three executors (PLAN-V2-
// PRODUCTION §1.5):
//   - local: the node runs in the local worker process (local-worker.ts), stopped with its whole process tree;
//   - cloud: the node runs here and its paid items go to Atelier Cloud (cloud-http.ts: quote, job, download);
//   - gpu: the node is sent to Atelier Cloud, which runs it on RunPod (cloud-gpu.ts).
// Plus the services (ffmpeg, system voice, working folders, our resources, Atelier Cloud, Claude), the credits
// (credits.ts) and the copy of every Cloud job into the local ledger (`onJob`). The Cloud's address and its access
// token come from the app's Cloud session; nothing here stores or logs a token. Lot P7 starts runs with it.
// `forCloudRun` is what a run the owner turned real gets (production-16, decision 0044): its nodes run in this process as
// in a demo run, each node's paid items go to the Cloud through a client that tells which node made each job.
import path from 'node:path'
import { demoCloudService } from '../../engine/cloud-demo'
import { cloudGpuExecutor } from '../../engine/cloud-gpu'
import { cloudCaller, cloudHttpService, type CloudHttpOptions } from '../../engine/cloud-http'
import type { Spender } from '../../engine/estimate'
import { inProcessExecutor, type Executors, type NodeExecutor } from '../../engine/executor'
import { nodeHost } from '../../engine/host'
import { housekeep } from '../../engine/render/housekeeping'
import { createRemoteRenderer, defaultLocalRenders, usableMemoryBytes, type RemoteRenderer } from '../../engine/remote-render/executor'
import type { ClaudeService, EngineServices, VideoReaderService } from '../../engine/services'
import { FsArtefactStore } from '../../engine/store'
import { CloudQuoter, CreditSpender, notConnectedSpender } from './credits'
import { localWorkerExecutor, type LocalWorkerExecutor } from './local-worker'
import type { CloudRunHost, NodeJobEvent } from './runs/cloud'

/** Where a run's Cloud jobs are attributed in the local ledger. */
export interface RunTags {
  videoId?: number | null
  channelId?: number | null
  /** The video's cap in credits (`budget.capCredits`). */
  capCredits?: number | null
  /** The run's quote ceiling (`captureCeiling`, decision 0078) and what its earlier attempts already spent: a real run never reserves past it. */
  run?: { ceilingCredits: number; spentCredits: number }
}

export type JobListener = NonNullable<CloudHttpOptions['onJob']> extends (e: infer E) => unknown ? (e: E, tags: RunTags) => void : never

export interface ProductionHostOptions {
  /** Holds artefacts/, cache/, scratch/, worker/ and cloud-keys/ (the idempotency records that survive a crash). */
  dataDir: string
  resourcesDir: string
  /** How to start the local worker (local-worker.ts: appWorkerCommand in the app, nodeWorkerCommand in tests). */
  worker: { command: string; args: string[]; env?: NodeJS.ProcessEnv }
  /** The connected Cloud, or null: Cloud and GPU nodes then fail with a clear message and nothing is paid. */
  cloud: { baseUrl: () => string; token: () => Promise<string>; fetchImpl?: typeof fetch; pollMs?: number } | null
  claude?: ClaudeService
  /** Reads the support videos of an idea (the eyes, through the Cloud). */
  videos?: VideoReaderService
  /** Copies each Cloud job into the local ledger (CloudSpendMirror.record). */
  onJob?: JobListener
  /** Credits a video already committed (CloudSpendMirror.committedFor): seeds the cap of its next run. */
  committedFor?: (videoId: number) => number
  platform?: NodeJS.Platform
  pathEnv?: string
  killTree?: (pid: number, platform: NodeJS.Platform) => void
  /** The team VPS's remote renderer (decision 0084, vps-rendu): heavy render nodes go to serverless workers, the VPS as fallback.
   *  Absent: every heavy render is made here, at most `defaultLocalRenders(os.totalmem())` at once (the others wait their turn). */
  remoteRender?: RemoteRenderer
}

export interface RunHost {
  services: EngineServices
  executors: Executors
  spender: Spender
  quoter: CloudQuoter | undefined
  /** Removes the run's scratch folders and the worker's folders (after the run settled). */
  cleanup(): Promise<void>
}

export interface ProductionHost {
  store: FsArtefactStore
  forRun(tags?: RunTags): RunHost
  /** A real run's host (null without a Cloud): in-process nodes, the Cloud per node, the wallet guard, the GPU executor. */
  forCloudRun(o: { dataDir: string; resourcesDir: string; tags: RunTags; onJob: (nodeId: string, e: NodeJobEvent) => void }): CloudRunHost | null
  /** A DEMO run's services (decision 0109): the Cloud limited to its free usages (stock search), which can never spend; null
   *  without a Cloud (the demo then draws its stand-ins, as before). */
  forDemoRun(o: { dataDir: string; resourcesDir: string }): { services: EngineServices; cleanup(): Promise<void> } | null
  /** Quit: kills every local worker still running (whole process trees), synchronously. */
  killAll(): void
}

export function createProductionHost(o: ProductionHostOptions): ProductionHost {
  const store = new FsArtefactStore(path.join(o.dataDir, 'artefacts'))
  const workers = new Set<LocalWorkerExecutor>()
  // rendu-menage: the scratch of dead processes and the oldest re-creatable files go when this computer starts and after each run
  const tidy = (dir: string): void => void housekeep(dir, { dryRun: false }).catch(() => undefined)
  tidy(o.dataDir)
  // one queue of heavy renders for every run of this computer (several productions at once never exhaust its memory)
  const renderer = o.remoteRender ?? createRemoteRenderer({ backends: [], maxLocal: defaultLocalRenders(usableMemoryBytes()) })
  return {
    store,
    killAll: () => {
      for (const w of workers) w.killAll()
    },
    forDemoRun(r) {
      if (!o.cloud) return null
      const cloud = demoCloudService({
        baseUrl: o.cloud.baseUrl(),
        token: o.cloud.token,
        ...(o.cloud.fetchImpl ? { fetchImpl: o.cloud.fetchImpl } : {}),
        ...(o.cloud.pollMs ? { pollMs: o.cloud.pollMs } : {}),
        // its own key records: a demo key never replays a priced quote of a real run
        stateDir: path.join(o.dataDir, 'cloud-keys-demo')
      })
      const host = nodeHost({
        dataDir: r.dataDir,
        resourcesDir: r.resourcesDir,
        ...(o.platform ? { platform: o.platform } : {}),
        ...(o.pathEnv !== undefined ? { pathEnv: o.pathEnv } : {}),
        extra: { cloud }
      })
      return { services: host.services, cleanup: async () => { await host.cleanup(); tidy(r.dataDir) } }
    },
    forCloudRun(r): CloudRunHost | null {
      if (!o.cloud) return null
      const base: CloudHttpOptions = {
        baseUrl: o.cloud.baseUrl(),
        token: o.cloud.token,
        ...(o.cloud.fetchImpl ? { fetchImpl: o.cloud.fetchImpl } : {}),
        ...(o.cloud.pollMs ? { pollMs: o.cloud.pollMs } : {}),
        stateDir: path.join(o.dataDir, 'cloud-keys'),
        // a demo answer in a real run is free (production-17)
        realRun: true
      }
      // every job goes to the local ledger (the mirror) and to the run, with the node that made it
      const forNode = (nodeId: string): CloudHttpOptions => ({
        ...base,
        onJob: (e) => {
          o.onJob?.(e, r.tags)
          r.onJob(nodeId, e)
        }
      })
      const host = nodeHost({
        dataDir: r.dataDir,
        resourcesDir: r.resourcesDir,
        ...(o.platform ? { platform: o.platform } : {}),
        ...(o.pathEnv !== undefined ? { pathEnv: o.pathEnv } : {}),
        extra: { cloud: cloudHttpService(base), ...(o.claude ? { claude: o.claude } : {}), ...(o.videos ? { videos: o.videos } : {}) }
      })
      // the attempt's context is its own (one per node attempt): its Cloud client is the node's
      const inProcess: NodeExecutor = {
        run: (x) => {
          x.ctx.services = { ...x.ctx.services, cloud: cloudHttpService(forNode(x.nodeId)) }
          return inProcessExecutor.run(x)
        }
      }
      const gpu: NodeExecutor = { run: (x) => cloudGpuExecutor(forNode(x.nodeId)).run(x) }
      const videoId = r.tags.videoId
      return {
        services: host.services,
        executors: { local: renderer.wrap(inProcess), cloud: inProcess, gpu },
        spender: new CreditSpender({
          caller: cloudCaller(base),
          capCredits: r.tags.capCredits ?? null,
          ...(r.tags.run ? { run: r.tags.run } : {}),
          alreadyCommitted: typeof videoId === 'number' ? (o.committedFor?.(videoId) ?? 0) : 0
        }),
        cleanup: async () => {
          await host.cleanup()
          tidy(r.dataDir)
        }
      }
    },
    forRun(tags: RunTags = {}): RunHost {
      const cloudOpts = (): CloudHttpOptions | null =>
        o.cloud
          ? {
              baseUrl: o.cloud.baseUrl(),
              token: o.cloud.token,
              ...(o.cloud.fetchImpl ? { fetchImpl: o.cloud.fetchImpl } : {}),
              ...(o.cloud.pollMs ? { pollMs: o.cloud.pollMs } : {}),
              stateDir: path.join(o.dataDir, 'cloud-keys'),
              onJob: (e) => o.onJob?.(e, tags)
            }
          : null
      const c = cloudOpts()
      const host = nodeHost({
        dataDir: o.dataDir,
        resourcesDir: o.resourcesDir,
        ...(o.platform ? { platform: o.platform } : {}),
        ...(o.pathEnv !== undefined ? { pathEnv: o.pathEnv } : {}),
        extra: { ...(c ? { cloud: cloudHttpService(c) } : {}), ...(o.claude ? { claude: o.claude } : {}), ...(o.videos ? { videos: o.videos } : {}) }
      })
      const local = localWorkerExecutor({
        command: o.worker.command,
        args: o.worker.args,
        ...(o.worker.env ? { env: o.worker.env } : {}),
        workRoot: path.join(o.dataDir, 'worker'),
        services: () => host.services,
        ...(o.platform ? { platform: o.platform } : {}),
        ...(o.killTree ? { killTree: o.killTree } : {})
      })
      workers.add(local)
      const executors: Executors = { local: renderer.wrap(local), ...(c ? { gpu: cloudGpuExecutor(c) } : {}) }
      const caller = c ? cloudCaller(c) : null
      return {
        services: host.services,
        executors,
        spender: caller ? new CreditSpender({
              caller,
              capCredits: tags.capCredits ?? null,
              alreadyCommitted: typeof tags.videoId === 'number' ? (o.committedFor?.(tags.videoId) ?? 0) : 0
            }) : notConnectedSpender,
        quoter: caller ? new CloudQuoter(caller) : undefined,
        cleanup: async () => {
          workers.delete(local)
          await local.cleanup()
          await host.cleanup()
          tidy(o.dataDir)
        }
      }
    }
  }
}
