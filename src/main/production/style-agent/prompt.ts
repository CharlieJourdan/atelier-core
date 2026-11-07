// The style agent's one model call (production-15): it reads the references' measures and the pipeline the code built, says
// the style in two or three plain French sentences, and writes the sample's narration (two sentences on the references'
// subject). It changes no number and no pipeline: those are the code's (likeness.ts, style-propose.ts). Since parcours-utilisateur
// it also reads the way in (clone, own channel, translate, mix, inspirations per axis, rework), what the channels' numbers say
// (formats, reach) and the code's proposals, and answers with the one question it asks the owner on how to differ and the
// proposals that match the owner's words (never more than the code proposed).
import type { VideoMeasure } from '../../../engine/technologies/fit'
import type { StyleProposal } from '../../../engine/technologies/style-propose'
import { catalogueText, type AgentFeasibility } from './feasibility'
import type { MeasuredReference } from './references'

export const styleSystem =
  'You are the pipeline architect of Atelier, an app that makes faceless YouTube videos. The owner gave reference channels or ' +
  'videos whose STYLE they want to reproduce (never a real person: the presenter and the voice are invented or the channel’s own). ' +
  'You get what the eyes measured on them, what the channels’ public numbers say, the way in the owner chose, the pipeline the code ' +
  'built and the changes the code proposes. Answer with one fenced block ```atelier-style``` holding a JSON object ' +
  '{"summary": string, "script": string, "base": "avatar@1" | "voiceover@1" | "documentary@2" | "story-short@1" | "pov@1", "ask": string, "suggested": string[], ' +
  '"feasibility": {"share": number, "why": string, "parts": [{"title": string, "share": number, "can": "yes" | "partial" | "no", "how": string}], "missing": string[], "humans": string[], "instead": string[]}}: ' +
  '"summary" says the style in two or three short, plain French sentences ' +
  '(who is on screen and how long, the pictures and their look, the rhythm, the text on screen, the voice’s pace) and how the ' +
  'proposed pipeline matches it; when the channel numbers say its videos are weak, say it plainly and kindly in one sentence; ' +
  '"script" is the narration of a 15–20 second sample: two sentences (about 45 words) on the ' +
  'references’ subject (or the owner’s words), in the pipeline’s language, written like their hooks; "base" is "story-short@1" when ' +
  'they are vertical story shorts (a first-person story read fast, one word at a time on screen, over unrelated background clips: ' +
  'satisfying processes or gameplay), "pov@1" when the pictures are drawn flat 2D animation (a stick-figure or cartoon hero, vector ' +
  'places, animated numbers and icons: a « POV » or « what if » story told to the viewer), "documentary@2" when ' +
  'there is no presenter and the pictures are mostly archives (paintings, period photographs, documents, maps) and motion-design ' +
  'cards (animated maps, data cards, timelines), "voiceover@1" when there is no presenter otherwise, else "avatar@1"; when the owner ' +
  'names an inspiration per axis, the base follows the CONTENT TYPE axis only. Without references, or when they are marked ' +
  'DEMONSTRATION or unmeasured, propose from the owner’s words, the channel’s name and its titles: then the pipeline the code built is ' +
  'only provisional, so describe the base you choose and never its mix, and never quote numbers of a DEMONSTRATION. A rework: the owner ' +
  'wants to change one of their pipelines; ask what to change on it. ' +
  '"ask" is ONE short French question (tutoiement) you ask the owner on how to make the channel theirs, fitted to the case (their own ' +
  'channel: almost nothing to change; a weak channel: a better version; a translation: what sets it apart from the original). ' +
  '"suggested" lists the ids of the code’s proposed changes that match the owner’s words or instructions (empty when none does): ' +
  'never an id that is not listed. ' +
  '"feasibility" says EARLY and HONESTLY whether Atelier can make this style. Atelier makes faceless videos from: archives and free ' +
  'stock found by an agent, generated images and short generated clips (characters are NOT identical from one shot to the next), ' +
  'motion-design cards (maps, charts, timelines, kinetic text), simple flat 2D drawn scenes (stick or cartoon figures, the Animation ' +
  'pipeline), an AI presenter or the owner’s cloned face from a portrait, AI or cloned voices, scripts, captions, music found, and ' +
  'the owner’s own imported clips, scripts and voice. It CANNOT make: studio character animation, 3D scenes or 3D animated characters, ' +
  'filmed real people (a vlog, a podcast, an interview, a presenter really filmed), live-action scenes, footage owned by others (films, ' +
  'series, TV, news interviews, games), original music. Read the page’s words (title, description, credits, category) as well as the ' +
  'eyes: the eyes often call real footage or hand-made animation « AI clips ». "share" is the part of the reference’s style (0–100; what ' +
  'is on screen weighs most) Atelier reproduces; "why" one or two plain French sentences; "parts" the style’s parts (pictures, ' +
  'presenter, voice and script, editing, music…), each with its share of the video, whether Atelier makes it and how or why not; ' +
  '"missing", "humans" and "instead" are ids from the lists given (never another id): the technologies it lacks, the people the ' +
  'pipeline needs (a presenter filmed by the owner, guests, an animator, a person who reviews the edit) and what Atelier does instead ' +
  'when it cannot (the owner sends audio or a script and Atelier re-voices, illustrates, animates and edits). When the eyes watched only ' +
  'the first minutes, say so in "why". When the style is out of reach, "summary" says it first, never « la pipeline reprend ce style ». ' +
  '"humans" lists only the people THIS style needs (a reproducible archive or motion-design style needs no animator: at most ' +
  '"editor-review"). When most of the style is out of reach (share under 30), "base" is the nearest pipeline Atelier makes WELL for ' +
  'the same subject and tone (e.g. "documentary@2" with archives and maps for true war or history stories, "pov@1" for drawn stories), ' +
  'not the one whose pictures would only imitate the reference badly. ' +
  'You change no number and no setting: never write that you add or change something, say what the proposed pipeline does. Never ' +
  'write an internal id (like documentary@2) or a provider’s name in "summary" or "ask": say « la pipeline Documentaire », etc. No other text.'

const pct = (x: number | null | undefined): string => (typeof x === 'number' ? `${Math.round(x * 100)} %` : 'not measured')
const num = (x: number | null | undefined, unit: string): string => (typeof x === 'number' ? `${Math.round(x * 10) / 10} ${unit}` : 'not measured')

function measureLine(m: VideoMeasure): string {
  const kinds = m.kinds ? Object.entries(m.kinds).map(([k, v]) => `${k} ${pct(v)}`).join(', ') : 'not measured'
  return [
    `presenter ${pct(m.presenterShare)}${m.layouts?.length ? ` (${m.layouts.join(', ')})` : ''}`,
    `pictures ${kinds}`,
    `look ${m.lookFamily ?? 'not measured'}`,
    `shots ${num(m.shotS, 's')}`,
    `pace ${num(m.wordsPerMinute, 'words/min')}`,
    `captions ${m.captions === null || m.captions === undefined ? 'not measured' : m.captions ? 'yes' : 'no'}`,
    `offer ${m.sponsor ? `at ${num(m.sponsorAtS, 's')}` : 'none seen'}`
  ].join('; ')
}

/** What the agent reads beyond the references: the way in, the owner's instructions, the axes and the code's proposals. */
export interface StyleContext {
  path?: string
  own?: boolean
  language?: string | null
  instructions?: string
  /** Each axis of « Créer de zéro » / « Mélanger » : `axis: what was taken`. */
  axes?: string[]
  proposals?: { id: string; title: string; effect: string }[]
  /** The code's feasibility in one line (share, parts), for the agent to correct. */
  feasibility?: string
}

export function stylePrompt(text: string, refs: readonly MeasuredReference[], proposal: StyleProposal, ctx: StyleContext = {}): string {
  const lines = refs.flatMap((r) => [
    `## ${r.title} (${r.kind}: ${r.url})${r.problem ? ` — not measured: ${r.problem}` : ''}${r.demo ? ' — DEMONSTRATION: example measures (the eyes are not connected), not a reading of this video' : ''}${r.unread ? ` — PARTLY WATCHED: ${r.unread}` : ''}`,
    ...(r.words ? [`- page and eyes, in words: ${r.words.replace(/\s+/g, ' ').slice(0, 1500)}`] : []),
    ...(r.insight?.lines ?? []).map((l) => `- channel numbers: ${l}`),
    ...r.measures.map((m, i) => `- video ${i + 1}: ${measureLine(m)}`),
    ...r.subjects.slice(0, 4).map((s) => `- subject: ${s.slice(0, 400)}`),
    ...(r.coverage ?? []).map((c) => `- reading: ${c}`),
    ...(r.logs ?? []).slice(0, 2).map((l) => `- ${l.replace(/\n/g, '\n  ')}`)
  ])
  const faithful = proposal.variants.find((v) => v.kind === 'faithful') ?? proposal.variants[0]
  const mix = faithful?.doc.mix ? Object.entries(faithful.doc.mix).filter(([k]) => k !== 'curve' && k !== 'shotLengthS').map(([k, v]) => `${k} ${pct(v as number)}`).join(', ') : 'none'
  return [
    `Way in: ${ctx.path ?? 'clone'}${ctx.own ? ' (the owner’s OWN channel)' : ''}${ctx.language ? `; the new channel speaks ${ctx.language}` : ''}.`,
    `What the owner wants: ${text || '(no words, only example videos)'}`,
    ...(ctx.instructions ? [`Extra instructions: ${ctx.instructions}`] : []),
    ...(ctx.axes?.length ? [`Inspirations per axis:\n${ctx.axes.map((a) => `- ${a}`).join('\n')}`] : []),
    refs.length > 0 ? `References measured by the eyes:\n${lines.join('\n')}` : 'No example video: propose from the words.',
    `Pipeline the code built: base ${proposal.base} (${proposal.reason}); mix ${mix}, curve ${String(faithful?.doc.mix?.curve ?? 'flat')}; likeness estimate ${faithful?.likeness ?? '—'} / 100.`,
    ctx.proposals?.length ? `Changes the code proposes (id — title — effect):\n${ctx.proposals.map((p) => `- ${p.id} — ${p.title} — ${p.effect}`).join('\n')}` : 'The code proposes no change.',
    ...(ctx.feasibility ? [`The code’s first judgement of feasibility (correct it from the words and the eyes): ${ctx.feasibility}`] : []),
    `Lists for "feasibility":\n${catalogueText()}`
  ].join('\n\n')
}

const BASE_FR: Readonly<Record<string, string>> = { 'avatar@1': 'Avatar', 'voiceover@1': 'Voix off', 'documentary@2': 'Documentaire', 'story-short@1': 'Histoire Reddit (short)' }
/** An internal id the model wrote anyway becomes its French name. */
export const plainIds = (text: string): string => text.replace(/\b(avatar|voiceover|documentary|story-short)@\d+\b/g, (id) => BASE_FR[id] ?? id)

export interface StyleBlock {
  summary: string | null
  script: string | null
  base: string | null
  ask: string | null
  suggested: string[]
  /** As the agent wrote it (checked by feasibility.ts). */
  feasibility: AgentFeasibility | null
}

/** The block's fields (missing or malformed: nulls; the code's own script and question then stay). */
export function parseStyleBlock(text: string): StyleBlock {
  const m = /```atelier-style\s*([\s\S]*?)```/.exec(text)
  try {
    const o = JSON.parse(m?.[1] ?? '') as Record<string, unknown>
    const s = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? plainIds(v.trim()).slice(0, max) : null)
    return {
      summary: s(o.summary, 1200),
      script: s(o.script, 600),
      base: o.base === 'avatar@1' || o.base === 'voiceover@1' || o.base === 'documentary@2' || o.base === 'story-short@1' || o.base === 'pov@1' ? o.base : null,
      ask: s(o.ask, 240),
      suggested: Array.isArray(o.suggested) ? o.suggested.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
      feasibility: o.feasibility && typeof o.feasibility === 'object' ? (o.feasibility as AgentFeasibility) : null
    }
  } catch {
    const plain = plainIds(text.replace(/```[\s\S]*?```/g, '').trim())
    return { summary: plain ? plain.slice(0, 1200) : null, script: null, base: null, ask: null, suggested: [], feasibility: null }
  }
}
