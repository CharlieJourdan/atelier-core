// Shared pieces of the headless-brain tests: a brain on a random loopback port over temp folders (never in the repo),
// the fake team (ATELIER_FAKE_LLM=1: never a real model), no runner, no automations, no MCP bridge.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startHeadless, type HeadlessBrain, type HeadlessOptions } from '../../src/main/headless/host'

export const REPO = path.resolve(__dirname, '..', '..')

export interface TestBrain extends HeadlessBrain {
  token: string
  dir: string
  rpc: (method: string, args?: unknown[], headers?: Record<string, string>) => Promise<{ status: number; body: unknown }>
  stop: () => Promise<void>
}

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

export async function startTestBrain(extra: Partial<HeadlessOptions> = {}): Promise<TestBrain> {
  const dir = tempDir('atb-')
  const brain = await startHeadless({
    dataDir: path.join(dir, 'data'),
    keyFile: path.join(dir, 'key', 'machine.key'),
    host: '127.0.0.1',
    port: 0,
    origins: [],
    repoRoot: REPO,
    env: { ATELIER_FAKE_LLM: '1', ATELIER_RUNNER: 'off', ATELIER_AUTOMATIONS: 'off', ATELIER_EXAMPLE: '0' },
    ...extra
  })
  const token = brain.newToken
  if (!token) throw new Error('a fresh brain prints its token')
  const rpc = async (method: string, args: unknown[] = [], headers: Record<string, string> = { authorization: `Bearer ${token}` }) => {
    const res = await fetch(`${brain.url}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ method, args }) })
    return { status: res.status, body: (await res.json()) as unknown }
  }
  return {
    ...brain,
    token,
    dir,
    rpc,
    stop: async () => {
      await brain.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Reads SSE messages from an open `/events` response until `pred` matches one (or the timeout). */
export async function waitForSse(res: Response, pred: (event: string, data: unknown) => boolean, timeoutMs = 5000): Promise<{ event: string; data: unknown }> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())))
      ])
      if (next === null || next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event && data !== undefined) {
          const parsed = JSON.parse(data) as unknown
          if (pred(event, parsed)) return { event, data: parsed }
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  throw new Error('no matching SSE event')
}
