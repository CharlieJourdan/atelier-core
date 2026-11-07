// « J'ai mon script » (agents-production): the text of a script file the owner drops, a `.txt` (UTF-8, or UTF-16 with its
// mark) or a Word `.docx`. A .docx is a zip: its `word/document.xml` is found through the zip's central directory, inflated
// with node:zlib, and its paragraphs (`<w:p>`) become lines (`<w:t>` texts, tabs and breaks kept). No library, no network.
import { inflateRawSync } from 'node:zlib'

/** Largest file read (a script of an hour is well under 1 MB of text). */
export const MAX_SCRIPT_FILE_BYTES = 8 * 1024 * 1024

export interface ScriptFileInput {
  name: string
  /** The file's bytes, base64. */
  base64: string
}

export function scriptFromFile(input: unknown): { text: string; words: number } {
  if (typeof input !== 'object' || input === null) throw new Error('Fichier invalide.')
  const { name, base64 } = input as Partial<ScriptFileInput>
  if (typeof name !== 'string' || typeof base64 !== 'string') throw new Error('Fichier invalide.')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) throw new Error('Ce fichier est vide.')
  if (bytes.length > MAX_SCRIPT_FILE_BYTES) throw new Error('Ce fichier est trop gros pour un script (8 Mo au plus).')
  const ext = name.toLowerCase().split('.').pop()
  let text: string
  if (ext === 'docx') text = docxText(bytes)
  else if (ext === 'txt' || ext === 'md') text = plainText(bytes)
  else throw new Error('Importe un fichier .txt ou .docx.')
  text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new Error('Ce fichier ne contient pas de texte.')
  return { text, words: text.split(/\s+/).filter(Boolean).length }
}

function plainText(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le')
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8')
  return b.toString('utf8')
}

/** The body text of a Word document. */
export function docxText(zip: Buffer): string {
  const xml = zipEntry(zip, 'word/document.xml')
  if (!xml) throw new Error('Ce fichier .docx est illisible (pas de document Word dedans).')
  const body = xml.toString('utf8')
  const paragraphs = body.split(/<\/w:p>/)
  const out: string[] = []
  for (const p of paragraphs) {
    let line = ''
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      if (m[0] === '<w:tab/>') line += '\t'
      else if (m[0] === '<w:br/>') line += '\n'
      else line += m[1] ?? ''
    }
    out.push(unescapeXml(line))
  }
  return out.join('\n')
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** One file of a zip (stored or deflated), found through the central directory; null when absent. */
export function zipEntry(zip: Buffer, wanted: string): Buffer | null {
  // the end of central directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Ce fichier .docx est illisible (ce n’est pas une archive Word).')
  const count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) break
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    at += 46 + nameLen + extraLen + commentLen
    if (name !== wanted) continue
    if (zip.readUInt32LE(local) !== 0x04034b50) return null
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + size)
    if (method === 0) return data
    if (method === 8) return inflateRawSync(data)
    throw new Error('Ce fichier .docx utilise une compression inconnue.')
  }
  return null
}
