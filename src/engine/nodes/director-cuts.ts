// The director's deterministic passes (docs/ENGINE-SPEC.md §21.2 steps 2–6): from the timed beats and a per-beat
// draft (what to show: subject, stock query, image prompt, labels), build the cut layer at the style's rhythm, the
// labels, the generation list with its prices, keep it within the budget and check it. Pure: same inputs, same plan.
import { z } from 'zod'
import {
  EDITPLAN_SCHEMA,
  type EditPlan,
  type GenItem,
  type GenKind,
  type GenList,
  type Motion,
  type Shot
} from '../formats/editplan'
import { ASPECTS, FPS, frameSizeOf, toFrame, type Beat, type Word } from '../formats/timing'
import { seededRandom } from '../errors'
import { bareWord, normWord } from '../text/script'
import { dropAvatar, placeAvatar } from './director-avatar'
import { MotionPlanParams, placeMotion } from './director-motion'
import { BricksPlanParams, placeBricks } from './director-bricks'
import type { ParsedScript } from '../text/script'
import { ScreenParams } from './director-mix'
import { PaceRows, paceAt } from './director-screen'
import { TEXT_CHECKS } from './director-textcheck'

export const DirectorParams = z.object({
  /** Cuts per minute of the base track (R21.1; documentary ~10–12). */
  cpm: z.number().min(4).max(40).default(12),
  minShotS: z.number().min(0.8).max(4).default(1.5),
  maxShotS: z.number().min(3).max(12).default(7),
  /**
   * The measured cadence along the video (reverse-pipeline, director-screen.ts PaceRows): each shot's target length times the row's
   * factor; it replaces `introPace` / `outroPace`. Absent: those, as before.
   */
  paceRows: PaceRows.optional(),
  /** Faster cutting over the hook, slower over the last 20 s (R21.3). */
  hookSpanS: z.number().min(0).max(120).default(60),
  introPace: z.number().min(1).max(2).default(1.4),
  outroPace: z.number().min(0.4).max(1).default(0.7),
  labelsPerMin: z.number().min(0).max(10).default(4),
  /**
   * Labels a minute over the hook (`hookSpanS`), counted apart from the rest (a hook
   * carries several labels while the body keeps a few a minute). Absent: one quota over the whole film, as before.
   */
  labelsHookPerMin: z.number().min(0).max(20).optional(),
  labelSeconds: z.number().min(1.5).max(5).default(2.6),
  /** Visual mix of the base track (style `visuals.mix`); usage_max = stock first (R12.4). */
  mix: z.object({ stock: z.number().min(0).max(1), image: z.number().min(0).max(1) }).default({ stock: 0.6, image: 0.4 }),
  /** Share of generated images upgraded to generated video, hook and turning points first (§21.7). */
  videoShare: z.number().min(0).max(1).default(0),
  maxVideoClips: z.number().int().min(0).default(0),
  /** Credits per unit, from the Cloud price grid (placeholders until P13/P14 price real providers). */
  prices: z
    .object({ 'stock.photo': z.number().min(0), 'stock.video': z.number().min(0), 'image.gen': z.number().min(0), 'video.gen': z.number().min(0) })
    .default({ 'stock.photo': 0, 'stock.video': 0, 'image.gen': 2, 'video.gen': 12 }),
  /** Credit cap for the list; null: none. */
  budgetCredits: z.number().min(0).nullable().default(null),
  captionsPreset: z.string().default('highlight'),
  /** The picture's shape: `16:9` (long-form, default) or `9:16` (a short). Items are asked for, and the plan is sized, this way. */
  aspect: z.enum(ASPECTS).default('16:9'),
  /** Visual style suffix appended to every image prompt (style `visuals.styleSuffix`). */
  styleSuffix: z.string().default('documentary photograph, natural light, muted colours, no text'),
  /** Director drafts by Claude (run) or from the beats only (fake, and fallback). */
  scenePass: z.boolean().default(true),
  /**
   * The kinds of shots the channel is known for (its style profile, lot "eyes"): guidance for the scene pass only. Absent = the
   * prompt is the one it always was.
   */
  shotTypes: z.array(z.string().min(1).max(60)).max(8).optional(),
  /**
   * A talking presenter on part of the film (ENGINE-SPEC §21.1, `avatar.speak`): absent = none, so a film without one is
   * planned exactly as before. By default the hook and the outro only (the most expensive item, BUSINESS-INFRA §3.2).
   */
  avatar: z
    .object({
      segments: z.array(z.enum(['hook', 'outro'])).min(1).default(['hook', 'outro']),
      layout: z.enum(['full', 'pip']).default('full'),
      hookS: z.number().min(2).max(20).default(8),
      outroS: z.number().min(2).max(20).default(8),
      /** Credits per second of avatar, from the Cloud price grid (placeholder until priced). */
      creditsPerSecond: z.number().min(0).default(4)
    })
    .optional(),
  /**
   * Animated overlays from our templates (ENGINE-SPEC §25, `motion.render`): absent = none, so a film without them is planned exactly as
   * before. Which beats get which template is decided here (figures → a counter, a named person → a lower third, a list, a quotation,
   * a place, the turns of a several-voices script → a message conversation, the title) within `share` of the film and `perMinute`.
   */
  motion: MotionPlanParams.optional(),
  /**
   * The channel's own approved bricks (ENGINE-SPEC §25.2), given by the app when the run starts and the channel switched them on: placed
   * where each says (start, end, each named person) before our templates. Absent or empty = none.
   */
  bricks: BricksPlanParams.optional(),
  /**
   * The pipeline's mix and curve (decision 0022, production-model §6.2, §7): present, the director places the presenter by code
   * and fills the pictures to the curve's shares from the scene pass's directives (director-mix.ts); `mix`, `videoShare` and
   * the presenter's `segments` are then unused. Absent: the rhythm director above, exactly as before.
   */
  screen: ScreenParams.optional(),
  /**
   * Shots one generated clip serves in the mix mode (the clip brick's `shotsPerGeneration`, decision 0035): 2 pairs a
   * generated-video shot with the next one close after it (one generation, wide then a tight crop). Absent: 1.
   */
  clipShotsPerGeneration: z.union([z.literal(1), z.literal(2)]).optional(),
  /** With 2 shots per generation: the share of the generated-video shots that are paired (0.5 = half, production-10). Absent: all. */
  clipPairShare: z.number().min(0).max(1).optional(),
  /** The clip brick's « motion only where it is seen » (vrais-tests): clip shots with nothing moving become stills. */
  clipMotionOnly: z.boolean().optional(),
  /** The clip brick's pairing rule: two shots share one generation only on one continuous action. */
  clipPairSameAction: z.boolean().optional(),
  /** The clip brick sends short single shots to a per-second engine (its forecast counts them cheaper). */
  clipShortEngine: z.boolean().optional(),
  /**
   * The on-screen text check of the mix director (director-textcheck.ts): `rules` = every number, name and quotation a
   * label, frame or card writes must be in the script; `evidence` = the rules, then Claude must quote the script for every text not
   * copied from it, and an unsupported text is rewritten with the script's words or removed. Absent: the labels' word check only.
   */
  textCheck: z.enum(TEXT_CHECKS).optional(),
  /**
   * A director grammar of its own (documentary-2, director-doc2.ts): `documentary-2` = the archive documentary measured on five whole
   * videos (films, prints boards, maps, charts, documents, texts over the films; varied by the sequencer). Absent: the mix or the rhythm.
   */
  grammar: z.enum(['documentary-2']).optional(),
  /** documentary-2 proposals (never the default of a faithful clone): `dossier` = prints on a kraft file folder with red stamps. */
  docSkin: z.enum(['reference', 'dossier']).optional(),
  /** documentary-2: the maps' look, the reference's dark satellite or an old parchment map. */
  docMapLook: z.enum(['satellite', 'parchment']).optional()
})
export type DirectorParams = z.infer<typeof DirectorParams>

/** What the scene pass decides for one beat (Claude in `run`, deterministic in `fake`). */
export const BeatDraft = z.object({
  beat: z.number().int().min(0),
  subject: z.string().min(1).max(200),
  /** 2–4 concrete English words for stock search (stock libraries index in English). */
  stockQuery: z.string().min(1).max(80),
  imagePrompt: z.string().min(1).max(600),
  labels: z.array(z.object({ text: z.string().min(1).max(60), anchorWords: z.string().min(1).max(80) })).max(4).default([]),
  /** A person the beat names, with their role (a lower third, only asked for when the plan has animated overlays). */
  people: z.array(z.object({ name: z.string().min(1).max(40), role: z.string().min(1).max(50) })).max(2).optional()
})
export type BeatDraft = z.infer<typeof BeatDraft>

const SHOT_SIZES = ['wide shot', 'medium shot', 'close-up detail', 'aerial view', 'low angle shot']
const MOTIONS: Motion['kind'][] = ['push', 'pull', 'left', 'right']

/** Deterministic draft for a beat: its key terms carry the subject (the fake director, and the fallback). */
export function fallbackDraft(b: Beat, title: string): BeatDraft {
  const terms = b.keyTerms.filter((t) => !/\p{N}/u.test(t)).slice(0, 3)
  // without a scene pass the beat's own opening words say best what it is about (key terms alone read as a word list)
  const opening = b.text.split(/\s+/).slice(0, 8).join(' ').replace(/[,;:]$/, '')
  const subject = opening.length >= 12 ? opening : terms.length > 0 ? terms.join(', ') : title
  const labels = b.keyTerms
    .filter((t) => /\p{N}/u.test(t) || /^\p{Lu}/u.test(t))
    .slice(0, b.tags.includes('figure') ? 2 : 1)
    .map((t) => ({ text: t, anchorWords: t }))
  return { beat: b.i, subject, stockQuery: (terms.join(' ') || subject).slice(0, 80), imagePrompt: `${subject} — ${title}`.slice(0, 600), labels }
}

/** Candidate cut times (seconds): beat starts and allowed cut points, slightly before the word (R21.2). */
function cutCandidates(beats: readonly Beat[]): { t: number; beatStart: boolean }[] {
  const out: { t: number; beatStart: boolean }[] = []
  for (const b of beats) {
    const lead = (b.tags.includes('pivot') ? 8 : 3) / FPS
    if (b.i > 0) out.push({ t: Math.max(0, b.start - (b.tags.includes('pivot') ? lead : 0)), beatStart: true })
    for (const c of b.cutPoints) out.push({ t: Math.max(0, c - lead), beatStart: false })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Base track boundaries (seconds) at the style's rhythm, cutting on allowed points (R21.1–R21.3). */
export function baseCuts(beats: readonly Beat[], D: number, p: DirectorParams, wordStarts: readonly number[] = []): number[] {
  const cands = cutCandidates(beats)
  const starts = wordStarts.map((s) => Math.max(0, s - 3 / FPS))
  const avg = 60 / p.cpm
  const cuts = [0]
  let t = 0
  while (D - t > p.maxShotS) {
    const pace = p.paceRows ? 1 / paceAt(p.paceRows, t) : t < Math.min(p.hookSpanS, D * 0.5) ? p.introPace : D - t < 20 ? p.outroPace : 1
    const want = Math.max(p.minShotS, Math.min(p.maxShotS, avg / pace))
    const lo = t + p.minShotS
    const hi = Math.min(t + p.maxShotS, D - p.minShotS)
    let best: number | null = null
    let bestScore = Infinity
    for (const c of cands) {
      if (c.t < lo || c.t > hi) continue
      // a new beat is the natural place for a new picture: it gets a bonus worth ~0.6 s of distance
      const score = Math.abs(c.t - (t + want)) - (c.beatStart ? 0.6 : 0)
      if (score < bestScore) {
        bestScore = score
        best = c.t
      }
    }
    if (best === null) {
      // no allowed cut point in the window: never cut inside a word (R21.2), take the nearest word start
      let near: number | null = null
      for (const s of starts) if (s >= lo && s <= hi && (near === null || Math.abs(s - (t + want)) < Math.abs(near - (t + want)))) near = s
      best = near
    }
    t = best ?? Math.min(hi, t + want)
    cuts.push(t)
  }
  // a last stretch longer than a shot was handled above; a short tail joins the last shot unless it is long enough
  if (D - t >= p.minShotS || cuts.length === 1) cuts.push(D)
  else cuts[cuts.length - 1] = D
  // frame grid, strictly increasing
  const frames = [...new Set(cuts.map(toFrame))].sort((a, b) => a - b)
  return frames.map((f) => f / FPS)
}

const beatAt = (beats: readonly Beat[], t: number): Beat =>
  beats.find((b) => t >= b.start - 1e-6 && t < b.end - 1e-6) ?? (beats.at(-1) as Beat)

/** Finds the first word of `anchor` inside a beat's words (fuzzy on normalised words); its start time or null. */
function anchorTime(words: readonly Word[], b: Beat, anchor: string): number | null {
  const want = anchor.split(/\s+/).map(normWord).filter(Boolean)
  if (want.length === 0) return null
  for (let k = b.firstWord; k <= b.lastWord; k++) {
    const said = (j: number): string => (words[k + j] as Word | undefined)?.w ?? ''
    if (want.every((w, j) => normWord(said(j)) === w || normWord(bareWord(said(j))) === w)) return (words[k] as Word).start
  }
  return null
}

export interface PlanResult {
  plan: EditPlan
  list: GenList
}

export interface PlanInput {
  beats: readonly Beat[]
  words: readonly Word[]
  durationS: number
  title: string
  script: string
  /** The script as parsed: its speakers make the message conversation (animated overlays only). */
  parsed?: ParsedScript | null
  drafts: ReadonlyMap<number, BeatDraft>
  p: DirectorParams
  seed: number
  diagnostics: string[]
  /** A base track already made (the mix director's): its shots and items, the presenter's included. */
  track?: { shots: Shot[]; items: GenItem[] }
}

/** The cut, label, list, budget passes. `drafts` holds one draft per beat (missing → fallback). */
export function buildPlan(o: PlanInput): PlanResult {
  const { beats, durationS: D, p } = o
  const F = toFrame(D)
  const rnd = seededRandom(o.seed * 7919 + 17)
  const draftOf = (b: Beat): BeatDraft => o.drafts.get(b.i) ?? fallbackDraft(b, o.title)
  const shots: Shot[] = []
  const items: GenItem[] = []
  // the mix director brings its own base track (presenter and pictures to the curve); else the rhythm's
  if (o.track) {
    shots.push(...o.track.shots)
    items.push(...o.track.items)
  } else rhythmTrack(o, F, rnd, draftOf, shots, items)
  let labels = placeLabels(o, F, draftOf)
  shots.push(...labels)
  // the channel's own bricks first (they say where they go), then our templates around them
  if (p.bricks && p.bricks.length > 0) {
    const b = placeBricks({ bricks: p.bricks, words: o.words, beats, durationS: D, shots, accent: p.motion?.accent ?? '#3B82F6', theme: p.motion?.theme ?? 'dark', people: (x) => draftOf(x).people ?? [] })
    shots.push(...b.shots)
    o.diagnostics.push(...b.diagnostics)
  }
  // the animated overlays: chosen from what the narration says, after the labels and the presenter so none lies over them
  if (p.motion) {
    const m = placeMotion({
      beats,
      words: o.words,
      parsed: o.parsed ?? null,
      title: o.title,
      durationS: D,
      cfg: p.motion,
      shots,
      people: (b) => draftOf(b).people ?? []
    })
    shots.push(...m.shots)
    if (m.dropLabels.length > 0) {
      const gone = new Set(m.dropLabels)
      for (let k = shots.length - 1; k >= 0; k--) if (gone.has((shots[k] as Shot).id) && (shots[k] as Shot).track === 'labels') shots.splice(k, 1)
      labels = labels.filter((l) => !gone.has(l.id))
    }
    o.diagnostics.push(...m.diagnostics)
  }
  const list = keepWithinBudget(items, shots, p, o.diagnostics)
  const chapters = beats.filter((b) => b.chapter).map((b) => ({ title: b.chapter as string, startFrame: toFrame(b.start) }))
  const plan: EditPlan = {
    schema: EDITPLAN_SCHEMA,
    fps: FPS,
    size: [...frameSizeOf(p.aspect)] as [number, number],
    frames: F,
    tracks: { base: shots.filter((s) => s.track === 'base').map((s) => s.id), overlay: shots.filter((s) => s.track === 'overlay').map((s) => s.id), labels: labels.map((s) => s.id) },
    captionsPreset: p.captionsPreset,
    shots,
    chapters,
    diagnostics: o.diagnostics
  }
  return { plan, list }
}

/** The base track at the style's rhythm (§21.2 step 3), the presenter's hook and outro, the upgrade to video: the rhythm director. */
function rhythmTrack(o: PlanInput, F: number, rnd: () => number, draftOf: (b: Beat) => BeatDraft, shots: Shot[], items: GenItem[]): void {
  const { beats, durationS: D, p } = o
  const cuts = baseCuts(beats, D, p, o.words.map((w) => w.start))
  const perBeatCount = new Map<number, number>()
  let stockShare = 0
  let motionIx = Math.floor(rnd() * MOTIONS.length)
  for (let k = 0; k < cuts.length - 1; k++) {
    const startFrame = Math.round((cuts[k] as number) * FPS)
    const endFrame = k === cuts.length - 2 ? F : Math.round((cuts[k + 1] as number) * FPS)
    // cuts land up to 8 frames before their beat (R21.2): the shot belongs to the beat it leads into
    const b = beatAt(beats, (cuts[k] as number) + 9 / FPS)
    const d = draftOf(b)
    const n = perBeatCount.get(b.i) ?? 0
    perBeatCount.set(b.i, n + 1)
    // the visual mix, kept close to its target share as the film goes (deterministic)
    const totalMix = p.mix.stock + p.mix.image || 1
    const kind: GenKind = p.mix.image === 0 || (p.mix.stock > 0 && stockShare / (k + 1) < p.mix.stock / totalMix) ? 'stock.photo' : 'image.gen'
    if (kind === 'stock.photo') stockShare++
    const size = SHOT_SIZES[(b.i + n) % SHOT_SIZES.length] as string
    const id = `s${String(k + 1).padStart(3, '0')}`
    const item = `item-${String(k + 1).padStart(3, '0')}`
    // consecutive stills never creep the same way (R21.6)
    const motion = MOTIONS[motionIx++ % MOTIONS.length] as Motion['kind']
    const amount = 0.1 + rnd() * 0.08
    const prevBeat = k > 0 ? beatAt(beats, (cuts[k - 1] as number) + 9 / FPS) : null
    const newBeat = prevBeat !== null && prevBeat.i !== b.i
    const transitionIn: Shot['transitionIn'] =
      newBeat && b.chapter ? 'dip' : newBeat && prevBeat.paragraph !== b.paragraph ? 'dissolve' : 'cut'
    shots.push({
      id,
      track: 'base',
      startFrame,
      endFrame,
      kind,
      genItem: item,
      motion: { kind: motion, from: motion === 'pull' ? 1 + amount : 1.02, to: motion === 'pull' ? 1.02 : 1 + amount },
      transitionIn,
      role: 'base',
      beat: b.i
    })
    const seconds = (endFrame - startFrame) / FPS
    items.push({
      id: item,
      kind,
      ...(kind === 'stock.photo' ? { query: n > 0 ? `${d.stockQuery} ${size.split(' ')[0] as string}` : d.stockQuery } : {}),
      prompt: `${size} of ${d.imagePrompt}, ${p.styleSuffix}${p.aspect === '9:16' ? ', vertical 9:16 composition' : ''}`,
      constraints: { durationS: Math.round(seconds * 1000) / 1000, aspect: p.aspect },
      context: { beatText: b.text, subject: d.subject, keyTerms: b.keyTerms },
      unitPrice: p.prices[kind as keyof DirectorParams['prices']] ?? 0,
      units: 1,
      priority: (k === 0 ? 10 : 0) + (b.tags.includes('hook') ? 3 : 0) + (b.tags.some((t) => t === 'pivot' || t === 'disclosure' || t === 'chapter') ? 2 : 0),
      shotIds: [id]
    })
  }
  // the presenter first: it takes the hook's shots, so the clips go to what is left (§21.7)
  if (p.avatar) {
    const describe = (a: number, b: number): { text: string; terms: string[] } => {
      const said = beats.filter((x) => x.start < b / FPS && x.end > a / FPS)
      return { text: said.map((x) => x.text).join(' '), terms: [...new Set(said.flatMap((x) => x.keyTerms))].slice(0, 8) }
    }
    o.diagnostics.push(...placeAvatar(shots, items, p.avatar, { frames: F, aspect: p.aspect, describe }))
  }
  upgradeToVideo(items, shots, p, D, o.diagnostics)
}

/** `videoShare` of the generated images become generated video, hook and turning points first (§21.7). */
function upgradeToVideo(items: GenItem[], shots: Shot[], p: DirectorParams, D: number, diag: string[]): void {
  const cap = Math.min(Math.round(items.filter((i) => i.kind === 'image.gen').length * p.videoShare), Math.round((p.maxVideoClips * D) / 600))
  if (cap <= 0) return
  const order = items.filter((i) => i.kind === 'image.gen').sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1))
  for (const it of order.slice(0, cap)) {
    it.kind = 'video.gen'
    it.unitPrice = p.prices['video.gen']
    it.units = Math.ceil(it.constraints.durationS)
    for (const s of shots) if (s.genItem === it.id) s.kind = 'video.gen'
  }
  diag.push(`${cap} generated images upgraded to generated video`)
}

/** Labels: figures, dates and names said by the narration (§21.3, §21.9: every string comes from the script). */
function placeLabels(o: { beats: readonly Beat[]; words: readonly Word[]; script: string; p: DirectorParams; diagnostics: string[] }, F: number, draftOf: (b: Beat) => BeatDraft): Shot[] {
  const { beats, words, p } = o
  const scriptNorm = new Set(o.script.split(/\s+/).flatMap((w) => [normWord(w), normWord(bareWord(w))]).filter(Boolean))
  const D = F / FPS
  // 0 a minute: no label at all (avatar@1: the reference videos never write text on screen, avatar-qualite part 2)
  const quota = p.labelsPerMin <= 0 ? 0 : Math.max(1, Math.round((p.labelsPerMin * D) / 60))
  // a hook quota of its own: the hook's labels and the body's are counted apart
  const hookEnd = Math.min(D, p.hookSpanS)
  const hookQuota = p.labelsHookPerMin === undefined ? null : Math.round((p.labelsHookPerMin * hookEnd) / 60)
  const bodyQuota = p.labelsHookPerMin === undefined ? null : p.labelsPerMin <= 0 ? 0 : Math.round((p.labelsPerMin * (D - hookEnd)) / 60)
  const shown = new Set<string>()
  const out: Shot[] = []
  let refused = 0
  const candidates = beats.flatMap((b) => draftOf(b).labels.map((l) => ({ b, l })))
  // figures first (a fact the picture cannot show), then names; hook beats before the rest
  candidates.sort((x, y) => Number(/\p{N}/u.test(y.l.text)) - Number(/\p{N}/u.test(x.l.text)) || Number(y.b.tags.includes('hook')) - Number(x.b.tags.includes('hook')) || x.b.i - y.b.i)
  const picked: { start: number; end: number; text: string; beat: number; anchor: string }[] = []
  for (const { b, l } of candidates) {
    if (hookQuota === null && picked.length >= quota) break
    const text = l.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    const key = normWord(text)
    if (!text || shown.has(key)) continue
    // on-screen text check (§21.9, deterministic part): every word of the label is said in the script
    if (!text.split(/\s+/).every((w) => scriptNorm.has(normWord(w)))) {
      refused++
      continue
    }
    const at = anchorTime(words, b, l.anchorWords)
    if (at === null) continue
    const start = Math.max(0, at - 0.2)
    const end = Math.min(D, start + p.labelSeconds)
    if (end - start < 1.2 || picked.some((x) => start < x.end + 0.5 && end > x.start - 0.5)) continue
    if (hookQuota !== null && bodyQuota !== null) {
      const inHook = start < hookEnd
      if (picked.filter((x) => x.start < hookEnd === inHook).length >= (inHook ? hookQuota : bodyQuota)) continue
    }
    shown.add(key)
    picked.push({ start, end, text, beat: b.i, anchor: l.anchorWords })
  }
  picked.sort((a, b) => a.start - b.start)
  picked.forEach((x, i) => {
    out.push({
      id: `l${String(i + 1).padStart(3, '0')}`,
      track: 'labels',
      startFrame: toFrame(x.start),
      endFrame: Math.min(F, toFrame(x.end)),
      kind: 'label',
      transitionIn: 'cut',
      role: 'scene',
      beat: x.beat,
      anchor: x.anchor,
      text: x.text
    })
  })
  o.diagnostics.push(`text check: ${picked.length} labels kept, ${refused} refused (words not in the script)`)
  return out
}

/** Downgrades the least valuable paid items until the list fits the budget (R12.3, §21.2 step 5). */
function keepWithinBudget(items: GenItem[], shots: Shot[], p: DirectorParams, diag: string[]): GenList {
  const total = (): number => items.reduce((s, it) => s + it.unitPrice * it.units, 0)
  const budget = p.budgetCredits
  if (budget !== null) {
    const next: Partial<Record<GenKind, GenKind>> = { 'video.gen': 'image.gen', 'image.gen': 'stock.photo', avatar: 'stock.photo' }
    let changed = 0
    while (total() > budget + 1e-9) {
      // least value per credit first; the film's first shot last
      const cand = items
        .filter((it) => next[it.kind] && it.unitPrice * it.units > 0)
        .sort((a, b) => a.priority / (a.unitPrice * a.units) - b.priority / (b.unitPrice * b.units) || (a.id < b.id ? 1 : -1))
      const it = cand.find((c) => c.priority < 10) ?? cand[0]
      if (!it) break
      const to = next[it.kind] as GenKind
      if (it.kind === 'avatar') {
        // the presenter is given back as footage, voice over stock (§21.2 step 5)
        dropAvatar(it, shots, items, it.context.subject, p.prices['stock.photo'])
        changed++
        continue
      }
      it.kind = to
      it.unitPrice = p.prices[to as keyof DirectorParams['prices']] ?? 0
      it.units = to === 'video.gen' ? Math.ceil(it.constraints.durationS) : 1
      if (to === 'stock.photo' && !it.query) it.query = it.context.subject.slice(0, 80)
      for (const s of shots) if (s.genItem === it.id) s.kind = to
      changed++
    }
    if (changed > 0) diag.push(`budget: ${changed} items downgraded to fit ${budget} credits`)
  }
  const byKind: Record<string, number> = {}
  for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
  return { items, totals: { credits: total(), items: items.length, byKind }, budget }
}
