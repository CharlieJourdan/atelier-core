// P8 — re-render only what changed (spec §2 P8): a cache key per plan brick (its node, the settings it reads, the
// calibration factors that apply to it). Between two rounds, the first brick whose key changed and every brick after it
// (their inputs flow down the pipeline) re-run; the bricks before it are reused. Pure.
import { createHash } from 'node:crypto'
import type { PipelinePlan } from '../../../../shared/clone'
import type { Calibration } from './calibration'

const bare = (node: string): string => node.split('@')[0]!

/** Whether a setting key belongs to a brick (`director.pov.shotS` → `director.pov@1`). */
export const settingOf = (key: string, node: string): boolean => key === node || key.startsWith(`${node}.`) || key === bare(node) || key.startsWith(`${bare(node)}.`)

/** One key per brick, in plan order. */
export function brickKeys(plan: PipelinePlan, calibration: Calibration = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of plan.bricks) {
    const settings = plan.settings.filter((s) => settingOf(s.key, b.node)).map((s) => [s.key, s.value])
    const factors = Object.entries(calibration).filter(([k]) => k.startsWith(`${b.node}:`) || k.startsWith(`${bare(b.node)}:`)).map(([k, v]) => [k, v.factor])
    out[b.node] = createHash('sha256').update(JSON.stringify([b.node, settings, factors])).digest('hex').slice(0, 16)
  }
  return out
}

/** Which bricks re-run and which are reused, given the previous round's keys (null = first round: everything runs). */
export function rerunPlan(plan: PipelinePlan, now: Record<string, string>, before: Record<string, string> | null): { rerun: string[]; reused: string[] } {
  const order = plan.bricks.map((b) => b.node)
  if (!before) return { rerun: order, reused: [] }
  const first = order.findIndex((n) => before[n] !== now[n])
  if (first < 0) return { rerun: [], reused: order }
  return { rerun: order.slice(first), reused: order.slice(0, first) }
}
