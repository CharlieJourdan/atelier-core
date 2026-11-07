// The scene pass of the mix director (docs/specs/production-model.md §7.2, pipeline-avatar.md §2.4 step 2): one LLM call
// per stretch (the opening minute, then ~2.5 minutes), 2 at a time. Each call gets the numbered sentences, who is on screen
// for each (the presenter's shots are placed before, by code), and the stretch's picture budget per kind from the curve;
// it answers `json.directives` (what to show on which words, never a time) and the objects that come back, each with ONE
// fixed description the code writes into every prompt that shows it. `fakeDirectives` is the same pass without an LLM
// (the node's fake, and a stretch whose call failed twice).
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EngineError } from '../errors'
import { z } from 'zod'
import { Directive } from '../formats/directives'
import type { Outline } from '../formats/outline'
import type { Word } from '../formats/timing'
import type { RunCtx } from '../registry'
import { cultureLine } from '../text/locale'
import { keyTerms, normWord } from '../text/script'
import { askJson, atomicWrite, hashOf, languageLine, progress } from './common'
import { PICTURE_KINDS, SHOT_LENGTHS, cutBefore, type Part, type PictureKind, type ScreenParams, type Sentence, type Slot } from './director-mix'
import { FACETS } from './director-variety'
import { ILLUSTRATION_RULES } from './director-grammars'

const SceneDirective = Directive.extend({ ref: z.string().trim().min(1).max(60).optional() })
type SceneDirective = z.infer<typeof SceneDirective>
const Recurring = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(300) })
export type Recurring = z.infer<typeof Recurring>
export const SceneAnswer = z.object({ directives: z.array(SceneDirective).max(300), recurring: z.array(Recurring).max(20).default([]) })
export type SceneAnswer = z.infer<typeof SceneAnswer>

const PEOPLE: Record<ScreenParams['people'], string> = {
  anyone: 'People may appear in the pictures (never a real named person).',
  'not-presenter': 'Other people may appear in the pictures, never the presenter, never a real named person.',
  'presenter-as-actor': 'The presenter may act the scene in the pictures (write « the presenter » in the prompt); other people may appear, never a real named person.',
  nobody: 'No person in the pictures: show objects, places and hands at most.'
}

/** The stable system text of the scene pass (cache-friendly: it changes only with the channel's settings). */
export function sceneRules(s: ScreenParams): string {
  const split = s.layouts.includes('split')
  const pip = s.layouts.includes('pip')
  return [
    'You are the Director of a narrated YouTube video: an AI presenter talks to camera, and pictures illustrate what is said at the moment it is said.',
    'The code has already placed the presenter on screen; you decide WHAT the pictures show and ON WHICH WORDS each new picture starts. You never give a time.',
    'Rules:',
    '- For every sentence that shows pictures, one directive per picture change, about one every 3 to 4 seconds of picture time. anchor = 1 to 6 words copied EXACTLY from that sentence, starting ON the noun or verb that names what the picture shows (« un spray du supermarché », « repeint le coin »), never on the words before it (« L’an dernier, vous l’aviez… »): the picture is cut exactly there and lasts until the next anchor, 2.5 to 4.5 s.',
    '- The picture follows the words: show what the narrator is talking about at that moment, not the first noun of the sentence.',
    // the pipeline's measured illustration preset, when it has one (avatar@1: its references' literal grammar, record 0055)
    ...(s.illustration ? ILLUSTRATION_RULES[s.illustration] : []),
    `- kind: one of ${PICTURE_KINDS.join(', ')} (only the kinds of the budget). Keep each kind close to its budget for the stretch. clipAi = a short generated video with one clear action; imageAi = a generated still; stock = found stock video; archive = a found archive photo.`,
    '- prompt (clipAi, imageAi): in English, one concrete subject, the shot size, the action when there is one (« a gloved hand takes a dish out of the oven »), light and setting; no text, letters or numbers in the picture.',
    s.cards
      ? '- query (stock, archive): 2 to 5 concrete English words an archive search can match (see the rules above for names).'
      : '- query (stock, archive): 2 to 4 concrete English words a stock library can match; never a person name or a brand.',
    ...(s.cards
      ? [
          '- Documentary cards: besides the picture kinds, a directive may be a card (kind motion.map, motion.bars or motion.timeline, with "card": {"template": "map"|"bars"|"timeline", "hold": <sentences>, "props": {…}}) within the stretch\'s card budget, and an archive or imageAi directive may carry "frame": {"frame": "board"|"paper"|"full"|"tv", "label", "sub", "punch", "lines", "excerpt", "mark", "source", "quote"}.'
        ]
      : []),
    // a documentary shows real people of the past in their found archives (their portraits), never in a made picture
    s.cards && s.people === 'anyone' ? '- People may appear. A real named person only in a found archive (their real portrait or photograph, kind archive); never in a generated picture.' : `- ${PEOPLE[s.people]}`,
    s.brands === 'none' ? '- No logo or brand name anywhere: generic products only.' : '- Real brands may appear when the narration names them.',
    s.repeatWindowS > 0
      ? `- Within ${s.repeatWindowS} seconds no two pictures show the same subject (the same object, wall, corner or room), unless it is ONE continuing action, and then the second picture shows that action, closer. Every picture is a different directive with its own subject and prompt; the same picture is never shown twice.`
      : '- Consecutive pictures change subject, setting or shot size; the same picture is never shown twice. The same object or place twice in a row only for ONE continuing action, and then the second picture shows that action, closer.',
    '- A sentence lists how many pictures the code will cut on it (« pictures: n »): give it exactly that many directives, each on its own words.',
    '- text: optional, only a figure, a date, a name or a place the sentence SAYS, copied exactly; it is written on screen.',
    '- A distinctive object or character that comes back in several sentences (a car, a pet, a tool, a person) gets ONE fixed description: list it once in "recurring" ({"name","description"}) and set "ref" to its name in every directive that shows it. Never a plain wall, corner, floor or room: they would make every picture look alike.',
    s.presenterLayouts
      ? '- Every sentence marked P (the presenter is on screen) also gets ONE directive with "layout":"split", kind imageAi, on its own words: the code shows that still beside the presenter or behind him, as the pipeline measured.'
      : split || pip
      ? `- A sentence marked P (the presenter is on screen) needs no directive, except: when its subject is very visual, ONE directive with "layout":"${split ? 'split' : 'pip'}" shows that picture ${split ? 'beside the presenter' : 'with the presenter in a corner'} (at most one sentence in three).`
      : '- A sentence marked P (the presenter is on screen) needs no directive.',
    '- why: a few words on why this picture here.',
    ...(s.locale ? [`- ${cultureLine(s.locale)}`] : []),
    ...(s.objectNotes?.length ? ['- Draw these objects exactly as they really are:', ...s.objectNotes.map((n) => `  · ${n}`)] : []),
    ...(s.styleRules ? ['This channel\'s look:', s.styleRules] : []),
    `Answer with ONE JSON object: {"directives":[{"sentence":<n>,"anchor":"…","kind":"…","subject":"…","prompt":"…","query":"…","layout":"…","text":"…",${s.cards ? '"card":{…},"frame":{…},' : ''}"why":"…","ref":"…"}],"recurring":[{"name":"…","description":"…"}]} — omit the optional fields you do not use; nothing else.`
  ].join('\n')
}

/** Stretches of sentences: the opening (`hookSpanS`), then ~150 s each (ENGINE-SPEC §21.2 step 1). */
export function sentenceStretches(sentences: readonly Sentence[], hookSpanS: number, stretchS = 150): Sentence[][] {
  const out: Sentence[][] = []
  let cur: Sentence[] = []
  let limit = hookSpanS > 0 ? hookSpanS : stretchS
  for (const s of sentences) {
    if (cur.length > 0 && s.start >= limit) {
      out.push(cur)
      cur = []
      limit = s.start + stretchS
    }
    cur.push(s)
  }
  if (cur.length > 0) out.push(cur)
  return out
}

const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c))

/** Seconds of picture time per kind a stretch should show: its time off the presenter, split by the curve's shares. */
export function stretchBudget(part: readonly Sentence[], slots: readonly Slot[], parts: readonly Part[]): Partial<Record<PictureKind, number>> {
  const a = (part[0] as Sentence).start
  const b = (part.at(-1) as Sentence).end
  const out: Partial<Record<PictureKind, number>> = {}
  for (const p of parts) {
    const span = overlap(a, b, p.fromS, p.toS)
    if (span <= 0) continue
    const presenter = slots.reduce((n, s) => n + overlap(s.start, s.end, Math.max(a, p.fromS), Math.min(b, p.toS)), 0)
    const total = PICTURE_KINDS.reduce((n, k) => n + (p.shares[k] ?? 0), 0)
    if (total <= 0) continue
    for (const k of PICTURE_KINDS) if ((p.shares[k] ?? 0) > 0) out[k] = (out[k] ?? 0) + ((span - presenter) * (p.shares[k] as number)) / total
  }
  return out
}

/** How each sentence is shown before the scene pass: the presenter all along, the presenter then pictures, or pictures. */
function onScreen(s: Sentence, slots: readonly Slot[], words: readonly Word[]): { mark: 'P' | 'P+' | '-'; from: number } {
  const sl = slots.find((x) => x.start < s.end - 1e-9 && x.end > s.start + 1e-9)
  if (!sl) return { mark: '-', from: s.first }
  if (sl.end >= s.end - 1e-9 && sl.start <= s.start + 1e-9) return { mark: 'P', from: s.last + 1 }
  let k = s.first
  while (k <= s.last && cutBefore(words, k) < sl.end - 1e-9) k++
  return { mark: k > s.last ? 'P' : 'P+', from: k }
}

const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export function stretchPrompt(o: {
  outline: Outline
  part: readonly Sentence[]
  k: number
  of: number
  slots: readonly Slot[]
  parts: readonly Part[]
  words: readonly Word[]
  notes: readonly string[]
  /** Pictures the code cuts per sentence (a fill without directives): the scene pass gives that many directives. */
  counts?: ReadonlyMap<number, number>
}): string {
  const budget = stretchBudget(o.part, o.slots, o.parts)
  // documentary cards: their seconds in this stretch, from the mix's motion share (director-cards.ts places them)
  const a = (o.part[0] as Sentence).start
  const b = (o.part.at(-1) as Sentence).end
  const cardS = o.parts.reduce((n, p) => n + Math.max(0, Math.min(b, p.toS) - Math.max(a, p.fromS)) * (p.shares.motion ?? 0), 0)
  const lines = Object.entries(budget)
    .filter(([, v]) => (v as number) >= 1)
    .map(([k, v]) => `${k} ≈ ${Math.round(v as number)} s (about ${Math.max(1, Math.round((v as number) / SHOT_LENGTHS[k as PictureKind]))} pictures)`)
  return [
    languageLine(o.outline.language),
    `Video: "${o.outline.title}". Promise: ${o.outline.promise}`,
    `Stretch ${o.k + 1} of ${o.of}, ${fmt((o.part[0] as Sentence).start)}–${fmt((o.part.at(-1) as Sentence).end)}${o.k === 0 ? ' (the opening: it must hold the viewer)' : ''}.`,
    `Picture budget of this stretch: ${lines.length > 0 ? lines.join(', ') : 'none (the presenter only)'}.`,
    ...(cardS >= 4 ? [`Card budget of this stretch (maps, data cards, timelines): about ${Math.round(cardS)} s, one card holds 6 to 30 s.`] : []),
    'Sentences (number · on screen: P = the presenter, P+ = the presenter then pictures from the quoted words, - = pictures · text):',
    ...o.part.map((s) => {
      const on = onScreen(s, o.slots, o.words)
      const from = on.mark === 'P+' ? ` from «${o.words.slice(on.from, on.from + 3).map((w) => w.w).join(' ')}»` : ''
      return `${s.n} · ${on.mark}${from} · ${s.text}`
    }),
    ...(o.counts && o.part.some((s) => (o.counts?.get(s.n) ?? 0) > 0)
      ? [`Pictures per sentence: ${o.part.flatMap((s) => ((o.counts?.get(s.n) ?? 0) > 0 ? [`${s.n} · pictures: ${o.counts?.get(s.n)}`] : [])).join(', ')}.`]
      : []),
    ...(o.notes.length > 0 ? ['Requested changes from the reviewer:', ...o.notes.map((n) => `- ${n}`)] : [])
  ].join('\n')
}

/** Directives without an LLM: one per ~3.6 s of picture time, on the words there, kinds after the stretch's budget. */
/** The directives made without the LLM: their subjects are the sentence's key terms, not a described scene. */
const FAKE = new WeakSet<object>()
/** A directive of `fakeDirectives` (the « motion only where it is seen » rule has no scene to judge in it). */
export const isFakeDirective = (d: object): boolean => FAKE.has(d)
/** Marks a directive derived from a fake one (another angle on the same key terms) as fake too. */
export const asFakeDirective = <T extends object>(d: T): T => (FAKE.add(d), d)

export function fakeDirectives(part: readonly Sentence[], slots: readonly Slot[], parts: readonly Part[], words: readonly Word[], screen: ScreenParams, language?: string): SceneAnswer {
  const budget = stretchBudget(part, slots, parts)
  const kinds = PICTURE_KINDS.filter((k) => (budget[k] ?? 0) > 0)
  const done: Record<string, number> = {}
  const directives: SceneDirective[] = []
  const counts = new Map<string, number>()
  for (const s of part) for (const t of keyTerms(words.slice(s.first, s.last + 1).map((w) => w.w))) if (/^\p{Lu}/u.test(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
  const recurring = [...counts.entries()].filter(([, n]) => n >= 3).slice(0, 5).map(([name]) => ({ name, description: `${name}, the same look every time it appears` }))
  let presenterOnly = 0
  let angle = 0
  for (const s of part) {
    const on = onScreen(s, slots, words)
    const terms = keyTerms(words.slice(s.first, s.last + 1).map((w) => w.w))
    const subject = terms.join(', ') || s.text.slice(0, 80)
    const ref = recurring.find((r) => terms.some((t) => normWord(t) === normWord(r.name)))?.name
    if (on.mark === 'P') {
      if ((screen.layouts.includes('split') || screen.layouts.includes('pip')) && kinds.length > 0 && ++presenterOnly % 3 === 0) {
        // with both layouts allowed, the asks alternate: half screen, then the inset
        const both = screen.layouts.includes('split') && screen.layouts.includes('pip')
        const layout = both ? (Math.floor(s.n / 2) % 2 === 1 ? 'pip' : 'split') : screen.layouts.includes('split') ? 'split' : 'pip'
        directives.push({ sentence: s.n, anchor: words.slice(s.first, s.first + 2).map((w) => w.w).join(' '), kind: 'imageAi', subject, prompt: `${subject}, detail`, layout, why: 'the subject beside the presenter' })
      }
      continue
    }
    if (kinds.length === 0) continue
    let k = on.from
    let first = true
    while (k <= s.last) {
      const left = PICTURE_KINDS.filter((x) => kinds.includes(x)).sort((a, b) => ((budget[b] ?? 0) - (done[b] ?? 0)) - ((budget[a] ?? 0) - (done[a] ?? 0)))
      const kind = left[0] as PictureKind
      done[kind] = (done[kind] ?? 0) + SHOT_LENGTHS[kind]
      const anchor = words.slice(k, Math.min(k + 3, s.last + 1)).map((w) => w.w).join(' ')
      const figure = first ? words.slice(s.first, s.last + 1).map((w) => w.w.replace(/[^\p{L}\p{N}]+$/u, '')).find((w) => /^\p{N}+$/u.test(w)) : undefined
      // one angle of the guide per picture, the key terms in turn: two pictures of a sentence never share a prompt
      const f = FACETS[angle % FACETS.length] as (typeof FACETS)[number]
      const mine = terms.length > 3 ? [0, 1, 2].map((i) => terms[(angle + i) % terms.length] as string) : terms
      angle++
      directives.push({
        sentence: s.n,
        anchor,
        kind,
        subject: first ? subject : `${subject} — ${f.fr}`.slice(0, 200),
        ...(kind === 'stock' || kind === 'archive'
          ? { query: mine.join(' ') || 'city street' }
          : { prompt: `${f.size} of ${mine.join(', ') || subject}, ${kind === 'clipAi' ? 'one clear action, ' : ''}${f.scene}` }),
        ...(figure ? { text: figure } : {}),
        ...(ref ? { ref } : {}),
        why: 'what the sentence says here'
      })
      first = false
      // the next picture ~3.6 s later
      const at = cutBefore(words, k) + SHOT_LENGTHS[kind]
      let j = k + 1
      while (j <= s.last && cutBefore(words, j) < at) j++
      if (j > s.last || cutBefore(words, s.last) + 0.6 - cutBefore(words, j) < 1.5) break
      k = j
    }
  }
  if (screen.cards) directives.push(...fakeCards(part, words, directives, language))
  for (const d of directives) FAKE.add(d)
  return { directives, recurring }
}

const FRAMES = ['board', 'full', 'paper'] as const
/**
 * Documentary cards without an LLM (the demo, a failed stretch): the archives framed in turn (a print with its key term as label, a
 * caption box, a document with its sentence as excerpt), and a data card on the first sentence that says a number.
 */
/** The data card's own words, in the video's language (clonage-traduction: a French video showed « THE FIGURES »). */
const FIGURES: Record<string, { title: string; row: string }> = { fr: { title: 'LES CHIFFRES', row: 'CHIFFRE' }, es: { title: 'LAS CIFRAS', row: 'CIFRA' }, de: { title: 'DIE ZAHLEN', row: 'ZAHL' } }

function fakeCards(part: readonly Sentence[], words: readonly Word[], directives: SceneDirective[], language?: string): SceneDirective[] {
  const figures = FIGURES[(language ?? '').slice(0, 2).toLowerCase()] ?? { title: 'THE FIGURES', row: 'FIGURE' }
  let k = 0
  for (const d of directives) {
    // one archive in two framed (the references show about half their archives as prints, documents or captioned paintings)
    if (d.kind !== 'archive' || k++ % 2 === 1) continue
    const s = part.find((x) => x.n === d.sentence)
    const frame = FRAMES[Math.floor(k / 2) % FRAMES.length] as (typeof FRAMES)[number]
    const label = (d.subject.split(/[,—]/)[0] ?? d.subject).trim().slice(0, 60)
    d.frame = frame === 'paper' && s ? { frame, label, excerpt: s.text.slice(0, 200), source: 'ARCHIVES' } : { frame, label }
  }
  const out: SceneDirective[] = []
  for (const s of part) {
    const said = words.slice(s.first, s.last + 1)
    const numbers = said.map((w) => ({ w: w.w, v: Number(w.w.replace(/[^\d.]/g, '')) })).filter((x) => /\d/.test(x.w) && Number.isFinite(x.v) && x.v > 0)
    if (numbers.length < 1 || out.length > 0) continue
    out.push({
      sentence: s.n,
      anchor: said.slice(0, 2).map((w) => w.w).join(' '),
      kind: 'motion.bars',
      subject: 'the figures of the sentence',
      // the number as said, without the punctuation that closes its clause (« 1499, » → « 1499 »)
      card: { template: 'bars', hold: 1, props: { title: figures.title, rows: numbers.slice(0, 4).map((x, i) => ({ label: `${figures.row} ${i + 1}`, value: x.v, display: x.w.replace(/[^\p{L}\p{N}$%.,]/gu, '').replace(/[.,]+$/, '').slice(0, 16) || String(x.v), accent: i === numbers.length - 1, on: x.w })) } },
      why: 'the sentence compares figures'
    })
  }
  return out
}

/**
 * The answers of all stretches as one `json.directives`: the recurring objects get the FIRST description given for their
 * name (stretch order), written at the head of every prompt that shows them; `ref` leaves the directive (§7.2's shape).
 * Never the same subject twice in a row (production-17: the first real run showed a wall, then the same wall): a picture
 * right after one that showed the same recurring object (same or next sentence) keeps its own prompt, its action, without
 * the fixed description at its head (its name in the prompt still gets it the first picture as a reference). With the
 * sentences' times (`startOf`, avatar-qualite: the fixed description of a wall corner headed 5 of the 10 pictures of the first
 * real hook), the description is written at most once every `windowS` seconds per object (the pipeline's `repeatWindowS`).
 */
export function mergeAnswers(answers: readonly SceneAnswer[], startOf?: (sentence: number) => number, windowS = 0): { directives: Directive[]; recurring: Recurring[] } {
  const fixed = new Map<string, Recurring>()
  for (const a of answers) for (const r of a.recurring) if (!fixed.has(normWord(r.name))) fixed.set(normWord(r.name), r)
  const all = answers.flatMap((a) => a.directives).sort((x, y) => x.sentence - y.sentence)
  const directives: Directive[] = []
  let last: { sentence: number; ref: string | null } | null = null
  const written = new Map<string, number>()
  for (const orig of all) {
    const { ref, ...d } = orig
    const r = ref ? fixed.get(normWord(ref)) : undefined
    const at = startOf?.(d.sentence)
    const lastAt = r ? written.get(normWord(r.name)) : undefined
    const again: boolean =
      r !== undefined &&
      (windowS > 0 && at !== undefined && lastAt !== undefined ? at - lastAt < windowS : last !== null && last.ref === normWord(r.name) && d.sentence - last.sentence <= 1)
    const out: Directive = r && !again && d.prompt && !d.prompt.startsWith(r.description) ? { ...d, prompt: `${r.description}; ${d.prompt}`.slice(0, 800) } : d
    if (r && out !== d && at !== undefined) written.set(normWord(r.name), at)
    if (FAKE.has(orig)) FAKE.add(out)
    directives.push(out)
    if (d.prompt || d.query) last = { sentence: d.sentence, ref: r ? normWord(r.name) : null }
  }
  return { directives, recurring: [...fixed.values()] }
}

/** The scene pass on the LLM (role director, tier balanced, decision 0013); a stretch whose call fails twice gets the fake's directives. */
export async function scenePass(
  ctx: RunCtx,
  o: {
    outline: Outline
    sentences: readonly Sentence[]
    slots: readonly Slot[]
    parts: readonly Part[]
    words: readonly Word[]
    screen: ScreenParams
    hookSpanS: number
    counts?: ReadonlyMap<number, number>
  },
  diag: string[]
): Promise<SceneAnswer[]> {
  const rules = sceneRules(o.screen)
  const groups = sentenceStretches(o.sentences, o.hookSpanS)
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  const answers: SceneAnswer[] = new Array<SceneAnswer>(groups.length)
  let done = 0
  const one = async (part: Sentence[], k: number): Promise<void> => {
    const prompt = stretchPrompt({ outline: o.outline, part, k, of: groups.length, slots: o.slots, parts: o.parts, words: o.words, notes: ctx.notes, ...(o.counts ? { counts: o.counts } : {}) })
    const key = hashOf({ v: 'mix-1', rules, prompt, seed: ctx.seed })
    const file = cacheDir ? path.join(cacheDir, `${key}.json`) : null
    let answer: SceneAnswer | null = null
    if (file && existsSync(file)) answer = SceneAnswer.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
    if (!answer) {
      try {
        answer = await askJson(ctx, { role: 'director', tier: 'balanced', system: rules, prompt, schema: SceneAnswer })
        if (file) await atomicWrite(file, JSON.stringify(answer))
      } catch (e) {
        // a stop, or a sign-in that no longer works (production-17: the run stops with the owner's action), is never hidden
        if (ctx.signal.aborted || (e instanceof EngineError && e.code === 'missing_tool')) throw e
        diag.push(`réalisation simplifiée de ${fmt((part[0] as Sentence).start)} à ${fmt((part.at(-1) as Sentence).end)}`)
        ctx.emit({ kind: 'log', level: 'warn', text: `scene pass failed for stretch ${k + 1}: plain directives` })
        answer = fakeDirectives(part, o.slots, o.parts, o.words, o.screen, o.outline.language)
      }
    }
    const allowed = new Set(part.map((s) => s.n))
    answers[k] = { directives: answer.directives.filter((d) => allowed.has(d.sentence)), recurring: answer.recurring }
    progress(ctx, ++done, groups.length, `${done} passages sur ${groups.length}`)
  }
  // two stretches at a time (the Claude limit counts calls, R32.8)
  for (let i = 0; i < groups.length; i += 2) await Promise.all(groups.slice(i, i + 2).map((part, j) => one(part, i + j)))
  return answers
}

/** A sentence whose pictures outnumber its directives (the code showed another angle on it) and what is on screen around it. */
export interface PictureGap {
  sentence: number
  startS: number
}

/**
 * The top-up of the scene pass (avatar-qualite): when the fill ran out of directives on some sentences (the code then shows
 * another angle on the sentence's own words, a weak prompt), ONE more call asks the director for new directives there, with
 * the pictures already around them, so none repeats them. Cached like the stretches; a failed call keeps the angles.
 */
export async function topUpPass(
  ctx: RunCtx,
  o: { outline: Outline; sentences: readonly Sentence[]; screen: ScreenParams; gaps: readonly PictureGap[]; around: readonly { startS: number; subject: string; scene: string }[] },
  diag: string[]
): Promise<Directive[]> {
  const need = new Map<number, number>()
  for (const g of o.gaps) need.set(g.sentence, (need.get(g.sentence) ?? 0) + 1)
  const rules = sceneRules(o.screen)
  const prompt = [
    languageLine(o.outline.language),
    `Video: "${o.outline.title}".`,
    'These sentences need more pictures than they were given. For each, give as many NEW directives as asked, anchored on its own words, each showing something no picture around it shows (another object, gesture, place, result or reaction of what is said).',
    'Sentences (number · pictures needed · text):',
    ...[...need].map(([n, k]) => `${n} · ${k} · ${o.sentences[n - 1]?.text ?? ''}`),
    'Pictures already around them (time · subject · prompt):',
    ...o.around.map((a) => `${fmt(a.startS)} · ${a.subject} · ${a.scene.slice(0, 200)}`),
    'Answer with ONE JSON object: {"directives":[...],"recurring":[]} — the directives in the same shape as before; nothing else.'
  ].join('\n')
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  const file = cacheDir ? path.join(cacheDir, `${hashOf({ v: 'topup-1', rules, prompt, seed: ctx.seed })}.json`) : null
  let answer: SceneAnswer | null = null
  if (file && existsSync(file)) answer = SceneAnswer.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
  if (!answer) {
    try {
      answer = await askJson(ctx, { role: 'director', tier: 'balanced', system: rules, prompt, schema: SceneAnswer })
      if (file) await atomicWrite(file, JSON.stringify(answer))
    } catch (e) {
      if (ctx.signal.aborted || (e instanceof EngineError && e.code === 'missing_tool')) throw e
      diag.push(`variété : ${o.gaps.length} plan(s) gardent un autre angle de leur phrase (complément du réalisateur impossible)`)
      return []
    }
  }
  // a top-up shows its own words: no recurring object's fixed description at its head
  return answer.directives.filter((d) => need.has(d.sentence)).map(({ ref: _ref, ...d }) => d)
}
