// `--clean-data` (rendu-menage): the options of the clean of a brain's data folder. Files used in the last hour are spared
// unless the folder is a STOPPED brain's (its `brain-run.pid` names a dead process): there everything re-creatable may go, so a
// chantier that cleans right after its proof frees the segments it just made (before: 0 of 7.4 GB freed, deleted by hand). A
// folder with no pid file (the desktop app's, a keeper started without one) keeps the hour: something may be rendering there.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { HousekeepOptions } from '../../engine/render/housekeeping'

/** The pid file `scripts/brain-run.mjs` writes (a plain number) and the keeper writes (JSON `{ brain }`). */
export const BRAIN_PID_FILE = 'brain-run.pid'
const HOUR = 3_600_000

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Is a brain process running on this data folder (its pid file names a live process)? */
export function brainRunningOn(dataDir: string, isAlive: (pid: number) => boolean = alive): boolean {
  let raw: string
  try {
    raw = readFileSync(path.join(dataDir, BRAIN_PID_FILE), 'utf8').trim()
  } catch {
    return false
  }
  let pid = Number(raw)
  if (!Number.isInteger(pid)) {
    try {
      pid = Number((JSON.parse(raw) as { brain?: unknown }).brain)
    } catch {
      return false
    }
  }
  return Number.isInteger(pid) && pid > 0 && isAlive(pid)
}

/** A stopped brain's folder: its pid file is there and names no live process. */
export function brainStoppedOn(dataDir: string, isAlive: (pid: number) => boolean = alive): boolean {
  let raw: string
  try {
    raw = readFileSync(path.join(dataDir, BRAIN_PID_FILE), 'utf8').trim()
  } catch {
    return false
  }
  return raw.length > 0 && !brainRunningOn(dataDir, isAlive)
}

export function cleanDataOptions(
  a: { dataDir: string; apply: boolean; budgetGb: number | null },
  isAlive: (pid: number) => boolean = alive
): HousekeepOptions & { brainRunning: boolean } {
  const brainRunning = brainRunningOn(a.dataDir, isAlive)
  return {
    dryRun: !a.apply,
    ...(a.budgetGb !== null ? { budgetBytes: Math.round(a.budgetGb * 1024 ** 3) } : {}),
    sparedMs: brainStoppedOn(a.dataDir, isAlive) ? 0 : HOUR,
    brainRunning
  }
}
