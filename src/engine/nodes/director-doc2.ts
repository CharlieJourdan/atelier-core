// `director.plan` for `documentary@2` (grammar `documentary-2`, research note documentary-2-2026-11 (old repository)): the scene pass says what the
// archives can show per sentence (doc2-scene.ts), the sequencer picks a varied, measured way to show each stretch (doc2-sequence.ts),
// and this file turns them into the edit plan: archive films cut into clips (old-TV frame or full), prints boards in their layouts,
// full-frame stills with a real zoom, tilted satellite maps, bar cards, documents underlined on their words, and the texts over the
// films (dates, figures, names, red bars, chapter titles) within the measured rates. Nothing is generated: every picture is an archive
// to find (`stock.photo` / `stock.video`, searched by `visuals.fulfil` in the public archives), every card is drawn.
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { buildTimeline } from '../formats/directives'
import { checkEditPlan, type GenItem, type Shot } from '../formats/editplan'
import { DOC_PALETTE } from '../formats/cards'
import { spokenNumbers, type SpokenNumber } from '../edit/numbers'
import { checkMotion } from '../formats/motion'
import type { Outline } from '../formats/outline'
import { FPS, toFrame, type Beat, type Word } from '../formats/timing'
import type { RunCtx } from '../registry'
import type { Json } from '../types'
import { progress } from './common'
import { wordOn } from './director-cards'
import { buildPlan, type BeatDraft, type DirectorParams } from './director-cuts'
import { sentencesOf, type Sentence } from './director-mix'
import { splitFigure } from './doc2-figures'
import { dateText, dateWord } from './doc2-texts'
import { languageOf } from '../review/checks'
import { boardMove, filmMove, map3dProps, stillMove } from './doc2-map'
import { DOC2_PROFILE, familyOf, type Doc2Profile } from './doc2-profile'
import { checkScene, doc2ScenePass, fakeScene, type Doc2Scene, type Doc2Sentence } from './doc2-scene'
import { familyShares, seededRng, sequenceDoc2, sequenceProblems, type Doc2Slot, type Doc2Unit } from './doc2-sequence'

/** A sentence longer than this is shown in two stretches (three past twice that). */
export const SPLIT_S = 9.5
/** In the first seconds (the hook's opening), a sentence longer than this is shown in two stretches. */
export const HOOK_FAST_S = 20
export const HOOK_SPLIT_S = 4.2
/** The shortest a card can be on screen; a shorter stretch is shown as film. */
const CARD_MIN_S: Record<string, number> = { prints: 2.5, map: 3, chart: 3, document: 3, still: 1.5, film: 0 }

const pad = (n: number): string => String(n).padStart(3, '0')
const bare = (x: string): string => x.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')
/** What a figure counts when the model did not say: the one or two words after it in the narration (« twenty-two cantons » → cantons). */
export function countedBy(said: string, figure: string): string | undefined {
  const w = said.split(/\s+/)
  const f = figure.split(/\s+/).map(bare)
  const at = w.findIndex((_, i) => f.every((x, j) => bare(w[i + j] ?? '') === x))
  if (at < 0) return undefined
  // (never past the end of its clause)
  const after = w.slice(at + f.length, at + f.length + 2)
  const stop = after.findIndex((x) => /[.,;:!?]$/.test(x))
  const next = after.slice(0, stop < 0 ? 2 : stop + 1).map(bare).filter((x) => x.length > 2 && !/^(of|the|and|des|les|de|du)$/.test(x))
  return next.length > 0 ? next.join(' ').slice(0, 40) : undefined
}
/** A figure as the reference writes it: in digits when the narration says it in words (« four million » → 4,000,000). */
const figure = (said: string): string => (splitFigure(said)?.digits ?? said).slice(0, 40)
/** What the figure counts: the model's label, else the words it wrote after the figure, else the words said after it. */
const counted = (n: { text: string; label?: string | undefined }, said: string): string | undefined => n.label ?? splitFigure(n.text)?.rest ?? countedBy(said, n.text)
const r3 = (x: number): number => Math.round(x * 1000) / 1000
const clip = (s: string | undefined, max: number): string | undefined => {
  const t = s?.trim()
  return t ? (t.length > max ? t.slice(0, max).trimEnd() : t) : undefined
}

/** The stretches to show: each sentence, a long one cut at the word nearest its middle (after a comma when there is one near). */
export function slotsOf(sentences: readonly Sentence[], words: readonly Word[], scenes: ReadonlyMap<number, Doc2Scene>, beats: readonly Beat[]): Doc2Slot[] {
  const out: Doc2Slot[] = []
  for (const s of sentences) {
    const scene = scenes.get(s.n) ?? { sentence: s.n }
    const opens = beats.find((b) => b.chapter && b.firstWord >= s.first && b.firstWord <= s.last)?.chapter
    const len = s.end - s.start
    // the hook is reactive (Charlie's second review: no 6-second board before anything happens): its sentences cut every ≈ 4 s
    const split = s.start < HOOK_FAST_S ? HOOK_SPLIT_S : SPLIT_S
    const parts = len > split * 2 ? 3 : len > split ? 2 : 1
    let from = s.start
    for (let k = 0; k < parts; k++) {
      let to = s.end
      if (k < parts - 1) {
        const want = s.start + (len * (k + 1)) / parts
        let best = -1
        let bestCost = Infinity
        for (let w = s.first + 1; w <= s.last; w++) {
          const t = (words[w] as Word).start
          if (t - from < 2.5 || s.end - t < 2.5) continue
          const comma = /[,;:]$/.test((words[w - 1] as Word).w) ? -1.2 : 0
          const cost = Math.abs(t - want) + comma
          if (cost < bestCost) {
            bestCost = cost
            best = w
          }
        }
        // no word to cut at: this part runs to the sentence's end (never a hole in the base track)
        if (best >= 0) to = (words[best] as Word).start
      }
      out.push({ sentence: s.n, start: from, end: to, scene, part: k, ...(k === 0 && opens ? { chapter: opens } : {}) })
      from = to
      if (to >= s.end) break
    }
  }
  return mergeShort(out)
}

/** A sentence shorter than this joins its neighbour (« Then Denmark. Norway. Belgium. »: the reference shows one board of them). */
export const SHORT_SLOT_S = 2.6
/** The things a scene shows as prints (its listed photographs, else its person or its photograph, labelled with its place). */
const printsOf = (sc: Doc2Scene): NonNullable<Doc2Scene['photos']> =>
  sc.photos ?? (sc.person ? [{ query: sc.person.query, label: sc.person.name }] : sc.photo ? [{ query: sc.photo, ...(sc.place ? { label: sc.place.name } : {}) }] : [])

/** Short consecutive stretches merged (at most 7 s together, never across a chapter): their pictures become one board's prints. */
export function mergeShort(slots: readonly Doc2Slot[]): Doc2Slot[] {
  const out: Doc2Slot[] = []
  for (const s of slots) {
    const prev = out.at(-1)
    const short = s.end - s.start < SHORT_SLOT_S || (prev !== undefined && prev.end - prev.start < SHORT_SLOT_S)
    // (in the hook's opening, never longer than a hook shot: Charlie's second review)
    if (prev && short && !s.chapter && s.end - prev.start <= (prev.start < HOOK_FAST_S ? HOOK_SPLIT_S + 0.5 : 7) && s.part === 0) {
      const listed = [...printsOf(prev.scene), ...printsOf(s.scene)].filter((x, i, a) => a.findIndex((y) => y.query === x.query) === i).slice(0, 4)
      const merged: Doc2Scene = { ...s.scene, ...prev.scene, ...(listed.length >= 2 ? { photos: listed } : {}) }
      out[out.length - 1] = { ...prev, end: s.end, scene: merged }
    } else out.push(s)
  }
  return out
}

interface Built {
  shots: Shot[]
  items: GenItem[]
  diag: string[]
  texts: Record<'date' | 'number' | 'name' | 'bar' | 'chapter', number>
}

/** Cut points inside [a, b) at word starts, about every `step` seconds, none closer than 1.6 s to another or to an edge. */
function clipCuts(words: readonly Word[], a: number, b: number, step: number): number[] {
  // (a clip as long as the reference's, never shorter: the number of clips rounds down)
  const n = Math.max(1, Math.floor((b - a) / step))
  const cuts: number[] = []
  for (let k = 1; k < n; k++) {
    const want = a + ((b - a) * k) / n
    const near = words.map((w) => w.start).filter((t) => t > a + 2.4 && t < b - 2.4 && (cuts.length === 0 || t > (cuts.at(-1) as number) + 2.4))
    const t = near.sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0]
    if (t !== undefined) cuts.push(t)
  }
  return cuts.sort((x, y) => x - y)
}

/** The word index where `text` (or its first word) is said between times a and b, as seconds from `from`; undefined when not found. */
function atOf(words: readonly Word[], a: number, b: number, text: string | undefined, from: number, lead: number): number | undefined {
  if (!text) return undefined
  const i0 = words.findIndex((w) => w.start >= a - 1e-6)
  let i1 = words.findIndex((w) => w.start >= b - 1e-6)
  if (i0 < 0) return undefined
  if (i1 < 0) i1 = words.length
  const k = wordOn(words, i0, Math.max(i0, i1 - 1), text)
  return k === null ? undefined : Math.max(0.15, Math.round(((words[k] as Word).start - from + lead) * 100) / 100)
}

/** The plan's shots and items from the units. */
export function buildDoc2(o: {
  units: readonly Doc2Unit[]
  words: readonly Word[]
  sentences: readonly Sentence[]
  beats: readonly Beat[]
  D: number
  seed: string
  profile?: Doc2Profile
  /** Proposals (never the faithful default): the boards on a kraft file folder with stamps, the maps as parchment. */
  skin?: 'reference' | 'dossier'
  mapLook?: 'satellite' | 'parchment'
  /** The factors and shares the voice says (« twenty times »), set on their word over the films. */
  spoken?: readonly SpokenNumber[]
}): Built {
  const dossier = o.skin === 'dossier'
  const P = o.profile ?? DOC2_PROFILE
  const lang = languageOf(o.words)
  const rnd = seededRng(`doc2-build|${o.seed}`)
  const shots: Shot[] = []
  const items: GenItem[] = []
  const diag: string[] = []
  const texts = { date: 0, number: 0, name: 0, bar: 0, chapter: 0 }
  const cap = (k: keyof Doc2Profile['textsPerMin'], t: number): boolean => texts[k as keyof typeof texts] < 1 + (P.textsPerMin[k] * 1.5 * Math.max(t, 60)) / 60
  const spec = (template: string, props: Record<string, unknown>): Record<string, unknown> => ({ template, props, accent: DOC_PALETTE.red, theme: 'dark' })
  const beatAt = (t: number): Beat => o.beats.find((b) => t + 9 / FPS >= b.start && t + 9 / FPS < b.end) ?? (o.beats.at(-1) as Beat)
  const saidIn = (a: number, b: number): string => o.words.filter((w) => w.start >= a - 1e-6 && w.start < b - 1e-6).map((w) => w.w).join(' ')
  let n = 0
  const item = (kind: 'stock.photo' | 'stock.video', query: string, a: number, b: number, shotId: string, subject: string, alt?: string): GenItem => {
    const s = o.sentences.find((x) => a >= x.start - 1e-6 && a < x.end) ?? (o.sentences[0] as Sentence)
    const it: GenItem = {
      id: `item-${pad(++n)}`,
      kind,
      query: query.slice(0, 80),
      ...(alt && alt.trim() && alt.trim() !== query.trim() ? { alt: alt.trim().slice(0, 80) } : {}),
      constraints: { durationS: r3(b - a), aspect: '16:9' },
      context: { beatText: s.text.slice(0, 2000), subject: subject.slice(0, 200), keyTerms: query.split(/\s+/).slice(0, 6), said: saidIn(a, b).slice(0, 1000), atS: r3(a) },
      unitPrice: 0,
      units: 1,
      priority: 1,
      shotIds: [shotId]
    }
    items.push(it)
    return it
  }
  const base = (id: string, a: number, b: number, kind: Shot['kind'], extra: Partial<Shot>, anchor?: string): Shot => {
    const sh: Shot = { id, track: 'base', startFrame: Math.round(a * FPS), endFrame: Math.round(b * FPS), kind, transitionIn: 'cut', role: 'scene', beat: beatAt(a).i, ...(anchor ? { anchor } : {}), ...extra }
    shots.push(sh)
    return sh
  }
  let shotN = 0
  const filmQueries = new Map<string, number>()
  // the first map of the hook and of the body arrives with the large move
  const arrived = { hook: false, body: false }
  for (const [ui, u] of o.units.entries()) {
    const sc = u.slots[0]?.scene as Doc2Scene
    const fam = familyOf(u.pattern)
    const a = u.start
    const b = u.end
    const anchor = saidIn(a, Math.min(b, a + 3)).split(' ').slice(0, 4).join(' ') || undefined
    const id = `s${pad(++shotN)}`
    const lead = P.landLeadS
    const film = (): void => {
      // a montage of clips of the same subject, each a different moment of the archives (the fulfiller takes the next candidate)
      const query = clip(sc.film ?? sc.photo ?? sc.person?.query, 80) ?? (saidIn(a, b).split(' ').filter((w) => w.length > 3).slice(0, 4).join(' ') || 'archive film')
      const cuts = [a, ...clipCuts(o.words, a, b, P.filmClipS), b]
      const tags: Record<string, unknown>[] = []
      const chapter = u.slots[0]?.chapter
      if (chapter && texts.chapter < 12) {
        tags.push({ kind: 'chapter', text: clip(chapter, 60), atS: 0.4 })
        texts.chapter++
      } else {
        // a date only where its year is said (a sentence cut in two said it in its first part: not again in the second)
        const dateAt = sc.date ? atOf(o.words, a, b, dateWord(sc.date), a, lead) : undefined
        if (sc.date && dateAt !== undefined && cap('date', a)) {
          tags.push({ kind: 'date', text: dateText(sc.date, lang), atS: dateAt })
          texts.date++
        }
        if (sc.number && cap('number', a)) {
          tags.push({ kind: 'number', text: figure(sc.number.text), sub: clip(counted(sc.number, saidIn(a, b)), 60), atS: atOf(o.words, a, b, sc.number.on ?? sc.number.text, a, lead) ?? 0.4 })
          texts.number++
        } else if (sc.person && cap('name', a)) {
          tags.push({ kind: 'name', text: sc.person.name, ...(sc.person.role ? { sub: clip(sc.person.role, 60) } : {}), atS: atOf(o.words, a, b, sc.person.name, a, lead) ?? 0.4 })
          texts.name++
        } else if (sc.quote && cap('bar', a)) {
          tags.push({ kind: 'bar', text: clip(sc.quote, 60), atS: atOf(o.words, a, b, sc.quote, a, lead) ?? 0.5 })
          texts.bar++
        }
      }
      for (let k = 0; k + 1 < cuts.length; k++) {
        const ca = cuts[k] as number
        const cb = cuts[k + 1] as number
        const sid = k === 0 ? id : `s${pad(++shotN)}`
        const variant = filmQueries.get(query) ?? 0
        filmQueries.set(query, variant + 1)
        const it = item('stock.video', query, ca, cb, sid, variant > 0 ? `${query} (${variant + 1})` : query, sc.broad)
        base(sid, ca, cb, 'stock.video', { genItem: it.id, film: rnd() < P.filmFullShare ? 'full' : 'tv', motion: filmMove(P, cb - ca), ...(sc.colour ? { colour: true } : {}) }, k === 0 ? anchor : undefined)
      }
      // a factor or a share said aloud: written on its word (« ×20 »), serif like the reference's big figures, unless a figure is already there
      const said = o.spoken?.find((x) => (x.kind === 'times' || x.kind === 'percent') && x.atS >= a && x.atS < b - 1)
      if (said && !tags.some((t) => t.kind === 'number' || t.kind === 'chapter') && cap('number', a)) {
        const from = Math.max(a, said.atS - 0.15)
        const to = Math.min(b, from + 2.6)
        const g = spec('kinetic', { words: [{ text: said.text, atS: 0.15, emphasis: true }], style: 'pop', position: 'upper', face: 'serif' })
        if (to - from >= 1.5 && checkMotion(g, to - from).length === 0) {
          shots.push({ id: `k${pad(ui + 1)}`, track: 'overlay', startFrame: Math.round(from * FPS), endFrame: Math.round(to * FPS), kind: 'motion', graphic: g as Shot['graphic'], transitionIn: 'cut', role: 'scene', beat: beatAt(from).i })
          texts.number++
        }
      }
      const usable = tags.filter((t) => typeof t.atS === 'number' && (t.atS as number) < b - a - 0.8)
      if (usable.length > 0 && b - a >= 1.5) {
        const g = spec('doc-tags', { tags: usable.slice(0, 2) })
        const problems = checkMotion(g, b - a)
        if (problems.length === 0) shots.push({ id: `t${pad(ui + 1)}`, track: 'overlay', startFrame: Math.round(a * FPS), endFrame: Math.round(b * FPS), kind: 'motion', graphic: g as Shot['graphic'], transitionIn: 'cut', role: 'scene', beat: beatAt(a).i })
        else diag.push(`texts over the film at ${a.toFixed(1)} s left out: ${problems[0]}`)
      }
    }
    const card = (template: string, props: Record<string, unknown>, extra: Partial<Shot> = {}): boolean => {
      const g = spec(template, props)
      const problems = checkMotion(g, b - a)
      if (problems.length > 0) {
        diag.push(`${u.pattern} at ${a.toFixed(1)} s shown as film: ${problems.slice(0, 2).join('; ')}`)
        return false
      }
      base(id, a, b, 'motion', { graphic: g as Shot['graphic'], ...extra }, anchor)
      return true
    }
    if (b - a < (CARD_MIN_S[fam] ?? 0) - 1e-6) {
      film()
      continue
    }
    let ok = true
    if (fam === 'film') film()
    else if (fam === 'still') {
      const it = item('stock.photo', clip(sc.photo ?? sc.film, 80) ?? 'archive photograph', a, b, id, sc.photo ?? 'still', sc.broad)
      base(id, a, b, 'stock.photo', { genItem: it.id, motion: stillMove(P, rnd), ...(sc.colour ? { colour: true } : {}) }, anchor)
    } else if (fam === 'prints') {
      const several = u.pattern.startsWith('prints-') && (sc.photos?.length ?? 0) >= 2
      const pics = several
        ? (sc.photos ?? []).slice(0, Number(u.pattern.slice(-1)))
        : [{ query: sc.person?.query ?? sc.photo ?? sc.film ?? 'archive photograph', label: sc.person?.name, on: sc.person?.name }]
      // a film played inside the print (the reference's hook boards), when the stretch has a film and no person to show
      const inPrint = !several && !sc.person && sc.film !== undefined && rnd() < (a < P.hookS ? P.printFilm.hook : P.printFilm.body)
      const colour = sc.colour ? { colour: true } : {}
      const props: Record<string, unknown> = {
        surface: dossier ? 'manila' : u.cream ? 'paper' : 'slate',
        layout: u.pattern === 'print-large' ? 'large' : u.pattern === 'print-side' ? 'side' : u.pattern === 'print-centre' ? 'centre' : 'auto',
        prints: pics.map((x, k) => {
          // the first print lands at once (the reference never shows an empty board), the others on their words, before the board ends
          const at = k === 0 ? 0.15 : Math.min(b - a - 1, atOf(o.words, a, b, x.on ?? x.label, a, lead) ?? 0.15 + k * Math.min(0.9, (b - a) / (pics.length + 1)))
          if (several) return { atS: at, ...colour, ...(x.label ? { label: clip(x.label, 40), tag: dossier ? 'stamp' : 'typed' } : {}) }
          if (sc.person && cap('name', a)) {
            texts.name++
            return { atS: 0.15, label: clip(sc.person.name, 40), ...(sc.person.role ? { sub: clip(sc.person.role, 60) } : {}), tag: 'torn', labelAtS: (atOf(o.words, a, b, sc.person.name, a, lead) ?? 0.6) + 0.1 }
          }
          if (sc.place && u.pattern !== 'print-side') return { atS: 0.15, ...colour, ...(inPrint ? { film: true } : {}), label: clip(sc.place.name, 40), ...(sc.place.sub ? { sub: clip(sc.place.sub, 60) } : {}), tag: 'box', labelAtS: (atOf(o.words, a, b, sc.place.name, a, lead) ?? 0.6) + 0.1 }
          return { atS: 0.15, ...colour, ...(inPrint ? { film: true } : {}) }
        }),
        ...boardMove(P, u.pattern, b - a, rnd),
        ...(several && rnd() < P.reflowShare ? { reflow: true } : {})
      }
      const side: Record<string, unknown>[] = []
      const bars: Record<string, unknown>[] = []
      if (u.pattern === 'print-side') {
        if (sc.number && cap('number', a)) {
          side.push({ kind: 'number', text: figure(sc.number.text), sub: clip(counted(sc.number, saidIn(a, b)), 60), atS: atOf(o.words, a, b, sc.number.on ?? sc.number.text, a, lead) ?? 0.9 })
          texts.number++
        }
        const dateAt = sc.date ? atOf(o.words, a, b, dateWord(sc.date), a, lead) : undefined
        if (sc.date && dateAt !== undefined && cap('date', a)) {
          side.push({ kind: 'date', text: dateText(sc.date, lang), atS: dateAt })
          texts.date++
        }
        if (sc.place && !sc.person) side.push({ kind: 'box', text: clip(sc.place.name, 40), ...(sc.place.sub ? { sub: clip(sc.place.sub, 60) } : {}), atS: atOf(o.words, a, b, sc.place.name, a, lead) ?? 1 })
      } else if (sc.date && atOf(o.words, a, b, dateWord(sc.date), a, lead) !== undefined && cap('date', a)) {
        props.date = { text: dateText(sc.date, lang), atS: atOf(o.words, a, b, dateWord(sc.date), a, lead) as number }
        texts.date++
      }
      if (sc.quote && cap('bar', a)) {
        bars.push({ text: clip(sc.quote, 60), atS: atOf(o.words, a, b, sc.quote, a, lead) ?? Math.min(b - a - 1, 1.2), ...(u.pattern === 'print-side' ? {} : { over: 0 }) })
        texts.bar++
      }
      if (side.length > 0) props.side = side.slice(0, 2)
      if (bars.length > 0) props.bars = bars
      const first = pics[0] as { query: string }
      const it0 = inPrint ? item('stock.video', clip(sc.film, 80) as string, a, b, id, sc.film as string, sc.broad) : item('stock.photo', first.query, a, b, id, first.query, sc.broad)
      const also = pics.slice(1).map((x) => item('stock.photo', x.query, a, b, id, x.query, sc.broad).id)
      ok = card('prints', props, { genItem: it0.id, ...(also.length > 0 ? { alsoItems: also } : {}) })
      if (!ok) items.splice(items.length - pics.length, pics.length)
    } else if (fam === 'map' && sc.map) {
      const m = sc.map
      const part = a < P.hookS ? 'hook' : 'body'
      ok = card('map3d', map3dProps(m, { d: b - a, arrival: !arrived[part], rnd, P, look: o.mapLook ?? 'satellite', atOf: (on) => atOf(o.words, a, b, on, a, lead) }))
      if (ok) arrived[part] = true
    } else if (fam === 'chart' && sc.chart) {
      const top = Math.max(...sc.chart.rows.map((r) => r.value))
      const at = (r: { on?: string | undefined; display?: string | undefined }, k: number): number => atOf(o.words, a, b, r.on ?? r.display, a, lead) ?? 0.6 + k * 0.8
      const rows = sc.chart.rows
      // a kind other than bars only when the reference uses it (the profile): a line over time, big counters
      const kind = sc.chart.kind !== undefined && P.chartKinds.includes(sc.chart.kind) ? sc.chart.kind : 'bars'
      if (kind === 'counters' && rows.length <= 4)
        ok = card('chart', { ...(sc.chart.kicker ? { kicker: clip(sc.chart.kicker, 50) } : {}), title: clip(sc.chart.title, 60), kind: 'counters', counters: rows.map((r, k) => ({ label: clip(r.label, 40), value: r.value, atS: at(r, k) })) })
      else if (kind === 'line' && rows.length >= 2)
        ok = card('chart', { ...(sc.chart.kicker ? { kicker: clip(sc.chart.kicker, 50) } : {}), title: clip(sc.chart.title, 60), kind: 'line', points: rows.map((r) => ({ label: clip(r.label, 12), value: r.value, ...(r.display ? { display: clip(r.display, 16) } : {}) })), atS: 0.6, drawS: Math.max(1, b - a - 1.5) })
      else ok = card('bars', {
        ...(sc.chart.kicker ? { kicker: clip(sc.chart.kicker, 50) } : {}),
        title: clip(sc.chart.title, 60),
        rows: sc.chart.rows.map((r, k) => ({ label: clip(r.label, 40), value: r.value, ...(r.display ? { display: clip(r.display, 16) } : {}), accent: r.value === top, atS: atOf(o.words, a, b, r.on ?? r.display, a, lead) ?? 0.6 + k * 0.8 }))
      })
    } else if (fam === 'document' && sc.document) {
      const doc = sc.document
      const mark = doc.text.toLowerCase().includes(doc.mark.toLowerCase()) ? doc.mark : doc.text.split(/\s+/).slice(0, 5).join(' ')
      // a real scan when the words name one: `motion.render` looks for the key line on it, else this typed page is drawn
      const scan = doc.scan ? item('stock.photo', doc.scan, a, b, id, doc.scan, sc.broad) : undefined
      ok = card(
        'document',
        {
          paper: 'typed',
          heading: clip(doc.title, 60),
          text: clip(doc.text, 700),
          ...(doc.source ? { source: clip(doc.source, 70) } : {}),
          marks: [{ phrase: clip(mark, 120), atS: atOf(o.words, a, b, mark, a, lead) ?? Math.min(b - a - 0.8, 1.2), style: 'underline' }],
          camera: 'follow',
          ...(scan ? { scan: { find: clip(doc.text, 320) } } : {})
        },
        scan ? { genItem: scan.id } : {}
      )
      if (!ok && scan) items.pop()
    } else ok = false
    // a card that does not draw (or has nothing to draw) is shown as film, said in the diagnostics
    if (!ok) film()
  }
  // the reference leaves a map, a chart or a document by a cross-fade, and comes into one the same way; everything else is a hard cut
  const baseShots = shots.filter((s) => s.track === 'base').sort((x, y) => x.startFrame - y.startFrame)
  baseShots.forEach((s, i) => {
    const prev = baseShots[i - 1]
    const isCard = (x: Shot | undefined): boolean => x?.kind === 'motion' && ['map3d', 'bars', 'document'].includes((x.graphic as { template?: string } | undefined)?.template ?? '')
    if (i > 0 && (isCard(s) || isCard(prev))) s.transitionIn = 'dissolve'
  })
  return { shots, items, diag, texts }
}

export async function directDoc2(
  ctx: RunCtx,
  o: { beats: Beat[]; words: Word[]; outline: Outline; D: number; diagnostics: string[] },
  p: DirectorParams,
  useClaude: boolean
): Promise<NodeOutputs> {
  const { beats, words, outline, D } = o
  const diag = [...o.diagnostics]
  const sentences = sentencesOf(words, D)
  const ds: Doc2Sentence[] = sentences.map((s) => ({ n: s.n, start: s.start, end: s.end, text: s.text }))
  const scened = useClaude && p.scenePass
  const asked = scened ? await doc2ScenePass(ctx, { title: outline.title, promise: outline.promise, language: outline.language, sentences: ds, hookS: DOC2_PROFILE.hookS }, diag) : new Map<number, Doc2Scene>()
  // every scene's texts are checked against what is said (the text-check rule, free); a sentence the pass left out gets its key terms
  const scenes = new Map<number, Doc2Scene>()
  let dropped = 0
  for (const s of ds) {
    const beat = beats.find((b) => b.firstWord <= (sentences[s.n - 1] as Sentence).first && b.lastWord >= (sentences[s.n - 1] as Sentence).first)
    const raw = asked.get(s.n) ?? fakeScene(s, beat)
    const around = ds.filter((x) => Math.abs(x.n - s.n) <= 2).map((x) => x.text).join(' ')
    const checked = checkScene(raw.film || raw.photo || raw.person || raw.photos ? raw : { ...raw, ...fakeScene(s, beat), ...raw }, s.text, around)
    dropped += checked.dropped.length
    scenes.set(s.n, checked.scene)
  }
  if (dropped > 0) diag.push(`text check: ${dropped} on-screen text(s) not said by the narration left out`)
  const slots = slotsOf(sentences, words, scenes, beats)
  const units = sequenceDoc2(slots, { seed: String(ctx.seed) })
  for (const pr of sequenceProblems(units)) diag.push(`sequence: ${pr}`)
  const lang = outline.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
  const built = buildDoc2({ units, words, sentences, beats, D, seed: String(ctx.seed), spoken: spokenNumbers(words, lang), ...(p.docSkin ? { skin: p.docSkin } : {}), ...(p.docMapLook ? { mapLook: p.docMapLook } : {}) })
  const shares = familyShares(units)
  diag.push(`documentary-2: ${units.length} units — ${Object.entries(shares).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(', ')}; texts ${Object.entries(built.texts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  const drafts = new Map<number, BeatDraft>(beats.map((b) => [b.i, { beat: b.i, subject: b.text.slice(0, 200), stockQuery: b.text.slice(0, 80), imagePrompt: b.text.slice(0, 600), labels: [] }]))
  const result = buildPlan({ beats, words, durationS: D, title: outline.title, script: words.map((w) => w.w).join(' '), parsed: null, drafts, p, seed: ctx.seed, diagnostics: [...diag, ...built.diag], track: { shots: built.shots, items: built.items } })
  const problems = checkEditPlan(result.plan, result.list, toFrame(D))
  if (problems.length > 0) throw new EngineError('schema', `the documentary plan failed its check: ${problems.slice(0, 4).join('; ')}`)
  const { plan, list } = result
  const timeline = buildTimeline(plan, list, words)
  progress(ctx, 1, 1, `${plan.tracks.base.length} plans, ${list.items.length} archives à trouver`)
  return {
    plan: { value: plan as unknown as Json, meta: { frames: plan.frames, shots: plan.tracks.base.length, labels: plan.tracks.labels.length, mode: 'documentary-2', demo: !scened } },
    genlist: { value: list as unknown as Json, meta: { credits: list.totals.credits, items: list.totals.items, stock: (list.totals.byKind['stock.photo'] ?? 0) + (list.totals.byKind['stock.video'] ?? 0) } },
    directives: { value: [], meta: { mode: 'documentary-2', count: 0, demo: !scened } },
    timeline: { value: timeline as unknown as Json, meta: { shots: timeline.shots.length, overlays: timeline.overlays.length, units: units.map((u) => u.pattern).join(' ') } }
  }
}
