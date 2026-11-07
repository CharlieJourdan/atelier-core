// `director.pov@1` (clone-monde-pov, research note style-monde-pov-2026-11 (old repository)): the edit plan of a 2D motion-design « what if » story.
// run: Claude (role Director) writes the shots of each stretch of the narration from the POV vocabulary (director-pov-prompt.ts): what
// each shot is, from which words, and on which words its parts land; code times them on the voice, checks each one against the POV card
// schema (a shot that does not draw becomes a plain scene, said in the diagnostics), keeps the measured rhythm (no shot under `minShotS`,
// a scene or a face split by a reaction close-up past `maxStillS`) and writes every shot as an opaque `pov` card of the base track.
// Nothing is generated or found: the generation list is empty and the film costs its voice and its director. fake: the same passes on
// shots made from the sentences alone (a scene, a number when one is said, a face every few sentences).
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { buildTimeline } from '../formats/directives'
import { EDITPLAN_SCHEMA, checkEditPlan, type EditPlan, type GenList, type Shot } from '../formats/editplan'
import { Outline } from '../formats/outline'
import { POV_DEPTHS, POV_HELD, POV_PALETTES, PovFigures, PovHeld, PovShot, PovType, type POV_PROPS, type PovHeldDetail, type PovSet } from '../formats/pov'
import { BeatsValue, FPS, FRAME_SIZES, WordsMeta, WordsValue, toFrame, type Word } from '../formats/timing'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { askJson, hashOf, languageLine, progress, readValue } from './common'
import { wordOn } from './director-cards'
import { povSystem } from './director-pov-prompt'

export const PovDirectorParams = z.object({
  palette: z.enum(POV_PALETTES).default('dusk'),
  // the reference's rhythm (style study § 4): a cut every ≈ 2.7 s, ≈ 2.4 s in the first 25 s, a face every ≈ 16 s
  shotS: z.number().min(1).max(10).default(2.7),
  hookShotS: z.number().min(1).max(10).default(2.4),
  hookS: z.number().min(0).max(120).default(25),
  faceEveryS: z.number().min(5).max(120).default(13),
  // the cloned passage (A 0:00–1:30): scenes 31 %, faces 20 %, numbers and data 34 %, phone / props on a blurred place 15 %
  shares: z.object({ scene: z.number(), face: z.number(), data: z.number(), ui: z.number() }).default({ scene: 0.33, face: 0.2, data: 0.35, ui: 0.12 }),
  minShotS: z.number().min(0.8).max(5).default(1),
  // the reference never holds a place or a face over ≈ 4 s (A: longest scene 3.9 s, face 2.6 s)
  maxStillS: z.number().min(3).max(20).default(4.5),
  /** A still scene at least this long gets a slow push (the reference: about one shot in four drifts). */
  pushFromS: z.number().min(1).max(20).default(3),
  /** A blur-smear (whip) between two scenes about once per this many seconds (the reference: once per ≈ 80 s). */
  whipEveryS: z.number().min(0).max(600).default(80),
  /** Seconds of narration per call to the director. */
  stretchS: z.number().min(30).max(600).default(120),
  aspect: z.enum(['16:9', '9:16']).default('16:9'),
  /** How the places are shot (moteur-briques): `deep` = the place behind defocused, a vignette and grain (measured depth of field). */
  depth: z.enum(POV_DEPTHS).default('flat'),
  /** Screen-time share of first-person shots (the viewer's own hand holding a thing up), measured on the reference; 0 = none. */
  handShare: z.number().min(0).max(0.8).default(0),
  /** The cards' measured type (face, capitals, titles' accent and rule); absent: the kit's own. */
  type: PovType.optional(),
  /** moteur-pov-2: the cast's measured drawing (silhouettes, rim, expressive faces); absent: the kit's own. */
  figures: PovFigures.optional(),
  /** The things the reference holds up in first person with what is on them, most frequent first. */
  held: z.array(PovHeld).max(6).default([]),
  /** The reference's first-person share over its opening (`openingS` seconds), where it handles its objects most. */
  openingS: z.number().min(0).max(600).default(0),
  openingHandShare: z.number().min(0).max(0.9).optional()
})
export type PovDirectorParams = z.infer<typeof PovDirectorParams>

interface Sentence {
  n: number
  first: number
  last: number
  start: number
  end: number
  text: string
}
const Draft = z.object({ sentence: z.number().int().min(1), on: z.string().max(120).default(''), shot: z.record(z.string(), z.unknown()) })
type Draft = z.infer<typeof Draft>
const Answer = z.object({ shots: z.array(Draft).min(1) })

export function sentencesOf(words: readonly Word[]): Sentence[] {
  const out: Sentence[] = []
  words.forEach((w, i) => {
    const last = out.at(-1)
    if (last && words[last.first]?.sentence === w.sentence) {
      last.last = i
      last.end = w.end
      last.text += ` ${w.w}`
    } else out.push({ n: out.length + 1, first: i, last: i, start: w.start, end: w.end, text: w.w })
  })
  return out
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const r2 = (v: number): number => Math.round(v * 100) / 100

/** Every `on` (and `xxxOn`) inside a shot turned into seconds from the shot's start; a word not found keeps no time. */
export function timeParts(v: unknown, words: readonly Word[], a: number, b: number, startS: number): unknown {
  if (Array.isArray(v)) return v.map((x) => timeParts(x, words, a, b, startS))
  if (typeof v !== 'object' || v === null) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((k === 'on' || k.endsWith('On')) && typeof x === 'string') {
      const i = wordOn(words, a, b, x)
      if (i !== null) out[k === 'on' ? 'atS' : `${k.slice(0, -2)}AtS`] = r2(Math.max(0, (words[i] as Word).start - startS))
    } else out[k] = timeParts(x, words, a, b, startS)
  }
  return out
}

/** Keeps every timed part inside the shot (a part said after the cut lands just before it). */
function clampTimes(v: unknown, durS: number): unknown {
  if (Array.isArray(v)) return v.map((x) => clampTimes(x, durS))
  if (typeof v !== 'object' || v === null) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.endsWith('AtS') || k === 'atS') {
      if (typeof x === 'number') out[k] = r2(Math.min(x, Math.max(0, durS - 0.35)))
    } else out[k] = clampTimes(x, durS)
  }
  return out
}

interface Timed {
  startS: number
  shot: PovShot | Record<string, unknown>
  sentence: number
}

const setOf = (s: Timed['shot']): PovSet | undefined => {
  const o = s as { kind?: string; set?: PovSet; over?: PovSet }
  return o.kind === 'scene' ? o.set : o.over
}

/**
 * Shots made without a model (the free demo, a director that failed): each sentence gets the kind furthest below its measured
 * share of the screen (places, faces, numbers and lists, phone, first-person hand), so a free demo shows the channel's mix of
 * compositions rather than one fixed pattern (moteur-briques: the gate refused a demo that was « a number or a face every four
 * shots »). A number said aloud is shown as a number.
 */
/** The thing a sentence names that a hand can hold (French and English words; a lottery « billet » is a ticket). */
export function heldNamed(text: string): (typeof POV_HELD)[number] | null {
  const t = text.toLowerCase()
  if (/\b(tickets?|grilles?|billets? de (loterie|loto)|lottery|receipt|reçu)\b/u.test(t)) return 'ticket'
  if (/(t[ée]l[ée]phone|\bportable\b|smartphone|\bphone\b|\bappli|\bapp\b|\bsms\b|\bmessage|notification)/u.test(t)) return 'phone'
  if (/\b(carte bancaire|carte bleue|bank card|credit card|carte)\b/u.test(t)) return 'card'
  if (/\b(billets?|factures?|banknotes?|bills?|invoices?)\b/u.test(t)) return 'bill'
  if (/\b(lettres?|courriers?|contrats?|documents?|papiers?|letters?|contracts?|papers?)\b/u.test(t)) return 'paper'
  if (/\b(post-it|sticky note)\b/u.test(t)) return 'note'
  return null
}

/** What is on a held thing for a sentence: the words say it (results, a call, a message), else the channel's measured detail. */
export function heldDetail(hold: (typeof POV_HELD)[number], text: string, held: readonly PovHeld[]): PovHeldDetail {
  const t = text.toLowerCase()
  if (hold === 'phone') {
    if (/(r[ée]sultat|tirage|num[ée]ros|results?|\bdraw\b|numbers)/u.test(t)) return 'results'
    if (/(appel|appelle|sonne|\bcall|rings?\b)/u.test(t)) return 'call'
    if (/(message|notification|vibre|\bsms\b|texto|buzz)/u.test(t)) return 'message'
  }
  const measured = held.find((h) => h.hold === hold)
  if (measured) return measured.detail
  return hold === 'ticket' ? 'numbers' : hold === 'card' || hold === 'bill' ? 'price' : 'plain'
}

/** The place a sentence names, among the drawn sets (French and English words); null when none. */
export function setNamed(text: string): PovSet | null {
  const t = text.toLowerCase()
  const rules: [RegExp, PovSet][] = [
    [/\b(lit|chambre|bed|bedroom)\b/u, 'bedroom'], [/\b(bureau|office|travail|collègues?)\b/u, 'office'], [/\b(banques?|bank)\b/u, 'street'],
    [/\b(rues?|street|trottoir|dehors|outside)\b/u, 'street'], [/\b(voisins?|neighbou?rs?|quartier|village)\b/u, 'village'],
    [/\b(ville|city|fenêtre|window)\b/u, 'skyline'],  [/\b(cuisine|kitchen|maison|chez toi|home|salon)\b/u, 'room'],
    [/\b(mer|plage|sea|beach|yacht)\b/u, 'sea'], [/\b(voitures?|cars?|concession)\b/u, 'showroom']
  ]
  return rules.find(([re]) => re.test(t))?.[1] ?? null
}

const HELD_TITLE: Partial<Record<string, Partial<Record<PovHeldDetail, { fr: string; en: string }>>>> = {
  ticket: { numbers: { fr: 'MA GRILLE', en: 'MY TICKET' }, plain: { fr: 'TICKET', en: 'TICKET' }, price: { fr: 'TICKET', en: 'TICKET' } },
  phone: { results: { fr: 'RÉSULTATS', en: 'RESULTS' }, call: { fr: 'APPEL', en: 'CALL' } }
}

export interface FakeDraftOptions {
  held?: readonly PovHeld[]
  openingS?: number
  openingHandShare?: number | undefined
  language?: string
}

export function fakeDrafts(sentences: readonly Sentence[], handShare = 0, shares: PovDirectorParams['shares'] = { scene: 0.33, face: 0.2, data: 0.35, ui: 0.12 }, o: FakeDraftOptions = {}): Draft[] {
  const held = o.held ?? []
  const fr = (o.language ?? 'fr') === 'fr'
  const sets: PovSet[] = ['room', 'street', 'bedroom', 'village', 'skyline', 'office']
  // each place furnished with what belongs there (a bare place with one figure reads as a placeholder: independent judge,
  // 2026-11-05), a few people of other colours, a crowd where people gather
  const furniture: Record<string, readonly (typeof POV_PROPS)[number][]> = {
    room: ['desk', 'lamp'], street: ['car', 'tree', 'house'], showroom: ['sportscar', 'car', 'oldcar'], office: ['desk', 'lamp'],
    hall: ['lamp', 'tree'], skyline: ['tower', 'plane'], bedroom: ['bed', 'lamp'], village: ['house', 'tree', 'house']
  }
  const crowdOf: Partial<Record<PovSet, number>> = { street: 12, hall: 24, village: 6 }
  const others = ['purple', 'green', 'blue', 'pink', 'grey', 'yellow'] as const
  const total = shares.scene + shares.face + shares.data + shares.ui || 1
  type K = 'scene' | 'face' | 'data' | 'ui' | 'hand'
  // the hand's share over the opening is the opening's own (the reference handles its objects most there)
  const targetAt = (startS: number): Record<K, number> => {
    const h = o.openingS && o.openingHandShare !== undefined && startS < o.openingS ? o.openingHandShare : handShare
    const rest = Math.max(0, 1 - h)
    return { scene: (shares.scene / total) * rest, face: (shares.face / total) * rest, data: (shares.data / total) * rest, ui: (shares.ui / total) * rest, hand: h }
  }
  const sum: Record<K, number> = { scene: 0, face: 0, data: 0, ui: 0, hand: 0 }
  const done: Record<K, number> = { scene: 0, face: 0, data: 0, ui: 0, hand: 0 }
  let place: PovSet = 'room'
  let scenes = 0
  let lastHand: string | null = null
  let prevDetail: PovHeldDetail | null = null
  // the places in turn (a scene the director makes for a sentence without its own kind moves the turn too)
  let cycle = 0
  return sentences.map((s, i) => {
    const words = s.text.split(/\s+/).filter(Boolean)
    const first = words.slice(0, 2).join(' ')
    const short = (k: number): string => words.slice(k, k + 2).join(' ').replace(/[.,;:!?»«"]/g, '').slice(0, 24) || 'ÇA'
    const num = s.text.match(/\d[\d\s.,]*/)?.[0]?.replace(/\s+/g, '')
    // the first sentence opens on a place; a number said is a number; else the kind furthest below its share
    // a question said aloud lands as a two-line title card (the reference's « LE TICKET PEUT-IL EXPIRER ? »)
    if (i > 0 && /\?\s*$/.test(s.text)) return { sentence: s.n, on: first, shot: { kind: 'title', lines: [short(0), `${short(2)} ?`], set: place, confetti: false } }
    const target = targetAt(s.start)
    for (const k of Object.keys(sum) as K[]) sum[k] += target[k]
    // a thing the sentence names is held up in first person (on a channel that films so), before a number said with it
    const named = handShare > 0 || (o.openingHandShare ?? 0) > 0 ? heldNamed(s.text) : null
    const kind: K = i === 0 ? 'scene' : named ? 'hand' : num && /\d{2,}/.test(num) ? 'data' : (Object.keys(target) as K[]).sort((x, y) => sum[y] - done[y] - (sum[x] - done[x]))[0]!
    done[kind]++
    switch (kind) {
      case 'hand': {
        // the named thing, else the channel's things in turn (most frequent first), else the kit's list
        const pool = held.length > 0 ? held.map((h) => h.hold) : POV_HELD
        const hold = named ?? (pool[(done.hand - 1) % pool.length] as (typeof POV_HELD)[number])
        // the same thing twice in a row reads as a repeated shot: a phone after a phone shows another screen
        const prevHand = lastHand
        lastHand = hold
        const detail0 = heldDetail(hold, s.text, held)
        const detail: PovHeldDetail = prevHand === hold && hold === 'phone' && detail0 === prevDetail ? (detail0 === 'message' ? 'results' : 'message') : detail0
        prevDetail = detail
        const title = HELD_TITLE[hold]?.[detail]?.[fr ? 'fr' : 'en']
        const said = (s.text.match(/\b\d{1,2}\b/g) ?? []).map(Number).slice(0, 7)
        const lines = detail === 'plain' || detail === 'price'
          ? [{ text: num && /\d/.test(num) ? num.replace(/[.,]$/, '') : short(2), ...(num ? { tone: 'big' as const } : {}) }]
          : detail === 'message' ? [{ text: short(0) }, { text: short(2) }] : []
        const second = (['ticket', 'phone', 'card', 'bill', 'paper'] as const).find((h) => h !== hold && heldNamed(s.text.replace(new RegExp(hold === 'ticket' ? '(ticket|grille)s?' : hold === 'phone' ? 't[ée]l[ée]phone|phone' : hold, 'giu'), '')) === h)
        return { sentence: s.n, on: first, shot: { kind: 'hand', hold, detail, ...(second ? { beside: second } : {}), ...(said.length >= 5 ? { balls: said } : {}), ...(title ? { title } : hold === 'phone' && detail === 'plain' ? { title: short(0) } : {}), lines, side: done.hand % 2 ? 'right' : 'left', over: place } }
      }
      case 'face':
        return { sentence: s.n, on: first, shot: { kind: 'face', moods: [{ expression: (['worried', 'shock', 'smile', 'determined'] as const)[done.face % 4] }], over: place } }
      case 'data':
        if (num && /\d{2,}/.test(num)) return { sentence: s.n, on: first, shot: { kind: 'number', steps: [{ text: num.replace(/[.,]$/, '') }], over: place } }
        // a title card is the channel's question device only (above); without a number, a flow or a list only when the
        // sentence lists things (commas), else the sentence's place (a lone clause chopped into a list reads as a template)
        if ((s.text.match(/,/g)?.length ?? 0) < 2 && (done.data % 2 === 0 || s.start < 30)) {
          // a new place (the one said, else the next one), never the same place twice in a row
          const said = setNamed(s.text)
          let next = said && said !== place ? said : (sets[cycle % sets.length] as PovSet)
          if (next === place) next = sets[(cycle + 1) % sets.length] as PovSet
          cycle++
          place = next
          return { sentence: s.n, on: first, shot: { kind: 'scene', set: place, cast: [{ color: 'hero', pose: 'stand', x: 0.4 }], props: (furniture[place] ?? []).map((kind, k, all) => ({ kind, x: all.length === 1 ? 0.78 : 0.12 + (k * 0.76) / (all.length - 1), scale: k === 0 ? 1 : 0.8 })), crowd: 0, camera: 'push' } }
        }
        return { sentence: s.n, on: first, shot: done.data % 2 && (s.text.match(/,/g)?.length ?? 0) >= 2 ? { kind: 'list', style: 'pill', title: short(0), items: [{ text: short(2) }, { text: short(4) }] } : { kind: 'icons', title: short(0), chain: true, items: [{ icon: 'landmark', label: short(2) }, { icon: 'lock', label: short(4) }, { icon: 'file-text', label: short(6) }] } }
      case 'ui':
        // a channel that films in the first person holds its phone up in the viewer's hand (never a bare phone card)
        if (handShare > 0 || (o.openingHandShare ?? 0) > 0) {
          const detail = heldDetail('phone', s.text, held)
          const title = HELD_TITLE.phone?.[detail]?.[fr ? 'fr' : 'en']
          const d2 = detail === 'plain' ? 'message' : detail
          return { sentence: s.n, on: first, shot: { kind: 'hand', hold: 'phone', detail: d2, ...(title ? { title } : {}), lines: d2 === 'message' ? [{ text: short(0) }, { text: short(2) }] : [], side: done.ui % 2 ? 'right' : 'left', over: place } }
        }
        return { sentence: s.n, on: first, shot: { kind: 'phone', app: short(0), lines: [{ text: short(2) }], over: place } }
      default: {
        {
          const said = setNamed(s.text)
          let next = said && said !== place ? said : (sets[cycle % sets.length] as PovSet)
          if (next === place && i > 0) next = sets[(cycle + 1) % sets.length] as PovSet
          place = next
        }
        cycle++
        scenes++
        const things = furniture[place] ?? []
        const jump = /^(.{3,28}?(plus tard|later|le lendemain|the next morning))[, ]/iu.exec(s.text)?.[1] ?? null
        const many = 1 + (scenes % 3)
        // the hero acts (walks, holds the phone, points, sits, raises an arm) in a different spot each time; the others too
        const heroPose = (['walk', 'phone', 'stand', 'point', 'arm-up', 'walk'] as const)[scenes % 6]!
        const heroX = [0.3, 0.55, 0.42, 0.22, 0.66, 0.36][scenes % 6]!
        const cast = [{ color: 'hero', pose: heroPose, x: heroX }, ...Array.from({ length: many - 1 }, (_, k) => ({ color: others[(scenes + k) % others.length], pose: (['point', 'walk', 'phone', 'stand'] as const)[(scenes + k) % 4], x: Math.min(0.92, heroX + 0.16 + k * 0.14) }))]
        return {
          sentence: s.n, on: first,
          shot: {
            kind: 'scene', set: place, cast, props: things.map((kind, k) => ({ kind, x: things.length === 1 ? 0.78 : 0.12 + (k * 0.76) / (things.length - 1), scale: k === 0 ? 1 : 0.8 })),
            crowd: crowdOf[place] ?? 0, camera: scenes % 2 ? 'push' : 'still',
            // a small corner tag every few places (the reference's « 4 JOURS PLUS TARD »)
            // a time jump said (« Quatre jours plus tard ») is the corner card; else every few places a short tag
            ...((jump ? { tag: { text: jump.toUpperCase() } } : scenes % 3 === 2 ? { tag: { text: short(0).toUpperCase() } } : {}))
          }
        }
      }
    }
  })
}

/** How many shots a stretch of the narration takes at the measured rhythm (the hook's part at its own pace). */
export function shotsFor(part: readonly Sentence[], p: PovDirectorParams): number {
  const a = (part[0] as Sentence).start
  const b = (part.at(-1) as Sentence).end
  const hook = Math.max(0, Math.min(b, p.hookS) - a)
  return Math.max(1, Math.round(hook / p.hookShotS + (b - a - hook) / p.shotS))
}

async function draftsByClaude(ctx: RunCtx, sentences: readonly Sentence[], outline: Outline, p: PovDirectorParams, diag: string[]): Promise<Draft[]> {
  const system = povSystem({ shotS: p.shotS, hookShotS: p.hookShotS, hookS: p.hookS, faceEveryS: p.faceEveryS, shares: p.shares, handShare: p.handShare, held: p.held, openingS: p.openingS, ...(p.openingHandShare !== undefined ? { openingHandShare: p.openingHandShare } : {}) })
  const parts: Sentence[][] = []
  let cur: Sentence[] = []
  let limit = p.hookS > 0 ? Math.max(p.hookS, 45) : p.stretchS
  for (const s of sentences) {
    if (cur.length > 0 && s.start >= limit) {
      parts.push(cur)
      cur = []
      limit = s.start + p.stretchS
    }
    cur.push(s)
  }
  if (cur.length > 0) parts.push(cur)
  const all: Draft[] = []
  let cast = ''
  for (const [k, part] of parts.entries()) {
    const prompt = [
      languageLine(outline.language),
      `Video: "${outline.title}". ${outline.promise}`,
      `Stretch ${k + 1} of ${parts.length}${k === 0 ? ' (the hook: denser; the title card comes right after the rule of the challenge is said)' : ''}: about ${shotsFor(part, p)} shots for it (the measured rhythm), not more.`,
      ...(cast ? [`Characters already shown (keep their look): ${cast}`] : []),
      ...(all.length > 0 ? [`The last shot before this stretch: ${JSON.stringify(all.at(-1)?.shot)}`] : []),
      'Sentences (number · time · text):',
      ...part.map((s) => `${s.n} · ${fmt(s.start)}–${fmt(s.end)} · ${s.text}`),
      ...(ctx.notes.length > 0 ? ['Requested changes from the reviewer:', ...ctx.notes.map((n) => `- ${n}`)] : [])
    ].join('\n')
    try {
      const answer = await askJson(ctx, { role: 'director', system, prompt, schema: Answer })
      const allowed = new Set(part.map((s) => s.n))
      const mine = answer.shots.filter((d) => allowed.has(d.sentence))
      all.push(...mine)
      const people = mine.flatMap((d) => (Array.isArray(d.shot.cast) ? (d.shot.cast as { color?: string; hair?: string }[]) : []))
      const seen = new Set(cast.split('; ').filter(Boolean))
      for (const c of people) if (c.color && c.color !== 'hero') seen.add(`${c.color}${c.hair && c.hair !== 'none' ? ` (${c.hair})` : ''}`)
      cast = [...seen].join('; ')
    } catch (e) {
      if (ctx.signal.aborted) throw e
      diag.push(`réalisation simplifiée de ${fmt((part[0] as Sentence).start)} à ${fmt((part.at(-1) as Sentence).end)}`)
      all.push(...fakeDrafts(part, p.handShare, p.shares, fakeOptions(p, outline)))
    }
    progress(ctx, k + 1, parts.length, `${k + 1} passages sur ${parts.length}`)
  }
  return all
}

/** The drafts timed on the voice and checked: one shot per draft that draws, in the voice's order, from 0 to the end. */
export function timeDrafts(drafts: readonly Draft[], sentences: readonly Sentence[], words: readonly Word[], D: number, p: PovDirectorParams, diag: string[]): Timed[] {
  const bySentence = new Map(sentences.map((s) => [s.n, s]))
  const starts: Timed[] = []
  for (const d of drafts) {
    const s = bySentence.get(d.sentence)
    if (!s) continue
    const k = d.on ? wordOn(words, s.first, s.last, d.on) : s.first
    const at = k === null ? s.start : Math.max(0, (words[k] as Word).start - 0.05)
    starts.push({ startS: at, shot: d.shot, sentence: d.sentence })
  }
  starts.sort((x, y) => x.startS - y.startS)
  const out: Timed[] = []
  for (const t of starts) {
    const last = out.at(-1)
    // a shot shorter than the minimum is dropped: the one before holds (the first shot always starts at 0)
    if (last && t.startS - last.startS < p.minShotS) {
      diag.push(`plan trop court retiré (phrase ${t.sentence})`)
      continue
    }
    out.push(t)
  }
  if (out.length === 0) out.push({ startS: 0, shot: { kind: 'scene', set: 'room', cast: [{}] }, sentence: 1 })
  ;(out[0] as Timed).startS = 0
  if (D - (out.at(-1) as Timed).startS < p.minShotS && out.length > 1) out.pop()
  // the parts on their words, then each shot checked against the card's schema
  return out.map((t, i) => {
    const end = out[i + 1]?.startS ?? D
    const s = bySentence.get(t.sentence) as Sentence
    const next = bySentence.get(t.sentence + 1) ?? s
    const lastWord = words.findIndex((w) => w.start >= end)
    const b = Math.max(s.first, Math.min(next.last, lastWord < 0 ? words.length - 1 : lastWord))
    const timed = firstEarly(clampTimes(timeParts(t.shot, words, s.first, b, t.startS), end - t.startS))
    const r = PovShot.safeParse(timed)
    if (r.success) return { ...t, shot: r.data }
    diag.push(`plan ${i + 1} (${fmt(t.startS)}) non dessinable (${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}) : une scène à la place`)
    return { ...t, shot: PovShot.parse({ kind: 'scene', set: setOf(t.shot) ?? 'room', cast: [{ color: 'hero', x: 0.45 }] }) }
  })
}

/** The first part of a list, a number or a phone shows within 0.4 s: a card never waits empty for its first word. */
function firstEarly(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v
  const o = v as Record<string, unknown>
  for (const k of ['steps', 'items', 'lines']) {
    const a = o[k]
    if (Array.isArray(a) && a.length > 0 && typeof a[0] === 'object' && a[0] !== null) {
      const first = a[0] as Record<string, unknown>
      if (typeof first.atS === 'number' && first.atS > 0.4) a[0] = { ...first, atS: 0.4 }
    }
  }
  return o
}

/** A scene or a face held past `maxStillS` is cut in two by a reaction (the reference never holds a still place that long). */
export function splitLong(shots: Timed[], D: number, p: PovDirectorParams): Timed[] {
  const out: Timed[] = []
  shots.forEach((t, i) => {
    const end = shots[i + 1]?.startS ?? D
    const s = t.shot as PovShot
    const still = s.kind === 'scene' || s.kind === 'face'
    if (!still || end - t.startS <= p.maxStillS) {
      out.push(t)
      return
    }
    const n = Math.ceil((end - t.startS) / p.maxStillS)
    const step = (end - t.startS) / n
    for (let k = 0; k < n; k++) {
      const startS = r2(t.startS + k * step)
      if (k === 0) out.push(t)
      else if (s.kind === 'scene')
        out.push({ startS, sentence: t.sentence, shot: PovShot.parse({ kind: 'face', moods: [{ expression: k % 2 === 1 ? 'determined' : 'smile' }], over: s.set }) })
      else out.push({ startS, sentence: t.sentence, shot: PovShot.parse({ kind: 'scene', set: s.over ?? 'room', cast: [{ color: s.color, hair: s.hair, x: 0.45 }], camera: 'push' }) })
    }
  })
  // a timed part of a shot that was cut short lands inside it; a still place that lasts gets a slow push
  return out.map((t, i) => {
    const len = (out[i + 1]?.startS ?? D) - t.startS
    const shot = PovShot.parse(clampTimes(t.shot, len))
    return { ...t, shot: shot.kind === 'scene' && shot.camera === 'still' && len >= p.pushFromS ? { ...shot, camera: 'push' as const } : shot }
  })
}

/** The edit plan: every shot a `pov` card on the base track, whips between scenes about once per `whipEveryS`. */
export function povPlan(shots: readonly Timed[], D: number, p: PovDirectorParams, seed: string, diagnostics: string[]): EditPlan {
  const frames = toFrame(D)
  let lastWhip = -Infinity
  const list: Shot[] = shots.map((t, i) => {
    const startFrame = i === 0 ? 0 : toFrame(t.startS)
    const endFrame = i === shots.length - 1 ? frames : toFrame((shots[i + 1] as Timed).startS)
    const shot = t.shot as PovShot
    const before = shots[i - 1]?.shot as PovShot | undefined
    const whip = p.whipEveryS > 0 && shot.kind === 'scene' && before?.kind === 'scene' && t.startS - lastWhip >= p.whipEveryS
    if (whip) lastWhip = t.startS
    return {
      id: `p${String(i + 1).padStart(3, '0')}`,
      track: 'base',
      startFrame,
      endFrame,
      kind: 'motion',
      transitionIn: whip ? 'whip' : 'cut',
      ...(whip ? { transitionDir: 'left' as const } : {}),
      role: 'scene',
      beat: t.sentence,
      graphic: { template: 'pov', props: { palette: p.palette, seed: `${seed}${i}`, shot, ...(p.depth !== 'flat' ? { depth: p.depth } : {}), ...(p.type ? { type: p.type } : {}), ...(p.figures ? { figures: p.figures } : {}) } } as unknown as Shot['graphic']
    }
  })
  return {
    schema: EDITPLAN_SCHEMA,
    fps: FPS,
    size: [...FRAME_SIZES[p.aspect]] as EditPlan['size'],
    frames,
    tracks: { base: list.map((s) => s.id), overlay: [], labels: [] },
    captionsPreset: 'highlight',
    shots: list,
    chapters: [],
    diagnostics
  }
}

const fakeOptions = (p: PovDirectorParams, outline: Outline): FakeDraftOptions => ({ held: p.held, openingS: p.openingS, openingHandShare: p.openingHandShare, language: outline.language })

async function direct(ctx: RunCtx, inputs: ResolvedInputs, p: PovDirectorParams, useClaude: boolean): Promise<NodeOutputs> {
  const words = readValue(inputs.words, WordsValue, 'the word times')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  readValue(inputs.beats, BeatsValue, 'the beats')
  const wm = WordsMeta.safeParse(inputs.words?.meta)
  if (!wm.success) throw new EngineError('bad_input', 'the word times have no duration')
  const D = wm.data.durationS
  const diagnostics: string[] = []
  if (useClaude) need(ctx, 'claude')
  const sentences = sentencesOf(words)
  const drafts = useClaude ? await draftsByClaude(ctx, sentences, outline, p, diagnostics) : fakeDrafts(sentences, p.handShare, p.shares, fakeOptions(p, outline))
  const shots = splitLong(timeDrafts(drafts, sentences, words, D, p, diagnostics), D, p)
  const seed = hashOf({ t: outline.title }).slice(0, 8)
  const plan = povPlan(shots, D, p, seed, diagnostics)
  const list: GenList = { items: [], totals: { credits: 0, items: 0, byKind: {} }, budget: null }
  const problems = checkEditPlan(plan, list, toFrame(D))
  if (problems.length > 0) throw new EngineError('schema', `the POV plan failed its check: ${problems.slice(0, 5).join('; ')}`)
  progress(ctx, 1, 1, `${plan.tracks.base.length} plans dessinés`)
  const timeline = buildTimeline(plan, list, words)
  return {
    plan: { value: plan as unknown as Json, meta: { frames: plan.frames, shots: plan.tracks.base.length, labels: 0, demo: !useClaude } },
    directives: { value: [], meta: { mode: 'pov', count: 0 } },
    timeline: { value: timeline as unknown as Json, meta: { shots: timeline.shots.length, overlays: timeline.overlays.length } },
    genlist: { value: list as unknown as Json, meta: { credits: 0, items: 0, stock: 0 } }
  }
}

export const directorPov = defineNode({
  type: 'director.pov@1',
  // moteur-pov-2: the demo script follows the measured object pattern and address; the drawn director's demo shots changed
  fakeVersion: 4,
  inputs: {
    beats: { type: 'json.beats', required: true },
    words: { type: 'json.words', required: true },
    outline: { type: 'json.outline', required: true },
    brief: { type: 'text.brief', required: false }
  },
  outputs: { plan: 'json.editplan', genlist: 'json.genlist', directives: 'json.directives', timeline: 'json.timeline' },
  params: PovDirectorParams,
  executors: ['local'],
  claudeRole: 'director',
  estimate: (ctx) => ({ units: [{ unit: 'calls', qty: 1 + Math.ceil((ctx.minutes * 60) / 120) }], durationS: 40 + ctx.minutes * 25 }),
  run: (ctx, inputs, p) => direct(ctx, inputs, p, true),
  fake: (ctx, inputs, p) => direct(ctx, inputs, p, false)
})
