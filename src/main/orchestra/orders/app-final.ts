// The final pass of an order on the app's real things (equipe-3-chaines): the render's review report read from the run's
// stored video (the blocking checks and the edit review already ran in the render, decisions 0086 / 0102), the film in the
// run's package, the channel's reference video (a setting, `orders.setReference`), the order's own script as what is said,
// and the cloning engine's blind judge through the app's model call.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Defect, ReviewReport } from '../../../engine/review'
import type { RunFn } from '../../../engine/sourcing/types'
import type { Db } from '../../db'
import type { AskFn } from '../../production/clone/compare/judge'
import { readNodes, readRun } from '../../production/runs/rows'
import type { ProductionRuns } from '../../production/runs/service'
import type { SettingsStore } from '../../settings'
import { finalPass, type FinalPassDeps } from './final-pass'
import type { FinalPass } from '.'

export interface AppFinalDeps {
  db: Db
  dataDir: string
  run: RunFn
  runs: () => ProductionRuns
  settings: SettingsStore
  isBlocking(d: Pick<Defect, 'kind' | 'severity'>): boolean
  ask: AskFn | null
}

export const referenceKey = (channelId: number): string => `orders.reference.${channelId}`

/** The finished film of a package folder: its largest .mp4 (pure on the listing). */
export function filmIn(dir: string): string | null {
  if (!existsSync(dir)) return null
  const mp4 = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.mp4$/iu.test(e.name)).map((e) => path.join(dir, e.name))
  return mp4.sort((a, b) => (/(?:^|[\\/])video\.mp4$/iu.test(b) ? 1 : 0) - (/(?:^|[\\/])video\.mp4$/iu.test(a) ? 1 : 0))[0] ?? null
}

export function appFinalPass(d: AppFinalDeps): FinalPass {
  const deps: FinalPassDeps = {
    run: d.run,
    workDir: (orderId) => path.join(d.dataDir, 'orders', String(orderId)),
    async review(runId) {
      try {
        const row = readRun(d.db, runId)
        const render = readNodes(d.db, runId).find((x) => x.type.startsWith('render.assemble@'))
        if (!render?.fingerprint) return null
        const stored = await d.runs().storeFor(row.video_id).getRun(render.fingerprint)
        const r = (stored?.outputs.video as { meta?: { review?: ReviewReport } } | undefined)?.meta?.review
        return r ? { left: r.left } : null
      } catch {
        return null
      }
    },
    isBlocking: d.isBlocking,
    film(runId) {
      const p = d.runs().packageOf(runId)
      const file = p ? filmIn(p.packageDir) : null
      return file ? { file, durationS: p?.durationS ?? null } : null
    },
    reference(channelId) {
      const v = d.settings.get(referenceKey(channelId))
      return typeof v === 'string' && v ? v : null
    },
    words(runId) {
      const r = d.db.prepare('SELECT script FROM video_orders WHERE run_id = ?').get(runId) as { script: string } | undefined
      return (r?.script ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
    },
    ask: d.ask
  }
  return finalPass(deps)
}
