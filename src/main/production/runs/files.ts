// Artefact files of a run, seen from the renderer. A file is named by a REF: its path relative to the video's artefact
// folder (`<data>/production/video-<id>/artefacts`), with forward slashes. `readRunFile` hands the bytes back ONLY when
// the real path (symlinks resolved) is inside that folder, within a size cap.
import { realpath, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { RunFile, RunFileRef } from '../../../shared/runs'

/** 300 MB: a 30-minute 1080p render fits; anything larger is refused. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.srt': 'text/plain; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

export const mimeOf = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

/** The store names files `<index>-<original name>`: the original name is shown. */
export const displayName = (file: string): string => path.basename(file).replace(/^\d+-/, '')

export function refOf(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

export async function fileRef(root: string, abs: string): Promise<RunFileRef> {
  const st = await stat(abs).catch(() => null)
  return { ref: refOf(root, abs), name: displayName(abs), size: st?.size ?? 0, mime: mimeOf(abs) }
}

const REFUSED = 'Accès refusé : ce fichier n’appartient pas à cette fabrication.'

export async function readRunFile(root: string, ref: unknown, maxBytes = MAX_FILE_BYTES): Promise<RunFile> {
  if (typeof ref !== 'string' || ref === '' || ref.length > 500 || ref.includes('\0')) throw new Error('Référence de fichier invalide.')
  if (path.isAbsolute(ref) || path.win32.isAbsolute(ref) || path.posix.isAbsolute(ref)) throw new Error(REFUSED)
  if (ref.split(/[\\/]/).some((part) => part === '..')) throw new Error(REFUSED)
  let realRoot: string
  let real: string
  try {
    realRoot = await realpath(root)
    real = await realpath(path.resolve(root, ref))
  } catch {
    throw new Error('Fichier introuvable : il a peut-être été supprimé.')
  }
  if (!real.startsWith(realRoot + path.sep)) throw new Error(REFUSED)
  const st = await stat(real)
  if (!st.isFile()) throw new Error('Ce n’est pas un fichier.')
  if (st.size > maxBytes) throw new Error(`Fichier trop lourd pour être ouvert ici (plus de ${Math.round(maxBytes / 1024 / 1024)} Mo) : ouvre le dossier.`)
  const buf = await readFile(real)
  return { name: displayName(real), mime: mimeOf(real), size: st.size, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
}
