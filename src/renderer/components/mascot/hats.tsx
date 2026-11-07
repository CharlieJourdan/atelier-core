// Hair, hats and face pieces of the voxel mascots (decision 0057). The head is a cube of 20 units standing on the body
// (HEAD); a hat is a few boxes a little larger than it, in a deeper shade of the body colour, so a recoloured agent stays
// one harmonious character. `behind` boxes are drawn before the head (they stay hidden by it), `front` ones after.
import type { ReactNode } from 'react'
import { INK } from './accessories'
import { shade, type Part } from './iso'
import type { FaceId, HatId } from './roles'

export const HEAD = { size: 20, z: 12 } as const
const TOP = HEAD.z + HEAD.size
const S = HEAD.size

export interface Shades {
  /** Hair and cuffs. */
  deep: string
  /** Hat crowns. */
  mid: string
}

export function shadesOf(body: string): Shades {
  return { deep: shade(body, 0.52), mid: shade(body, 0.32) }
}

export interface HatParts {
  behind?: readonly Part[]
  front: readonly Part[]
}

/** The band of hair (or of a hat) round the top of the head, a little wider than the head. */
const band = (height: number, color: string, grow = 0.4): Part => [-grow, -grow, TOP - height + 0.8, S + grow * 2, S + grow * 2, height, color]

const YELLOW = '#f2b632'
const GREEN = '#3aa57a'
const WHITE = '#f6f2e9'

export const HATS: Record<HatId, (s: Shades) => HatParts> = {
  hair: (s) => ({ front: [band(5, s.deep)] }),
  tuft: (s) => ({ front: [band(5, s.deep), [3, 3, TOP + 0.8, 7, 7, 2.6, s.deep]] }),
  bun: (s) => ({ front: [band(5, s.deep), [7, 7, TOP + 0.8, 6, 6, 5, s.deep]] }),
  beret: (s) => ({
    front: [
      [-1.8, -1.8, TOP - 0.4, S + 3.6, S + 3.6, 3, s.mid],
      [8.5, 8.5, TOP + 2.6, 3, 3, 1.8, s.deep]
    ]
  }),
  cap: (s) => ({ front: [band(6, s.mid), [-0.6, S + 0.6, TOP - 5, S + 1.2, 4.6, 1.6, s.deep]] }),
  hardhat: () => ({
    front: [
      [-2, -2, TOP - 5.4, S + 4, S + 4, 1.4, '#dd9d1c'],
      [-0.8, -0.8, TOP - 4.6, S + 1.6, S + 1.6, 6.6, YELLOW],
      [8.4, -0.8, TOP + 2, 3.2, S + 1.6, 1.6, '#f9d06a']
    ]
  }),
  headphones: () => ({
    behind: [[-3.6, 6, TOP - 15, 3.4, 8, 9, INK]],
    front: [
      [-1.4, 8.4, TOP, S + 2.8, 3.2, 1.6, INK],
      [S + 0.2, 8.6, TOP - 9, 1.6, 2.8, 9.4, INK],
      [S + 0.2, 6, TOP - 15, 3.4, 8, 9, INK],
      [S + 3.6, 7.8, TOP - 13.6, 0.5, 4.4, 6, '#38b883']
    ]
  }),
  eyeshade: () => ({ front: [band(3.6, GREEN, 0.5), [-0.5, S + 0.5, TOP - 3.6 + 1, S + 1, 4.6, 1.2, GREEN]] }),
  beanie: (s) => ({
    front: [
      [1, 1, TOP, S - 2, S - 2, 3.6, s.mid],
      band(4.6, s.deep),
      [8.4, 8.4, TOP + 3.6, 3.2, 3.2, 3, WHITE]
    ]
  })
}

/** Flat art on the left face of the head (x to the right, y UP, in box units). */
export const FACES: Record<FaceId, () => ReactNode> = {
  glasses: () => (
    <g fill="none" stroke={INK} strokeWidth={0.9} strokeLinejoin="round">
      <rect x={2.4} y={6.2} width={6.6} height={6.4} />
      <rect x={11} y={6.2} width={6.6} height={6.4} />
      <path d="M9 9.4 H11" />
    </g>
  ),
  monocle: () => (
    <g fill="none" stroke="#e7b23c" strokeLinecap="round">
      <rect x={11.2} y={6.4} width={6.2} height={6.2} strokeWidth={1.1} />
      <path d="M17.4 7.4 L18.6 2" strokeWidth={0.6} />
    </g>
  )
}
