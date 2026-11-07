// What each role looks like: the hat or hair, an optional face piece and the held accessory a new agent of the role
// starts with. The Record is exhaustive on purpose: a role added to AgentRole does not compile until it has a character.
// Atlas (the main agent) is the base character: plain hair, a compass, nothing else.
import { COMMON_ACCESSORIES, MASCOT_COLOR_COUNT, type AccessoryId, type AgentLook } from '../../../shared/mascot'
import type { AgentRole } from '@/proto/types'

export type HatId = 'hair' | 'tuft' | 'bun' | 'beret' | 'cap' | 'hardhat' | 'headphones' | 'eyeshade' | 'beanie'
export type FaceId = 'glasses' | 'monocle'

export interface RoleLook {
  hat: HatId
  face?: FaceId
  accessory: AccessoryId
}

export const ROLE_LOOK: Record<AgentRole, RoleLook> = {
  principal: { hat: 'hair', accessory: 'compass' },
  'channel-manager': { hat: 'tuft', accessory: 'flag' },
  researcher: { hat: 'hair', face: 'glasses', accessory: 'bulb' },
  scriptwriter: { hat: 'beret', accessory: 'quill' },
  director: { hat: 'cap', accessory: 'megaphone' },
  packaging: { hat: 'beanie', accessory: 'palette' },
  'production-supervisor': { hat: 'hardhat', accessory: 'stopwatch' },
  editor: { hat: 'eyeshade', accessory: 'clapper' },
  'competitor-analyst': { hat: 'bun', accessory: 'binoculars' },
  voice: { hat: 'headphones', accessory: 'mic' },
  'qc-eye': { hat: 'hair', face: 'monocle', accessory: 'checklist' },
  publisher: { hat: 'tuft', accessory: 'plane' },
  'pipeline-architect': { hat: 'hair', face: 'glasses', accessory: 'set-square' },
  'sponsor-manager': { hat: 'bun', accessory: 'tag' },
  custom: { hat: 'hair', accessory: 'gear' }
}

export interface ResolvedLook extends RoleLook {
  /** Index into the agent colour pairs. */
  color: number
}

/** The role's character with the owner's choices on top; the colour falls back to the agent's own colour index. */
export function resolveLook(role: AgentRole | string, look: AgentLook | null | undefined, colorIndex = 0): ResolvedLook {
  const base = ROLE_LOOK[role as AgentRole] ?? ROLE_LOOK.custom
  const color = look?.color ?? colorIndex
  return { ...base, accessory: look?.accessory ?? base.accessory, color: ((color % MASCOT_COLOR_COUNT) + MASCOT_COLOR_COUNT) % MASCOT_COLOR_COUNT }
}

/**
 * The look to store after the owner picks a colour or an accessory. A choice equal to the default is dropped, so the
 * character keeps following its role (and its own colour); nothing left means null.
 */
export function nextLook(role: AgentRole | string, look: AgentLook | null | undefined, colorIndex: number, patch: AgentLook): AgentLook | null {
  const own = (ROLE_LOOK[role as AgentRole] ?? ROLE_LOOK.custom).accessory
  const next: AgentLook = { ...look, ...patch }
  if (next.color !== undefined && next.color === ((colorIndex % MASCOT_COLOR_COUNT) + MASCOT_COLOR_COUNT) % MASCOT_COLOR_COUNT) delete next.color
  if (next.accessory === own) delete next.accessory
  return Object.keys(next).length ? next : null
}

/** The short list the editor offers an agent of this role: its own accessory first, the common ones, then empty hands. */
export function accessoryChoices(role: AgentRole | string): AccessoryId[] {
  const own = (ROLE_LOOK[role as AgentRole] ?? ROLE_LOOK.custom).accessory
  return [...new Set<AccessoryId>([own, ...COMMON_ACCESSORIES, 'none'])]
}
