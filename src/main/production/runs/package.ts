// The upload package of a finished run, copied out of the artefact store under its real file names
// (`video.mp4`, `description.txt`, `captions.srt`, `metadata.json`, `checklist.md`) into
// `<data>/production/video-<id>/paquet-<run>/`, the folder "Ouvrir le dossier" shows. The video is hard-linked when the
// disk allows it (no second copy of a large file), else copied.
import { copyFile, link, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Artefact } from '../../../engine/artefacts'
import { displayName } from './files'

export async function exportPackage(pkg: Artefact, dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const names = Array.isArray((pkg.value as { files?: unknown } | undefined)?.files) ? ((pkg.value as { files: unknown[] }).files as unknown[]) : []
  for (const [i, src] of (pkg.files ?? []).entries()) {
    const given = names[i]
    const name = typeof given === 'string' && /^[\w.-]{1,100}$/.test(given) ? given : displayName(src)
    const dest = path.join(dir, name)
    try {
      await link(src, dest)
    } catch {
      await copyFile(src, dest)
    }
  }
  return dir
}
