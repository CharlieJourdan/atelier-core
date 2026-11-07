// The « POV » card (clone-monde-pov, research note style-monde-pov-2026-11 (old repository)): every shot of a 2D motion-design « what if » story,
// drawn by our motion engine in one flat vector look — a set (a room at dusk, a street, a showroom…) with a stick-figure cast and props,
// a close-up of a character's face whose expression changes on its words, or a data / UI card (a number that counts or strikes, a
// checklist, a ring that ticks, a row of icons, a grid that fills, a bar against a reference, a line, a phone, a browser, a paper, a
// stopwatch or gauges, a title). A card that sits on a scene draws that scene defocused behind it (`over`). Everything is code-drawn:
// no picture is made or found. Times (`atS`) are seconds from the card's start; the director turns its anchor words into them.
import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)
const at = z.number().min(0).max(120).optional()

/** The palettes measured on the channel's videos (dusk violet → orange, night blue, blue monochrome, warm day). */
export const POV_PALETTES = ['dusk', 'night', 'blue', 'day'] as const
/** The places a scene can be (each one a drawn set; a place outside the list is shown by the nearest one and a label). */
export const POV_SETS = ['room', 'bedroom', 'office', 'street', 'showroom', 'hall', 'sea', 'skyline', 'village', 'stadium', 'bank', 'space'] as const
/** The things a scene can show (drawn props, side view). */
export const POV_PROPS = [
  'car',
  'sportscar',
  'oldcar',
  'yacht',
  'plane',
  'rocket',
  'desk',
  'bills',
  'bed',
  'house',
  'tree',
  'palm',
  'tower',
  'safe',
  'gold',
  'bag',
  'lamp'
] as const
/** What a first-person hand can hold up (formats `hand`). */
export const POV_HELD = ['ticket', 'phone', 'card', 'paper', 'note', 'bill'] as const
/** What is drawn on a held thing (moteur-pov-2, measured on the reference's close-ups): its numbers (a ticket's grid), a results
 *  screen (numbers drawn and a match), an incoming call, notifications, a price or amount, or only its words. */
export const POV_HELD_DETAILS = ['numbers', 'results', 'call', 'message', 'price', 'plain'] as const
export type PovHeldDetail = (typeof POV_HELD_DETAILS)[number]
/** A thing the reference holds up in first person, with what is on it and its share of the first-person screen time. */
export const PovHeld = z.object({ hold: z.enum(POV_HELD), detail: z.enum(POV_HELD_DETAILS).default('plain'), share: z.number().min(0).max(1).default(0) })
export type PovHeld = z.infer<typeof PovHeld>
export const POV_COLORS = ['hero', 'red', 'purple', 'green', 'blue', 'pink', 'grey', 'yellow'] as const
export const POV_POSES = ['stand', 'walk', 'arm-up', 'phone', 'sit', 'type', 'point', 'sleep', 'cheer'] as const
export const POV_HAIR = ['none', 'curly', 'bun', 'spiky', 'cap', 'long'] as const
export const POV_EXPRESSIONS = ['neutral', 'smile', 'laugh', 'worried', 'shock', 'angry', 'determined', 'sad', 'sly', 'tired'] as const
export type PovPalette = (typeof POV_PALETTES)[number]
export type PovSet = (typeof POV_SETS)[number]
export type PovProp = (typeof POV_PROPS)[number]
export type PovColor = (typeof POV_COLORS)[number]
export type PovPose = (typeof POV_POSES)[number]
export type PovHair = (typeof POV_HAIR)[number]
export type PovExpression = (typeof POV_EXPRESSIONS)[number]

export const PovPerson = z.object({
  color: z.enum(POV_COLORS).default('hero'),
  pose: z.enum(POV_POSES).default('stand'),
  /** Where the figure stands, 0 (left) … 1 (right) of the frame. */
  x: z.number().min(0).max(1).default(0.5),
  hair: z.enum(POV_HAIR).default('none'),
  /** A walking figure crosses this far (fraction of the width, signed: + to the right) over the shot. */
  walk: z.number().min(-0.6).max(0.6).optional()
})
export type PovPerson = z.infer<typeof PovPerson>

export const PovPropItem = z.object({
  kind: z.enum(POV_PROPS),
  x: z.number().min(0).max(1).default(0.5),
  scale: z.number().min(0.4).max(2.5).default(1),
  /** Its main colour (a car's paint), else the prop's own. */
  color: z.enum(POV_COLORS).optional(),
  label: text(28).optional(),
  /** When it pops in (else it is there from the start). */
  atS: at,
  /** A vehicle that drives off this far (fraction of the width, signed). */
  drive: z.number().min(-1).max(1).optional()
})
export type PovPropItem = z.infer<typeof PovPropItem>

/** A small tag on a scene (« EMBAUCHÉE IL Y A 1 H », « 100 PERSONNES », « +1 000 000 000 000 $ »). */
const Tag = z.object({ text: text(40), atS: at })
/** A scene shown defocused behind a card. */
const Behind = z.enum(POV_SETS).optional()
const Kicker = text(48).optional()

export const PovShot = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scene'),
    set: z.enum(POV_SETS),
    /** The sign of a shop or a showroom (« PRESTIGE AUTO »). */
    sign: text(28).optional(),
    cast: z.array(PovPerson).max(6).default([]),
    props: z.array(PovPropItem).max(8).default([]),
    /** A crowd of small figures at the back (how many). */
    crowd: z.number().int().min(0).max(80).default(0),
    tag: Tag.optional(),
    camera: z.enum(['still', 'push', 'left', 'right']).default('still'),
    /** The place defocused behind sharp props and labels (the reference names the cars bought on its blurred showroom). */
    soft: z.boolean().default(false),
    /** Bills or confetti falling over the scene. */
    rain: z.enum(['none', 'bills', 'confetti']).default('none')
  }),
  z.object({
    kind: z.literal('face'),
    color: z.enum(POV_COLORS).default('hero'),
    hair: z.enum(POV_HAIR).default('none'),
    /** The expressions in order, each from its time (the first from 0). */
    moods: z.array(z.object({ expression: z.enum(POV_EXPRESSIONS), atS: at })).min(1).max(4),
    over: Behind
  }),
  z.object({
    kind: z.literal('title'),
    kicker: Kicker,
    lines: z.array(text(28)).min(1).max(2),
    set: z.enum(POV_SETS).default('skyline'),
    confetti: z.boolean().default(true)
  }),
  z.object({
    kind: z.literal('number'),
    /** `count`: each step counts from the previous value; `stack`: each new value lands bigger under the struck old ones; `down`: a counter going down. */
    mode: z.enum(['count', 'stack', 'down']).default('count'),
    steps: z
      .array(z.object({ value: z.number().optional(), text: text(32).optional(), atS: at }).refine((s) => s.value !== undefined || s.text !== undefined, 'a step needs a value or a text'))
      .min(1)
      .max(5),
    /** Written after the number (« $ », « € », « M$ »). */
    unit: z.string().trim().max(8).optional(),
    kicker: Kicker,
    sub: text(48).optional(),
    /** A red line under the number (« CHAQUE CENTIME », « 0,001 % DÉPENSÉ »). */
    note: text(40).optional(),
    /** A thin progress bar under it, filled this far. */
    bar: z.number().min(0).max(1).optional(),
    confetti: z.boolean().default(false),
    over: Behind
  }),
  z.object({
    kind: z.literal('list'),
    style: z.enum(['check', 'pill']).default('check'),
    title: Kicker,
    items: z.array(z.object({ text: text(36), atS: at })).min(1).max(6),
    over: Behind
  }),
  z.object({
    kind: z.literal('ring'),
    /** The big text in the ring (« 08:00 », « 11,6 M$ »); a countdown writes its own. */
    center: text(16).optional(),
    /** A countdown from this many seconds, one tick a second (24 h = 86400 → « 24:00:00 »). */
    countdownS: z.number().int().min(1).max(359999).optional(),
    sub: text(24).optional(),
    caption: text(40).optional(),
    note: text(40).optional(),
    confetti: z.boolean().default(false)
  }),
  z.object({
    kind: z.literal('icons'),
    title: Kicker,
    items: z.array(z.object({ icon: text(32), label: text(24), atS: at })).min(1).max(5),
    /** A chain: each item in a dark rounded box with a thin gold outline, joined by arrows (« TOI → UNE PERSONNE »). */
    chain: z.boolean().default(false)
  }),
  z.object({
    kind: z.literal('grid'),
    icon: text(32),
    total: z.number().int().min(4).max(80),
    /** How many icons light up a second. */
    perSecond: z.number().min(0.5).max(20).default(5),
    title: Kicker,
    note: text(40).optional()
  }),
  z.object({
    kind: z.literal('compare'),
    /** The bar that grows (« BILLETS DE 100 $ ») against a reference shape (« EVEREST »). */
    label: text(28),
    ref: text(28),
    shape: z.enum(['mountain', 'tower', 'bar']).default('mountain'),
    /** How many times the reference the bar ends (the multiplier counts up to it). */
    times: z.number().min(1).max(100000)
  }),
  z.object({
    kind: z.literal('chart'),
    title: Kicker,
    trend: z.enum(['up', 'down', 'up-late']).default('up'),
    tone: z.enum(['green', 'red', 'gold']).default('green'),
    label: text(28).optional()
  }),
  z.object({
    kind: z.literal('phone'),
    app: text(24),
    lines: z.array(z.object({ text: text(32), atS: at, tone: z.enum(['small', 'big', 'red', 'green']).default('small') })).max(4).default([]),
    /** An incoming call (a name and a role) with its red and green buttons. */
    call: z.object({ name: text(20), role: text(28).optional() }).optional(),
    /** The screen cracks at this time. */
    crackAtS: at,
    over: Behind
  }),
  z.object({
    kind: z.literal('browser'),
    title: text(48),
    field: text(32).optional(),
    status: z.object({ text: text(28), tone: z.enum(['ok', 'refused']), atS: at }).optional(),
    over: Behind
  }),
  z.object({
    kind: z.literal('paper'),
    title: text(28),
    sub: text(36).optional(),
    value: text(24).optional(),
    stamp: z.object({ text: text(16), atS: at }).optional(),
    over: Behind
  }),
  z.object({
    /** First person (moteur-briques): the viewer's own arm comes in from a lower corner and holds a thing up over the defocused
     *  place — a ticket, a phone, a bank card, a paper, a note, a bill — with its few words on it. */
    kind: z.literal('hand'),
    hold: z.enum(POV_HELD),
    /** The thing's heading (« EUROMILLIONS », « MA BANQUE »). */
    title: text(28).optional(),
    lines: z.array(z.object({ text: text(32), atS: at, tone: z.enum(['small', 'big', 'red', 'green']).default('small') })).max(4).default([]),
    /** What is drawn on it besides its words (moteur-pov-2): a ticket's grid, a results screen, a call, notifications, a price. */
    detail: z.enum(POV_HELD_DETAILS).default('plain'),
    /** The numbers on a ticket or a results screen (drawn in circles, the last two as stars); absent: seeded ones. */
    balls: z.array(z.number().int().min(0).max(99)).max(7).optional(),
    /** A second thing lying beside the held one (the reference's ticket by a phone), with what is on it. */
    beside: z.enum(POV_HELD).optional(),
    besideDetail: z.enum(POV_HELD_DETAILS).optional(),
    /** The sleeve's colour (the narrator's own, the same in every hand shot). */
    color: z.enum(POV_COLORS).default('hero'),
    side: z.enum(['right', 'left']).default('right'),
    over: z.enum(POV_SETS).default('room')
  }),
  z.object({
    kind: z.literal('dial'),
    /** A stopwatch whose red hand ticks, two dashboard gauges with a blinking warning, or a wall clock. */
    look: z.enum(['stopwatch', 'gauges', 'clock']),
    caption: text(40).optional(),
    warning: text(20).optional(),
    bills: z.boolean().default(false)
  })
])
export type PovShot = z.infer<typeof PovShot>
export type PovKind = PovShot['kind']
export const POV_KINDS = ['scene', 'face', 'title', 'number', 'list', 'ring', 'icons', 'grid', 'compare', 'chart', 'phone', 'browser', 'paper', 'dial', 'hand'] as const
/** How the drawn places are shot (moteur-briques): `flat` vector, or `deep` — the place behind defocused, a vignette and a fine grain. */
export const POV_DEPTHS = ['flat', 'deep'] as const
/** The cards' type, measured on the reference (moteur-briques): the face, capitals, the accent of titles and a rule under them. */
export const PovType = z.object({
  face: z.enum(['geometric', 'sans', 'condensed', 'serif', 'serif-italic']).default('geometric'),
  upper: z.boolean().default(true),
  titleRule: z.boolean().default(false),
  /** The titles' colour (a measured accent, « titre bleu »); absent: the palette's gold. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
})
export type PovType = z.infer<typeof PovType>
/** How the cast is drawn, measured on the reference (moteur-pov-2): `silhouette` = thin all-black bodies (only the coloured ones
 *  wear a colour), `clothed` = a coloured hoodie on everyone; a light `rim` outline; `expressive` faces (a mouth, eyes that react)
 *  or eyes only; `hero` = only the narrator wears a colour, `all` = everyone does. */
export const PovFigures = z.object({
  body: z.enum(['silhouette', 'clothed']).default('clothed'),
  rim: z.boolean().default(false),
  faces: z.enum(['expressive', 'eyes']).default('eyes'),
  colour: z.enum(['hero', 'all']).default('all')
})
export type PovFigures = z.infer<typeof PovFigures>

export const PovCardProps = z.object({
  palette: z.enum(POV_PALETTES).default('dusk'),
  shot: PovShot,
  depth: z.enum(POV_DEPTHS).default('flat'),
  type: PovType.optional(),
  figures: PovFigures.optional(),
  /** A seed for the drawn details (windows, stars, crowd): the same shot always looks the same. */
  seed: z.string().max(40).default('pov')
})
export type PovCardProps = z.infer<typeof PovCardProps>

/** Every timed part of a POV card (for the « comes too late » check). */
export function povTimes(s: PovShot): { what: string; atS: number | undefined }[] {
  switch (s.kind) {
    case 'scene':
      return [...s.props.map((p, i) => ({ what: `prop ${i + 1}`, atS: p.atS })), { what: 'tag', atS: s.tag?.atS }]
    case 'face':
      return s.moods.map((m, i) => ({ what: `mood ${i + 1}`, atS: m.atS }))
    case 'number':
      return s.steps.map((x, i) => ({ what: `step ${i + 1}`, atS: x.atS }))
    case 'list':
    case 'icons':
      return s.items.map((x, i) => ({ what: `item ${i + 1}`, atS: x.atS }))
    case 'phone':
      return [...s.lines.map((x, i) => ({ what: `line ${i + 1}`, atS: x.atS })), { what: 'crack', atS: s.crackAtS }]
    case 'browser':
      return [{ what: 'status', atS: s.status?.atS }]
    case 'paper':
      return [{ what: 'stamp', atS: s.stamp?.atS }]
    case 'hand':
      return s.lines.map((x, i) => ({ what: `line ${i + 1}`, atS: x.atS }))
    default:
      return []
  }
}
