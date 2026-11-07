// Disk housekeeping of a data folder (rendu-menage). A render writes large intermediate files (lossless segments, ~50-350 Mbit/s,
// motion frames); nothing used to remove them, so a finished chantier held ~100 GB and a customer's small VPS disk would fill in a day.
//
// The rule, in one place:
//   KEPT, never touched : final outputs and the artefact store (`video-N/`), everything that cost money to make (`cache/visuals`,
//                         `cache/director`, `cache/voice-chunks`, `cache/asr`, voices, `cloud-keys/`), the shot log. A retest reuses them.
//   RE-CREATABLE        : `cache/segments`, `cache/motion`, `cache/thumbnails`, `cache/maps3d` (CPU only, no provider call), and the
//                         `scratch/<pid>-<time>` folders left by a process that died. They go oldest first once the budget is passed.
//   SPARED              : anything used in the last hour (a run may be reading it), `.tmp-*` files, the scratch of a live process.
import type { Dirent } from 'node:fs'
import { readdir, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'

/** Cache kinds made by CPU alone: safe to drop, a later run makes them again. */
export const EVICTABLE_CACHES: readonly string[] = ['segments', 'motion', 'thumbnails', 'maps3d']
const GIB = 1024 ** 3
const HOUR = 3_600_000

export interface HousekeepOptions {
  /** false: delete. true: only report what would go. */
  dryRun: boolean
  /** Bytes the re-creatable caches may keep. Default: `defaultBudgetBytes` from the disk's free room. */
  budgetBytes?: number
  now?: number
  /** Is this process id running? Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean
  /** Younger than this is spared (default 1 h). */
  sparedMs?: number
}

export interface HousekeepItem {
  path: string
  bytes: number
  /** Hours since last use, rounded. */
  idleH: number
}

export interface HousekeepReport {
  dataDir: string
  applied: boolean
  budgetBytes: number
  /** What the re-creatable caches hold before the clean. */
  evictableBytes: number
  /** What the kept caches and outputs hold (never touched). */
  keptBytes: number
  scratch: (HousekeepItem & { remove: boolean; why: string })[]
  evicted: HousekeepItem[]
  freedBytes: number
}

/** A quarter of the room the re-creatable files could take (free space plus what they hold now), between 2 and 20 GiB. */
export function defaultBudgetBytes(freeBytes: number, evictableBytes: number): number {
  return Math.round(Math.min(20 * GIB, Math.max(2 * GIB, (freeBytes + evictableBytes) / 4)))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface Entry {
  path: string
  bytes: number
  mtime: number
}

async function walk(dir: string, out: Entry[]): Promise<void> {
  let names: Dirent[]
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of names) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) await walk(p, out)
    else if (d.isFile()) {
      const s = await stat(p).catch(() => null)
      if (s) out.push({ path: p, bytes: s.size, mtime: s.mtimeMs })
    }
  }
}

const sum = (e: Entry[]): number => e.reduce((n, x) => n + x.bytes, 0)

async function existingDir(p: string): Promise<string> {
  let d = p
  while (d !== path.dirname(d)) {
    if (await stat(d).then((s) => s.isDirectory()).catch(() => false)) return d
    d = path.dirname(d)
  }
  return d
}

/** Reports (and, unless `dryRun`, applies) the clean of one production data folder (`<brain data>/production`). */
export async function housekeep(dataDir: string, o: HousekeepOptions): Promise<HousekeepReport> {
  const now = o.now ?? Date.now()
  const spared = o.sparedMs ?? HOUR
  const isAlive = o.isAlive ?? alive
  const idleH = (mtime: number): number => Math.max(0, Math.round((now - mtime) / HOUR))

  // 1. scratch folders of processes that are gone
  const scratch: HousekeepReport['scratch'] = []
  const scratchRoot = path.join(dataDir, 'scratch')
  for (const d of await readdir(scratchRoot, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (!d.isDirectory()) continue
    const p = path.join(scratchRoot, d.name)
    const files: Entry[] = []
    await walk(p, files)
    const newest = Math.max(0, ...files.map((f) => f.mtime))
    const pid = Number(/^(\d+)-/.exec(d.name)?.[1])
    let why = ''
    if (pid === process.pid) why = 'this process'
    else if (Number.isInteger(pid) && isAlive(pid)) why = 'process still running'
    else if (spared > 0 && now - newest < spared) why = 'used in the last hour'
    scratch.push({ path: p, bytes: sum(files), idleH: idleH(newest), remove: why === '', why: why || 'process gone' })
  }

  // 2. re-creatable caches, oldest first, down to the budget
  const evictable: Entry[] = []
  for (const kind of EVICTABLE_CACHES) await walk(path.join(dataDir, 'cache', kind), evictable)
  const evictableBytes = sum(evictable)
  let budgetBytes = o.budgetBytes
  if (budgetBytes === undefined) {
    const fs = await statfs(await existingDir(dataDir)).catch(() => null)
    budgetBytes = defaultBudgetBytes(fs ? fs.bavail * fs.bsize : 0, evictableBytes)
  }
  let held = evictableBytes
  const evicted: HousekeepItem[] = []
  for (const f of [...evictable].sort((a, b) => a.mtime - b.mtime)) {
    if (held <= budgetBytes) break
    if (path.basename(f.path).startsWith('.tmp-') || (spared > 0 && now - f.mtime < spared)) continue
    evicted.push({ path: f.path, bytes: f.bytes, idleH: idleH(f.mtime) })
    held -= f.bytes
  }

  const all: Entry[] = []
  await walk(dataDir, all)
  const scratchBytes = scratch.reduce((n, s) => n + s.bytes, 0)
  const freedBytes = scratch.filter((s) => s.remove).reduce((n, s) => n + s.bytes, 0) + evicted.reduce((n, e) => n + e.bytes, 0)
  const keptBytes = sum(all) - evictableBytes - scratchBytes

  if (!o.dryRun) {
    for (const s of scratch) if (s.remove) await rm(s.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
    for (const e of evicted) await rm(e.path, { force: true }).catch(() => undefined)
  }
  return { dataDir, applied: !o.dryRun, budgetBytes, evictableBytes, keptBytes, scratch, evicted, freedBytes }
}

const gb = (n: number): string => (n / GIB).toFixed(2)

/** A report in plain lines (the brain command prints them). */
export function formatReport(r: HousekeepReport): string[] {
  const dead = r.scratch.filter((s) => s.remove)
  return [
    r.dataDir,
    `  à garder (sorties, médias payés, journal) : ${gb(r.keptBytes)} Go — jamais touché`,
    `  refaisable (segments, animations, vignettes) : ${gb(r.evictableBytes)} Go, plafond ${gb(r.budgetBytes)} Go`,
    `  dossiers de travail d’un processus mort : ${dead.length} (${gb(dead.reduce((n, s) => n + s.bytes, 0))} Go)`,
    `  ${r.applied ? 'LIBÉRÉ' : 'à libérer (essai à blanc, rien n’est supprimé)'} : ${gb(r.freedBytes)} Go — ${r.evicted.length} fichier(s) refaisable(s), les plus anciens d’abord`
  ]
}
