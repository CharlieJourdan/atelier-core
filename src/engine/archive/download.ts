// `downloadArchive`: streams a hit's picture to `<dir>/<source>-<safe id>.<ext>`. At most 25 MB, the answer must be an image
// (content type), one retry on a network error / 5xx / 429 (never on a refused type or an oversize file). The file is written
// as `.part` and renamed when complete, so a failed download leaves nothing that looks like a picture.
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { get, HttpStatusError, type HttpDeps } from './http.ts'
import { MAX_DOWNLOAD_BYTES, type ArchiveHit } from './types.ts'
import { extOfMime, safeId } from './util.ts'

export interface DownloadDeps {
  fetch?: typeof fetch
  signal?: AbortSignal
  /** For the whole transfer, default 60 s. */
  timeoutMs?: number
  /** Default 25 MB. */
  maxBytes?: number
}

export class ArchiveDownloadError extends Error {
  /** Permanent errors are not retried. */
  readonly permanent: boolean
  constructor(message: string, permanent = true) {
    super(message)
    this.name = 'ArchiveDownloadError'
    this.permanent = permanent
  }
}

async function once(hit: ArchiveHit, dir: string, d: HttpDeps, maxBytes: number): Promise<{ file: string; bytes: number }> {
  const res = await get(hit.fileUrl, d, { timeoutMs: d.timeoutMs, headers: { accept: 'image/*' } })
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!type.startsWith('image/')) {
    await res.body?.cancel().catch(() => undefined)
    throw new ArchiveDownloadError(`not an image (content-type « ${type || 'none'} »)`)
  }
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw new ArchiveDownloadError(`file too big (${declared} bytes, limit ${maxBytes})`)
  }
  if (!res.body) throw new ArchiveDownloadError('empty answer', false)
  const ext = extOfMime(type) !== 'img' ? extOfMime(type) : extOfMime(hit.mime)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${hit.source}-${safeId(hit.id).replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, '')}.${ext}`)
  const part = `${file}.part`
  const handle = await open(part, 'w')
  let bytes = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ArchiveDownloadError(`file too big (more than ${maxBytes} bytes)`)
      }
      await handle.write(value)
    }
    await handle.close()
    if (bytes === 0) throw new ArchiveDownloadError('empty file', false)
    await rename(part, file)
    return { file, bytes }
  } catch (e) {
    await handle.close().catch(() => undefined)
    await rm(part, { force: true })
    throw e
  }
}

export async function downloadArchive(hit: ArchiveHit, dir: string, deps: DownloadDeps = {}): Promise<{ file: string; bytes: number }> {
  const d: HttpDeps = { fetch: deps.fetch ?? globalThis.fetch, signal: deps.signal, timeoutMs: deps.timeoutMs ?? 60_000 }
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES
  try {
    return await once(hit, dir, d, maxBytes)
  } catch (first) {
    if (deps.signal?.aborted) throw first
    if (first instanceof ArchiveDownloadError && first.permanent) throw first
    if (first instanceof HttpStatusError && first.status < 500 && first.status !== 429) throw first
    return await once(hit, dir, d, maxBytes) // one retry
  }
}
