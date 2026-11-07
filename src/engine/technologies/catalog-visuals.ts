// The pictures bricks of the Éléments stage (production-model §2.5, decision 0035): `visuals.fulfil` makes the stills (found
// or generated with the pipeline's image engine and the brick's style) and, without a clip brick, the old text-to-video clips;
// `clip.make` makes the clips FROM those stills with the clip engine, one or two shots per generation. Both take their engine
// and fallbacks from the pin (`pinParams`) and their style's look from the compiler (`styleParams`).
import { z } from 'zod'
import { STYLE_BRANDS, STYLE_PEOPLE } from '../../shared/brick-styles'
import { Look, lookOf } from '../nodes/visuals-look'
import { Locale, ObjectNotes } from '../text/locale'
import { defineTechnology } from './types'

export const visualsFulfil = defineTechnology({
  id: 'visuals.fulfil@1',
  labelKey: 'tech.visuals.fulfil',
  stage: 'elements',
  kind: 'visuals',
  engineFamily: 'image',
  styleFamily: 'image',
  nodes: [{ id: 'visuals', type: 'visuals.fulfil@1', in: { list: '@genlist', voice: '@voice' } }],
  provides: { images: 'visuals.images', clips: 'visuals.clips' },
  params: z.object({
    parallel: z.number().int().min(1).max(10).default(8),
    /** Options « Qui apparaît » and « Marques » (they win over the style's). */
    people: z.enum(STYLE_PEOPLE).optional(),
    brands: z.enum(STYLE_BRANDS).optional(),
    /** The channel's presenter portrait and room picture (local files), for `presenter-as-actor` and a style shooting in the room. */
    presenterPortrait: z.string().min(1).max(1000).optional(),
    roomImage: z.string().min(1).max(1000).optional(),
    /** The eyes check every generated still (when the host has them). */
    vision: z.boolean().optional(),
    // the pipeline's measured requirements (record 0055): unset, no such check
    /** The illustration check's bar (0–10): a still under it is rewritten and made again once. */
    illustrationBar: z.number().min(0).max(10).optional(),
    /** Two stills alike within this many seconds: the later made again once with another framing. */
    alikeWindowS: z.number().min(0).max(120).optional(),
    /** Archive items searched in the public archives first (Wikimedia Commons, Internet Archive, NASA, the Met), free, a licence each. */
    archives: z.boolean().optional(),
    /** documentary-2: `look` = archive films and photographs chosen by Claude looking at contact sheets (films cut at the moments it picks). */
    archivePick: z.enum(['first', 'look']).optional(),
    /** Where the video's world is (`fr-FR`) and object-accuracy notes: every picture prompt carries them (text/locale.ts). */
    locale: Locale.optional(),
    objectNotes: ObjectNotes.optional(),
    /** A cloned channel's measured look of its generated pictures (moteur-briques): every generated picture carries it. */
    look: Look.optional(),
    /** A demo's stand-ins (decision 0109): `found` free stock photographs instead of drawn slides (the free style gate sets it). */
    standIns: z.enum(['drawn', 'found']).optional()
  }),
  overridable: {
    recipe: ['parallel', 'people', 'brands', 'vision', 'illustrationBar', 'alikeWindowS', 'archives', 'archivePick', 'locale', 'objectNotes', 'look', 'standIns'],
    channel: ['people', 'brands', 'presenterPortrait', 'roomImage', 'vision', 'illustrationBar', 'alikeWindowS', 'archives', 'locale', 'objectNotes']
  },
  nodeParams: (p) => ({
    visuals: {
      parallel: p.parallel,
      ...(p.people !== undefined ? { people: p.people } : {}),
      ...(p.brands !== undefined ? { brands: p.brands } : {}),
      ...(p.presenterPortrait !== undefined || p.roomImage !== undefined
        ? { references: { ...(p.presenterPortrait !== undefined ? { presenter: p.presenterPortrait } : {}), ...(p.roomImage !== undefined ? { room: p.roomImage } : {}) } }
        : {}),
      ...(p.vision !== undefined ? { vision: p.vision } : {}),
      ...(p.illustrationBar !== undefined ? { illustrationBar: p.illustrationBar } : {}),
      ...(p.alikeWindowS !== undefined ? { alikeWindowS: p.alikeWindowS } : {}),
      ...(p.archives !== undefined ? { archives: p.archives } : {}),
      ...(p.archivePick !== undefined ? { archivePick: p.archivePick } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      ...(p.objectNotes !== undefined ? { objectNotes: p.objectNotes } : {}),
      ...(p.look !== undefined ? { look: p.look } : {}),
      ...(p.standIns !== undefined ? { standIns: p.standIns } : {})
    }
  }),
  pinParams: (pin) => ({ visuals: { engine: pin.engine, fallbacks: [...pin.fallbacks] } }),
  styleParams: (style) => ({ visuals: { look: lookOf(style) } }),
  cloudUsages: ['searchStock', 'generateImage', 'generateVideo'],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** The share of a clip brick's generated-video shots served two by two (its `pairShare`, else all of them with 2 shots per generation). */
export const pairShareOf = (p: { shotsPerGeneration?: number | undefined; pairShare?: number | undefined }): number =>
  p.pairShare ?? (p.shotsPerGeneration === 2 ? 1 : 0)

/** Clips made from the stills (image to video), per item with the clip engine's fallbacks; eco shares one generation between two shots. */
export const clipMake = defineTechnology({
  id: 'clip.make@1',
  labelKey: 'tech.clip.make',
  stage: 'elements',
  kind: 'visuals',
  engineFamily: 'clip',
  styleFamily: 'clip',
  nodes: [{ id: 'clips', type: 'clip.make@1', in: { list: '@genlist', images: '@images' } }],
  provides: { clips: 'clips.clips' },
  params: z.object({
    /** Shots one generation serves: 2 = wide then a tight crop of one clip (option « Qualité des clips » éco). */
    shotsPerGeneration: z.union([z.literal(1), z.literal(2)]).default(1),
    /** The share of the generated-video shots served two by two (0.5: half the clips give two shots, production-10); unset: all
     *  of them with `shotsPerGeneration` 2, none with 1. */
    pairShare: z.number().min(0).max(1).optional(),
    /** Minutes one engine may take for one clip before the next engine takes it. */
    timeoutMin: z.number().min(1).max(60).default(15),
    parallel: z.number().int().min(1).max(8).default(8),
    vision: z.boolean().optional(),
    /** « Motion only where it is seen » (vrais-tests, option « Clips seulement où ça bouge »): the director turns a clip shot whose
     *  scene shows nothing moving (a place, an object) into a still with a camera move. */
    motionOnly: z.boolean().default(false),
    /** Two shots share one generation only on one continuous action (never across a subject change). */
    pairSameAction: z.boolean().default(false),
    /** Short single shots (≤ `shortMaxS`) on this per-second engine first, at their exact length (option « Plans courts »); `none`: off. */
    shortEngine: z.union([z.string().regex(/^clip:[a-z0-9][a-z0-9.-]{0,60}$/), z.literal('none')]).default('none'),
    shortMaxS: z.number().min(1).max(6).default(3),
    /** The motion line of every clip when the style gives none (the pipeline's camera, record 0055). */
    clipMotion: z.string().min(1).max(400).optional(),
    /** A demo's stand-ins (decision 0109): `found` draws no clip (the found still takes the shot's move). */
    standIns: z.enum(['drawn', 'found']).optional()
  }),
  overridable: {
    recipe: ['shotsPerGeneration', 'pairShare', 'timeoutMin', 'parallel', 'vision', 'motionOnly', 'pairSameAction', 'shortEngine', 'shortMaxS', 'clipMotion', 'standIns'],
    channel: ['shotsPerGeneration', 'pairShare', 'vision', 'motionOnly', 'shortEngine', 'clipMotion']
  },
  nodeParams: (p) => ({
    clips: {
      parallel: p.parallel,
      timeoutS: p.timeoutMin * 60,
      ...(p.vision !== undefined ? { vision: p.vision } : {}),
      ...(p.shortEngine !== 'none' ? { shortEngine: p.shortEngine, shortMaxS: p.shortMaxS } : {}),
      ...(p.clipMotion !== undefined ? { motion: p.clipMotion } : {}),
      ...(p.standIns !== undefined ? { standIns: p.standIns } : {})
    }
  }),
  // the stills brick makes only the start still of a generated-video item; the director pairs the shots in eco
  contributes: (p) => ({
    images: { params: { stillsOnly: true } },
    ...(pairShareOf(p) > 0 || p.motionOnly || p.shortEngine !== 'none'
      ? {
          genlist: {
            params: {
              ...(pairShareOf(p) > 0 ? { clipShotsPerGeneration: 2, ...(pairShareOf(p) < 1 ? { clipPairShare: pairShareOf(p) } : {}), ...(p.pairSameAction ? { clipPairSameAction: true } : {}) } : {}),
              ...(p.motionOnly ? { clipMotionOnly: true } : {}),
              ...(p.shortEngine !== 'none' ? { clipShortEngine: true } : {})
            }
          }
        }
      : {})
  }),
  pinParams: (pin) => ({ clips: { engine: pin.engine, fallbacks: [...pin.fallbacks] } }),
  styleParams: (style) => ({ clips: { look: lookOf(style) } }),
  cloudUsages: ['generateVideo'],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})
