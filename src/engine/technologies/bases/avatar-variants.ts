// The variants of « Chaîne avatar » (`avatar@2`, chantier avatar-base-marcel): Charlie's own avatar channels, each the SAME
// pipeline with its own CHARACTER, VOICE and SET, its world (language, locale, the objects its trade shows) and whatever its own
// videos measure differently from Marcel's. Nothing else is cloned again: a variant is a handful of settings over the base.
//
// Where the character, the voice and the set live at run time: the channel. Its default presenter (the portrait and its HeyGen
// look: the set is what the portrait shows behind him) and its default voice (its clone per engine) are what a run of the channel
// uses (`channelPresenterFor`, `channelVoiceFor`). A variant records what was measured on the channel's videos so the channel can
// be set up to match (the portrait to pick, the voice to clone), names the voice engine (the option « Qualité de la voix »: ai33
// while we test, the MiniMax HD clone once it is on the channel) and fixes nothing that belongs to the channel. Measured on
// 2026-11-04 from the channels' own videos (research note avatar-variants-2026-11 (old repository)); they are Charlie's own channels, so their
// real characters and voices are used.
import type { RecipeDoc } from '../recipe'
import type { PresenterLayouts } from '../../nodes/director-layouts'
import { avatarChannelBase, type AVATAR_CHANNEL_CURVE } from './avatar-channel'

export interface AvatarVariant {
  id: string
  /** The pipeline's name in the team (« Chaîne avatar — Marcel »). */
  name: string
  channel: { name: string; url: string }
  /** The language spoken and the world the pictures show (houses, equipment, brands: text/locale.ts). */
  language: string
  locale: string
  /** Who speaks to camera, as his videos show him: the portrait the channel's presenter must be. */
  character: string
  /** What the portrait shows behind him (one set in every video measured). */
  set: string
  /** The voice as his videos sound, its measured pace, and the engine it runs on (the option « Qualité de la voix »). */
  voice: { description: string; measuredWpm: number | null; quality: 'standard' | 'high' }
  /** The trade's objects drawn the way this country has them (director and pictures, `objectNotes`). */
  objectNotes: string[]
  /** What his videos measure differently from Marcel's (absent: the base's). */
  layouts?: Partial<PresenterLayouts>
  curve?: typeof AVATAR_CHANNEL_CURVE
  /** The videos measured, and what could not be read from them. */
  measuredFrom: string[]
  unread: string[]
}

/** Marcel's trade objects (marcel-complet: American condensers, dryer hoses and breaker boxes were drawn for a French house). */
const MARCEL_OBJECTS = [
  'condensate pipe/condensate drain/condensate hose/drain hose/drain pipe/tuyau condensats: a thin 16 mm flexible white PVC tube coming out under the indoor unit or through the wall, never a wide corrugated duct or a garden hose',
  'condensate pump/pompe relevage: a small white plastic box the size of a soap bar hidden in the trunking under the indoor unit, with a thin tube in and out',
  'electrical panel/breaker panel/circuit breaker/disjoncteur/tableau électrique: a French domestic panel, white plastic with rows of small white modular DIN-rail breakers and labels, never a grey American metal breaker box',
  'outdoor unit/condenser/unité extérieure: a European split air-conditioner outdoor unit, a white box with ONE round fan grille on its front, on wall brackets or feet, never an American square condenser with a top fan'
]

export const AVATAR_VARIANTS: readonly AvatarVariant[] = [
  {
    id: 'marcel',
    name: 'Chaîne avatar — Marcel',
    channel: { name: 'marcel artisan', url: 'https://www.youtube.com/@exemple-chauffage' },
    language: 'fr',
    locale: 'fr-FR',
    character: 'Marcel, a retired French heating engineer in his sixties, grey hair, navy work overalls, a pencil in the chest pocket, warm and calm',
    set: 'a boiler room: a wall-hung gas boiler, copper pipes and valves behind him, warm indoor light',
    voice: { description: 'a warm, slow French male voice of an older craftsman (his own, cloned on ai33)', measuredWpm: 190, quality: 'standard' },
    objectNotes: MARCEL_OBJECTS,
    measuredFrom: ['kGaaKgZ6KEo (reference 2, 217 shots, avatar-layouts)', 'qC9P7Sxpp08 (marcel-complet)'],
    unread: []
  },
  {
    // two videos, 399 shots: presenter 27 % / 24 % of the screen, split 78–80 % and inset 20–22 % of his time after the hook,
    // presenter LEFT in 57 of 59 splits, insets bottom left at 37 % with a white border; the full-frame hook runs to 104 s / 86 s
    // (Marcel 51 s), the first split comes after the book card (146 s / 160 s); two insets at least 57 s apart
    id: 'klaus',
    name: 'Chaîne avatar — Klaus',
    channel: { name: 'Klaus vom Kundendienst', url: 'https://www.youtube.com/@exemple-kundendienst' },
    language: 'de',
    locale: 'de-DE',
    character:
      'Klaus Brandes, a retired German home-appliance service technician (41 years of Kundendienst), about 65–70, thin lined face, short ' +
      'light-grey hair combed back, a navy quilted sleeveless vest over a grey or checked shirt, pens and a yellow pencil in the vest pocket, reading glasses hanging on the vest',
    set:
      'a bright repair workbench by a large window: grey parts-drawer cabinets and an angle lamp on the left, a black bean-to-cup ' +
      'espresso machine and a built-in stainless oven behind him, an opened induction hob with its copper coils and a multimeter on ' +
      'the bench, the window on the right onto red-brick houses, soft daylight',
    voice: { description: 'a calm, friendly German male voice of an older technician, Sie-form, unhurried', measuredWpm: 140, quality: 'standard' },
    objectNotes: [
      'oven/Backofen/built-in oven: a German built-in stainless-steel oven in a fitted kitchen (Bosch, Siemens, Neff, Miele style), never a free-standing American range',
      'socket/plug/Steckdose: a German Schuko socket, round with two round pins and side earth clips, never a US flat-pin socket',
      'fuse box/Sicherungskasten/circuit breaker: a German domestic distribution board, white plastic with rows of small modular DIN-rail breakers (Leitungsschutzschalter) and an RCD, never a grey American breaker box',
      'kitchen/Küche: a German fitted kitchen with handleless or bar-handle fronts and a built-in column oven, never an American kitchen with a range hood over a stove'
    ],
    layouts: { fromS: 146, fullUntilS: 95, insetGapS: 57 },
    measuredFrom: ['dftI6DeP0HE « Neuer Backofen? Finger weg von DIESER Marke » (14:40, 200 shots)', 'yGxpgAF-46o « Backofen geht nicht mehr? » (15:08, 199 shots)'],
    unread: ['whole-video loudness and music bed (480p video-only copies; his own audio is with the voice chantier)']
  },
  {
    // two videos, 430 shots: presenter 24 % / 25 %, split 75–86 % and inset 14–25 % of his time after the hook, presenter LEFT in
    // every split (62 of 62), insets bottom left at 37 % with a white border; the full-frame hook runs to 91 s / 79 s, the first
    // split at 139 s / 99 s; two insets at least 47 s apart. Ui58Dv91Z8E is avatar@1's « reference 1 » (the same 760.2 s file)
    id: 'aime',
    name: 'Chaîne avatar — Gaston',
    channel: { name: 'Gaston le Compagnon', url: 'https://www.youtube.com/@exemple-compagnon' },
    language: 'fr',
    locale: 'fr-FR',
    character:
      'Gaston Martin, an old French compagnon carpenter, about 70–80, deeply lined face, grey hair under a black beret, a brown suede ' +
      'sleeveless vest over a red-and-black checked shirt, a carpenter’s pencil tucked behind the ear under the beret',
    set:
      'a rustic stone-and-timber barn workshop: hand tools hanging on the wall and planks on wooden shelves behind him, an open door on ' +
      'the left onto green hills, warm daylight',
    voice: { description: 'a warm, lively French male voice of an old countryside craftsman, vous-form', measuredWpm: 175, quality: 'standard' },
    objectNotes: [
      'beam/poutre/charpente/timber frame: old French oak beams and roof timbers of a stone farmhouse or barn, hand-hewn, with pegged joints',
      'wall/mur/maçonnerie: a French stone or rendered rubble wall with lime plaster, never American drywall or vinyl siding',
      'house/maison: a French country house in stone with clay-tile roof and wooden shutters, never an American clapboard house'
    ],
    layouts: { fromS: 99, fullUntilS: 85, insetGapS: 47 },
    measuredFrom: ['kEFOcVvMx_Q « Vers du bois » (12:48, 225 shots)', 'Ui58Dv91Z8E « Moisissure qui revient » (12:40, 205 shots; avatar@1 reference 1)'],
    unread: ['whole-video loudness and music bed (480p video-only copies; his own audio is with the voice chantier)']
  }
]

export function avatarVariant(id: string): AvatarVariant | undefined {
  return AVATAR_VARIANTS.find((v) => v.id === id)
}

/** The pipeline of a variant: « Chaîne avatar » with the variant's world, voice engine and measured differences. */
export function variantDoc(v: AvatarVariant): RecipeDoc {
  const doc: RecipeDoc = { ...structuredClone(avatarChannelBase.doc), base: avatarChannelBase.id, name: v.name }
  doc.language = v.language
  doc.options = { ...doc.options, 'quality.voice': v.voice.quality }
  if (v.curve && doc.mix) doc.mix = { ...doc.mix, curve: structuredClone(v.curve) }
  for (const b of doc.bricks) {
    if (b.tech === 'director.plan@1') {
      b.settings = { ...b.settings, locale: v.locale, objectNotes: [...v.objectNotes] }
      if (v.layouts) b.settings.presenterLayouts = { ...(b.settings.presenterLayouts as PresenterLayouts), ...v.layouts }
    }
    if (b.tech === 'visuals.fulfil@1') b.settings = { ...b.settings, locale: v.locale, objectNotes: [...v.objectNotes] }
  }
  return doc
}
