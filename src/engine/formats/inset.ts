// The inset: a small presenter window over a picture (layout `pip`). A pipeline's `presenterLayouts.inset` sets its geometry from
// what its references measure; a pip shot carries it (`Shot.inset`), so the render never guesses. Reference 2 (Marcel's own video)
// measures a 16:9 window 37.1 % of the width wide with a 6 px white border (at 1920 px), 1.1 % of the width from the left edge
// and 3.6 % of the height above the bottom, the same in all 8 of its insets.
import { z } from 'zod'

export const INSET_CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const
export type InsetCorner = (typeof INSET_CORNERS)[number]

export const Inset = z.object({
  corner: z.enum(INSET_CORNERS).default('bottom-left'),
  /** Outer width (border included) as a share of the frame's width; the window is 16:9. */
  widthFrac: z.number().min(0.1).max(0.6).default(0.371),
  /** Distance from the frame's edge: a share of the width (sideways) and of the height (up or down). */
  marginXFrac: z.number().min(0).max(0.15).default(0.011),
  marginYFrac: z.number().min(0).max(0.15).default(0.036),
  /** Width of the white border as a share of the frame's width (0: none). */
  borderFrac: z.number().min(0).max(0.02).default(0.003)
})
export type Inset = z.infer<typeof Inset>

/** Where the inset's window goes in a frame of `size` (pure): its outer box and the border's width, in pixels (all even). */
export function insetBox(inset: Inset, size: readonly [number, number]): { x: number; y: number; w: number; h: number; border: number } {
  const [W, H] = size
  const border = 2 * Math.round((W * inset.borderFrac) / 2)
  const w = 2 * Math.round((W * inset.widthFrac) / 2)
  const h = 2 * Math.round(((w - 2 * border) * 9) / 16 / 2) + 2 * border
  const mx = Math.round(W * inset.marginXFrac)
  const my = Math.round(H * inset.marginYFrac)
  return { w, h, border, x: inset.corner.endsWith('left') ? mx : W - w - mx, y: inset.corner.startsWith('top') ? my : H - h - my }
}
