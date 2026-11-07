// Small helpers shared by the archive sources: loose JSON reading, HTML stripping, credit line, ids.
import type { ArchiveSource } from './types.ts'

export type Json = Record<string, unknown>
export const rec = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", nbsp: ' ' }
/** HTML to plain text (Commons « Artist » and Internet Archive descriptions are HTML). */
export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Commons « Artist » repeats itself when it is built from several spans (« Unknown author Unknown author »); unknown authors are dropped. */
export function cleanCreator(raw: string): string | undefined {
  let c = raw.replace(/\s+/g, ' ').trim()
  const half = c.length % 2 === 1 ? c.slice(0, (c.length - 1) / 2) : ''
  if (half && c === half + ' ' + half) c = half
  if (!c || /^(unknown( author| artist)?|anonymous|anonyme|unbekannt|\?+|none|n\/a)$/i.test(c)) return undefined
  return c
}

export const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s)

export const SOURCE_LABEL: Record<ArchiveSource, string> = {
  wikimedia: 'Wikimedia Commons',
  'internet-archive': 'Internet Archive',
  nasa: 'NASA',
  met: 'The Metropolitan Museum of Art'
}

/** « <title> — <creator>, <licence>, via <source> » (no creator: « <title>, <licence>, via <source> »). */
export function attributionLine(source: ArchiveSource, title: string, creator: string | undefined, licence: string): string {
  const head = creator ? `${title} — ${creator}` : title
  return `${head}, ${licence}, via ${SOURCE_LABEL[source]}`
}

/** A file-system safe slug of an id (letters, digits, dot, dash, underscore). */
export const safeId = (id: string): string => id.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'item'

export function extOfMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim()
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  if (m === 'image/png') return 'png'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/tiff') return 'tif'
  return 'img'
}
