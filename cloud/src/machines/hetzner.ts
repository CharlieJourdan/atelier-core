// The machine provider behind the team computers: the Hetzner Cloud API (v1) for real, an in-memory fake for the demo and
// the tests. Same interface, so the service never knows which one it drives. The real one is only built when paidCalls
// is on and HETZNER_API_TOKEN is in the vault (machines/service.ts); it never logs the token.
import type { Location, ServerType } from './plans.ts'

export interface ProviderServer {
  id: string
  /** Hetzner's status words: initializing, starting, running, stopping, off, deleting, … */
  status: string
  ipv4: string | null
}

export interface CreateServerInput {
  name: string
  serverType: ServerType['id']
  location: Location
  /** Ubuntu image name, or a snapshot id to resume from. */
  image: string
  userData: string | null
  labels: Record<string, string>
}

export interface MachineProvider {
  readonly kind: 'hetzner' | 'fake'
  createServer(input: CreateServerInput): Promise<{ server: ProviderServer; actionId: string }>
  getServer(id: string): Promise<ProviderServer | null>
  shutdown(id: string): Promise<{ actionId: string }>
  powerOn(id: string): Promise<{ actionId: string }>
  createSnapshot(id: string, description: string): Promise<{ imageId: string; actionId: string }>
  deleteServer(id: string): Promise<{ actionId: string }>
  deleteImage(id: string): Promise<void>
  /** running | success | error */
  actionStatus(actionId: string): Promise<'running' | 'success' | 'error'>
}

export class MachineProviderError extends Error {
  readonly status: number
  readonly code: string
  /** Out of capacity in that location: try the next one. */
  readonly outOfStock: boolean
  constructor(message: string, status: number, code: string, outOfStock = false) {
    super(message)
    this.status = status
    this.code = code
    this.outOfStock = outOfStock
  }
}

const BASE = 'https://api.hetzner.cloud/v1'

interface HetznerServerJson {
  id: number
  status: string
  public_net?: { ipv4?: { ip?: string } | null }
}

const toServer = (s: HetznerServerJson): ProviderServer => ({ id: String(s.id), status: s.status, ipv4: s.public_net?.ipv4?.ip ?? null })

export interface HetznerOptions {
  token: string
  fetchImpl?: typeof fetch
  /** Waits before a retry after a 429 (tests pass 0). */
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export class HetznerProvider implements MachineProvider {
  readonly kind = 'hetzner' as const
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number
  private readonly opts: HetznerOptions

  constructor(opts: HetznerOptions) {
    this.opts = opts
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.maxRetries = opts.maxRetries ?? 3
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      if (res.status === 429 && attempt < this.maxRetries) {
        const reset = Number(res.headers.get('ratelimit-reset'))
        const wait = Number.isFinite(reset) && reset > 0 ? Math.min(60_000, Math.max(0, reset * 1000 - Date.now())) : 1000 * 2 ** attempt
        await this.sleep(wait)
        continue
      }
      if (res.status === 204) return undefined as T
      const text = await res.text()
      let json: unknown
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error
        const code = err?.code ?? `http_${res.status}`
        // the provider's message never contains the token; ours never echoes request headers
        throw new MachineProviderError(`Hetzner ${method} ${path.split('?')[0]}: ${code}${err?.message ? ` (${err.message.slice(0, 200)})` : ''}`, res.status, code, code === 'resource_unavailable' || code === 'placement_error')
      }
      return json as T
    }
  }

  async createServer(i: CreateServerInput): Promise<{ server: ProviderServer; actionId: string }> {
    const image = /^\d+$/.test(i.image) ? Number(i.image) : i.image
    const r = await this.call<{ server: HetznerServerJson; action: { id: number } }>('POST', '/servers', {
      name: i.name,
      server_type: i.serverType,
      location: i.location,
      image,
      start_after_create: true,
      labels: i.labels,
      ...(i.userData ? { user_data: i.userData } : {})
    })
    return { server: toServer(r.server), actionId: String(r.action.id) }
  }

  async getServer(id: string): Promise<ProviderServer | null> {
    try {
      const r = await this.call<{ server: HetznerServerJson }>('GET', `/servers/${encodeURIComponent(id)}`)
      return toServer(r.server)
    } catch (err) {
      if (err instanceof MachineProviderError && err.status === 404) return null
      throw err
    }
  }

  async shutdown(id: string): Promise<{ actionId: string }> {
    const r = await this.call<{ action: { id: number } }>('POST', `/servers/${encodeURIComponent(id)}/actions/shutdown`)
    return { actionId: String(r.action.id) }
  }

  async powerOn(id: string): Promise<{ actionId: string }> {
    const r = await this.call<{ action: { id: number } }>('POST', `/servers/${encodeURIComponent(id)}/actions/poweron`)
    return { actionId: String(r.action.id) }
  }

  async createSnapshot(id: string, description: string): Promise<{ imageId: string; actionId: string }> {
    const r = await this.call<{ image: { id: number }; action: { id: number } }>('POST', `/servers/${encodeURIComponent(id)}/actions/create_image`, {
      type: 'snapshot',
      description: description.slice(0, 120),
      labels: { atelier: 'hibernation' }
    })
    return { imageId: String(r.image.id), actionId: String(r.action.id) }
  }

  async deleteServer(id: string): Promise<{ actionId: string }> {
    const r = await this.call<{ action: { id: number } }>('DELETE', `/servers/${encodeURIComponent(id)}`)
    return { actionId: String(r.action.id) }
  }

  async deleteImage(id: string): Promise<void> {
    await this.call<undefined>('DELETE', `/images/${encodeURIComponent(id)}`)
  }

  async actionStatus(actionId: string): Promise<'running' | 'success' | 'error'> {
    const r = await this.call<{ action: { status: string } }>('GET', `/actions/${encodeURIComponent(actionId)}`)
    return r.action.status === 'success' ? 'success' : r.action.status === 'error' ? 'error' : 'running'
  }
}

/** The demo provider: machines that exist only in memory and are ready at once. */
export class FakeMachineProvider implements MachineProvider {
  readonly kind = 'fake' as const
  readonly servers = new Map<string, ProviderServer & { image: string; type: string }>()
  readonly images = new Set<string>()
  private seq = 1000
  /** Locations that answer "out of stock" (tests of the location fallback). */
  outOfStock = new Set<string>()

  async createServer(i: CreateServerInput): Promise<{ server: ProviderServer; actionId: string }> {
    if (this.outOfStock.has(i.location)) throw new MachineProviderError(`no ${i.serverType} in ${i.location}`, 412, 'resource_unavailable', true)
    if (/^\d+$/.test(i.image) && !this.images.has(i.image)) throw new MachineProviderError('image not found', 404, 'not_found')
    const id = String(++this.seq)
    const n = this.seq % 250
    const server = { id, status: 'running', ipv4: `198.51.100.${n}`, image: i.image, type: i.serverType }
    this.servers.set(id, server)
    return { server: { id, status: server.status, ipv4: server.ipv4 }, actionId: `a${id}` }
  }
  async getServer(id: string): Promise<ProviderServer | null> {
    const s = this.servers.get(id)
    return s ? { id: s.id, status: s.status, ipv4: s.ipv4 } : null
  }
  async shutdown(id: string): Promise<{ actionId: string }> {
    const s = this.need(id)
    s.status = 'off'
    return { actionId: `s${id}` }
  }
  async powerOn(id: string): Promise<{ actionId: string }> {
    const s = this.need(id)
    s.status = 'running'
    return { actionId: `p${id}` }
  }
  async createSnapshot(id: string): Promise<{ imageId: string; actionId: string }> {
    this.need(id)
    const imageId = String(++this.seq)
    this.images.add(imageId)
    return { imageId, actionId: `i${imageId}` }
  }
  async deleteServer(id: string): Promise<{ actionId: string }> {
    this.need(id)
    this.servers.delete(id)
    return { actionId: `d${id}` }
  }
  async deleteImage(id: string): Promise<void> {
    this.images.delete(id)
  }
  async actionStatus(): Promise<'running' | 'success' | 'error'> {
    return 'success'
  }
  private need(id: string): ProviderServer & { image: string; type: string } {
    const s = this.servers.get(id)
    if (!s) throw new MachineProviderError('server not found', 404, 'not_found')
    return s
  }
}
