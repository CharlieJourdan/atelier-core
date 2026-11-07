// The edit review's fixes (qualite-montage): the patches the render can apply to its own plan, one per shot per round, so that only the
// shots touched are rendered again (segments are cached by their exact spec). A patch that no longer fits the plan (its shot gone, its
// neighbour changed) is skipped, never forced. Pure.
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS } from '../formats/timing'
import type { Defect, Patch } from './types'

/** The fixes of one round: one per shot, a dropped shot's neighbour left alone, worst defects first. */
export function choosePatches(defects: readonly Defect[]): Patch[] {
  const touched = new Set<string>()
  const out: Patch[] = []
  const order = [...defects].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fail' ? -1 : 1))
  for (const d of order) {
    const f = d.fix
    if (!f) continue
    const ids = f.op === 'drop' ? [f.shotId, f.into, ...(f.and ? [f.and] : [])] : [f.shotId]
    if (ids.some((id) => touched.has(id))) continue
    // a shift moves the next shot's start: that shot is touched too
    for (const id of ids) touched.add(id)
    out.push(f)
  }
  return out
}

/** The plan with the patches applied, and the ones that were. */
export function applyPatches(plan: EditPlan, patches: readonly Patch[]): { plan: EditPlan; applied: Patch[] } {
  const shots = new Map(plan.shots.map((s) => [s.id, { ...s } as Shot]))
  let base = [...plan.tracks.base]
  let overlay = [...plan.tracks.overlay]
  const applied: Patch[] = []
  for (const p of patches) {
    const s = shots.get(p.shotId)
    if (!s) continue
    if (p.op === 'drop_overlay') {
      if (!overlay.includes(p.shotId)) continue
      overlay = overlay.filter((id) => id !== p.shotId)
      shots.delete(p.shotId)
      applied.push(p)
      continue
    }
    const i = base.indexOf(p.shotId)
    if (i < 0) continue
    if (p.op === 'move') {
      // a slow, even push over the whole shot: the camera never stops
      s.motion = { kind: 'push', from: 1, to: p.zoom, ease: 'linear' }
      applied.push(p)
    } else if (p.op === 'shift') {
      const next = shots.get(base[i + 1] ?? '')
      if (!next || p.toFrame <= s.startFrame + FPS / 2 || p.toFrame >= next.endFrame - FPS / 2) continue
      s.endFrame = p.toFrame
      next.startFrame = p.toFrame
      applied.push(p)
    } else if (p.op === 'drop') {
      const into = shots.get(p.into)
      const j = base.indexOf(p.into)
      if (!into || Math.abs(j - i) !== 1) continue
      if (p.and !== undefined) {
        const other = shots.get(p.and)
        if (!other || j !== i - 1 || base.indexOf(p.and) !== i + 1) continue
        const mid = s.startFrame + Math.round((s.endFrame - s.startFrame) / 2)
        into.endFrame = mid
        other.startFrame = mid
      } else if (j < i) into.endFrame = s.endFrame
      else into.startFrame = s.startFrame
      // the one that takes the place keeps the way in of the first of the two
      if (j > i) into.transitionIn = s.transitionIn
      base = base.filter((id) => id !== p.shotId)
      shots.delete(p.shotId)
      applied.push(p)
    }
  }
  const kept = new Set([...base, ...overlay, ...plan.tracks.labels])
  return {
    plan: { ...plan, shots: plan.shots.filter((s) => kept.has(s.id)).map((s) => shots.get(s.id) as Shot), tracks: { ...plan.tracks, base, overlay } },
    applied
  }
}
