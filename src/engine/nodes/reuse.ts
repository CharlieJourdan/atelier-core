// What a retest will reuse is quoted at 0 (issue #115). A paid node that keeps its results item by item in the workspace cache
// (the presenter's takes) writes, once it has run, how many units of paid work its cache now holds for a given input (here:
// this exact voice); the quote reads that ledger and bills only what goes beyond it. The key is made of fingerprints, so a
// changed voice, presenter or engine reuses nothing: the quote then stays whole. Never a failure: an unreadable ledger is « nothing reused ».
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Units already paid for and still in the cache, by unit (`avatar_s`…). */
export type Reusable = Record<string, number>

/** The ledger lives in the workspace cache `reuse` (`<production dir>/cache/reuse`). */
const fileOf = (dir: string, kind: string, key: string): string => path.join(dir, `${kind.replace(/[^a-z0-9.-]/gi, '_')}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`)

export async function writeReusable(dir: string, kind: string, key: string, units: Reusable): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(fileOf(dir, kind, key), JSON.stringify(units))
  } catch {
    // a ledger that cannot be written only means the next quote is whole
  }
}

export async function readReusable(dir: string, kind: string, key: string): Promise<Reusable | null> {
  try {
    const raw = JSON.parse(await readFile(fileOf(dir, kind, key), 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) return null
    const out: Reusable = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > 0) out[k] = v
    return out
  } catch {
    return null
  }
}
