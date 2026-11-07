// Stores files dropped on the composer inside Atelier's data folder; the renderer never sees real paths.
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type Attachment, type AttachmentUpload } from '../../shared/chat'

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/i
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export function safeFileName(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, '/')).replace(/[^\w.\- ()]/g, '_').trim()
  const cleaned = base.replace(/^\.+/, '').slice(0, 100)
  return cleaned || 'file'
}

export function saveUploads(dir: string, conversationId: number, uploads: AttachmentUpload[]): Attachment[] {
  if (uploads.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments per message`)
  const out: Attachment[] = []
  const target = path.join(dir, String(conversationId))
  const tooBig = (name: string): Error =>
    new Error(`${safeFileName(name)} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
  for (const up of uploads) {
    if (typeof up?.name !== 'string' || typeof up.dataBase64 !== 'string') throw new Error('Malformed attachment')
    // Cheap size bound before decoding: base64 is 4 chars per 3 bytes.
    if (up.dataBase64.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4) throw tooBig(up.name)
    if (!BASE64_RE.test(up.dataBase64)) throw new Error(`${safeFileName(up.name)}: invalid data`)
    const bytes = Buffer.from(up.dataBase64, 'base64')
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooBig(up.name)
    const name = safeFileName(up.name)
    const mime = typeof up.mime === 'string' && MIME_RE.test(up.mime) ? up.mime : 'application/octet-stream'
    mkdirSync(target, { recursive: true })
    const file = path.join(target, `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-${name}`)
    writeFileSync(file, bytes)
    out.push({ name, mime, size: bytes.length, path: file })
  }
  return out
}
