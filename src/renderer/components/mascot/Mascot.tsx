// An agent's mascot: a small voxel character in light isometric 3D, drawn in code (decision 0057). A cube head standing on a
// smaller body, lit from above (top lightest, right side darkest), with its face on the left side, a hat or hair in a
// deeper shade of the body colour and an accessory made of small boxes held in front of the body. SVG only (no image, no
// font, no gradient, no filter, no <style> injected), so it is crisp from 16 to 160 px, CSP-safe and the same in dark and
// light. The two body colours come from the agent colour pairs, so the old bubble colours live on in the character. The idle
// animation (a blink and a small bob) is in app.css and plays on hover only.
import { agentColors } from '@/components/atelier/primitives'
import type { AgentLook } from '../../../shared/mascot'
import { Accessory, INK } from './accessories'
import { FACES, HATS, HEAD, shadesOf } from './hats'
import { Box, Voxels, leftFace, proj, tint } from './iso'
import { resolveLook } from './roles'

/** Where the origin of the 3D space lands in the 64 x 64 picture. */
const OX = 27
const OY = 43

export interface MascotProps {
  /** An AgentRole (the proto roles); an unknown role draws the plain « custom » character. */
  role: string
  look?: AgentLook | null | undefined
  /** The agent's own colour index, used when the look sets no colour. */
  colorIndex?: number
  size?: number
  className?: string
}

export function Mascot({ role, look, colorIndex = 0, size = 32, className }: MascotProps) {
  const r = resolveLook(role, look, colorIndex)
  const [skin, body] = agentColors(r.color)
  const hat = HATS[r.hat](shadesOf(body))
  const [ax, ay] = proj(18.4, 3.6, 3)
  // a small figure shows its accessory a little larger, so it still reads
  const accessoryScale = size <= 32 ? 1.75 : 1.45
  return (
    <svg
      data-slot="mascot"
      data-role={role}
      data-accessory={r.accessory}
      className={className ? `mascot ${className}` : 'mascot'}
      width={size}
      height={size}
      viewBox="5 5 56 56"
      aria-hidden
      focusable="false"
    >
      <g transform={`translate(${OX} ${OY})`}>
        <ellipse cx={0} cy={proj(10, 10, 0)[1] + 1} rx={19} ry={7} fill="#000" opacity={0.16} />
        <g className="mascot-bob">
          {hat.behind && <Voxels parts={hat.behind} sorted={false} />}
          <Box part={[2, 3, 0, 16, 14, HEAD.z, body]} />
          <Box part={[0, 0, HEAD.z, HEAD.size, HEAD.size, HEAD.size, skin]} />
          <g transform={leftFace(HEAD.size, HEAD.z)}>
            <g className="mascot-eyes" fill={INK}>
              <rect x={3.8} y={6.8} width={4} height={5.6} rx={1} />
              <rect x={12.2} y={6.8} width={4} height={5.6} rx={1} />
            </g>
            <path d="M8 4.8 Q10 2.8 12 4.8" fill="none" stroke={INK} strokeWidth={1.1} strokeLinecap="round" />
            <rect x={1.8} y={3.2} width={3} height={1.8} rx={0.9} fill={tint(body, 0.2)} opacity={0.6} />
            <rect x={15.2} y={3.2} width={3} height={1.8} rx={0.9} fill={tint(body, 0.2)} opacity={0.6} />
            {r.face && FACES[r.face]()}
          </g>
          <Voxels parts={hat.front} sorted={false} />
          <g transform={`translate(${ax.toFixed(2)} ${ay.toFixed(2)}) scale(${accessoryScale})`}>
            <Accessory id={r.accessory} />
          </g>
        </g>
      </g>
    </svg>
  )
}
