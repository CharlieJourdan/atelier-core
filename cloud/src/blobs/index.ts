// Picks the Cloud's file store from its configuration. "local" (the default) keeps team files under the data folder;
// "s3" uses an S3-compatible bucket (Cloudflare R2) with its keys from the vault (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).
// When "s3" is asked and a key is missing the Cloud refuses to start: it never falls back to the local folder, which would
// quietly fill the server's disk and lose the files with the machine (same rule as payments).
import type { Vault } from '../vault.ts'
import { LocalBlobStore } from './local.ts'
import { S3BlobStore } from './s3.ts'
import type { BlobStore } from './types.ts'

export interface StorageSettings {
  kind: 'local' | 's3'
  endpoint?: string | undefined
  bucket?: string | undefined
  region?: string | undefined
  /** Multipart part size in bytes (default 16 MiB; tests lower it to 5 MiB). */
  partSizeBytes?: number | undefined
}

export const R2_KEY_ID = 'R2_ACCESS_KEY_ID'
export const R2_SECRET = 'R2_SECRET_ACCESS_KEY'

export interface OpenBlobsInput {
  settings: StorageSettings | undefined
  filesDir: string
  vault: Vault
  fetchImpl?: typeof fetch | undefined
  now?: (() => Date) | undefined
}

export function openBlobStore(i: OpenBlobsInput): BlobStore {
  const s = i.settings
  if (!s || s.kind === 'local') return new LocalBlobStore(i.filesDir)
  if (!s.endpoint || !s.bucket) throw new Error('storage is "s3" but storage.endpoint or storage.bucket is missing from config.json')
  if (!i.vault.has(R2_KEY_ID) || !i.vault.has(R2_SECRET)) {
    throw new Error(`storage is "s3" but ${R2_KEY_ID} or ${R2_SECRET} is missing from the vault`)
  }
  const vault = i.vault
  let cached: { accessKeyId: string; secretAccessKey: string } | null = null
  return new S3BlobStore({
    endpoint: s.endpoint,
    bucket: s.bucket,
    region: s.region ?? 'auto',
    // read once, on the first request: one audit line, not one per file
    credentials: () => (cached ??= { accessKeyId: vault.readForAdapter(R2_KEY_ID, 'storage'), secretAccessKey: vault.readForAdapter(R2_SECRET, 'storage') }),
    ...(i.fetchImpl ? { fetchImpl: i.fetchImpl } : {}),
    ...(i.now ? { now: i.now } : {}),
    ...(s.partSizeBytes ? { partSizeBytes: s.partSizeBytes } : {})
  })
}
