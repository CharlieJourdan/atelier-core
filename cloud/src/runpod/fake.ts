// A fake RunPod serverless API on 127.0.0.1 (lot P5): the same three routes as the real one (run, status, cancel,
// Bearer key), but a "pod" is a local child process running the worker program of the worker protocol. A run starts
// at once in `<workDir>/<id>/`; the worker gets its job on stdin, its protocol lines are read from stdout; it has no
// parent services (every `call` is refused, as on a pod). The end is posted to the job's webhook like RunPod does.
// Cancel kills the worker's whole process tree. Free, offline: used by `npm run cloud:dev` and the tests.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { decodeChildLine, encodeParentLine, WorkerJob, type ChildLine } from '../../../src/shared/worker-protocol.ts'
import { killTree as killProcessTree } from './kill.ts'
import type { RunpodSettings } from './adapter.ts'
import type { RunpodState } from './client.ts'

export const FAKE_RUNPOD_ENDPOINTS = { render: 'fake-render', 'gpu-video': 'fake-gpu-video' } as const

export interface FakeRunpodOptions {
  /** argv of the worker program; [0] is the executable (no shell). */
  workerCommand: string[]
  workDir: string
  apiKey: string
  env?: NodeJS.ProcessEnv
  killTree?: (pid: number) => void
  /** Posts a status object to a webhook (default: fetch; errors ignored). */
  deliver?: (url: string, body: Record<string, unknown>) => Promise<void> | void
}

export interface FakeJobState {
  id: string
  endpoint: string
  status: RunpodState
  outDir: string
  output?: unknown
  error?: string
  logs: string[]
  progress?: { frac: number; text?: string }
  cost?: unknown
  startedAt: number
  endedAt?: number
}

export interface FakeRunpod {
  url: string
  apiKey: string
  workDir: string
  /** Pod job ids cancelled through the API, in order. */
  cancels: string[]
  job(id: string): FakeJobState | undefined
  /** Every pod job started, oldest first. */
  jobs(): FakeJobState[]
  pidOf(id: string): number | undefined
  close(): Promise<void>
}

/** CloudOptions.runpod for a Cloud that uses this fake. */
export function fakeRunpodOptions(fake: FakeRunpod, o: { pollMs?: number } = {}): RunpodSettings {
  return { baseUrl: fake.url, apiKey: () => fake.apiKey, endpoints: { ...FAKE_RUNPOD_ENDPOINTS }, fileRoot: fake.workDir, ...(o.pollMs ? { pollMs: o.pollMs } : {}) }
}

const TERMINAL: readonly RunpodState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT']
const MAX_BODY = 10 * 1024 * 1024

interface Running {
  state: FakeJobState
  child: ChildProcess | null
  exited: boolean
  webhook: string | null
  stderr: string
}

const defaultDeliver = async (url: string, body: Record<string, unknown>): Promise<void> => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  await res.body?.cancel()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function startFakeRunpod(o: FakeRunpodOptions): Promise<FakeRunpod> {
  if (o.workerCommand.length === 0) throw new Error('workerCommand is empty')
  const jobs = new Map<string, Running>()
  const cancels: string[] = []
  const kill = o.killTree ?? ((pid: number) => killProcessTree(pid))
  const deliver = o.deliver ?? defaultDeliver
  const expectedAuth = Buffer.from(`Bearer ${o.apiKey}`)
  mkdirSync(o.workDir, { recursive: true })

  const statusOf = (r: Running): Record<string, unknown> => {
    const s = r.state
    const output = s.status === 'IN_PROGRESS' && s.progress ? { progress: s.progress.frac, ...(s.progress.text ? { text: s.progress.text } : {}) } : s.output
    return {
      id: s.id,
      status: s.status,
      ...(output !== undefined ? { output } : {}),
      ...(s.error !== undefined ? { error: s.error } : {}),
      delayTime: 0,
      executionTime: (s.endedAt ?? Date.now()) - s.startedAt
    }
  }

  const end = (r: Running, status: RunpodState, patch: { output?: unknown; error?: string } = {}): void => {
    if (TERMINAL.includes(r.state.status)) return
    Object.assign(r.state, patch, { status, endedAt: Date.now() })
    r.child?.stdin?.end()
    if (r.webhook) {
      const url = r.webhook
      const body = statusOf(r)
      void Promise.resolve()
        .then(() => deliver(url, body))
        .catch(() => undefined)
    }
  }

  const onLine = (r: Running, line: ChildLine): void => {
    switch (line.t) {
      case 'progress':
        r.state.progress = { frac: line.frac, ...(line.text ? { text: line.text } : {}) }
        break
      case 'log':
        r.state.logs.push(line.text)
        break
      case 'cost':
        r.state.cost = line.cost
        break
      case 'call':
        r.child?.stdin?.write(
          encodeParentLine({ t: 'reply', id: line.id, ok: false, error: { code: 'missing_tool', message: 'Pas de service dans la machine distante.', permanent: true } })
        )
        break
      case 'done': {
        const outputs: Record<string, unknown> = {}
        for (const [name, out] of Object.entries(line.outputs)) {
          outputs[name] = {
            ...(out.files ? { files: out.files.map((f) => ({ name: basename(f), url: pathToFileURL(resolve(r.state.outDir, f)).href })) } : {}),
            ...(out.value !== undefined ? { value: out.value } : {}),
            ...(out.meta ? { meta: out.meta } : {})
          }
        }
        const gpuSeconds = Math.max(1, Math.ceil((Date.now() - r.state.startedAt) / 1000))
        end(r, 'COMPLETED', { output: { outputs, ...(r.state.cost ? { cost: r.state.cost } : {}), gpuSeconds } })
        break
      }
      case 'error':
        end(r, 'FAILED', { error: line.error.message })
        break
    }
  }

  const start = (podId: string, endpoint: string, job: WorkerJob, webhook: string | null): Running => {
    const r: Running = {
      state: { id: podId, endpoint, status: 'IN_PROGRESS', outDir: job.outDir, logs: [], startedAt: Date.now() },
      child: null,
      exited: false,
      webhook,
      stderr: ''
    }
    jobs.set(r.state.id, r)
    const [cmd, ...args] = o.workerCommand as [string, ...string[]]
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: o.env ?? process.env
    })
    r.child = child
    child.on('error', (err) => {
      r.exited = true
      end(r, 'FAILED', { error: `the worker could not start (${err.name})` })
    })
    child.stdin.on('error', () => undefined)
    child.stderr.on('data', (d: Buffer) => {
      r.stderr = (r.stderr + d.toString('utf8')).slice(-2000)
    })
    createInterface({ input: child.stdout }).on('line', (text) => {
      const line = decodeChildLine(text)
      if (line) onLine(r, line)
    })
    child.on('close', (code, signal) => {
      r.exited = true
      end(r, 'FAILED', { error: `the worker exited (${code ?? signal}) without an answer: ${r.stderr.trim().slice(-500)}` })
    })
    child.stdin.write(encodeParentLine({ t: 'job', job }))
    return r
  }

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const auth = Buffer.from(String(req.headers.authorization ?? ''))
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) return send(res, 401, { error: 'unauthorized' })
    const parts = new URL(req.url ?? '/', 'http://fake').pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const [endpoint, action, id] = parts
    if (!endpoint || !action) return send(res, 404, { error: 'not found' })
    if (req.method === 'POST' && action === 'run' && parts.length === 2) {
      let body: { input?: { job?: unknown }; webhook?: unknown }
      try {
        body = JSON.parse(await readBody(req)) as typeof body
      } catch {
        return send(res, 400, { error: 'bad body' })
      }
      const podId = `fake-${randomBytes(8).toString('hex')}`
      const outDir = resolve(o.workDir, podId)
      const job = WorkerJob.safeParse({ ...(body.input?.job as object), outDir })
      if (!job.success) return send(res, 400, { error: `bad job: ${job.error.issues[0]?.path.join('.')}` })
      mkdirSync(outDir, { recursive: true })
      const r = start(podId, endpoint, job.data, typeof body.webhook === 'string' ? body.webhook : null)
      return send(res, 200, { id: r.state.id, status: r.state.status })
    }
    const r = id && parts.length === 3 ? jobs.get(id) : undefined
    if (!r || r.state.endpoint !== endpoint) return send(res, 404, { error: 'not found' })
    if (req.method === 'GET' && action === 'status') return send(res, 200, statusOf(r))
    if (req.method === 'POST' && action === 'cancel') {
      if (!TERMINAL.includes(r.state.status)) {
        cancels.push(r.state.id)
        end(r, 'CANCELLED')
        if (r.child?.pid !== undefined && !r.exited) kill(r.child.pid)
      }
      return send(res, 200, { id: r.state.id, status: r.state.status })
    }
    return send(res, 404, { error: 'not found' })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal' })
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey: o.apiKey,
    workDir: o.workDir,
    cancels,
    job: (id) => jobs.get(id)?.state,
    jobs: () => [...jobs.values()].map((r) => r.state),
    pidOf: (id) => jobs.get(id)?.child?.pid,
    async close() {
      for (const r of jobs.values()) {
        if (r.child?.pid !== undefined && !r.exited) kill(r.child.pid)
        r.webhook = null
        end(r, 'CANCELLED')
      }
      server.closeAllConnections()
      await new Promise<void>((ok) => server.close(() => ok()))
    }
  }
}
