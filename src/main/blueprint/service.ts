// The published blueprint in the app: fetched from Atelier Cloud when the app connects, then every 30 minutes and on demand
// (`cloud.blueprint`), cached in settings with its version, and read by the agent seed and the screens. Not connected, or
// nothing published yet (404): no blueprint, the built-in defaults apply unchanged. A Cloud that cannot be reached keeps
// the cached version (shown as « stale »). The cache belongs to one Cloud address: another Cloud never reads it.
import type { z } from 'zod'
import type { BlueprintResponse } from '../../shared/cloud-api'
import { NO_BLUEPRINT, type BlueprintStatus } from '../../shared/blueprint'
import type { JsonValue } from '../../shared/api'
import type { SettingsStore } from '../settings'
import { mapAgents, viewOf, type BlueprintDoc, type SeedDefaults } from './map'

export type PublishedBlueprint = z.infer<typeof BlueprintResponse>

export const CACHE_KEY = 'blueprint.cache'
export const REFRESH_EVERY_MS = 30 * 60_000

interface Cache {
  baseUrl: string
  version: number
  publishedAt: string
  fetchedAt: string
  blueprint: BlueprintDoc
}

export interface BlueprintServiceOptions {
  settings: SettingsStore
  /** The Cloud's current blueprint; null when none is published (404). Throws when the Cloud cannot be reached. */
  fetch: () => Promise<PublishedBlueprint | null>
  connected: () => boolean
  baseUrl: () => string
  /** Told when what the app knows of the blueprint changed. */
  notify: () => void
  now?: () => number
  intervalMs?: number
}

const isCache = (v: JsonValue | null): v is JsonValue & Cache => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const c = v as Record<string, JsonValue>
  const bp = c.blueprint as Record<string, JsonValue> | undefined
  return typeof c.baseUrl === 'string' && typeof c.version === 'number' && typeof c.publishedAt === 'string' && typeof c.fetchedAt === 'string' && !!bp && Array.isArray(bp.agents) && Array.isArray(bp.pipelines)
}

export class BlueprintService {
  private readonly o: BlueprintServiceOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: Promise<BlueprintStatus> | null = null
  private wasConnected: boolean
  /** The last refresh could not reach the Cloud (the cache is shown as stale). */
  private unreachable = false
  private closed = false

  constructor(o: BlueprintServiceOptions) {
    this.o = o
    this.wasConnected = o.connected()
  }

  /** The cached blueprint of the Cloud the app is connected to now; null otherwise (defaults apply). */
  cached(): Cache | null {
    if (!this.o.connected()) return null
    const raw = this.o.settings.get<JsonValue>(CACHE_KEY, null)
    return isCache(raw) && raw.baseUrl === this.o.baseUrl() ? raw : null
  }

  /** The version and what a new agent starts from, by runtime role; null without a blueprint. */
  forSeed(): { version: number; defaults: SeedDefaults } | null {
    const c = this.cached()
    return c ? { version: c.version, defaults: mapAgents(c.blueprint).defaults } : null
  }

  version(): number | null {
    return this.cached()?.version ?? null
  }

  status(): BlueprintStatus {
    const c = this.cached()
    if (!c) return { ...NO_BLUEPRINT, state: this.o.connected() ? 'none' : 'not-connected' }
    return viewOf(c.blueprint, c.version, { publishedAt: c.publishedAt, fetchedAt: c.fetchedAt, stale: this.unreachable })
  }

  /** Asks the Cloud now (calls overlap into one request); the answer is the new status. Never throws. */
  refresh(): Promise<BlueprintStatus> {
    if (!this.o.connected()) return Promise.resolve(this.status())
    this.inflight ??= this.fetchNow().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchNow(): Promise<BlueprintStatus> {
    const before = this.cached()?.version ?? null
    const wasUnreachable = this.unreachable
    try {
      const got = await this.o.fetch()
      if (this.closed || !this.o.connected()) return this.status()
      this.unreachable = false
      if (!got) this.o.settings.delete(CACHE_KEY)
      else {
        const cache: Cache = { baseUrl: this.o.baseUrl(), version: got.version, publishedAt: got.publishedAt, fetchedAt: new Date((this.o.now ?? Date.now)()).toISOString(), blueprint: got.blueprint }
        this.o.settings.set(CACHE_KEY, cache as unknown as JsonValue)
      }
    } catch {
      // unreachable, signed out, refused: the cached version stays, marked stale
      this.unreachable = this.cached() !== null
    }
    if (before !== (this.cached()?.version ?? null) || wasUnreachable !== this.unreachable) this.o.notify()
    return this.status()
  }

  /** Called when the connection may have changed: a newly connected app fetches at once. */
  onConnectionChanged(): void {
    const now = this.o.connected()
    const justConnected = now && !this.wasConnected
    this.wasConnected = now
    if (justConnected) void this.refresh()
    if (!now) this.unreachable = false
  }

  /** Starts the 30-minute refresh (and one now when the app is already connected). */
  start(): void {
    if (this.timer || this.closed) return
    this.timer = setInterval(() => void this.refresh(), this.o.intervalMs ?? REFRESH_EVERY_MS)
    this.timer.unref?.()
    if (this.o.connected()) void this.refresh()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
