// The presenter's layouts as the pipeline's references measure them (avatar-efficience, avatar-layouts): full frame before
// `fromS` (the hook), then split screen and inset in their measured shares of the presenter's time. Everything below is a
// setting of the pipeline or its style (`presenterLayouts`), never an engine rule: which side the presenter takes in a split,
// where the inset sits and how big it is, how far apart two insets are, and how a kind of moment (director-layout-rules.ts)
// shares the layouts. Without the setting the director keeps its older rule (a split or an inset only where the scene pass asks
// for one), which gave Marcel's 13-minute video 51 full-frame shots and no split, against reference 2's 17 % split and 5 % inset.
import { z } from 'zod'
import type { Layout } from '../formats/directives'
import { Inset } from '../formats/inset'
import { LAYOUT_TRIGGERS, LayoutWeights, type LayoutTrigger } from './director-layout-rules'

const share = z.number().min(0).max(1)

/** Shares of the presenter's screen time after `fromS` (they add to 1); before `fromS` the presenter is full frame. */
export const PresenterLayouts = z
  .object({
    fromS: z.number().min(0).max(3600),
    /**
     * Where the full-frame presenter ends, when that is before `fromS` (default: `fromS`). The references' last full-frame shot ends
     * at 51 s and 79 s but their first split starts at 77 s and 99 s; a presenter slot between the two (the part's share asks for
     * one) is a split, not a 26 s full-frame hook against the reference's 18 s (avatar-layouts, round 3).
     */
    fullUntilS: z.number().min(0).max(3600).optional(),
    full: share,
    split: share,
    pip: share,
    /** Who stands where in a split: `left` (both references, picture on the right), `right`, or `alternate` (the older rule). */
    presenterSide: z.enum(['left', 'right', 'alternate']).optional(),
    /** The inset's geometry; unset: the older small square, bottom right. */
    inset: Inset.optional(),
    /** Two insets are at least this many seconds apart (references: 47 s and 55 s at the closest, an inset every 70–90 s). */
    insetGapS: z.number().min(0).max(600).optional(),
    /**
     * The end of the video lays the presenter out differently (references: the last 45 s keep the presenter's 22–26 % but half of
     * it is the inset, over a still, against 20 % elsewhere): in the last `lastS` seconds these shares replace the body's.
     */
    outro: z.object({ lastS: z.number().min(5).max(300), full: share, split: share, pip: share }).refine((o) => Math.abs(o.full + o.split + o.pip - 1) <= 0.02, 'the outro shares add to 1').optional(),
    /** By kind of moment, the layouts a presenter appearance that opens on such a sentence takes (weights); absent kinds follow the shares. */
    triggers: z.partialRecord(z.enum(LAYOUT_TRIGGERS), LayoutWeights).optional()
  })
  .refine((l) => Math.abs(l.full + l.split + l.pip - 1) <= 0.02, 'the layout shares add to 1')
export type PresenterLayouts = z.infer<typeof PresenterLayouts>

const ORDER: Layout[] = ['split', 'pip', 'full']

/** One presenter slot, and the kind of moment its sentence is (director-layout-rules.ts); `kind` unset: an explanation. */
export interface LayoutSlot {
  start: number
  end: number
  kind?: LayoutTrigger
}

/**
 * The layout of each presenter slot (pure). Before `fromS`: full frame. After it, the slots that follow each other form one
 * appearance of the presenter; the first slot of an appearance takes the layout furthest below its share (of its kind of moment
 * when the pipeline sets `triggers` for it, else of the presenter's time so far), among the layouts the pipeline allows, and the
 * inset only when the last one ended `insetGapS` ago. The rest of the appearance keeps the layout, except an inset which goes on
 * as a split (the references: « inset then split » in 6 of 17 insets; a split then an inset in the same breath only twice).
 */
export function plannedLayouts(slots: readonly LayoutSlot[], l: PresenterLayouts, allowed: readonly Layout[], totalS?: number): Layout[] {
  const ok = (k: Layout): boolean => k === 'full' || allowed.includes(k)
  const sharesOf = (s: { full: number; split: number; pip: number }): Record<Layout, number> => ({ full: s.full, split: ok('split') ? s.split : 0, pip: ok('pip') ? s.pip : 0 })
  const bodyShares = sharesOf(l)
  const outroShares = l.outro ? sharesOf(l.outro) : null
  const outroFrom = l.outro && totalS !== undefined ? totalS - l.outro.lastS : Infinity
  // the outro keeps its own tally: its shares are of the presenter's time inside it, not of the whole video's
  const outroDone: Record<Layout, number> = { full: 0, split: 0, pip: 0 }
  let outroTotal = 0
  const done: Record<Layout, number> = { full: 0, split: 0, pip: 0 }
  const byKind = new Map<LayoutTrigger, { done: Record<Layout, number>; total: number }>()
  let total = 0
  let lastPip = -Infinity
  let runLayout: Layout | null = null
  let runEnd = -Infinity
  return slots.map((s) => {
    const len = s.end - s.start
    const continues = Math.abs(s.start - runEnd) < 1e-6
    runEnd = s.end
    if (s.start < (l.fullUntilS ?? l.fromS)) {
      runLayout = null
      return 'full'
    }
    let layout: Layout
    if (continues && runLayout) layout = runLayout === 'pip' && ok('split') ? 'split' : runLayout
    else {
      const weights = s.kind ? l.triggers?.[s.kind] : undefined
      const inOutro = outroShares !== null && s.start >= outroFrom && s.start >= (l.fullUntilS ?? l.fromS)
      let want = inOutro ? (outroShares as Record<Layout, number>) : bodyShares
      let seen = inOutro ? outroDone : done
      let seenTotal = inOutro ? outroTotal : total
      if (weights) {
        const w = { full: weights.full ?? 0, split: ok('split') ? (weights.split ?? 0) : 0, pip: ok('pip') ? (weights.pip ?? 0) : 0 }
        const sum = w.full + w.split + w.pip
        if (sum > 0) {
          want = { full: w.full / sum, split: w.split / sum, pip: w.pip / sum }
          const kind = byKind.get(s.kind as LayoutTrigger) ?? { done: { full: 0, split: 0, pip: 0 }, total: 0 }
          byKind.set(s.kind as LayoutTrigger, kind)
          seen = kind.done
          seenTotal = kind.total
        }
      }
      // an inset too close to the last one is a split (or the layout next in line)
      const gapOk = l.insetGapS === undefined || s.start - lastPip >= l.insetGapS
      const pool = ORDER.filter((k) => want[k] > 0 && (k !== 'pip' || gapOk))
      const pick = pool.reduce((best, k) => (want[k] * (seenTotal + len) - seen[k] > want[best] * (seenTotal + len) - seen[best] + 1e-9 ? k : best), pool[0] ?? 'full')
      layout = pool.length > 0 ? pick : 'full'
      runLayout = layout
      if (layout === 'pip') lastPip = s.start
    }
    done[layout] += len
    total += len
    if (outroShares !== null && s.start >= outroFrom) {
      outroDone[layout] += len
      outroTotal += len
    }
    const kind = s.kind ? byKind.get(s.kind) : undefined
    if (kind) {
      kind.done[layout] += len
      kind.total += len
    }
    return layout
  })
}
