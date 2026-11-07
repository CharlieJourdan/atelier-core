// The early-cut check (record 0059, Charlie 01/11 on run 7: « le spray apparaît avant qu'on parle du spray »): every picture
// the director placed on a directive is read against the word that names it, on the times `words.align` heard; one that starts
// more than `maxS` before that word is listed in the plan's diagnostics and the log. It never stops a run.
import type { EditPlan, GenList } from '../formats/editplan'
import type { Word } from '../formats/timing'
import { contentWordOf } from './director-mix'

/** A picture may start this long before the word that names it (the references: 0.10–0.14 s, record 0054). */
export const EARLY_CUT_S = 0.15

export interface EarlyCut {
  shot: string
  word: string
  /** Seconds between the cut and the word's onset. */
  earlyS: number
}

/** The pictures on a directive that start more than `maxS` before the word that names them. Pure. */
export function earlyCuts(plan: EditPlan, list: GenList, words: readonly Word[], maxS = EARLY_CUT_S): EarlyCut[] {
  const out: EarlyCut[] = []
  for (const sh of plan.shots) {
    if (sh.track !== 'base' || sh.kind === 'avatar' || sh.role !== 'scene') continue
    const t = sh.startFrame / plan.fps
    const k = words.findIndex((w) => w.start >= t - 0.05)
    if (k < 0) continue
    const subject = list.items.find((i) => i.id === sh.genItem)?.context.subject ?? ''
    const kc = contentWordOf(words, k, sh.anchor ?? (words[k] as Word).w, subject)
    const early = (words[kc] as Word).start - t
    if (early > maxS + 1e-6) out.push({ shot: sh.id, word: (words[kc] as Word).w, earlyS: Math.round(early * 100) / 100 })
  }
  return out
}

/**
 * Moves the cut of every early picture onto its word (`lead` before it), by holding the shot before it a little longer: the
 * presenter keeps talking to the word (never past `runMaxS` in a row), or the picture before stays. The early picture keeps at
 * least `minS`. What cannot move stays, and the check lists it. Returns how many cuts moved.
 */
export function snapEarlyCuts(plan: EditPlan, list: GenList, words: readonly Word[], o: { lead: number; maxS: number; minS: number; runMaxS: number }): number {
  const base = plan.shots.filter((s) => s.track === 'base').sort((a, b) => a.startFrame - b.startFrame)
  let moved = 0
  for (const e of earlyCuts(plan, list, words, o.maxS)) {
    const i = base.findIndex((s) => s.id === e.shot)
    const shot = base[i]
    const prev = base[i - 1]
    if (!shot || !prev || prev.endFrame !== shot.startFrame) continue
    const to = Math.round((shot.startFrame / plan.fps + e.earlyS - o.lead) * plan.fps)
    if (shot.endFrame - to < o.minS * plan.fps - 1e-6 || to <= shot.startFrame) continue
    if (prev.kind === 'avatar') {
      let from = i - 1
      while (from > 0 && (base[from - 1] as typeof prev).kind === 'avatar' && (base[from - 1] as typeof prev).endFrame === (base[from] as typeof prev).startFrame) from--
      if ((to - (base[from] as typeof prev).startFrame) / plan.fps > o.runMaxS + 1e-6) continue
    }
    prev.endFrame = to
    shot.startFrame = to
    // the presenter's piece is cut from its voice range: it follows the longer shot (its seconds are billed from it)
    const item = prev.kind === 'avatar' ? list.items.find((x) => x.id === prev.genItem) : undefined
    if (item?.voiceRange && item.voiceRange.endFrame < to) {
      item.voiceRange = { ...item.voiceRange, endFrame: to }
      item.constraints = { ...item.constraints, durationS: Math.round(((to - item.voiceRange.startFrame) / plan.fps) * 1000) / 1000 }
    }
    moved++
  }
  return moved
}
