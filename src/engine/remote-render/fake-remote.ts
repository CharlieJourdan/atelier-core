// The fake remote render provider (vps-rendu): a small HTTP service that plays both halves of a serverless provider, free
// and offline: an object store (PUT/GET of blobs, like R2 through presigned links) and a job runner (start/status/cancel,
// like Scaleway Jobs) that runs the REAL worker program on each job:
//   - `process`: `node scripts/render-job.ts` on this machine (tests, quick checks);
//   - `docker`:  `docker run --cpus <c> --memory <m> <image>` per job, the provider's own box (the scale test);
//   - a function: the tests' in-process worker.
// It keeps at most `slots` runs at once (a provider's quota) and queues the rest, adds a cold start, bills the run's wall
// seconds, stops a run past its timeout, and can be `down` (every start answers 503) to prove the fallback.
// Bound to 127.0.0.1 by default; every request carries the bearer token it printed.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { RenderRunState } from '../../shared/render-job'

export interface FakeRemoteRun {
  id: string
  state: RenderRunState
  jobUrl: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  billedS?: number
  error?: string
}

export type FakeRunner = 'process' | 'docker' | ((jobUrl: string, signal: AbortSignal) => Promise<void>)

export interface FakeRemoteOptions {
  dir: string
  runner: FakeRunner
  /** Runs at once (default 6). */
  slots?: number
  coldStartMs?: number
  down?: boolean
  host?: string
  port?: number
  /** `process`: the repository root (scripts/render-job.ts). */
  root?: string
  docker?: { image: string; cpus: string; memory: string; mounts?: string[]; extraArgs?: string[] }
}

export interface FakeRemote {
  url: string
  token: string
  runs(): FakeRemoteRun[]
  /** How many times each key was written (PUT). */
  puts(): Record<string, number>
  setDown(down: boolean): void
  close(): Promise<void>
}

const SAFE_KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const MAX_BODY = 2 * 1024 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function startFakeRemote(o: FakeRemoteOptions): Promise<FakeRemote> {
  const token = randomBytes(18).toString('hex')
  const blobs = path.join(o.dir, 'blobs')
  await mkdir(blobs, { recursive: true })
  const slots = Math.max(1, o.slots ?? 6)
  let down = o.down ?? false
  const runs = new Map<string, FakeRemoteRun & { stop?: AbortController; child?: ChildProcess }>()
  const queue: string[] = []
  const putCount = new Map<string, number>()
  let active = 0

  const authorised = (req: IncomingMessage, url: URL): boolean => {
    const given = (req.headers.authorization ?? '').replace(/^Bearer /, '') || url.searchParams.get('t') || ''
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const execute = (jobUrl: string, signal: AbortSignal, run: FakeRemoteRun & { child?: ChildProcess }): Promise<void> => {
    if (typeof o.runner === 'function') return o.runner(jobUrl, signal)
    const [file, args] =
      o.runner === 'docker'
        ? [
            'docker',
            [
              'run',
              '--rm',
              '--name',
              `atelier-fake-remote-${run.id}`,
              '--cpus',
              o.docker?.cpus ?? '6',
              '--memory',
              o.docker?.memory ?? '12g',
              '--memory-swap',
              o.docker?.memory ?? '12g',
              '--shm-size',
              '1g',
              ...(o.docker?.mounts ?? []).flatMap((m) => ['-v', m]),
              ...(o.docker?.extraArgs ?? []),
              '-e',
              `ATELIER_JOB_URL=${jobUrl}`,
              o.docker?.image ?? 'atelier-render-worker:dev'
            ]
          ]
        : [
            process.execPath,
            ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/ts-resolve.mjs', 'scripts/render-job.ts', '--job', jobUrl]
          ]
    return new Promise((resolve, reject) => {
      const child = spawn(file as string, args as string[], { cwd: o.root ?? process.cwd(), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      run.child = child
      let err = ''
      child.stderr?.on('data', (d: Buffer) => void (err = (err + d.toString('utf8')).slice(-2000)))
      const kill = (): void => {
        if (o.runner === 'docker') spawn('docker', ['rm', '-f', `atelier-fake-remote-${run.id}`], { stdio: 'ignore' })
        child.kill('SIGKILL')
      }
      signal.addEventListener('abort', kill, { once: true })
      child.on('error', reject)
      child.on('close', (code) => {
        signal.removeEventListener('abort', kill)
        if (code === 0) resolve()
        else reject(new Error(err.trim().split(/\r?\n/).slice(-2).join(' ') || `exit ${code}`))
      })
    })
  }

  const pump = (): void => {
    while (active < slots && queue.length > 0) {
      const id = queue.shift() as string
      const run = runs.get(id)
      if (!run || run.state !== 'queued') continue
      active++
      const stop = new AbortController()
      run.stop = stop
      void (async () => {
        try {
          if (o.coldStartMs) await new Promise((r) => setTimeout(r, o.coldStartMs))
          if (stop.signal.aborted) throw new Error('cancelled')
          run.state = 'running'
          run.startedAt = Date.now()
          await execute(run.jobUrl, stop.signal, run)
          if (stop.signal.aborted) throw new Error('cancelled')
          run.state = 'succeeded'
        } catch (e) {
          if (run.state !== 'cancelled') {
            run.state = 'failed'
            run.error = e instanceof Error ? e.message : String(e)
          }
        } finally {
          run.endedAt = Date.now()
          // billed like a serverless job: from the container's start to its end
          run.billedS = run.startedAt ? (run.endedAt - run.startedAt) / 1000 : 0
          active--
          pump()
        }
      })()
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!authorised(req, url)) return json(res, 401, { error: 'unauthorised' })
      const blob = /^\/blob\/(.+)$/.exec(url.pathname)
      if (blob) {
        const key = decodeURIComponent(blob[1] as string)
        if (!SAFE_KEY.test(key) || key.split('/').includes('..')) return json(res, 400, { error: 'bad key' })
        const file = path.join(blobs, ...key.split('/'))
        if (req.method === 'PUT') {
          const body = await readBody(req)
          await mkdir(path.dirname(file), { recursive: true })
          await writeFile(file, body)
          putCount.set(key, (putCount.get(key) ?? 0) + 1)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'GET') {
          if (!existsSync(file)) return json(res, 404, { error: 'not found' })
          const bytes = await readFile(file)
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length })
          return res.end(bytes)
        }
        return json(res, 405, { error: 'method' })
      }
      if (url.pathname === '/runs' && req.method === 'POST') {
        if (down) return json(res, 503, { error: 'the provider is down (fake)' })
        const body = JSON.parse((await readBody(req)).toString('utf8')) as { jobUrl?: string; timeoutS?: number }
        if (typeof body.jobUrl !== 'string') return json(res, 400, { error: 'jobUrl' })
        const id = randomBytes(6).toString('hex')
        const run: FakeRemoteRun = { id, state: 'queued', jobUrl: body.jobUrl, createdAt: Date.now() }
        runs.set(id, run)
        queue.push(id)
        const timeoutS = typeof body.timeoutS === 'number' ? body.timeoutS : 3600
        setTimeout(() => {
          const r = runs.get(id)
          if (r && (r.state === 'queued' || r.state === 'running')) {
            r.state = 'failed'
            r.error = `timed out after ${timeoutS} s`
            r.stop?.abort()
          }
        }, timeoutS * 1000).unref()
        pump()
        return json(res, 201, { id })
      }
      const one = /^\/runs\/([a-f0-9]+)(\/cancel)?$/.exec(url.pathname)
      if (one) {
        const run = runs.get(one[1] as string)
        if (!run) return json(res, 404, { error: 'no run' })
        if (one[2] && req.method === 'POST') {
          if (run.state === 'queued' || run.state === 'running') {
            run.state = 'cancelled'
            run.stop?.abort()
          }
          return json(res, 200, { state: run.state })
        }
        return json(res, 200, { state: run.state, ...(run.billedS !== undefined && run.endedAt ? { billedS: run.billedS } : {}), ...(run.error ? { error: run.error } : {}) })
      }
      return json(res, 404, { error: 'no route' })
    })().catch((e: unknown) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }))
  })
  await new Promise<void>((resolve) => server.listen(o.port ?? 0, o.host ?? '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://${o.host && o.host !== '0.0.0.0' ? o.host : '127.0.0.1'}:${port}`,
    token,
    runs: () => [...runs.values()].map(({ stop: _s, child: _c, ...r }) => r),
    puts: () => Object.fromEntries(putCount),
    setDown: (d) => void (down = d),
    close: async () => {
      for (const r of runs.values()) r.stop?.abort()
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
    }
  }
}
