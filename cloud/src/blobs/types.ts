// Where the Cloud keeps team files: a folder on disk (the default) or an S3-compatible bucket (Cloudflare R2). Keys are
// plain `/`-separated names built by the Cloud itself (never from a request), e.g. `teams/<team>/artefacts/<sha256>`.
import type { Readable } from 'node:stream'

export interface PresignOptions {
  ttlS: number
  /** The name the browser saves the file under (Content-Disposition: attachment). */
  filename: string
  mime: string
}

export interface BlobStore {
  readonly kind: 'local' | 's3'
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>
  /** The same from a file on disk (a raw upload), read part by part: a big file is never held in memory whole. */
  putFile(key: string, path: string, size: number, mime: string): Promise<void>
  get(key: string): Promise<Buffer>
  /** The bytes as a stream, whole or from `start` to `end` (both included), so a big file is never held in memory. Only the local folder has it: a bucket serves presigned links. */
  readStream?(key: string, range?: { start: number; end: number }): Readable
  has(key: string): Promise<boolean>
  /** Removing a missing key is not an error. */
  delete(key: string): Promise<void>
  /** A short-lived link straight to the storage service, so the bytes never pass through the Cloud; null for a local folder. */
  presignGet(key: string, o: PresignOptions): string | null
}

export const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/

export function checkKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new Error(`unsafe storage key ${key}`)
}
