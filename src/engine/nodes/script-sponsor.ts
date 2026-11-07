// `script.sponsor@1` (docs/specs/pipeline-avatar.md §2.13): writes the channel's sponsor mentions into the script where its
// placement rule says, in the presenter's voice. The first mention goes on the paragraph break nearest to the rule's window
// (right after the hook by default: 70 to 150 s of narration), the reminder before the closing paragraph. Each mention is a
// paragraph of its own; its sentences are listed in `json.outline` (`sponsor`, by anchor) so the screen can anchor the
// sponsor slot on them. A price is spoken only when the rule allows it. Without a sponsor the script passes through as is.
import { z } from 'zod'
import { isAbortError } from '../errors'
import { Outline } from '../formats/outline'
import { effectiveRule, parseSponsor, type Sponsor } from '../formats/sponsor'
import { PROMO_PLACES } from '../formats/promo'
import type { PromoText } from '../formats/promo'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { wpmMeasured } from '../text/lint'
import { anchorOf, countWords, findAnchor, parseScript } from '../text/script'
import type { NodeOutputs } from '../artefacts'
import type { Json } from '../types'
import { firstJson, languageLine, readText, readValue } from './common'
import { anchorOutline } from './script-outline'
import { promoMention, promoPassages } from './script-promo'
import { findAdParagraph, readAdMarker, type AdMarker } from '../text/ad-marker'

const Params = z.object({
  language: z.string().min(2).default('fr'),
  /** Words per minute of the narration; unset: the measured default of the language. */
  wpm: z.number().int().min(60).max(300).optional(),
  /** Where the channel's own promo goes, over the place its sheet says (the pipeline's « L'offre », avatar-reglages-voix). */
  place: z.enum(PROMO_PLACES).optional()
})
type Params = z.infer<typeof Params>

export interface Slot {
  kind: 'mention' | 'reminder'
  /** The mention goes before paragraph `at` (0-based, never 0). */
  at: number
  words: number
  seconds: number
}

/**
 * Where the mentions go (pure): the paragraph break nearest to the rule's window, never before the hook's end (the start of
 * the outline's second beat, else the end of the first paragraph); the reminder before the last paragraph when it comes later.
 */
export function placeMentions(paragraphs: readonly string[], hookEndWord: number, s: Sponsor, wpm: number): Slot[] {
  if (paragraphs.length < 2) return []
  const starts: number[] = []
  let w = 0
  for (const p of paragraphs) {
    starts.push(w)
    w += countWords(p)
  }
  const total = w
  const breaks = starts.map((at, i) => ({ i, at })).filter((b) => b.i > 0)
  const nearest = (word: number, from: number): number => {
    const ok = breaks.filter((b) => b.at >= from)
    const list = ok.length > 0 ? ok : breaks
    return list.reduce((best, b) => (Math.abs(b.at - word) < Math.abs(best.at - word) ? b : best)).i
  }
  const perS = wpm / 60
  const r = s.rule
  const after = hookEndWord > 0 ? hookEndWord : (starts[1] ?? 0)
  let first: number
  if (r.where === 'middle') first = nearest(total / 2, after)
  else if (r.where === 'before_end') first = paragraphs.length - 1
  else {
    const lo = r.windowS[0] * perS
    const hi = Math.max(lo, r.windowS[1] * perS)
    first = nearest(Math.min(hi, Math.max(lo, after)), after)
  }
  const slots: Slot[] = [{ kind: 'mention', at: first, words: Math.max(8, Math.round(r.seconds * perS)), seconds: r.seconds }]
  const last = paragraphs.length - 1
  if (r.reminder && r.where !== 'before_end' && last > first) {
    slots.push({ kind: 'reminder', at: last, words: Math.max(6, Math.round(r.reminderSeconds * perS)), seconds: r.reminderSeconds })
  }
  return slots
}

const PRICE = /\d+(?:[.,]\d+)?\s?(?:€|\$|£|euros?|dollars?|eur\b|usd\b)|(?:€|\$|£)\s?\d/iu

/** Why a mention cannot be used (null: it can): no product name, a price the rule does not allow, a length far off. */
export function mentionProblem(text: string, slot: Slot, s: Sponsor): string | null {
  const n = countWords(text)
  if (!text.toLowerCase().includes(s.name.toLowerCase())) return 'the product name is missing'
  if (!s.rule.spokenPrice && (PRICE.test(text) || (s.price && text.includes(s.price)))) return 'a price is spoken'
  if (n < slot.words * 0.6 || n > slot.words * 1.5) return `${n} words instead of about ${slot.words}`
  return null
}

const FILL = {
  fr: [
    'C’est simple, clair et pensé pour vous faire gagner du temps.',
    'Beaucoup d’entre vous me l’ont demandé, alors je l’ai rendu disponible.',
    'Vous y trouverez tout ce dont on parle ici, étape par étape.',
    'Prenez le temps d’y jeter un œil, ça vous servira.'
  ],
  en: [
    'It is simple, clear and made to save you time.',
    'Many of you asked for it, so I made it available.',
    'You will find everything we talk about here, step by step.',
    'Take a moment to look at it, it will help you.'
  ]
}

/** The mention of the demo runs (and the fallback when the model's stays unusable): the name, the pitch, the link. */
export function templateMention(s: Sponsor, slot: Slot, language: string): string {
  if (s.kind === 'promo') return promoMention(s, slot, language)
  const fr = language === 'fr'
  const lines =
    slot.kind === 'reminder'
      ? [fr ? `Et n’oubliez pas ${s.name} : le lien est dans la description.` : `And do not forget ${s.name}: the link is in the description.`]
      : [
          fr ? `Avant d’aller plus loin, un mot sur ${s.name}.` : `Before we go further, a word about ${s.name}.`,
          ...(s.pitch ? [s.pitch.replace(/[.!?]?$/u, '.')] : []),
          fr ? 'Le lien est dans la description, juste sous cette vidéo.' : 'The link is in the description, right below this video.'
        ]
  const fill = fr ? FILL.fr : FILL.en
  for (let i = 0; slot.kind === 'mention' && countWords(lines.join(' ')) < slot.words * 0.9 && i < fill.length; i++) lines.splice(lines.length - 1, 0, fill[i] as string)
  return lines.join(' ')
}

const Reply = z.object({ mention: z.string().min(1), reminder: z.string().default(''), headline: z.string().max(70).optional(), subline: z.string().max(140).optional() })

function prompt(s: Sponsor, slots: Slot[], paragraphs: readonly string[], why: string): string {
  const around = (at: number): string => `before: « ${(paragraphs[at - 1] ?? '').slice(-300)} »\nafter: « ${(paragraphs[at] ?? '').slice(0, 300)} »`
  const promo = s.kind === 'promo'
  const adapt = promo && s.reuse !== undefined && s.reuse !== 'same'
  return [
    'TASK: sponsor',
    promo ? `This is the channel's OWN offer (its promo), not a sponsor: the presenter speaks of their own work, briefly, as an aside (« petite parenthèse »).` : '',
    `Write the sponsor mention${slots.length > 1 ? ' and the reminder' : ''} the presenter says in this video, in the presenter's own voice, as plain narration (no Markdown).`,
    `Product: ${s.name}. ${s.pitch ? `What it is: ${s.pitch}.` : ''} ${s.link ? 'Its link is in the description (say so; never read the address aloud).' : ''}`,
    s.rule.spokenPrice && s.price ? `You may say its price once: ${s.price}.` : 'Never say a price or an amount of money.',
    ...slots.map((x) => `${x.kind === 'mention' ? 'Mention' : 'Reminder'}: about ${x.words} words (${x.seconds} seconds), it must flow between\n${around(x.at)}`),
    why ? `Your previous answer could not be used: ${why}. Fix exactly that.` : '',
    adapt ? `The promo's card shows a headline (at most 40 characters, said in capitals) and a short line (at most 90 characters): write both for THIS video, tied to its subject, for the offer « ${s.promo?.headline ?? s.name} ».` : '',
    adapt
      ? 'Answer with ONE JSON value: { "mention": "<text>", "reminder": "<text or empty>", "headline": "<text>", "subline": "<text>" }'
      : 'Answer with ONE JSON value: { "mention": "<text>", "reminder": "<text or empty>" }'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The mentions' texts: one model call (two at most), a template where the model's text stays unusable. */
async function writeMentions(ctx: RunCtx, s: Sponsor, slots: Slot[], paragraphs: readonly string[], p: Params): Promise<{ texts: string[]; warnings: string[]; promo?: PromoText }> {
  const claude = need(ctx, 'claude')
  let why = ''
  let last: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await claude.ask({
        role: 'sponsor_writer',
        tier: 'balanced',
        system: `${languageLine(p.language)}\n\nYou write the short sponsor passages of a video presenter: natural, honest, never pushy.`,
        prompt: prompt(s, slots, paragraphs, why),
        json: true,
        signal: ctx.signal
      })
      const r = Reply.safeParse(firstJson(reply.text))
      if (!r.success) {
        why = 'the answer was not the JSON asked for'
        continue
      }
      last = slots.map((x) => (x.kind === 'mention' ? r.data.mention : r.data.reminder).replace(/\s+/g, ' ').trim())
      const problems = slots.map((x, i) => mentionProblem(last[i] ?? '', x, s))
      const said = { ...(r.data.headline?.trim() ? { headline: r.data.headline.trim() } : {}), ...(r.data.subline?.trim() ? { subline: r.data.subline.trim() } : {}) }
      if (problems.every((x) => x === null)) return { texts: last, warnings: [], ...(Object.keys(said).length > 0 ? { promo: said } : {}) }
      why = problems.filter(Boolean).join('; ')
    } catch (e) {
      if (isAbortError(e)) throw e
      why = 'the call failed'
    }
  }
  const warnings: string[] = []
  const texts = slots.map((x, i) => {
    if (last[i] && mentionProblem(last[i] as string, x, s) === null) return last[i] as string
    warnings.push(`mention sponsor ${x.kind === 'mention' ? 'principale' : 'de rappel'} écrite par le modèle de secours (${why})`)
    return templateMention(s, x, p.language)
  })
  return { texts, warnings }
}

/** The script with the mentions inserted and the outline that lists their sentences (the beats keep their anchors). */
export function insertMentions(text: string, outline: Outline, slots: Slot[], texts: readonly string[], promo?: PromoText): { text: string; outline: Outline } {
  const paragraphs = text.split(/\n\s*\n/)
  const order = slots.map((x, i) => ({ x, t: texts[i] ?? '' })).sort((a, b) => b.x.at - a.x.at)
  for (const { x, t } of order) paragraphs.splice(x.at, 0, t)
  const out = paragraphs.join('\n\n')
  const parsed = parseScript(out)
  const sponsor = slots.map((x, i) => ({
    kind: x.kind,
    text: texts[i] ?? '',
    anchors: parseScript(texts[i] ?? '').sentences.map((sent) => anchorOf(sent.text)).filter((a) => findAnchor(parsed, a) !== null),
    seconds: x.seconds,
    ...(promo && x.kind === 'mention' ? { promo } : {})
  }))
  return { text: out, outline: { ...anchorOutline(outline, out), sponsor: sponsor.filter((m) => m.anchors.length > 0) } }
}

/** The outline with existing passages as the promo's slots (the first a mention, a later one its reminder), the text unchanged. */
function passageOutline(text: string, outline: Outline, passages: readonly string[], wpm: number): Outline {
  const parsed = parseScript(text)
  const sponsor = passages.map((passage, i) => ({
    kind: i === 0 ? ('mention' as const) : ('reminder' as const),
    text: passage,
    anchors: parseScript(passage).sentences.map((sent) => anchorOf(sent.text)).filter((a) => findAnchor(parsed, a) !== null),
    seconds: Math.round((countWords(passage) / wpm) * 60)
  }))
  return { ...outline, sponsor: sponsor.filter((m) => m.anchors.length > 0) }
}

/** Word index where the hook ends: the start of the outline's second beat, else 0 (the first paragraph break then counts). */
function hookEnd(text: string, outline: Outline): number {
  const anchor = outline.beats[1]?.anchor
  if (!anchor) return 0
  const parsed = parseScript(text)
  const at = findAnchor(parsed, anchor)
  return at === null ? 0 : (parsed.sentences[at]?.first ?? 0)
}

async function sponsorRun(ctx: RunCtx, inputs: ResolvedInputs, p: Params, fake: boolean): Promise<NodeOutputs> {
  const text = readText(inputs.script, 'The script')
  const outline = readValue(inputs.outline, Outline, 'The outline')
  const meta = inputs.script?.meta ?? {}
  const read = typeof inputs.sponsor?.value === 'string' ? parseSponsor(inputs.sponsor.value) : null
  const s = read && read.kind === 'promo' && p.place ? { ...read, place: p.place } : read
  const pass = (reason: string) => ({ text: { value: text, meta: { ...meta, sponsor: reason } }, outline: { value: outline as unknown as Json } })
  const marker = readAdMarker(meta.adMarker)
  if (!s) return marker ? withWarning(pass('none'), 'le script marque une pub mais la chaîne n’a ni promo ni sponsor : rien n’est placé') : pass('none')
  const wpm = p.wpm ?? wpmMeasured(p.language)
  const paragraphs = text.split(/\n\s*\n/)
  // the owner marked the spot in his own script: the channel's promo (or sponsor) goes exactly there, over any placement setting
  if (marker) return markerRun(ctx, { text, outline, meta, paragraphs }, marker, s, p, wpm, fake)
  if (s.kind === 'promo' && s.place === 'none') return pass('promo-none')
  // the promo on the passage that already speaks of the offer: nothing is written, its sentences become the slot
  if (s.kind === 'promo' && s.place === 'mention') {
    const at = promoPassages(paragraphs, s)
    if (at.length === 0) return { ...pass('promo-no-mention'), text: { value: text, meta: { ...meta, sponsor: 'promo-no-mention', warnings: [...(Array.isArray(meta.warnings) ? meta.warnings : []), 'la promo devait se caler sur un passage qui parle de l’offre : le script n’en a pas, la promo n’est pas placée'] } } }
    return { text: { value: text, meta: { ...meta, sponsor: s.name, mentions: at.length, promo: 'mention' } }, outline: { value: passageOutline(text, outline, at.map((i) => paragraphs[i] as string), wpm) as unknown as Json } }
  }
  const placed = { ...s, rule: effectiveRule(s) }
  const slots = placeMentions(paragraphs, hookEnd(text, outline), placed, wpm)
  if (slots.length === 0) return pass('no-place')
  const written: { texts: string[]; warnings: string[]; promo?: PromoText } = fake ? { texts: slots.map((x) => templateMention(placed, x, p.language)), warnings: [] } : await writeMentions(ctx, placed, slots, paragraphs, p)
  const { texts, warnings } = written
  const r = insertMentions(text, outline, slots, texts, written.promo)
  const words = countWords(r.text)
  const before = Array.isArray(meta.warnings) ? meta.warnings : []
  return {
    text: {
      value: r.text,
      meta: { ...meta, words, estimatedMinutes: Math.round((words / wpm) * 10) / 10, sponsor: s.name, mentions: slots.length, warnings: [...before, ...warnings], ...(fake ? { demo: true } : {}) }
    },
    outline: { value: r.outline as unknown as Json }
  }
}

function withWarning(out: { text: { value: string; meta: Record<string, Json> }; outline: { value: Json } }, line: string) {
  const before = Array.isArray(out.text.meta.warnings) ? out.text.meta.warnings : []
  return { ...out, text: { ...out.text, meta: { ...out.text.meta, warnings: [...before, line] } } }
}

interface Script {
  text: string
  outline: Outline
  meta: Record<string, Json>
  paragraphs: readonly string[]
}

/** The promo on the owner's marker: his own words right after it when they already name the offer, else a mention written there. */
async function markerRun(ctx: RunCtx, sc: Script, marker: AdMarker, s: Sponsor, p: Params, wpm: number, fake: boolean): Promise<NodeOutputs> {
  const { text, outline, meta, paragraphs } = sc
  const at = findAdParagraph(paragraphs, marker)
  const own = paragraphs[at]
  if (s.kind === 'promo' && own !== undefined && promoPassages([own], s).length > 0) {
    return { text: { value: text, meta: { ...meta, sponsor: s.name, mentions: 1, promo: 'marker' } }, outline: { value: passageOutline(text, outline, [own], wpm) as unknown as Json } }
  }
  const placed = { ...s, rule: { ...effectiveRule(s), reminder: false } }
  const seconds = placed.rule.seconds
  const slots: Slot[] = [{ kind: 'mention', at, words: Math.max(8, Math.round((seconds * wpm) / 60)), seconds }]
  const written: { texts: string[]; warnings: string[]; promo?: PromoText } = fake ? { texts: slots.map((x) => templateMention(placed, x, p.language)), warnings: [] } : await writeMentions(ctx, placed, slots, paragraphs, p)
  const r = insertMentions(text, outline, slots, written.texts, written.promo)
  const words = countWords(r.text)
  const before = Array.isArray(meta.warnings) ? meta.warnings : []
  return {
    text: {
      value: r.text,
      meta: { ...meta, words, estimatedMinutes: Math.round((words / wpm) * 10) / 10, sponsor: s.name, mentions: 1, promo: 'marker', warnings: [...before, ...written.warnings], ...(fake ? { demo: true } : {}) }
    },
    outline: { value: r.outline as unknown as Json }
  }
}

export const scriptSponsor = defineNode<Params>({
  type: 'script.sponsor@1',
  inputs: {
    script: { type: 'text.script', required: true, label: 'Script' },
    outline: { type: 'json.outline', required: true, label: 'Plan' },
    sponsor: { type: 'text.input', required: false, label: 'Sponsor de la chaîne' }
  },
  outputs: { text: 'text.script', outline: 'json.outline' },
  params: Params,
  executors: ['local'],
  claudeRole: 'sponsor_writer',
  estimate: () => ({ units: [{ unit: 'calls', qty: 1 }], provider: 'claude', durationS: 30 }),
  run: (ctx, inputs, p) => sponsorRun(ctx, inputs, p, false),
  fake: (ctx, inputs, p) => sponsorRun(ctx, inputs, p, true)
})
