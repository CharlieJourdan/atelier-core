// The scene pass of `documentary@2`: per sentence, WHAT the archives can show and WHICH words of the narration may be written on
// screen. The LLM (role Director) answers per stretch of the script; it never decides how a picture is presented (the sequencer does,
// doc2-sequence.ts) nor any time (code finds the words). Every on-screen text is then checked against the words actually said
// (`checkScene`): a name, a date, a figure or a quote not in its sentence is dropped, never written (the text-check rule, here free).
// fake: scenes made from each sentence's key terms (the same passes, no model).
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Beat } from '../formats/timing'
import type { RunCtx } from '../registry'
import { normWord } from '../text/script'
import { askJson, atomicWrite, hashOf, languageLine, progress } from './common'
import { digitsOf } from './doc2-figures'

const line = (max: number) => z.string().trim().min(1).max(max)
const LatLon = z.object({ lat: z.number().min(-80).max(80), lon: z.number().min(-180).max(180) })
/** `on`: 1–4 words of the sentence where that part appears (code turns them into a time). */
const on = line(60).optional()

export const Doc2Scene = z.object({
  sentence: z.number().int().min(1),
  /** Search words for an archive FILM (English): what moves on screen, with its period and place. */
  film: line(90).optional(),
  /** 2–4 English words, a generic archive subject of the same period and place, searched too for when nothing shows the sentence exactly. */
  broad: line(60).optional(),
  /** Search words for one archive PHOTOGRAPH (English). */
  photo: line(90).optional(),
  /** A person the sentence names: name as written, role in 1–5 words, search words for their portrait. */
  person: z.object({ name: line(40), role: line(60).optional(), query: line(90) }).optional(),
  /** Two to four things, people or places the sentence lists, each with its photograph's search words and a short label. */
  photos: z.array(z.object({ query: line(90), label: line(40).optional(), on })).max(4).optional(),
  /** A place or an institution the sentence names (a box label), with a short second line (a city, a year). */
  place: z.object({ name: line(40), sub: line(50).optional() }).optional(),
  /** A date as the sentence says it. */
  date: line(30).optional(),
  /** A figure the sentence says, and what it counts (1–5 words). */
  number: z.object({ text: line(40), label: line(40).optional(), on }).optional(),
  /** Words the sentence quotes (a slogan, an insult, an order), copied exactly. */
  quote: line(70).optional(),
  /** The picture exists in colour and the reference keeps it so: a present-day photograph, a colour document, a banknote, a poster. */
  colour: z.boolean().optional(),
  /** A map, when the sentence is about where things are: a title, its camera, countries shaded, places pinned, a route drawn. */
  map: z
    .object({
      kicker: line(30).optional(),
      title: line(60),
      center: LatLon,
      /** 3 ≈ a continent, 5 ≈ a large country, 7 ≈ a region. */
      zoom: z.number().min(2).max(8),
      regions: z.array(z.object({ countries: z.array(line(60)).min(1).max(40), tone: z.enum(['red', 'gold', 'pale']).default('red'), label: line(40).optional(), on })).max(4).default([]),
      pins: z.array(LatLon.extend({ label: line(30), on })).max(6).default([]),
      routes: z.array(z.object({ from: LatLon, to: LatLon, via: z.array(LatLon).max(6).default([]), label: line(40).optional(), on })).max(3).default([]),
      /** Short facts the sentence says, boxed on the map (« 26 CANTONS »). */
      facts: z.array(z.object({ text: line(30), on })).max(3).default([])
    })
    .optional(),
  /** A data card, when the sentence gives two figures or more of the same kind (each said). */
  chart: z.object({ kind: z.enum(['bars', 'line', 'counters']).optional(), kicker: line(40).optional(), title: line(60), rows: z.array(z.object({ label: line(40), value: z.number().min(0), display: line(16).optional(), on })).min(1).max(5) }).optional(),
  /** A document the sentence cites (an order, a letter, a report): its words as the narration gives them, and the words to underline. */
  document: z.object({ title: line(60), text: line(320), mark: line(90), source: line(70).optional(), /** Search words for a real scan of it (English). */ scan: line(90).optional() }).optional()
})
export type Doc2Scene = z.infer<typeof Doc2Scene>
/** The limits of the texts inside a scene's objects. */
const TEXT_LIMITS: Record<string, Record<string, number>> = {
  person: { name: 40, role: 60, query: 90 },
  place: { name: 40, sub: 50 },
  number: { text: 40, label: 40, on: 60 },
  photos: { query: 90, label: 40, on: 60 },
  document: { title: 60, text: 320, mark: 90, source: 70, scan: 90 }
}
const cutTexts = (v: unknown, lim: Record<string, number>): unknown =>
  typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, typeof x === 'string' && lim[kk] ? x.trim().slice(0, lim[kk]) : x])) : v
/** A point as the model may write it: {lat, lon}, {lat, lng}, {latitude, longitude} or [lat, lon]. */
const latLon = (p: unknown): Record<string, unknown> => {
  if (Array.isArray(p)) return { lat: Number(p[0]), lon: Number(p[1]) }
  if (typeof p !== 'object' || p === null) return {}
  const o = p as Record<string, unknown>
  return { lat: Number(o.lat ?? o.latitude), lon: Number(o.lon ?? o.lng ?? o.longitude) }
}
const clamp = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
const cut = (x: unknown, n: number): unknown => (typeof x === 'string' ? x.trim().slice(0, n) : x)
/** A map's or a chart's parts that read, each alone (a list item that does not is dropped; a text too long is cut). */
function cleanCard(k: 'map' | 'chart', v: Record<string, unknown>): Record<string, unknown> {
  const keep = (list: unknown, one: (x: Record<string, unknown>) => Record<string, unknown>, max: number): Record<string, unknown>[] =>
    (Array.isArray(list) ? list : []).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map(one).slice(0, max)
  const on = (x: Record<string, unknown>): Record<string, unknown> => (x.on === undefined ? {} : { on: cut(x.on, 60) })
  if (k === 'chart') return { ...v, title: cut(v.title, 60), ...(v.kicker ? { kicker: cut(v.kicker, 40) } : {}), rows: keep(v.rows, (r) => ({ label: cut(r.label, 40), value: Number(r.value), ...(r.display ? { display: cut(r.display, 16) } : {}), ...on(r) }), 5).filter((r) => Number.isFinite(r.value) && (r.value as number) >= 0) }
  return {
    // the model also writes a map as {lat, lon, zoom, regions: [{name}]}: its centre from lat / lon, its title from its countries
    title: cut(v.title ?? (Array.isArray(v.regions) ? (v.regions as Record<string, unknown>[]).map((r) => r.name ?? r.country ?? (Array.isArray(r.countries) ? r.countries[0] : r.countries)).filter((x) => typeof x === 'string').slice(0, 3).join(', ') : undefined) ?? 'Europe', 60),
    ...(v.kicker ? { kicker: cut(v.kicker, 30) } : {}),
    center: latLon(v.center ?? v),
    zoom: clamp(v.zoom, 2, 8, 4.5),
    regions: keep(v.regions, (r) => ({ countries: (Array.isArray(r.countries) ? r.countries : [r.countries ?? r.name ?? r.country]).filter((c) => typeof c === 'string').slice(0, 40), tone: ['red', 'gold', 'pale'].includes(r.tone as string) ? r.tone : 'red', ...(r.label ? { label: cut(r.label, 40) } : {}), ...on(r) }), 4).filter((r) => (r.countries as unknown[]).length > 0),
    pins: keep(v.pins, (x) => ({ ...latLon(x), label: cut(x.label, 30), ...on(x) }), 6).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && typeof x.label === 'string'),
    routes: keep(v.routes, (x) => ({ from: latLon(x.from), to: latLon(x.to), via: (Array.isArray(x.via) ? x.via : []).map(latLon).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(0, 6), ...on(x) }), 3),
    facts: keep(Array.isArray(v.facts) ? v.facts.map((x) => (typeof x === 'string' ? { text: x } : x)) : [], (x) => ({ text: cut(x.text, 30), ...on(x) }), 3).filter((x) => typeof x.text === 'string' && x.text.length > 0)
  }
}

/**
 * One scene read field by field: a field the model got wrong (a label too long, a zoom out of range) is dropped, never the whole stretch
 * (documentary-2 round 1: one bad field made the hook fall back to key terms).
 */
export function lenientScene(raw: unknown): Doc2Scene | null {
  if (typeof raw !== 'object' || raw === null) return null
  const whole = Doc2Scene.safeParse(raw)
  if (whole.success) return whole.data
  const r = raw as Record<string, unknown>
  const base = Doc2Scene.safeParse({ sentence: r.sentence })
  if (!base.success) return null
  const out: Record<string, unknown> = { sentence: base.data.sentence }
  for (const [k, v] of Object.entries(r)) {
    if (k === 'sentence') continue
    // long texts are cut to their limit first (a label of 45 letters keeps its first 40), then the field is tried alone
    const tryOne = (value: unknown): boolean => {
      const p = Doc2Scene.safeParse({ sentence: base.data.sentence, [k]: value })
      if (p.success) out[k] = (p.data as Record<string, unknown>)[k]
      return p.success
    }
    // a place or a person written as a plain name, a figure as plain words
    if (typeof v === 'string' && (k === 'place' || k === 'person' || k === 'number') && !(Doc2Scene.safeParse({ sentence: base.data.sentence, [k]: v }).success))
      tryOne(k === 'place' ? { name: v.trim().slice(0, 40) } : k === 'person' ? { name: v.trim().slice(0, 40), query: v.trim().slice(0, 90) } : { text: v.trim().slice(0, 40) })
    else if (!tryOne(v) && typeof v === 'string') tryOne(v.slice(0, 60))
    // a map or a chart with one wrong part keeps the rest: its lists cleaned item by item, its zoom brought into range
    else if (!(k in out) && (k === 'map' || k === 'chart') && typeof v === 'object' && v !== null) tryOne(cleanCard(k, v as Record<string, unknown>))
    // a document without its title (the model often leaves it out): its marked words stand for it
    else if (!(k in out) && k === 'document' && typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).title === undefined)
      tryOne(cutTexts({ ...(v as Record<string, unknown>), title: (v as Record<string, unknown>).mark ?? (v as Record<string, unknown>).on ?? 'Document' }, TEXT_LIMITS.document ?? {}))
    // a person, a place, a figure, a document, a list: each text cut to its limit
    else if (!(k in out) && k in TEXT_LIMITS && typeof v === 'object' && v !== null) tryOne(Array.isArray(v) ? v.map((x) => cutTexts(x, TEXT_LIMITS[k] ?? {})) : cutTexts(v, TEXT_LIMITS[k] ?? {}))
  }
  return Doc2Scene.parse(out)
}
/** The model's own answer is kept beside the read one in the cache (what it said, when a field does not reach the plan). */
const Answer = z.object({ scenes: z.array(z.unknown()) }).transform((a) => ({ scenes: a.scenes.map(lenientScene).filter((s): s is Doc2Scene => s !== null), raw: a.scenes }))

export const DOC2_SCENE_RULES = [
  'You are the picture researcher of a long-form history documentary made ONLY of real archives: archive films, archive photographs, maps, data cards and documents. Nothing is generated.',
  'For each sentence below, say what the public archives can show for it, and which of its words may appear on screen. You never decide the layout or the timing.',
  'Rules:',
  '- film / photo / person.query / photos[].query: 2 to 5 ENGLISH search words an archive catalogue would use (what is shown, the place, the period: « German infantry march 1940 », « Swiss National Bank Bern »). Never a mood, never a modern scene in a period sentence.',
  '- Give `film` for almost every sentence (archive film is the backbone); give `photo` when one photograph says it better (a building, a document, a portrait, a precise moment).',
  '- broad: for EVERY sentence, 2 to 4 English words of a generic archive subject of the same period and place that can stand in when nothing shows it exactly (« German army 1940 », « Swiss Alps 1930s », « Nazi rally crowd », « Bern street 1930s »).',
  '- person: only a person the sentence NAMES; name copied exactly as written; role in 1 to 5 words (their job then, their country).',
  '- photos: only when the sentence lists two to four distinct things, people or places; label = the listed words copied from the sentence.',
  '- place, date, number, quote: only what the sentence itself SAYS, copied exactly (no new name, no new figure, no rounding). quote = words the narration quotes or stresses as a phrase (≤ 8 words).',
  '- map: when the sentence is about geography (a country, borders, a route, where an army or a city is). In the hook (stretch 1) give a map for EVERY sentence about places: the first must come in the first minute. Give real coordinates (lat, lon) for the centre, pins and route ends; countries by their English names, the ones taken first listed first; title = what the map shows and when (« Europe, summer 1940 », « The Swiss Confederation »), kicker = the year, never a list of countries. ALWAYS shade the countries the sentence talks about (regions), with all the lands of an empire or an alliance listed (the whole Axis, not only Germany), tone red for an enemy or an occupier, gold for the country of the story. zoom: 3.5 for Europe, 5 for a large country, 6.5 for a small country like Switzerland, 7.5 for a region. routes: ALWAYS when the sentence says something moves (an army crosses a border, goods travel, people flee, troops push up from the south), with `via` waypoints that follow the real way. facts: up to 3 short boxes the sentence says (« 26 CANTONS », « 4 LANGUAGES »), figures in digits. EVERY region has a `label` that says whose land it is (« AXIS », « OCCUPIED FRANCE », « SWITZERLAND »): a shaded map without it is a defect. When the sentence names a mountain range, a river, a front, a border or a coast as the point (« the Alps were a fortress », « the Rhine »), draw it as a route along its real line with `via` waypoints and its `label` (« THE ALPS »).',
  '- chart: only when the sentence gives two figures or more that compare (or one figure against a whole); values as numbers, display as said.',
  '- Every picture must show what ITS sentence says, never a stand-in of another subject (soldiers in the snow for a sentence about bankers, a portrait of someone the sentence does not name). When the sentence lists reasons, options or explanations (« the Alps were a fortress, the army would fight, Hitler had bigger enemies »), give `photos` with one short `label` per reason (a divided explanation); when the sentence is about where things are, a map; when nothing concrete can be shown, a `quote` of its key words rather than a vague picture.',
  '- document: when the sentence cites or names a real document (an order, a letter, a law, a report, a passport, a war plan, a timetable, a list of names); text = its words as the narration gives them; mark = the 2 to 8 words of `text` that matter; scan = 2 to 5 English search words for a real scan of that very document in an archive (« Operation Tannenbaum order 1940 »).',
  '- colour: true only for a picture that exists in colour and is shown so: a present-day photograph (the sentence says today), a colour document, a banknote, a poster.',
  '- chart: `kind` only when the sentence asks for something other than bars: `line` for a figure over time, `counters` for one striking total.',
  '- on: 1 to 4 words copied from the sentence where that part should appear.',
  '- Leave out every field you are not sure of. Most sentences have only `film` and maybe `photo`.',
  'Answer with ONE JSON object: {"scenes":[{"sentence":<n>, ...}]} with one entry per sentence given, nothing else.'
].join('\n')

export interface Doc2Sentence {
  n: number
  start: number
  end: number
  text: string
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The scene pass on Claude: one call per stretch (the hook, then ~150 s), two at a time; answers cached per stretch. */
export async function doc2ScenePass(
  ctx: RunCtx,
  o: { title: string; promise: string; language: string; sentences: readonly Doc2Sentence[]; hookS: number },
  diag: string[]
): Promise<Map<number, Doc2Scene>> {
  const parts: Doc2Sentence[][] = []
  let cur: Doc2Sentence[] = []
  let limit = o.hookS
  for (const s of o.sentences) {
    if (cur.length > 0 && s.start >= limit) {
      parts.push(cur)
      cur = []
      limit = s.start + 150
    }
    cur.push(s)
  }
  if (cur.length > 0) parts.push(cur)
  const out = new Map<number, Doc2Scene>()
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  let done = 0
  const one = async (part: Doc2Sentence[], k: number): Promise<void> => {
    const prompt = [
      languageLine(o.language),
      `Video: "${o.title}". Promise: ${o.promise}`,
      `Stretch ${k + 1} of ${parts.length}${k === 0 ? ' (the hook)' : ''}. Sentences (number · time · text):`,
      ...part.map((s) => `${s.n} · ${fmt(s.start)} · ${s.text}`),
      ...(ctx.notes.length > 0 ? ['Requested changes from the reviewer:', ...ctx.notes.map((n) => `- ${n}`)] : [])
    ].join('\n')
    const key = hashOf({ v: 5, rules: DOC2_SCENE_RULES, prompt: prompt.replace(/ · \d+:\d+ · /g, ' · '), seed: ctx.seed })
    const file = cacheDir ? path.join(cacheDir, `doc2-${key}.json`) : null
    let answer: z.infer<typeof Answer> | null = null
    if (file && existsSync(file)) answer = Answer.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
    if (!answer) {
      try {
        answer = await askJson(ctx, { role: 'director', system: DOC2_SCENE_RULES, prompt, schema: Answer })
        if (file) await atomicWrite(file, JSON.stringify(answer))
      } catch (e) {
        if (ctx.signal.aborted) throw e
        ctx.emit({ kind: 'log', level: 'warn', text: `scene pass, stretch ${k + 1}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}` })
        diag.push(`scenes ${fmt((part[0] as Doc2Sentence).start)}–${fmt((part.at(-1) as Doc2Sentence).end)}: the scene pass failed twice, key terms only`)
      }
    }
    const allowed = new Set(part.map((s) => s.n))
    for (const sc of answer?.scenes ?? []) if (allowed.has(sc.sentence)) out.set(sc.sentence, sc)
    progress(ctx, ++done, parts.length, `${done} passages sur ${parts.length}`)
  }
  for (let i = 0; i < parts.length; i += 2) await Promise.all(parts.slice(i, i + 2).map((part, j) => one(part, i + j)))
  return out
}

const COUNTRIES = ['france', 'germany', 'switzerland', 'italy', 'spain', 'britain', 'england', 'poland', 'austria', 'russia', 'japan', 'america', 'europe', 'belgium', 'netherlands', 'sweden', 'norway', 'denmark', 'portugal', 'mexico', 'china']
const DOCUMENT_WORDS = /\b(order|orders|letter|telegram|report|treaty|decree|memo|passport|law|lettre|ordre|rapport|traité|décret)\b/i

/** A scene from the sentence alone (fake mode, and a sentence the LLM left out): key terms as search words, what it says as texts. */
export function fakeScene(s: Doc2Sentence, beat: Beat | undefined): Doc2Scene {
  const terms = (beat?.keyTerms ?? []).filter((t) => t.length > 2).slice(0, 3)
  const words = s.text.replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3)
  const query = (terms.length > 0 ? terms.join(' ') : words.slice(0, 4).join(' ')).slice(0, 80) || 'archive'
  const year = /\b(1[0-9]{3}|20[0-2][0-9])\b/.exec(s.text)?.[1]
  const figures = [...s.text.matchAll(/\b\d[\d,.]*\b/g)].map((m) => m[0]).filter((x) => x !== year)
  const names = [...s.text.matchAll(/\b([A-Z][a-zà-ÿ]+ [A-Z][a-zà-ÿ]+)\b/g)].map((m) => m[1] as string).filter((n) => !COUNTRIES.some((c) => n.toLowerCase().includes(c)))
  const country = COUNTRIES.find((c) => s.text.toLowerCase().includes(c))
  const doc = DOCUMENT_WORDS.exec(s.text)
  const quoted = /[«“"]([^»”"]{3,60})[»”"]/.exec(s.text)?.[1]
  return {
    sentence: s.n,
    film: query,
    ...(words.length > 6 ? { photo: query } : {}),
    ...(names[0] ? { person: { name: names[0], query: names[0] } } : {}),
    ...(year ? { date: year } : {}),
    ...(figures.length === 1 ? { number: { text: figures[0] as string, label: words.slice(-2).join(' ').slice(0, 40) || 'total' } } : {}),
    ...(figures.length >= 2 ? { chart: { title: (terms[0] ?? 'Figures').slice(0, 60), rows: figures.slice(0, 4).map((f, i) => ({ label: `${i + 1}`, value: Number(f.replace(/,/g, '')) || i + 1, display: f })) } } : {}),
    ...(quoted ? { quote: quoted.trim() } : {}),
    ...(country ? { map: { title: country[0]?.toUpperCase() + country.slice(1), center: { lat: 47, lon: 8 }, zoom: 4, regions: [], pins: [], routes: [], facts: [] } } : {}),
    ...(doc ? { document: { title: doc[1] as string, text: s.text.slice(0, 300), mark: words.slice(0, 3).join(' ') || s.text.slice(0, 20) } } : {})
  }
}

const norm = (s: string): string[] => s.split(/\s+/).map((w) => normWord(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))).filter(Boolean)
/** True when every word of `text` is said in `said` (in order, case and accents aside). */
export function saidIn(text: string, said: string): boolean {
  const want = norm(text)
  const have = norm(said)
  if (want.length === 0) return false
  for (let k = 0; k + want.length <= have.length; k++) if (want.every((w, j) => have[k + j] === w)) return true
  return false
}
/** True when most words of `text` are words of `said` (titles and labels may reorder the narration's words). */
const mostlySaid = (text: string, said: string): boolean => {
  const have = new Set(norm(said))
  const want = norm(text)
  return want.length > 0 && want.filter((w) => have.has(w)).length / want.length >= 0.5
}

/** True when a boxed fact is said: its words among those said, its figure in digits or in words (« 26 CANTONS » for « twenty-six cantons »). */
export function factSaid(text: string, said: string): boolean {
  const have = norm(said)
  const words = norm(text)
  const numeric = (w: string): boolean => /^[\d.,]+$/.test(w)
  if (!words.filter((w) => !numeric(w)).every((w) => have.includes(w) || have.includes(`${w}s`) || have.includes(w.replace(/s$/, '')))) return false
  const spelled = new Set<string>()
  const raw = said.toLowerCase().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
  for (let i = 0; i < raw.length; i++) for (let n = 1; n <= 3; n++) spelled.add((digitsOf(raw.slice(i, i + n).join(' ')) ?? '').replace(/\D/g, ''))
  return words.filter(numeric).every((w) => have.includes(w) || spelled.has(w.replace(/\D/g, '')))
}

/**
 * The on-screen texts of a scene checked against what is said: names, dates, figures and quotes must be said in the sentence word for
 * word; labels and titles mostly in the stretch around it. A text that fails is dropped (its picture stays), counted in `dropped`.
 */
export function checkScene(sc: Doc2Scene, sentence: string, around: string): { scene: Doc2Scene; dropped: string[] } {
  const dropped: string[] = []
  const out: Doc2Scene = { ...sc }
  if (out.person && !saidIn(out.person.name, sentence)) {
    // the person is not named here: keep the portrait search, drop the name strip
    dropped.push(`name « ${out.person.name} »`)
    out.photo = out.photo ?? out.person.query
    delete out.person
  }
  if (out.date && !saidIn(out.date, sentence)) {
    dropped.push(`date « ${out.date} »`)
    delete out.date
  }
  if (out.number && !saidIn(out.number.text, sentence)) {
    dropped.push(`figure « ${out.number.text} »`)
    delete out.number
  }
  if (out.quote && !saidIn(out.quote, sentence)) {
    dropped.push(`quote « ${out.quote} »`)
    delete out.quote
  }
  if (out.place && !mostlySaid(out.place.name, around)) {
    dropped.push(`place « ${out.place.name} »`)
    delete out.place
  }
  if (out.photos) out.photos = out.photos.map((p) => (p.label && !mostlySaid(p.label, around) ? (dropped.push(`label « ${p.label} »`), { query: p.query, ...(p.on ? { on: p.on } : {}) }) : p))
  if (out.chart) {
    const rows = out.chart.rows.filter((r) => saidIn(r.display ?? String(r.value), sentence) || saidIn(String(r.value), sentence))
    if (rows.length < out.chart.rows.length) dropped.push(`${out.chart.rows.length - rows.length} chart value(s)`)
    if (rows.length === 0) delete out.chart
    else out.chart = { ...out.chart, rows }
  }
  if (out.map && out.map.facts.length > 0) {
    const facts = out.map.facts.filter((f) => factSaid(f.text, around))
    if (facts.length < out.map.facts.length) dropped.push(`${out.map.facts.length - facts.length} map fact(s)`)
    out.map = { ...out.map, facts }
  }
  if (out.document && !mostlySaid(out.document.text, around)) {
    dropped.push(`document « ${out.document.title} »`)
    delete out.document
  }
  return { scene: out, dropped }
}
