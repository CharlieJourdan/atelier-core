// The look of an agent's mascot (decision 0057): a small square character drawn in code. An agent's look is light on
// purpose, a colour and one held accessory, and both are optional: nothing stored means « the defaults of its role »
// (the role table lives with the drawing, renderer/components/mascot). This module is what the main process and the
// renderer share: the ids, the short list the editor offers, and the check applied to a look before it is stored.

/** Held accessories, in the order the editor lists them after the role's own. `none` shows empty hands. */
export const ACCESSORY_IDS = [
  'compass',
  'flag',
  'bulb',
  'quill',
  'megaphone',
  'palette',
  'stopwatch',
  'clapper',
  'binoculars',
  'magnifier',
  'checklist',
  'mic',
  'plane',
  'set-square',
  'tag',
  'gear',
  'star',
  'none'
] as const
export type AccessoryId = (typeof ACCESSORY_IDS)[number]

/** The 8 body colours are the agent colour pairs (components/atelier/primitives AGENT_COLORS). */
export const MASCOT_COLOR_COUNT = 8

/** What an agent stores. Absent fields follow the role (accessory) or the agent's own colour index (colour). */
export interface AgentLook {
  color?: number
  accessory?: AccessoryId
}

/** The short list the editor offers besides the role's own accessory (and « none »). */
export const COMMON_ACCESSORIES: readonly AccessoryId[] = ['quill', 'magnifier', 'mic', 'clapper', 'checklist', 'set-square', 'bulb', 'compass']

export function isAccessory(v: unknown): v is AccessoryId {
  return typeof v === 'string' && (ACCESSORY_IDS as readonly string[]).includes(v)
}

/**
 * Checks a look typed on the sheet or sent over IPC and returns it without anything unknown. An empty look comes back
 * as null (« follow the role »).
 */
export function checkLook(v: unknown): AgentLook | null {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Apparence invalide : un objet est attendu.')
  const src = v as Record<string, unknown>
  const out: AgentLook = {}
  if (src.color !== undefined) {
    if (typeof src.color !== 'number' || !Number.isInteger(src.color) || src.color < 0 || src.color >= MASCOT_COLOR_COUNT) {
      throw new Error(`Une couleur d’apparence est un entier de 0 à ${MASCOT_COLOR_COUNT - 1}.`)
    }
    out.color = src.color
  }
  if (src.accessory !== undefined) {
    if (!isAccessory(src.accessory)) throw new Error(`Unknown accessory: ${String(src.accessory)}`)
    out.accessory = src.accessory
  }
  return Object.keys(out).length ? out : null
}

/** Reads a stored look back (a damaged value is ignored, never thrown). */
export function parseLook(raw: string | null): AgentLook | null {
  if (raw === null) return null
  try {
    return checkLook(JSON.parse(raw))
  } catch {
    return null
  }
}
