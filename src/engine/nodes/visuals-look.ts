// The « carrosserie » applied to one picture (production-model §4, decision 0035): the director says WHAT to show (shot size,
// scene, recurring objects); the brick's style says HOW it looks (prompt suffix, negatives, people and brand rules, which
// references ride along). The same item under two styles gives two prompts and the same engine call shape. People rules
// are enforced by code whatever the scene pass wrote: `nobody` removes every person from the prompt (objects only, not even
// hands), `not-presenter` never names the presenter, `presenter-as-actor` attaches the presenter's portrait to the shots
// that show a person. Pure.
import { z } from 'zod'
import { REFERENCE_USES, STYLE_BRANDS, STYLE_PEOPLE, type BrickStyle } from '../../shared/brick-styles'
import type { GenItem } from '../formats/editplan'
import { cultureLine, notesFor } from '../text/locale'

/** What a node keeps of a brick style (the part a generation reads), as node params: part of the fingerprint. */
export const Look = z.object({
  /** `phone-real@3`: written in the records, never sent. */
  style: z.string().max(60).optional(),
  suffix: z.string().min(1).max(1000).optional(),
  negative: z.array(z.string().min(1).max(200)).max(40).optional(),
  people: z.enum(STYLE_PEOPLE).optional(),
  brands: z.enum(STYLE_BRANDS).optional(),
  /** The reference uses the style declares (`room-shots`: the room rides on shots of the room). */
  references: z.array(z.enum(REFERENCE_USES)).max(4).optional(),
  /** A clip style's motion line (clip family): how things move. */
  motion: z.string().min(1).max(400).optional()
})
export type Look = z.infer<typeof Look>

/** The look of a brick style at its exact version. */
export function lookOf(style: BrickStyle, version?: number): Look {
  const uses = [...new Set((style.references ?? []).map((r) => r.use))]
  return {
    style: `${style.id}@${version ?? style.version}`,
    ...(style.promptSuffix ? { suffix: style.promptSuffix } : {}),
    ...(style.negative?.length ? { negative: [...style.negative] } : {}),
    ...(style.people ? { people: style.people } : {}),
    ...(style.brands ? { brands: style.brands } : {}),
    ...(uses.length > 0 ? { references: uses } : {}),
    // a clip style says how things move in its rules (the first sentence), until clip styles get a field of their own
    ...(style.family === 'clip' && style.rules ? { motion: (style.rules.split(/(?<=\.)\s/)[0] as string).slice(0, 400) } : {})
  }
}

type People = (typeof STYLE_PEOPLE)[number]

/** Words that put a person (or a part of one) in a picture. */
const PERSON =
  /\b(?:the\s+)?(?:presenter|person|people|persons|man|men|woman|women|child|children|kid|kids|boy|boys|girl|girls|baby|babies|toddler|teen|teenager|adult|adults|senior|elderly|grandmother|grandfather|grandma|grandpa|mother|father|mum|mom|dad|parent|parents|family|friend|friends|neighbour|neighbor|customer|customers|worker|workers|chef|cook|cooks|cleaner|gardener|plumber|doctor|nurse|someone|somebody|anyone|everyone|he|she|him|her|his|hers|they|them|their|guy|lady|ladies|gentleman|hand|hands|finger|fingers|fingertip|fingertips|arm|arms|face|faces|feet|foot|leg|legs|head|silhouette|portrait|crowd|couple|user|owner|homeowner|housewife|husband|wife|grandparent|grandparents|human|humans|student|students|teacher|teachers|farmer|farmers|baker|bakers|mechanic|mechanics|driver|drivers|tourist|tourists|shopper|shoppers|pedestrian|pedestrians|player|players|staff|employee|employees|audience|passenger|passengers|patient|patients|guest|guests|visitor|visitors|waiter|waitress|cashier|seller|buyer|boss|athlete|body|bodies|eyes|lips|mouth|thumb|thumbs|palm|palms|shoulder|shoulders|knee|knees|wrist|wrists|elbow|elbows)(?:'s|’s)?\b(?!-(?:held|free|made|sized|crafted|picked|drawn|written|painted|operated))/i
export const mentionsPerson = (text: string): boolean => PERSON.test(text)

const PRESENTER = /\b(?:the\s+)?presenter(?:'s|’s)?\b/gi
const ROOMISH = /\b(?:room|kitchen|bathroom|bedroom|living room|lounge|garage|office|hallway|hall|interior|cellar|attic|laundry|workshop|pantry|dining room)\b/i

/** The clauses of a text that show no person. */
const clausesWithoutPeople = (text: string): string =>
  text
    .split(/\s*[,;]\s*/)
    .filter((c) => c.trim().length > 0 && !mentionsPerson(c))
    .join(', ')

/** The clauses of a prompt that show no person (a whole prompt about a person leaves its subject's key terms). */
function withoutPeople(scene: string, item: GenItem): string {
  const kept = clausesWithoutPeople(scene)
  if (kept.trim().length > 0) return kept
  const terms = item.context.keyTerms.filter((t) => !mentionsPerson(t))
  return terms.length > 0 ? terms.slice(0, 4).join(', ') : 'the everyday objects of the scene'
}

export interface Composed {
  prompt: string
  /** What must never appear, one line (sent in the engine's negative field, or as « Avoid: … »). */
  negative: string | undefined
  /** The presenter's portrait rides along (`presenter-as-actor` on a shot that shows a person). */
  presenter: boolean
  /** The room's reference rides along (a style that shoots in the channel's room, on a shot of the room). */
  room: boolean
}

/** The negatives every generated picture carries when its style says nothing (§23: no text in the image). */
const DEFAULT_NEGATIVE = ['readable text, letters or numbers', 'watermark']

/**
 * The prompt of one picture under a look. `people` / `brands`: the brick's settings (options « Qui apparaît », « Marques »),
 * which win over the style's. Without a look, settings or the director's parts, the director's prompt stays as it is (the
 * pipelines made before production-8 keep their pictures).
 */
export function composePicture(item: GenItem, look: Look | undefined, o: { people?: People | undefined; brands?: 'real' | 'none' | undefined; aspect: '16:9' | '9:16'; locale?: string | undefined; notes?: readonly string[] | undefined }): Composed {
  const people = o.people ?? look?.people
  const brands = o.brands ?? look?.brands
  const director = item.prompt ?? item.context.subject
  // the pipeline's world and its exact objects (text/locale.ts) close every composed prompt
  const world = [notesFor(director, o.notes), cultureLine(o.locale)].filter(Boolean).join('. ')
  if (!look && people === undefined && brands === undefined) return { prompt: world ? `${director}. ${world}`.slice(0, 4000) : director, negative: undefined, presenter: false, room: false }
  // with a look, the director's own suffix gives way to the style's (the scene and its size stay the director's)
  let scene = look && item.shot ? item.shot.scene : director
  const size = look && item.shot ? item.shot.size : null
  const negative = [...(look?.negative ?? DEFAULT_NEGATIVE)]
  const add: string[] = []
  let presenter = false
  if (people === 'nobody') {
    scene = withoutPeople(scene, item)
    add.push('an empty scene with objects only')
    negative.push('people', 'hands', 'faces', 'silhouettes')
  } else if (people === 'not-presenter') {
    scene = scene.replace(PRESENTER, (m) => (/['’]s$/.test(m) ? "a person's" : 'a person'))
    negative.push("the presenter's face")
  } else if (people === 'presenter-as-actor') {
    presenter = mentionsPerson(scene)
    if (presenter) add.push('the person is the one in the reference portrait, same face, hair and clothes')
  }
  if (brands === 'none') {
    add.push('plain unbranded packaging')
    negative.push('logos', 'brand names')
  }
  const room = (look?.references ?? []).includes('room-shots') && (ROOMISH.test(scene) || (size !== null && /\bwide\b/i.test(size)))
  const vertical = o.aspect === '9:16' && !/vertical 9:16/.test(scene) ? ', vertical 9:16 composition' : ''
  const head = size ? `${size} of ${scene}` : scene
  // a style's own words may put someone in the frame too: with nobody, its clauses that do are left out
  const suffix = look?.suffix ? (people === 'nobody' ? clausesWithoutPeople(look.suffix) : look.suffix) : ''
  const prompt = `${head}${add.length > 0 ? `, ${add.join(', ')}` : ''}${vertical}${suffix ? `. ${suffix}` : ''}${world ? `. ${world}` : ''}`.slice(0, 4000)
  return { prompt, negative: [...new Set(negative)].join(', ').slice(0, 1500), presenter, room }
}

/** A plainer prompt after a refusal (§23 step 5): no names, no quotes, no words of violence, the scene's first clause only. */
export function plainer(prompt: string): string {
  const first = prompt.split(/\.\s/)[0] ?? prompt
  return first
    .replace(/["“”«»]/g, '')
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, 'a thing')
    .replace(/\b(?:blood|bloody|kill|killing|dead|death|weapon|gun|knife|knives|fire|burn|burning|wound|injury|poison|toxic|explode|explosion|naked|nude)\w*\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
    .slice(0, 1200)
}
