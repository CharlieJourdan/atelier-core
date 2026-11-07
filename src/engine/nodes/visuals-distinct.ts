// Two pictures alike, at the stills stage (avatar-qualite part 3). Run 6 made every asset, then the render stopped on « two
// shots show almost the same picture » and asked a human: an automatic run never does that. Here, before any clip is made
// from them, the generated stills of the shots within NEAR_WINDOW_S of each other are compared (the correlation of their 32×18
// grey thumbnails, `likeness`); a later one that looks like an earlier one is made again ONCE with a clearly different
// framing (a close-up becomes a wide shot, anything else an extreme close-up of a detail), and the better of the two is kept:
// the new one when it looks less like its neighbours, else the first (made again from its cache, nothing paid twice).
// The two shots of one clip (one continuing action) are never compared. Shots without their start time are not compared.
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { NEAR_LIKENESS, greyThumbOf, likeness } from './visuals-checks'

/** The window avatar@1 sets (`alikeWindowS`, record 0055): seconds within which two pictures should not look alike. */
export const DISTINCT_WINDOW_S = 20

/** What the pass kept for a picture made again: how alike it was, how alike the new one is, which one stays. */
export interface DistinctNote {
  likeness: number
  after: number
  kept: 'new' | 'first'
}

/** The contrasting framing of a picture made again: wide for a close one, a close detail for anything else. */
export function contrastingShot(it: GenItem): { size: string; scene: string } {
  const size = it.shot?.size ?? 'medium shot'
  const scene = it.shot?.scene ?? it.prompt ?? it.context.subject
  const close = /close|detail|macro/i.test(size)
  return {
    size: close ? 'wide shot' : 'extreme close-up detail',
    scene: `${scene.slice(0, 1000)}; ${close ? 'seen from further back, the whole place around it' : 'one small detail of it filling the frame'}, a different framing from the picture before`
  }
}

/**
 * The pass over a fulfilled list. `remake(i, item)` makes item `i` again (its per-item cache makes a known prompt free);
 * `restore(i)` puts the first picture back when the new one is no better.
 */
export async function distinctPass(
  ctx: RunCtx,
  o: {
    items: readonly GenItem[]
    files: readonly (string | undefined)[]
    skip: ReadonlySet<number>
    remake: (i: number, item: GenItem) => Promise<void>
    restore: (i: number) => Promise<void>
    /** The pipeline's window (`alikeWindowS`). */
    windowS?: number
  }
): Promise<{ notes: Map<number, DistinctNote>; remade: Set<number>; line: string | null }> {
  const win = o.windowS ?? DISTINCT_WINDOW_S
  const now = [...o.items]
  const shots = now
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => o.files[i] !== undefined && !o.skip.has(i) && (it.kind === 'image.gen' || it.kind === 'video.gen') && it.sameAs === undefined && it.context.atS !== undefined)
    .sort((a, b) => (a.it.context.atS as number) - (b.it.context.atS as number))
  const thumbs = new Map<number, number[]>()
  for (const s of shots) thumbs.set(s.i, await greyThumbOf(ctx, o.files[s.i] as string))
  /** How much `i` looks like the shots within the window before and after it (its worst neighbour). */
  const worst = (i: number): number => {
    const at = now[i]?.context.atS as number
    let w = -1
    for (const s of shots) {
      if (s.i === i || Math.abs((s.it.context.atS as number) - at) >= win) continue
      if (s.it.sameAs === now[i]?.id || now[i]?.sameAs === s.it.id) continue
      w = Math.max(w, likeness(thumbs.get(i) as number[], thumbs.get(s.i) as number[]))
    }
    return w
  }
  const notes = new Map<number, DistinctNote>()
  const remade = new Set<number>()
  for (let k = 1; k < shots.length; k++) {
    const b = shots[k] as (typeof shots)[number]
    // only the later picture of a pair is made again, and only once
    let before = -1
    for (let j = k - 1; j >= 0; j--) {
      const a = shots[j] as (typeof shots)[number]
      if ((b.it.context.atS as number) - (a.it.context.atS as number) >= win) break
      before = Math.max(before, likeness(thumbs.get(a.i) as number[], thumbs.get(b.i) as number[]))
    }
    if (before < NEAR_LIKENESS) continue
    const first = thumbs.get(b.i) as number[]
    const firstWorst = worst(b.i)
    const shot = contrastingShot(b.it)
    const again: GenItem = { ...b.it, prompt: `${shot.size} of ${shot.scene}`, shot }
    now[b.i] = again
    await o.remake(b.i, again)
    thumbs.set(b.i, await greyThumbOf(ctx, o.files[b.i] as string))
    const after = worst(b.i)
    if (after < firstWorst) {
      notes.set(b.i, { likeness: round(firstWorst), after: round(after), kept: 'new' })
      remade.add(b.i)
    } else {
      now[b.i] = b.it
      thumbs.set(b.i, first)
      await o.restore(b.i)
      notes.set(b.i, { likeness: round(firstWorst), after: round(after), kept: 'first' })
    }
  }
  const line = notes.size > 0 ? `images trop proches : ${notes.size} refaite(s) avec un autre cadrage, ${remade.size} gardée(s)` : null
  if (line) ctx.emit({ kind: 'log', level: 'info', text: line })
  return { notes, remade, line }
}

const round = (x: number): number => Math.round(x * 100) / 100
