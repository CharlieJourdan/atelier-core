// The artefact store (docs/ENGINE-SPEC.md R7.3, R7.7): the outputs of each node run, keyed by the run's fingerprint.
// If a fingerprint is stored, the node does not run again. Two implementations: in memory (tests, demo) and on disk
// (`<data>/production/artefacts/<fingerprint>/`), whose writes are atomic so a crash never leaves half a run cached.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Artefact } from './artefacts'
import { isFingerprint } from './canonical'
import type { ArtefactReader } from './registry'

/** Everything one node run produced. */
export interface StoredRun {
  fingerprint: string
  outputs: Record<string, Artefact>
}

export interface ArtefactStore extends ArtefactReader {
  getRun(fingerprint: string): Promise<StoredRun | null>
  /** Stores a run atomically and returns it as stored (file paths inside the store). An existing run wins. */
  putRun(run: StoredRun): Promise<StoredRun>
}

const clone = <T>(v: T): T => structuredClone(v)

/**
 * A run its node marked provisional (an output with `meta.provisional`: pictures that could not be made, filled for now;
 * production-17): never reused by a later run, and replaced by the next run of the same fingerprint.
 */
export const isProvisional = (run: StoredRun): boolean => Object.values(run.outputs).some((a) => a.meta?.provisional === true)

export class MemoryArtefactStore implements ArtefactStore {
  private readonly runs = new Map<string, StoredRun>()
  private readonly artefacts = new Map<string, Artefact>()

  getRun(fingerprint: string): Promise<StoredRun | null> {
    const run = this.runs.get(fingerprint)
    return Promise.resolve(run ? clone(run) : null)
  }

  putRun(run: StoredRun): Promise<StoredRun> {
    const existing = this.runs.get(run.fingerprint)
    if (existing && !isProvisional(existing)) return Promise.resolve(clone(existing))
    const copy = clone(run)
    this.runs.set(copy.fingerprint, copy)
    for (const a of Object.values(copy.outputs)) this.artefacts.set(a.fingerprint, a)
    return Promise.resolve(clone(copy))
  }

  read(fingerprint: string): Promise<Artefact | null> {
    const a = this.artefacts.get(fingerprint)
    return Promise.resolve(a ? clone(a) : null)
  }

  /** Fingerprints of the stored runs (tests and diagnostics). */
  fingerprints(): string[] {
    return [...this.runs.keys()]
  }
}

const RECORD = 'run.json'

/**
 * Reads a stored record; null when it is damaged or does not belong to its folder. File paths are relative and must
 * stay inside the run's folder (a record never points elsewhere on the disk).
 */
function parseRecord(text: string, fingerprint: string, dir: string): StoredRun | null {
  let run: StoredRun
  try {
    run = JSON.parse(text) as StoredRun
  } catch {
    return null
  }
  if (!run || run.fingerprint !== fingerprint || typeof run.outputs !== 'object' || run.outputs === null) return null
  for (const a of Object.values(run.outputs)) {
    if (!a || typeof a.fingerprint !== 'string') return null
    if (a.files === undefined) continue
    if (!Array.isArray(a.files)) return null
    const abs: string[] = []
    for (const f of a.files) {
      const full = typeof f === 'string' ? path.resolve(dir, f) : ''
      if (!full.startsWith(path.resolve(dir) + path.sep)) return null
      abs.push(full)
    }
    a.files = abs
  }
  return run
}

/** Every file a stored run lists is still on the disk. */
async function filesPresent(run: StoredRun): Promise<boolean> {
  for (const a of Object.values(run.outputs)) {
    for (const f of a.files ?? []) {
      try {
        await stat(f)
      } catch {
        return false
      }
    }
  }
  return true
}

/** Test hook: called after the run is fully written to its temporary folder, before it is committed by a rename. */
export interface FsStoreHooks {
  beforeCommit?: (tmpDir: string) => void | Promise<void>
}

export class FsArtefactStore implements ArtefactStore {
  /** Artefact fingerprint -> run fingerprint, learnt from the runs read or written by this instance. */
  private readonly index = new Map<string, string>()
  private swept: Promise<void> | undefined

  readonly root: string
  private readonly hooks: FsStoreHooks

  constructor(root: string, hooks: FsStoreHooks = {}) {
    this.root = root
    this.hooks = hooks
  }

  private dirOf(fingerprint: string): string {
    // the fingerprint becomes a folder name: only the engine's own hex form is accepted (no path tricks)
    if (!isFingerprint(fingerprint)) throw new Error(`not a fingerprint: ${fingerprint}`)
    return path.join(this.root, fingerprint)
  }

  async getRun(fingerprint: string): Promise<StoredRun | null> {
    const dir = this.dirOf(fingerprint)
    let text: string
    try {
      text = await readFile(path.join(dir, RECORD), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    const run = parseRecord(text, fingerprint, dir)
    // a damaged record (disk trouble), or one whose files were deleted since (solidite: reused, it failed every later
    // node and every « Relancer » the same way): treat it as never stored, so the node simply runs again
    if (!run || !(await filesPresent(run))) {
      await rm(dir, { recursive: true, force: true })
      return null
    }
    for (const a of Object.values(run.outputs)) this.index.set(a.fingerprint, fingerprint)
    return run
  }

  /**
   * Removes temporary folders left by a crash in the middle of a write (once, before this instance's first write).
   * Only folders older than an hour: another process (the local worker) may be writing to the same store right now.
   */
  private async sweep(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch {
      return
    }
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const n of names.filter((x) => x.startsWith('.tmp-'))) {
      const dir = path.join(this.root, n)
      const st = await stat(dir).catch(() => null)
      if (st && st.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true })
    }
  }

  async putRun(run: StoredRun): Promise<StoredRun> {
    const existing = await this.getRun(run.fingerprint)
    if (existing && !isProvisional(existing)) return existing
    const final = this.dirOf(run.fingerprint)
    // a provisional run gives way to the new one (moved aside, then removed)
    if (existing) {
      const old = path.join(this.root, `.tmp-old-${run.fingerprint.slice(0, 16)}-${randomUUID()}`)
      await rename(final, old)
      await rm(old, { recursive: true, force: true })
    }
    this.swept ??= this.sweep()
    await this.swept
    await mkdir(this.root, { recursive: true })
    const tmp = path.join(this.root, `.tmp-${run.fingerprint.slice(0, 16)}-${randomUUID()}`)
    try {
      await mkdir(tmp)
      const record: StoredRun = { fingerprint: run.fingerprint, outputs: {} }
      for (const [name, a] of Object.entries(run.outputs)) {
        const stored: Artefact = { ...clone(a), files: undefined }
        if (a.files) {
          const rel: string[] = []
          await mkdir(path.join(tmp, 'files', name), { recursive: true })
          for (const [i, src] of a.files.entries()) {
            const r = path.posix.join('files', name, `${i}-${path.basename(src)}`)
            await copyFile(src, path.join(tmp, r))
            rel.push(r)
          }
          stored.files = rel
        } else delete stored.files
        record.outputs[name] = stored
      }
      // the record is flushed to disk before the rename commits it (a power cut never commits a half record)
      const fh = await open(path.join(tmp, RECORD), 'w')
      try {
        await fh.writeFile(JSON.stringify(record))
        await fh.sync()
      } finally {
        await fh.close()
      }
      await this.hooks.beforeCommit?.(tmp)
      try {
        await rename(tmp, final)
      } catch (e) {
        // another writer committed the same fingerprint first: theirs is equivalent, keep it
        const again = await this.getRun(run.fingerprint)
        if (again) return again
        throw e
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
    return (await this.getRun(run.fingerprint)) as StoredRun
  }

  async read(fingerprint: string): Promise<Artefact | null> {
    const runFp = this.index.get(fingerprint)
    if (!runFp) return null
    const run = await this.getRun(runFp)
    return Object.values(run?.outputs ?? {}).find((a) => a.fingerprint === fingerprint) ?? null
  }
}
