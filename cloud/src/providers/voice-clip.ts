// What the voice clone adapters share (production-5): the sample to clone is fetched from the Cloud's own signed link (the
// provider key is never sent there), checked against the provider's formats and size, and handed over as a Blob.
import type { ProviderContext } from './types.ts'
import { call, readBytes, throwIfAborted, type HttpOptions } from './http.ts'

export const CLIP_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg'
}

export interface Clip {
  name: string
  ext: string
  blob: Blob
}

/** Downloads the sample `artefactId` of the job's team; refuses a format or a size the provider does not take. */
export async function fetchClip(
  ctx: ProviderContext,
  artefactId: string,
  rules: { label: string; extensions: readonly string[]; maxBytes: number },
  secret: string,
  o: HttpOptions
): Promise<Clip> {
  const clip = ctx.artefact(artefactId)
  const ext = clip.name.slice(clip.name.lastIndexOf('.') + 1).toLowerCase()
  if (!rules.extensions.includes(ext)) throw new Error(`${rules.label}: the sample must be one of ${rules.extensions.join(', ')}`)
  const res = await call({ label: `${rules.label} (sample download)`, url: clip.url, secret, signal: ctx.signal, init: { method: 'GET' } }, o)
  const bytes = await readBytes(res, `${rules.label} (sample download)`, ctx.signal)
  if (bytes.byteLength === 0) throw new Error(`${rules.label}: the sample is empty`)
  if (bytes.byteLength > rules.maxBytes) throw new Error(`${rules.label}: the sample is over ${Math.round(rules.maxBytes / 1024 / 1024)} MB`)
  throwIfAborted(ctx.signal)
  return { name: clip.name, ext, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: CLIP_MIME[ext] ?? 'application/octet-stream' }) }
}
