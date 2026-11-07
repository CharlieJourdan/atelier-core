// The founder's base brick styles (decision 0021): our own text, shipped as version 1 of three builtin styles and inserted
// once into a fresh database by `BrickStyleStore.ensureBuiltins`. A style is data: the user copies and edits these into
// new versions or new styles; the shipped version 1 is never rewritten.
import { BRICK_STYLE_SCHEMA, type BrickStyle } from '../../../shared/brick-styles'

const PHONE_REAL: BrickStyle = {
  $schema: BRICK_STYLE_SCHEMA,
  id: 'phone-real',
  family: 'image',
  version: 1,
  label: 'Phone camera, real life',
  rules:
    'Illustrate exactly what the sentence says, never a loose metaphor. One clear subject per picture. Vary the shot size ' +
    'with the neighbouring pictures (never two wide shots or two close-ups in a row). Describe a recurring object, room ' +
    'or person identically every time it comes back, so it looks the same from one shot to the next. Prefer a real, ' +
    'ordinary place and a concrete action over an abstract scene. When a room reference exists, shoot in that room.',
  promptSuffix:
    'Photo taken with a phone camera: natural window light, an ordinary lived-in room, hand-held framing at eye level, ' +
    'slight lens imperfection, true-to-life colours, everyday objects. No text or captions in the picture.',
  negative: [
    'readable text or captions in the picture',
    'extra or fused fingers',
    'logos or brand names when brands are off',
    'objects that change look between shots',
    'studio lighting',
    'glossy advertising look',
    'over-saturated or heavily filtered colours'
  ],
  people: 'not-presenter',
  brands: 'real',
  references: [{ asset: 'room.reference', use: 'room-shots', note: "The presenter's own room, when the channel has one." }],
  shotGrammar: [
    { kind: 'hands doing the task', share: 0.25, note: 'Close on the hands at work, the action of the sentence.' },
    { kind: 'the room', share: 0.2, note: 'Wide or medium view that sets the place.' },
    { kind: 'the product or object, close', share: 0.25, note: 'The thing itself, filling the frame.' },
    { kind: 'the problem itself', share: 0.15, note: 'What goes wrong, shown plainly.' },
    { kind: 'wide, medium and close alternated', note: 'Size changes from one picture to the next.' }
  ]
}

const CLEAN_STOCK: BrickStyle = {
  $schema: BRICK_STYLE_SCHEMA,
  id: 'clean-stock',
  family: 'image',
  version: 1,
  label: 'Clean stock stills',
  rules:
    'Neutral, readable pictures that support the narration without drawing attention to themselves. One clear subject, ' +
    'centred or on a third, with room around it. Vary the shot size with the neighbouring pictures. Keep the same ' +
    'colour feel across the whole video.',
  promptSuffix:
    'Clean stock-style still: soft even light, uncluttered neutral background, sharp subject, natural colours. No text ' +
    'or captions in the picture.',
  negative: [
    'readable text or captions in the picture',
    'logos or brand names',
    'cluttered or busy backgrounds',
    'harsh shadows or colour casts',
    'extra or fused fingers',
    'watermarks'
  ],
  people: 'anyone',
  brands: 'none',
  shotGrammar: [
    { kind: 'subject on a plain background', share: 0.4 },
    { kind: 'context scene, wide', share: 0.3 },
    { kind: 'detail, close', share: 0.3 }
  ]
}

const PRESENTER_STUDIO: BrickStyle = {
  $schema: BRICK_STYLE_SCHEMA,
  id: 'presenter-studio',
  family: 'presenter',
  version: 1,
  label: 'Presenter portrait, studio',
  rules:
    'The same person in every angle: same face, same hair, same wardrobe. Keep the expression calm and natural, looking ' +
    'at the camera. Change only the angle or the framing between shots, never the person.',
  promptSuffix:
    'Chest-up portrait, eyes to camera, calm natural expression, soft key light, plain or softly blurred room behind, ' +
    'same face and same wardrobe as the reference.',
  negative: ['face drift between angles', 'extra teeth', 'warped hands', 'changing clothes', 'text or logos on clothing'],
  people: 'presenter-as-actor',
  references: [{ asset: 'presenter.portrait', use: 'always', note: "The channel's presenter portrait, attached to every generation." }],
  shotGrammar: [
    { kind: 'front, chest-up', share: 0.6 },
    { kind: 'three-quarter angle, chest-up', share: 0.3 },
    { kind: 'tighter on the face', share: 0.1 }
  ]
}

/**
 * The documentary's pictures (style-markets, `documentary@2`): found public-domain archives first; the stills made for what no archive
 * shows look like period photographs of that exact time and place (research note style-markets-of-the-past-2026-11 (old repository)).
 */
const ARCHIVE_REAL: BrickStyle = {
  $schema: BRICK_STYLE_SCHEMA,
  id: 'archive-real',
  family: 'image',
  version: 1,
  label: 'Period archives',
  rules:
    'Real period documents first: photographs, paintings, engravings, newspapers, maps and portraits from public archives, chosen for ' +
    'what the sentence names. A made picture only where no archive shows it, and then a period photograph of that exact time and ' +
    'place: the clothes, objects, vehicles and buildings of the date, never a modern detail.',
  promptSuffix:
    'Authentic period press photograph of the time and place the sentence names: film grain, the lens, light and tones of that era ' +
    '(black and white before the 1950s, faded colour film after), period clothes, objects and buildings, candid documentary framing. ' +
    'No text, captions or watermarks in the picture.',
  negative: ['modern objects, phones or cars in a period scene', 'readable text or captions in the picture', 'glossy digital look', 'cartoon or painting look in a photograph', 'extra or fused fingers', 'watermarks'],
  people: 'anyone',
  brands: 'none',
  shotGrammar: [
    { kind: 'the named person, their portrait', share: 0.25, note: 'A found portrait, as a print with a name label.' },
    { kind: 'the place or the event at that time', share: 0.35, note: 'A period photograph or painting, full frame with a caption.' },
    { kind: 'the document named', share: 0.15, note: 'The newspaper, letter, law or treaty, the quoted line marked in red.' },
    { kind: 'the period, its streets and crowds', share: 0.25, note: 'Archive footage or photographs of that time and place.' }
  ]
}

/** The styles shipped with the app, in the order lists show them. */
export const BASE_STYLES: readonly BrickStyle[] = [PHONE_REAL, CLEAN_STOCK, PRESENTER_STUDIO, ARCHIVE_REAL]

/** A newer version of a base style shipped later: added on top of the style, unless its owner already edited it (the note is
 *  the version's identity: one shipped update is added at most once). */
export interface ShippedUpdate {
  style: BrickStyle
  note: string
}

/** The note every shipped version starts with (version 1 is « Livré avec Atelier »). */
export const SHIPPED_NOTE = 'Livré avec Atelier'

export const SHIPPED_UPDATES: readonly ShippedUpdate[] = [
  {
    // vrais-tests (2026-11-01, research note model-benchmark-2026-11 (old repository)): « an ordinary lived-in room » moved outdoor shots indoors
    // on several engines; the suffix now names the place of the sentence, indoors or outside
    style: {
      ...PHONE_REAL,
      version: 2,
      promptSuffix:
        'Photo taken with a phone camera in the place the sentence names (indoors or outside): natural light, hand-held framing ' +
        'at eye level, slight lens imperfection, true-to-life colours, ordinary everyday objects. No text or captions in the picture.'
    },
    note: `${SHIPPED_NOTE} (vrais-tests, 01/11/2026) : le lieu de la phrase, dedans ou dehors`
  }
]
