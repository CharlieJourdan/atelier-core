// Paths that differ between Windows (H1) and macOS (Charlie's Mac): the "local folder" rule for anything Atelier
// executes from or keeps work files in (the production worker's folders, later lots).
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { t } from '../../shared/fr'

export interface LocalFolderEnv {
  platform: NodeJS.Platform
  home: string
  tmp: string
  realpath: (p: string) => string
}

const defaultLocalEnv = (): LocalFolderEnv => ({
  platform: process.platform,
  home: os.homedir(),
  tmp: os.tmpdir(),
  realpath: (p) => realpathSync.native(p)
})

/** The shared, world-writable temp folders: never a trusted root, even when TMPDIR is unset and os.tmpdir() is /tmp. */
const SHARED_TMP = new Set(['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'])
const isSharedTmp = (p: string): boolean => SHARED_TMP.has(path.posix.normalize(p).replace(/[/]+$/, ''))

const within = (child: string, parent: string): boolean => {
  const rel = path.posix.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel))
}

/**
 * A folder Atelier executes from or writes work files to must be local and Charlie's own.
 * - Windows: a drive-letter path whose real path (junctions resolved) is one too; UNC paths are refused.
 * - macOS/Linux: an absolute path whose real path (symlinks resolved) is inside the home folder or the user's own
 *   temp folder (macOS: a per-user 0700 folder; e2e stubs live there). The shared /tmp is never a root, even when
 *   TMPDIR is unset and os.tmpdir() is /tmp. /Volumes (network shares, external disks), /net and /Network are
 *   refused because they are outside the roots.
 */
export function checkLocalFolder(dir: string, env: Partial<LocalFolderEnv> = {}): void {
  const e = { ...defaultLocalEnv(), ...env }
  const real = (): string => {
    try {
      return e.realpath(dir)
    } catch {
      throw new Error(t('folder.missing', { dir }))
    }
  }
  if (e.platform === 'win32') {
    const local = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p)
    if (!local(dir)) throw new Error(t('folder.network'))
    const r = real()
    if (!local(r)) throw new Error(t('folder.leadsToNetwork', { real: r }))
    return
  }
  if (!path.posix.isAbsolute(dir)) throw new Error(t('folder.absolute'))
  const r = real()
  const roots = [e.home, e.tmp]
    .flatMap((root) => {
      try {
        return [root, e.realpath(root)]
      } catch {
        return [root]
      }
    })
    .filter((root) => !isSharedTmp(root))
  if (!roots.some((root) => root && within(r, root))) {
    throw new Error(t('folder.notHome', { real: r }))
  }
}

/** The cheap string-only version of the rule, for a folder saved earlier (no file system access). */
export function looksLocal(dir: string, platform: NodeJS.Platform = process.platform, home: string = os.homedir(), tmp: string = os.tmpdir()): boolean {
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(dir)
  return path.posix.isAbsolute(dir) && [home, tmp, '/private' + tmp].some((root) => !isSharedTmp(root) && within(path.posix.normalize(dir), root))
}
