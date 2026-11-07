// Light isometric drawing for the voxel mascots (decision 0057): boxes in a 2:1 isometric view, three flat faces each (top
// lightest, left the base colour, right darkest), so a character reads as a small lit cube without any gradient, filter or
// id. x runs to the lower right of the screen, y to the lower left, z up; the viewer sees the top, the left (y max) and the
// right (x max) faces of a box.
import type { ReactNode } from 'react'

export const A = 0.866
export const B = 0.5
export const C = 1

/** [x, y, z, width (x), depth (y), height (z), colour, alpha?] */
export type Part = readonly [number, number, number, number, number, number, string, number?]

/** Screen position of a point of the 3D space. */
export function proj(x: number, y: number, z: number): [number, number] {
  return [(x - y) * A, (x + y) * B - z * C]
}

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString()
const pts = (corners: [number, number, number][]): string => corners.map(([x, y, z]) => proj(x, y, z).map(r2).join(',')).join(' ')

/** Mixes a #rrggbb colour towards another by `amount`. */
function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number): string => Math.round(v + (target - v) * amount).toString(16).padStart(2, '0')
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}
/** Towards black. */
export const shade = (hex: string, amount: number): string => mix(hex, 0, amount)
/** Towards white. */
export const tint = (hex: string, amount: number): string => mix(hex, 255, amount)

/** One box: three faces, each painted with its own shade of the colour (a hairline of the same colour hides the seams). */
export function Box({ part }: { part: Part }) {
  const [x, y, z, w, d, h, color, alpha] = part
  const zt = z + h
  const top = tint(color, 0.22)
  const right = shade(color, 0.24)
  const face = (points: string, fill: string): ReactNode => <polygon points={points} fill={fill} stroke={fill} strokeWidth={0.4} strokeLinejoin="round" />
  return (
    <g {...(alpha !== undefined ? { opacity: alpha } : {})}>
      {face(pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, zt], [x + w, y, zt]]), right)}
      {face(pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, zt], [x, y + d, zt]]), color)}
      {face(pts([[x, y, zt], [x + w, y, zt], [x + w, y + d, zt], [x, y + d, zt]]), top)}
    </g>
  )
}

/** Boxes drawn back to front (by their corner), or in the given order when `sorted` is false. */
export function Voxels({ parts, sorted = true }: { parts: readonly Part[]; sorted?: boolean }) {
  const ordered = sorted ? [...parts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2])) : parts
  return (
    <>
      {ordered.map((p, i) => (
        <Box key={i} part={p} />
      ))}
    </>
  )
}

/** The screen box of some parts, for fitting a small icon around them. */
export function boundsOf(parts: readonly Part[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y, z, w, d, h] of parts) {
    for (const cx of [x, x + w]) {
      for (const cy of [y, y + d]) {
        for (const cz of [z, z + h]) {
          const [sx, sy] = proj(cx, cy, cz)
          x0 = Math.min(x0, sx)
          x1 = Math.max(x1, sx)
          y0 = Math.min(y0, sy)
          y1 = Math.max(y1, sy)
        }
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The matrix that lays flat 2D art (x to the right, y UP, in box units) on the left face of a box (the plane y = `plane`,
 * its bottom at height `z`): the eyes and mouth of a head are drawn in this plane.
 */
export function leftFace(plane: number, z: number): string {
  const [e, f] = proj(0, plane, z)
  return `matrix(${A} ${B} 0 ${-C} ${r2(e)} ${r2(f)})`
}
