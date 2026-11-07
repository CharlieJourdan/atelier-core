// The last check before the render (production-17): the first real 60 s video showed ONE still for its last 34 s. Nine
// pictures could not be made (a busy Cloud), each was filled with its neighbour's picture, and the render played them end
// to end. A film is refused when a stretch of consecutive B-roll shots (presenter shots apart) shows the same picture or clip
// for longer than MAX_SAME_PICTURE_S, unless the plan made it one shot that long; it is also refused when more than a
// quarter of the planned B-roll shots have no picture of their own. A rerun then remakes only the missing pictures.
// Two pictures that look alike within NEAR_WINDOW_S are only a warning here (avatar-qualite part 3: an automatic run never
// stops to ask a human): the pictures brick already made the later one again with another framing (visuals-distinct.ts).
// « Alike » is the correlation of their 32×18 grey thumbnails (`likeness`), not a 9×8 hash, which took a wide bedroom and a
// close mould corner of run 6 for the same picture.
import { NEAR_LIKENESS, likeness } from '../nodes/visuals-checks'

/** The longest stretch of the same picture across several planned shots. */
export const MAX_SAME_PICTURE_S = 8
/** The share of planned B-roll shots that may borrow a neighbour's picture (a missing one here and there). */
export const MAX_BORROWED_SHARE = 0.25
/** Seconds within which two pictures should not look alike. */
export const NEAR_WINDOW_S = 20

export interface CheckedShot {
  id: string
  /** A presenter shot (its own generation, never compared). */
  presenter: boolean
  startS: number
  endS: number
  /** What the shot shows: the hash of its clip or picture. */
  source: string
  /** The shot has no picture of its own (it borrows a neighbour's). */
  borrowed: boolean
  /** Its picture's 32×18 grey thumbnail (`greyThumbOf`); absent: not compared (a demo drawing, a presenter). */
  grey?: readonly number[]
  /** Shots of one clip share this (one continuing action): never compared to each other. */
  group?: string
}

/** The problems in French (empty: the film may be rendered). */
export function shotProblems(shots: readonly CheckedShot[]): string[] {
  const problems: string[] = []
  let run: CheckedShot[] = []
  const close = (): void => {
    const first = run[0]
    const last = run.at(-1)
    if (first && last && run.length > 1 && last.endS - first.startS > MAX_SAME_PICTURE_S && run.some((r) => r.borrowed)) {
      problems.push(`${Math.round(last.endS - first.startS)} s de suite montrent la même image (${run.length} plans, de ${fmt(first.startS)} à ${fmt(last.endS)})`)
    }
    run = []
  }
  for (const s of shots) {
    if (s.presenter) {
      close()
      continue
    }
    if (run.length > 0 && run[0]?.source !== s.source) close()
    run.push(s)
  }
  close()
  const broll = shots.filter((s) => !s.presenter)
  const borrowed = broll.filter((s) => s.borrowed).length
  if (broll.length > 0 && borrowed / broll.length > MAX_BORROWED_SHARE) problems.push(`${borrowed} plans sur ${broll.length} n’ont pas leur propre image`)
  return problems
}

/** The warnings in French: a long stretch of one picture whose shots all have their own, and two pictures within NEAR_WINDOW_S that look alike (the two shots of one clip apart). Never a stop. */
export function shotWarnings(shots: readonly CheckedShot[]): string[] {
  const warnings: string[] = []
  let run: CheckedShot[] = []
  const close = (): void => {
    const first = run[0]
    const last = run.at(-1)
    if (first && last && run.length > 1 && last.endS - first.startS > MAX_SAME_PICTURE_S && !run.some((r) => r.borrowed)) {
      warnings.push(`${Math.round(last.endS - first.startS)} s de suite montrent la même image (${run.length} plans, de ${fmt(first.startS)} à ${fmt(last.endS)})`)
    }
    run = []
  }
  for (const s of shots) {
    if (s.presenter) close()
    else {
      if (run.length > 0 && run[0]?.source !== s.source) close()
      run.push(s)
    }
  }
  close()
  const looked = shots.filter((s) => !s.presenter && !s.borrowed && s.grey !== undefined)
  for (let i = 0; i < looked.length; i++) {
    const a = looked[i] as CheckedShot
    for (let j = i + 1; j < looked.length; j++) {
      const b = looked[j] as CheckedShot
      if (b.startS - a.startS >= NEAR_WINDOW_S) break
      if (a.source === b.source || (a.group !== undefined && a.group === b.group)) continue
      const l = likeness(a.grey as readonly number[], b.grey as readonly number[])
      if (l >= NEAR_LIKENESS) warnings.push(`les plans de ${fmt(a.startS)} et ${fmt(b.startS)} se ressemblent (${Math.round(l * 100)} %)`)
    }
  }
  return warnings
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
