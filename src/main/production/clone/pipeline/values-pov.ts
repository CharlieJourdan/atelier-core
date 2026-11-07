// Brick values of the drawn first-person channel (moteur-pov-2): what the reference holds up and how often in its opening, its
// cast's drawing, and the demo script's object pattern — each computed from measured definition fields only (pure).
import { OPENING_S, type Production, type StyleDefinition, type VideoAnalysis } from '../../../../shared/clone'
import { heldObjectsOf } from '../definition/derive'

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const said = (f: { source: string }): boolean => f.source !== 'default'

/** The things held up in first person (director.pov `held`), when measured. */
export function heldFrom(def: StyleDefinition): StyleDefinition['sourcing']['heldObjects']['value'] | undefined {
  const v = def.sourcing.heldObjects.value
  return said(def.sourcing.heldObjects) && v.length > 0 ? v.slice(0, 6) : undefined
}

/** The opening's own first-person share (director.pov `opening`), when it was measured above the whole video's. */
export function openingFrom(def: StyleDefinition): { s: number; handShare: number } | undefined {
  const o = def.sourcing.povOpeningShare
  if (!said(o) || o.value < 0.02 || o.value <= def.sourcing.povShare.value) return undefined
  return { s: OPENING_S, handShare: r3(clamp(o.value, 0, 0.9)) }
}

/** The cast's measured drawing (director.pov `figures`). */
export function figuresFrom(def: StyleDefinition): NonNullable<StyleDefinition['sourcing']['figures']['value']> | undefined {
  return said(def.sourcing.figures) && def.sourcing.figures.value ? def.sourcing.figures.value : undefined
}

/** The script's object pattern (script.write `objects`): the things, the opening's rate over its words, the body's rate. */
export function scriptObjectsFrom(def: StyleDefinition): { objects: { hold: string; detail: string; share: number }[]; openingShare: number; openingWords: number; bodyShare: number } | undefined {
  const held = heldFrom(def)
  if (!held) return undefined
  const body = def.sourcing.povShare.value
  const opening = openingFrom(def)?.handShare ?? body
  return {
    objects: held.map((h) => ({ hold: h.hold, detail: h.detail, share: h.share })),
    openingShare: r3(clamp(opening, 0, 1)),
    openingWords: Math.round((OPENING_S * clamp(def.script.wordsPerMinute.value, 60, 300)) / 60),
    bodyShare: r3(clamp(body, 0, 1))
  }
}

/**
 * A reproduced passage handles the things ITS video handles there (spec P6: our own script on the same subject and structure):
 * the script's object pattern and the drawn director's things and first-person share come from the passage's own first-person
 * shots, measured, when it has some; otherwise the recipe keeps the channel's (pure).
 */
export function withPassageObjects(recipe: unknown, a: VideoAnalysis | null, passage: Production['passage'], def: StyleDefinition): unknown {
  if (!a || !recipe || typeof recipe !== 'object' || !Array.isArray((recipe as { bricks?: unknown }).bricks)) return recipe
  const inside = a.shots.filter((s) => s.startS >= passage.fromS && s.startS < passage.toS)
  const seconds = passage.toS - passage.fromS
  const time = inside.reduce((t, s) => t + Math.min(s.lengthS, passage.toS - s.startS), 0)
  const pov = inside.filter((s) => s.pov === true).reduce((t, s) => t + Math.min(s.lengthS, passage.toS - s.startS), 0)
  if (time <= 0 || pov <= 0) return recipe
  const held = heldObjectsOf([{ ...a, shots: inside }]).objects
  if (held.length === 0) return recipe
  const share = r3(clamp(pov / time, 0, 0.9))
  const mix = shotMixOf(inside, passage.toS)
  const doc = structuredClone(recipe) as { bricks: { tech: string; settings: Record<string, unknown> }[] }
  for (const b of doc.bricks) {
    if (b.tech.startsWith('script.write')) {
      b.settings = { ...b.settings, objects: { objects: held, openingShare: share, openingWords: Math.round((seconds * clamp(def.script.wordsPerMinute.value, 60, 300)) / 60), bodyShare: share } }
    }
    if (b.tech.startsWith('director.pov')) b.settings = { ...b.settings, held, opening: { s: Math.round(seconds), handShare: share }, ...(mix ? { shares: mix } : {}) }
  }
  return doc
}

/** The shot mix of drawn shots (places, face close-ups, data cards, phone screens) measured on their descriptions, the
 *  first-person shots apart; null when nothing was read. Pure. */
export function shotMixOf(shots: readonly VideoAnalysis['shots'][number][], toS: number): { scene: number; face: number; data: number; ui: number } | null {
  const t = { scene: 0, face: 0, data: 0, ui: 0 }
  for (const s of shots) {
    if (s.pov === true) continue
    const d = Math.min(s.lengthS, toS - s.startS)
    const k = /(face|visage|expression|frown|smil|shock|wide-eyed)/i.test(s.shows) && /(character|face|visage|head)/i.test(s.shows)
      ? 'face'
      : s.origin === 'motion' || /(diagram|counter|chart|graph|schéma|compteur)/i.test(s.shows)
        ? 'data'
        : /(phone|téléphone|screen|écran)/i.test(s.shows) ? 'ui' : 'scene'
    t[k] += d
  }
  const all = t.scene + t.face + t.data + t.ui
  if (all <= 0) return null
  return { scene: r3(t.scene / all), face: r3(t.face / all), data: r3(t.data / all), ui: r3(t.ui / all) }
}
