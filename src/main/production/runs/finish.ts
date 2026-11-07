// What a finished run leaves: the final video's ref and duration, and the package copied out under its real names.
import path from 'node:path'
import type { ArtefactStore, StoredRun } from '../../../engine/store'
import { refOf } from './files'
import { exportPackage } from './package'
import type { NodeRow, RunRow } from './rows'
import type { ProductionRuns } from './service'

export interface FinishedOutputs {
  videoFile: string | null
  packageDir: string | null
  durationS: number | null
}

export async function finishOutputs(runs: ProductionRuns, row: RunRow, nodes: NodeRow[]): Promise<FinishedOutputs> {
  const out: FinishedOutputs = { videoFile: null, packageDir: null, durationS: null }
  const store = runs.storeFor(row.video_id)
  const root = runs.artefactsDir(row.video_id)
  for (const n of nodes) {
    if (!n.fingerprint) continue
    let stored: StoredRun | null
    try {
      stored = await store.getRun(n.fingerprint)
    } catch {
      continue
    }
    for (const a of Object.values(stored?.outputs ?? {})) {
      if (a.type === 'video.final' && a.files?.[0] && out.videoFile === null) {
        out.videoFile = refOf(root, a.files[0])
        const d = a.meta?.durationS
        out.durationS = typeof d === 'number' ? Math.round(d * 10) / 10 : null
      }
      if (a.type === 'package.youtube' && (a.files?.length ?? 0) > 0) {
        try {
          out.packageDir = await exportPackage(a, path.join(runs.productionDir, `video-${row.video_id}`, `paquet-${row.id}`))
        } catch {
          out.packageDir = null // the files stay in the store; "Ouvrir le dossier" is then not offered
        }
      }
    }
  }
  return out
}

/** The presenter registrations (engine → id: the HeyGen look) the run's talking-presenter nodes returned, one record per node. */
export async function presenterRegistrations(store: ArtefactStore, nodes: NodeRow[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (const n of nodes) {
    if (!n.fingerprint || !n.type.startsWith('avatar.speak')) continue
    const stored = await store.getRun(n.fingerprint).catch(() => null)
    for (const a of Object.values(stored?.outputs ?? {})) {
      const r = a.meta?.registrations
      if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r as Record<string, unknown>)
    }
  }
  return out
}
