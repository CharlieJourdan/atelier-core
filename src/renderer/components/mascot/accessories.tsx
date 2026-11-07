// Held accessories of the voxel mascots (decision 0057): each is a handful of small boxes (iso.tsx), a quill that climbs in
// steps, a clapperboard of two slabs. Parts are in box units around the origin (x to the lower right, y to the lower left,
// z up). Fixed colours: they must read on every body colour, in dark and in light.
import type { AccessoryId } from '../../../shared/mascot'
import { Voxels, boundsOf, type Part } from './iso'

export const INK = '#2a2d35'
const PAPER = '#f6f2e9'
const METAL = '#c4cad6'
const GOLD = '#efbd45'
const JADE = '#2fae7b'
const RED = '#e5584d'
const BLUE = '#5b9bea'
const SKY = '#9fd0f2'
const WOOD = '#e9c58a'

export const ACCESSORIES: Record<Exclude<AccessoryId, 'none'>, readonly Part[]> = {
  compass: [
    [0, 0, 0, 8, 8, 2, METAL],
    [1, 1, 2, 6, 6, 0.8, PAPER],
    [3.4, 1.4, 2.8, 1.2, 3, 0.6, RED],
    [3.4, 4.4, 2.8, 1.2, 2.4, 0.6, INK],
    [3, 0, 2, 2, 1, 1, GOLD]
  ],
  flag: [
    [0, 0, 0, 1.2, 1.2, 14, INK],
    [1.2, 0, 8.4, 7, 1.2, 5, JADE]
  ],
  bulb: [
    [2, 2, 0, 4, 4, 3, METAL],
    [0.5, 0.5, 3, 7, 7, 7, GOLD],
    [3.2, 3.2, 10, 1.6, 1.6, 0.4, INK]
  ],
  quill: [
    [-1.6, 0, -1.8, 1.6, 1.2, 1.8, INK],
    [0, 0, 0, 2.4, 1.2, 2.6, PAPER],
    [1.5, 0, 2.6, 2.4, 1.2, 2.6, PAPER],
    [3, 0, 5.2, 2.6, 1.2, 2.6, PAPER],
    [4.5, 0, 7.8, 2.6, 1.2, 2.6, PAPER],
    [6, 0, 10.4, 2, 1.2, 2.4, PAPER]
  ],
  megaphone: [
    [0, 2.2, 1.8, 3, 3, 3, INK],
    [3, 1.6, 1.2, 3, 4.2, 4.2, RED],
    [6, 1, 0.6, 2.2, 5.4, 5.4, PAPER],
    [1, 3, 0, 1.2, 1.2, 1.8, INK]
  ],
  palette: [
    [0, 0, 0, 9, 7, 1.4, WOOD],
    [1.4, 1.4, 1.4, 1.8, 1.8, 0.6, RED],
    [4.2, 0.8, 1.4, 1.8, 1.8, 0.6, BLUE],
    [6.6, 2.4, 1.4, 1.8, 1.8, 0.6, JADE],
    [2, 4.4, 1.4, 1.6, 1.6, 0.6, PAPER]
  ],
  stopwatch: [
    [0.5, 0, 0, 7, 3.4, 7.4, PAPER],
    [0.5, 0, 0, 7, 3.4, 0.8, INK],
    [3, 1, 7.4, 2, 1.4, 1.4, INK],
    [3.3, 3.4, 3.2, 1, 0.6, 3.6, RED]
  ],
  clapper: [
    [0, 0, 0, 9.5, 2.6, 6, INK],
    [0, 0, 6, 9.5, 2.6, 2.4, PAPER],
    [1, 2.6, 6.2, 1.8, 0.5, 2, INK],
    [4.2, 2.6, 6.2, 1.8, 0.5, 2, INK],
    [7.4, 2.6, 6.2, 1.8, 0.5, 2, INK],
    [1.4, 2.6, 2, 3.6, 0.5, 0.8, PAPER]
  ],
  binoculars: [
    [0, 0, 0, 3.8, 5.6, 7, INK],
    [5, 0, 0, 3.8, 5.6, 7, INK],
    [3.8, 1.6, 2.6, 1.2, 2.2, 2.4, METAL],
    [0.7, 5.6, 1, 2.4, 0.6, 2.8, BLUE],
    [5.7, 5.6, 1, 2.4, 0.6, 2.8, BLUE]
  ],
  magnifier: [
    [-2.8, 0, 0, 1.8, 1.4, 1.8, INK],
    [-1.2, 0, 1.6, 1.8, 1.4, 1.8, INK],
    [0, 0, 3, 8, 1.4, 1.4, INK],
    [0, 0, 11, 8, 1.4, 1.4, INK],
    [0, 0, 4.4, 1.4, 1.4, 6.6, INK],
    [6.6, 0, 4.4, 1.4, 1.4, 6.6, INK],
    [1.4, 0.3, 4.4, 5.2, 0.8, 6.6, '#cfe6fb', 0.75]
  ],
  checklist: [
    [0, 0, 0, 7, 1.6, 10, PAPER],
    [2, 0, 10, 3, 1.6, 1.2, METAL],
    [1, 1.6, 2, 1.2, 0.5, 1.2, JADE],
    [3, 1.6, 2.3, 3, 0.5, 0.7, INK],
    [1, 1.6, 4.6, 1.2, 0.5, 1.2, JADE],
    [3, 1.6, 4.9, 3, 0.5, 0.7, INK],
    [1, 1.6, 7.2, 1.2, 0.5, 1.2, RED],
    [3, 1.6, 7.5, 3, 0.5, 0.7, INK]
  ],
  mic: [
    [1.5, 1.5, 0, 5, 5, 1.4, INK],
    [3.2, 3.2, 1.4, 1.6, 1.6, 4.4, INK],
    [2, 2, 5.8, 4, 4, 4.6, METAL],
    [2, 2, 8, 4, 4, 0.7, INK]
  ],
  plane: [
    [0, 0, 2, 3.4, 7, 1, PAPER],
    [3.4, 1, 2, 3.4, 5, 1, PAPER],
    [6.8, 2, 2, 3, 3, 1, PAPER],
    [0, 3.2, 3, 9.8, 0.7, 0.4, METAL]
  ],
  'set-square': [
    [0, 0, 0, 9.5, 1.2, 2.2, SKY],
    [0, 0, 2.2, 7.5, 1.2, 2.2, SKY],
    [0, 0, 4.4, 5.5, 1.2, 2.2, SKY],
    [0, 0, 6.6, 3.5, 1.2, 2.2, SKY],
    [0, 0, 8.8, 1.8, 1.2, 2.2, SKY],
    [1.6, 1.2, 1.4, 3, 0.4, 0.7, BLUE]
  ],
  tag: [
    [0, 0, 0, 8.4, 1.5, 6.4, GOLD],
    [1.2, 1.5, 3.9, 1.4, 0.5, 1.4, INK],
    [3.6, 1.5, 3.9, 3.6, 0.5, 0.8, INK],
    [3.6, 1.5, 2, 3.6, 0.5, 0.8, INK]
  ],
  gear: [
    [0, 0, 0, 7, 7, 2.4, METAL],
    [2.5, 2.5, 2.4, 2, 2, 0.5, INK],
    [2.6, -1.4, 0, 1.8, 1.4, 2.4, METAL],
    [2.6, 7, 0, 1.8, 1.4, 2.4, METAL],
    [-1.4, 2.6, 0, 1.4, 1.8, 2.4, METAL],
    [7, 2.6, 0, 1.4, 1.8, 2.4, METAL]
  ],
  star: [
    [2.8, 0, 0, 2.8, 1.5, 8.4, GOLD],
    [0, 0, 2.8, 8.4, 1.5, 2.8, GOLD],
    [1, 0, 1, 1.8, 1.5, 1.8, GOLD],
    [5.6, 0, 1, 1.8, 1.5, 1.8, GOLD]
  ]
}

export function Accessory({ id }: { id: AccessoryId }) {
  return id === 'none' ? null : <Voxels parts={ACCESSORIES[id]} />
}

/** An accessory on its own (the editor's choices), fitted in its box. */
export function AccessoryIcon({ id, size = 30 }: { id: AccessoryId; size?: number }) {
  if (id === 'none') {
    return (
      <svg data-slot="accessory-icon" width={size} height={size} viewBox="-10 -10 20 20" aria-hidden focusable="false">
        <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke={INK} strokeWidth={1.6} strokeLinecap="round" opacity={0.4} />
      </svg>
    )
  }
  const b = boundsOf(ACCESSORIES[id])
  const pad = 1.5
  const side = Math.max(b.w, b.h) + pad * 2
  const x = b.x - (side - b.w) / 2 - pad
  const y = b.y - (side - b.h) / 2 - pad
  return (
    <svg data-slot="accessory-icon" width={size} height={size} viewBox={`${x.toFixed(2)} ${y.toFixed(2)} ${(side + pad * 2).toFixed(2)} ${(side + pad * 2).toFixed(2)}`} aria-hidden focusable="false">
      <Accessory id={id} />
    </svg>
  )
}
