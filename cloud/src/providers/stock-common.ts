// What the two stock adapters (Pexels, Wikimedia Commons) share: the download of the chosen files with a size cap, and the
// shape they hand back to the jobs module. A file is fetched from the https link the provider gave; the provider key is
// never sent to it (it is a CDN, not the API).
import type { StockResult } from '../../../src/shared/cloud-api.ts'
import type { NewFile } from '../storage.ts'
import { call, readBytes, type HttpOptions } from './http.ts'
import { RetryableProviderError } from './types.ts'

/** One file is at most this big (a photo is a few MB; a longer video than this is skipped, never cut). */
export const STOCK_MAX_FILE_BYTES = 40 * 1024 * 1024

/** A presenter or clip video the provider already made (and bills) is at most this big: a 162 s presenter call at 1080p is about
 *  97 MB. Stock files keep STOCK_MAX_FILE_BYTES. */
export const VIDEO_MAX_FILE_BYTES = 400 * 1024 * 1024

export const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv'
}

/** A result found by a provider, not downloaded yet. */
export interface Candidate {
  result: Omit<StockResult, 'file'>
  /** The https link of the file. */
  url: string
  /** The content types the file may have; anything else is skipped. */
  mimes: readonly string[]
}

export interface Downloaded {
  bytes: Uint8Array
  mime: string
}

/** Fetches `url` (https only). Returns null when the file is bigger than the cap or is not one of the announced types. */
export async function downloadFile(
  label: string,
  url: string,
  allowed: readonly string[],
  signal: AbortSignal,
  o: HttpOptions,
  headers: Record<string, string> = {},
  maxBytes: number = STOCK_MAX_FILE_BYTES
): Promise<Downloaded | null> {
  if (!/^https:\/\//i.test(url)) return null
  const res = await call({ label, url, secret: '', signal, init: { method: 'GET', headers } }, { ...o, timeoutMs: o.timeoutMs ?? 120_000 })
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > maxBytes) return null
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!allowed.includes(mime)) return null
  const bytes = await readBytes(res, label, signal)
  if (bytes.length > maxBytes || bytes.length === 0) return null
  return { bytes, mime }
}

/** The download of a video a provider FINISHED (and bills): up to VIDEO_MAX_FILE_BYTES. */
export function downloadVideo(label: string, url: string, allowed: readonly string[], signal: AbortSignal, o: HttpOptions, headers: Record<string, string> = {}): Promise<Downloaded | null> {
  return downloadFile(label, url, allowed, signal, o, headers, VIDEO_MAX_FILE_BYTES)
}

/**
 * What a provider adapter throws when the video it FINISHED could not be downloaded. Retryable, and the adapter must keep its
 * provider handle: the job's retry downloads the same video again instead of paying for a second generation.
 */
export function undownloadable(label: string): RetryableProviderError {
  return new RetryableProviderError(`${label}: the finished clip could not be downloaded, will retry the download`)
}

/**
 * Downloads the files of already-ranked candidates until `count` are kept. A file that cannot be had (too big, wrong type,
 * a 404) is skipped; only when NOTHING could be downloaded and a failure was retryable is that failure thrown, so the job
 * retries instead of reporting "no result".
 */
export async function collect(
  candidates: readonly Candidate[],
  count: number,
  label: string,
  signal: AbortSignal,
  o: HttpOptions,
  onProgress: (fraction: number) => void,
  headers: Record<string, string> = {}
): Promise<{ files: NewFile[]; results: StockResult[] }> {
  const files: NewFile[] = []
  const results: StockResult[] = []
  let retryable: RetryableProviderError | null = null
  for (const c of candidates) {
    if (results.length >= count) break
    if (signal.aborted) throw signal.reason ?? new Error('aborted')
    try {
      const got = await downloadFile(label, c.url, c.mimes, signal, o, headers)
      if (!got) continue
      const name = `stock-${results.length + 1}.${MIME_EXT[got.mime] ?? 'bin'}`
      files.push({ name, mime: got.mime, bytes: Buffer.from(got.bytes) })
      results.push({ ...c.result, file: name })
      onProgress(results.length / count)
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err
      if (err instanceof RetryableProviderError) retryable = err
      // any other failure: this candidate is skipped
    }
  }
  if (results.length === 0 && retryable) throw retryable
  return { files, results }
}
