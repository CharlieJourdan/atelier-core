// The default store: files under the data folder, written to a `.part` file of its own (two writes of the same key at
// once never share one) then renamed (a crash never leaves half a file). On Windows a rename over a file that is open at
// that moment (another request reading it, an antivirus scan) fails with EPERM / EACCES / EBUSY for a short while: the
// rename is retried, and a write that still fails removes its .part.
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkKey, type BlobStore } from './types.ts'

export type RenameFn = (from: string, to: string) => Promise<void>

export interface LocalBlobOptions {
  platform?: NodeJS.Platform
  rename?: RenameFn
  /** Retries of a refused rename on Windows (default 8), the first after `retryDelayMs` (default 25), doubling each time. */
  retries?: number
  retryDelayMs?: number
}

const WINDOWS_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

export class LocalBlobStore implements BlobStore {
  readonly kind = 'local' as const
  private readonly root: string
  private readonly o: Required<LocalBlobOptions>
  constructor(root: string, o: LocalBlobOptions = {}) {
    this.root = root
    this.o = { platform: o.platform ?? process.platform, rename: o.rename ?? rename, retries: o.retries ?? 8, retryDelayMs: o.retryDelayMs ?? 25 }
  }

  private path(key: string): string {
    checkKey(key)
    return join(this.root, ...key.split('/'))
  }

  private async settle(part: string, path: string): Promise<void> {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.o.rename(part, path)
          return
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code ?? ''
          if (this.o.platform !== 'win32' || !WINDOWS_BUSY.has(code) || attempt >= this.o.retries) throw e
          await new Promise((r) => setTimeout(r, this.o.retryDelayMs * 2 ** attempt))
        }
      }
    } catch (e) {
      await rm(part, { force: true })
      throw e
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    const part = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.part`
    await writeFile(part, bytes)
    await this.settle(part, path)
  }

  async putFile(key: string, from: string): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    const part = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.part`
    // the upload's file is the caller's to remove: copied, not moved (another disk, or still open)
    await copyFile(from, part)
    await this.settle(part, path)
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }

  readStream(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.path(key), range)
  }

  async has(key: string): Promise<boolean> {
    return stat(this.path(key)).then(
      (s) => s.isFile(),
      () => false
    )
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  presignGet(): null {
    return null
  }
}
