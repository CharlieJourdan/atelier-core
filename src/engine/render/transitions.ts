// Transitions between two base shots (docs/ENGINE-SPEC.md §28.1, motion-montage). Like the dissolve, each is rendered into the HEAD of
// the incoming segment: the previous picture (its move continued past its end, or a clip's last frame) and the new shot are blended by
// ffmpeg's `xfade`, so the join of the segments stays a stream copy. A whip adds a directional motion blur over its few frames.
import type { Transition } from '../formats/editplan'

export type TransitionDir = 'left' | 'right' | 'up' | 'down'

/** Frames each transition takes (30 fps), measured on the references: a cross-fade ≈ 0.4 s, a whip ≈ 0.2 s. */
export const TRANSITION_FRAMES: Record<Exclude<Transition, 'cut' | 'dip'>, number> = {
  dissolve: 12,
  match: 8,
  flash: 8,
  whip: 6,
  push: 10,
  zoom: 10
}

/** The transitions drawn from the previous picture (a cut has none; a dip fades each side on its own). */
export const isBlend = (t: Transition | undefined): t is Exclude<Transition, 'cut' | 'dip'> => t !== undefined && t !== 'cut' && t !== 'dip'

/** ffmpeg's `xfade` transition of ours. */
export function xfadeName(t: Exclude<Transition, 'cut' | 'dip'>, dir: TransitionDir = 'left'): string {
  switch (t) {
    case 'dissolve':
    case 'match':
      return 'fade'
    case 'flash':
      return 'fadewhite'
    case 'zoom':
      return 'zoomin'
    case 'whip':
    case 'push':
      return `slide${dir}`
  }
}

/**
 * The graph that blends `[a]` (the previous picture) into `[b]` (the new shot) over `frames`, then runs `after` (fades, the format), into
 * `[v]`. A whip's frames are smeared along its direction (a box blur on one axis, only while it moves).
 */
export function transitionGraph(t: Exclude<Transition, 'cut' | 'dip'>, frames: number, dir: TransitionDir | undefined, after: string): string {
  const d = (frames / 30).toFixed(4)
  const blend = `[a][b]xfade=transition=${xfadeName(t, dir ?? 'left')}:duration=${d}:offset=0`
  if (t !== 'whip') return `${blend},${after}[v]`
  const horizontal = dir === undefined || dir === 'left' || dir === 'right'
  const blur = horizontal ? 'sizeX=72:sizeY=1' : 'sizeX=1:sizeY=72'
  return `${blend},avgblur=${blur}:enable='lt(n\\,${frames})',${after}[v]`
}
