// A small cache for provider answers: in memory, and in one JSON file per entry when a directory is given. Keyed by a hash of
// what was asked. Pixabay's terms require results to be cached for 24 hours, and a repeated query costs nothing this way.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaCandidate } from './types.ts'

export const DEFAULT_TTL_MS = 24 * 3600 * 1000

export interface SearchCache {
  get(key: string): Promise<MediaCandidate[] | undefined>
  set(key: string, value: MediaCandidate[]): Promise<void>
}

export const cacheKey = (parts: unknown): string => createHash('sha1').update(JSON.stringify(parts)).digest('hex')

interface Entry {
  at: number
  value: MediaCandidate[]
}

export class MemoryCache implements SearchCache {
  private readonly map = new Map<string, Entry>()
  private readonly ttlMs: number
  private readonly now: () => number
  constructor(ttlMs = DEFAULT_TTL_MS, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }
  async get(key: string): Promise<MediaCandidate[] | undefined> {
    const e = this.map.get(key)
    if (!e) return undefined
    if (this.now() - e.at > this.ttlMs) {
      this.map.delete(key)
      return undefined
    }
    return structuredClone(e.value)
  }
  async set(key: string, value: MediaCandidate[]): Promise<void> {
    this.map.set(key, { at: this.now(), value: structuredClone(value) })
  }
}

/** Memory first, then `<dir>/<key>.json`. A damaged or old file is a miss, never an error. */
export class FileCache implements SearchCache {
  private readonly mem: MemoryCache
  private readonly dir: string
  private readonly ttlMs: number
  private readonly now: () => number
  constructor(dir: string, ttlMs = DEFAULT_TTL_MS, now: () => number = Date.now) {
    this.dir = dir
    this.ttlMs = ttlMs
    this.now = now
    this.mem = new MemoryCache(ttlMs, now)
  }
  async get(key: string): Promise<MediaCandidate[] | undefined> {
    const hot = await this.mem.get(key)
    if (hot) return hot
    try {
      const e = JSON.parse(await readFile(path.join(this.dir, `${key}.json`), 'utf8')) as Entry
      if (!Array.isArray(e.value) || this.now() - e.at > this.ttlMs) return undefined
      await this.mem.set(key, e.value)
      return e.value
    } catch {
      return undefined
    }
  }
  async set(key: string, value: MediaCandidate[]): Promise<void> {
    await this.mem.set(key, value)
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(path.join(this.dir, `${key}.json`), JSON.stringify({ at: this.now(), value }))
    } catch {
      // a cache that cannot be written is only a slower run
    }
  }
}
