// The two halves of the fake remote provider as a backend sees them (vps-rendu): its object store and its job runner, over
// HTTP with its bearer token, so a simulated VPS in a container reaches a fake that runs on the host
// (`http://host.docker.internal:<port>`). The links handed to the worker carry the token in their query, like presigned links.
import type { RenderJobStore, RenderRunStatus, RenderStarter } from '../../shared/render-job'
import { storeRenderBackend, type RenderBackend } from './backend'

export interface FakeRemoteAddress {
  url: string
  token: string
  fetchImpl?: typeof fetch
}

export function fakeRemoteStore(a: FakeRemoteAddress): RenderJobStore {
  const f = a.fetchImpl ?? fetch
  const link = (key: string): string => `${a.url}/blob/${key.split('/').map(encodeURIComponent).join('/')}?t=${a.token}`
  return {
    async put(key, bytes, signal) {
      const res = await f(link(key), { method: 'PUT', body: new Uint8Array(bytes), signal })
      await res.body?.cancel()
      if (!res.ok) throw new Error(`the fake store answered HTTP ${res.status}`)
      return link(key)
    },
    slot: (key) => ({ putUrl: link(key), getUrl: link(key) }),
    async get(key, signal) {
      const res = await f(link(key), { signal })
      if (res.status === 404) {
        await res.body?.cancel()
        return null
      }
      if (!res.ok) throw new Error(`the fake store answered HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    }
  }
}

export function fakeRemoteStarter(a: FakeRemoteAddress): RenderStarter {
  const f = a.fetchImpl ?? fetch
  const headers = { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }
  return {
    id: 'fake',
    async start(jobUrl, o) {
      const res = await f(`${a.url}/runs`, { method: 'POST', headers, body: JSON.stringify({ jobUrl, timeoutS: o.timeoutS }), signal: o.signal })
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !body.id) throw new Error(`the fake provider refused the job (HTTP ${res.status}${body.error ? `: ${body.error}` : ''})`)
      return body.id
    },
    async status(ref, signal) {
      const res = await f(`${a.url}/runs/${ref}`, { headers, signal })
      if (!res.ok) throw new Error(`the fake provider answered HTTP ${res.status}`)
      return (await res.json()) as RenderRunStatus
    },
    async cancel(ref) {
      const res = await f(`${a.url}/runs/${ref}/cancel`, { method: 'POST', headers })
      await res.body?.cancel()
    }
  }
}

export const fakeRemoteBackend = (a: FakeRemoteAddress & { pollMs?: number }): RenderBackend =>
  storeRenderBackend({ starter: fakeRemoteStarter(a), store: fakeRemoteStore(a), ...(a.pollMs ? { pollMs: a.pollMs } : {}) })
