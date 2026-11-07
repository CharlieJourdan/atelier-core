// What the "eyes" ask Gemini for: one JSON object (hook, structure, pacing, shot types, on-screen text, music, calls to
// action) described by a JSON Schema in the subset the structured-output mode supports (type, properties, required, enum,
// items, nullable through a type array), and the zod check applied to the answer.
import { AnalysisResult, CAPTION_KINDS, PICTURE_CAMERAS, PICTURE_LIGHTS, PICTURE_LOOKS, PRESENTER_LAYOUTS, SEGMENT_KINDS, TEMPOS } from '../../../src/shared/video-analysis.ts'

// The zod check of the answer lives in src/shared/video-analysis.ts (the app reads the same shape).
export { AnalysisResult }

const str = { type: 'string' }
const num = { type: 'number' }
const share = (description: string) => ({ type: 'number', description: `${description} From 0 to 1.` })

/** The editing measures « Créer une pipeline » reproduces (src/shared/video-analysis.ts StyleMeasures; style-japanese: the eyes
 *  were never asked for them, so a study read only the shot types' names). */
const MEASURES = {
  type: 'object',
  description: 'Measured over the watched part of the video, by looking at the frames and timing them.',
  properties: {
    presenterShare: share('Share of the time a presenter talks to the camera (on screen, speaking to the viewer).'),
    hookPresenterShare: share('The same share over the first 30 seconds.'),
    layouts: { type: 'array', items: { type: 'string', enum: ['full', 'split', 'inset'] }, description: 'How the talking presenter is framed.' },
    presenterActs: share('Share of the other shots in which the same presenter (same face and clothes) acts the scene instead of talking to camera.'),
    presenterRunMaxS: { type: 'number', description: 'The longest time the presenter talks to camera without a cut away, in seconds.' },
    pictures: {
      type: 'object',
      description: 'Shares of the screen time of the shots that are not the talking presenter, adding to 1.',
      properties: {
        aiImage: share('Still pictures (a slow zoom or pan at most).'),
        aiClip: share('Moving video shots, generated or filmed.'),
        stock: share('Recognisable stock footage.'),
        archive: share('Archive footage or documents.'),
        motion: share('Motion design: cards, charts, maps, product or QR cards.')
      },
      required: ['aiImage', 'aiClip', 'stock', 'archive', 'motion']
    },
    shotS: { type: 'number', description: 'Mean shot length in seconds (every cut counts).' },
    look: { type: 'string', enum: [...PICTURE_LOOKS] },
    light: { type: 'string', enum: [...PICTURE_LIGHTS], description: 'The light of most pictures: grey overcast daylight, warm sunny daylight, studio light, or a mix.' },
    camera: { type: 'string', enum: [...PICTURE_CAMERAS], description: 'The camera of most pictures: held still, hand-held, or moving (dolly, drone, tracking).' },
    captions: { type: 'string', enum: [...CAPTION_KINDS], description: 'Burnt-in captions of the narration.' },
    labelsPerMinute: { type: 'number', description: 'On-screen labels a minute (item numbers, key words), captions aside.' },
    wordsPerMinute: { type: ['number', 'null'], description: 'Narration words a minute.' },
    offer: {
      type: ['object', 'null'],
      description: 'The first mention of a product or sponsor (the channel’s own guide or book included): its second, its length, and whether a card or QR code is shown.',
      properties: { atS: num, durationS: num, card: { type: 'boolean' } },
      required: ['atS', 'durationS', 'card']
    }
  },
  required: ['presenterShare', 'layouts', 'pictures', 'shotS', 'look', 'captions', 'labelsPerMinute', 'wordsPerMinute', 'offer']
} as const

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: what the video is and why it works.' },
    hook: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What is said or shown in the opening.' },
        endsAtS: { type: 'number', description: 'Second at which the hook ends.' },
        technique: { type: 'string', description: 'The hook technique (question, promise, shock, story, countdown…).' }
      },
      required: ['text', 'endsAtS', 'technique']
    },
    structure: {
      type: 'array',
      description: 'Consecutive segments covering the video.',
      items: {
        type: 'object',
        properties: { fromS: num, toS: num, kind: { type: 'string', enum: [...SEGMENT_KINDS] }, summary: str },
        required: ['fromS', 'toS', 'kind', 'summary']
      }
    },
    pacing: {
      type: 'object',
      properties: { cutsPerMinute: num, tempo: { type: 'string', enum: [...TEMPOS] }, notes: str },
      required: ['cutsPerMinute', 'tempo', 'notes']
    },
    shotTypes: { type: 'array', items: str, description: 'The kinds of shots used (talking head, screen recording, b-roll, stock, animation…).' },
    onScreenText: {
      type: 'array',
      items: { type: 'object', properties: { atS: num, text: str }, required: ['atS', 'text'] }
    },
    music: {
      type: 'object',
      properties: { present: { type: 'boolean' }, mood: str, notes: str },
      required: ['present', 'mood', 'notes']
    },
    callsToAction: {
      type: 'array',
      items: { type: 'object', properties: { atS: num, text: str }, required: ['atS', 'text'] }
    },
    presenter: {
      type: 'array',
      description: 'Every span where a presenter (a person talking to the camera) is on screen, in order, cut to the second.',
      items: {
        type: 'object',
        properties: { fromS: num, toS: num, layout: { type: 'string', enum: [...PRESENTER_LAYOUTS] } },
        required: ['fromS', 'toS', 'layout']
      }
    },
    measures: MEASURES
  },
  required: ['summary', 'hook', 'structure', 'pacing', 'shotTypes', 'onScreenText', 'music', 'callsToAction', 'measures']
} as const

export const ANALYSIS_PROMPT =
  'Analyse this YouTube video as a production analyst would, to let someone make a similar video. Describe the hook ' +
  '(opening seconds), the structure as consecutive segments with start and end seconds, the pacing (cuts per minute, ' +
  'tempo), the kinds of shots, the text shown on screen with the second it appears, the music, and every call to action ' +
  'with its second, every span where a presenter talks to the camera (full frame, half of a split screen or a small ' +
  'inset over a picture; empty when there is none), then the editing measures (who is on screen and how long, the kinds ' +
  'of pictures, the shot length, the light and the camera, the text on screen, the pace and the first product mention). ' +
  'Measure, do not guess, the shot length and the words per minute: count the cuts in a 30-second stretch of the video, and the words ' +
  'spoken in a 30-second stretch of the narration, and scale up; shots are often shorter than they feel. ' +
  'Times are in seconds from the start of the video. Answer in the language of the video\'s own ' +
  'narration; keep every field short and factual. Return only the JSON object.'
