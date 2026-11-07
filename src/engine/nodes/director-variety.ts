// Variety of the pictures (avatar-qualite, Charlie 01/11: « les 3 derniers plans c'est quasiment les mêmes »): no two
// pictures within REPEAT_WINDOW_S show the same subject, unless one continuing action (a clip shared by two shots). The first
// real 60 s hook showed a white wall corner five times: one fixed « recurring » description at the head of half the prompts,
// and two shots cut on one directive (9 directives for 10 shots). Here: how alike two prompts are (word overlap, the words every
// prompt shares set aside), the angles a shot may take when its sentence has no fresh directive left (the shot-planning guide:
// hands at work, the object named, the place, the result, a person reacting), and the plan's check (`repeatProblems`).
// Pure: no I/O.
import type { Directive } from '../formats/directives'
import type { EditPlan, GenItem, GenList } from '../formats/editplan'
import { normWord } from '../text/script'

/** Seconds within which two pictures never show the same subject. */
export const REPEAT_WINDOW_S = 20
/** Two scenes sharing at least this share of their words (Jaccard) show the same thing. */
export const SIMILAR_SCENES = 0.5

/** Words that say how a picture is framed or lit, not what it shows. */
const FRAMING = new Set(
  (
    'shot shots close closeup close-up extreme detail wide medium overhead angle low high view slow push pull pan in out light lighting natural soft warm cold the and with from into onto over under for its his her their this that a an of on at to by is are photo picture frame framing camera hand-held handheld left right side just visible' +
    // the angles of the guide (FACETS) say how a sentence is shown, not what
    ' hands doing seen main object alone filling whole place further away same thing moment later once done face person happens one clear action still life'
  ).split(' ')
)

/** The content words of a scene (lower case, accents off, 3 letters or more, framing words out). */
export function sceneWords(scene: string): Set<string> {
  const out = new Set<string>()
  for (const raw of scene.split(/[^\p{L}\p{N}'-]+/u)) {
    const w = normWord(raw).replace(/^['-]+|['-]+$/g, '')
    if (w.length >= 3 && !FRAMING.has(w)) out.add(w)
  }
  return out
}

/** How alike two scenes are, 0–1 (Jaccard of their content words, `common` words set aside). */
export function sceneSimilarity(a: string, b: string, common: ReadonlySet<string> = new Set()): number {
  const x = [...sceneWords(a)].filter((w) => !common.has(w))
  const y = new Set([...sceneWords(b)].filter((w) => !common.has(w)))
  if (x.length === 0 || y.size === 0) return 0
  const both = x.filter((w) => y.has(w)).length
  return both / (x.length + y.size - both)
}

/** Words more than half the scenes share (a style or a setting written everywhere): they say nothing about the subject. */
export function commonWords(scenes: readonly string[]): Set<string> {
  if (scenes.length < 6) return new Set()
  const n = new Map<string, number>()
  for (const s of scenes) for (const w of sceneWords(s)) n.set(w, (n.get(w) ?? 0) + 1)
  return new Set([...n].filter(([, k]) => k > scenes.length / 2).map(([w]) => w))
}

/** The angles a picture of a sentence may take (the shot-planning guide), in the order a stretch rotates them. */
export const FACETS = [
  { id: 'hands', size: 'close-up', scene: 'the hands doing it, seen close', fr: 'le geste' },
  { id: 'object', size: 'extreme close-up detail', scene: 'the main object alone, filling the frame', fr: 'l’objet' },
  { id: 'place', size: 'wide shot', scene: 'the whole place, seen from further away', fr: 'le lieu' },
  { id: 'result', size: 'medium shot', scene: 'the same thing a moment later, once done', fr: 'le résultat' },
  { id: 'reaction', size: 'medium close shot', scene: 'the face of the person it happens to', fr: 'une réaction' }
] as const

/** A shot size the scene pass wrote at the head of a prompt (« Close-up of … »), taken off before another angle is put on. */
export const SIZE_HEAD = /^\s*((?:extreme\s+)?close[- ]up(?:\s+detail)?|close\s+shot|(?:medium\s+)?wide\s+shot|medium(?:\s+close)?\s+shot|low[- ]angle(?:\s+(?:medium|wide))?\s+shot|overhead\s+shot|high[- ]angle\s+shot|slow\s+pan\s+across|slow\s+push-in\s+on)\s+(?:of\s+)?/i

/** A scene written by code on one angle of the guide (a variant or the deterministic directives): judged by its subject only. */
export const isAngleScene = (scene: string): boolean => FACETS.some((f) => scene.includes(f.scene))

/** Two scenes show the same thing: alike in words, unless one is an angle written by code (its key terms say little). */
export const sameScene = (a: string, b: string, common?: ReadonlySet<string>): boolean => !isAngleScene(a) && !isAngleScene(b) && sceneSimilarity(a, b, common) >= SIMILAR_SCENES

/** The terms of a sentence taken in turn: the k-th angle gets other words than the (k-1)-th. */
function rotated(terms: readonly string[], k: number, n = 3): string[] {
  if (terms.length <= n) return [...terms]
  return Array.from({ length: n }, (_, i) => terms[(k + i) % terms.length] as string)
}

/**
 * A picture for a shot whose sentence has no fresh directive left: the SAME subject as the directive on screen, seen from the
 * k-th angle of the guide (avatar-qualite part 2: a new unrelated subject broke « illustrate the words »); without one, the
 * angle on the sentence's own words. Never the repeated prompt as it was (the same prompt twice gives the same picture).
 */
export function facetDirective(base: Directive | null, sentence: number, terms: readonly string[], k: number): Directive {
  const f = FACETS[k % FACETS.length] as (typeof FACETS)[number]
  const words = rotated(terms, k).join(', ')
  const subject = `${base?.subject ?? (terms.slice(0, 3).join(', ') || 'plan')} — ${f.fr}`.slice(0, 200)
  const same = base?.prompt ? base.prompt.replace(SIZE_HEAD, '').slice(0, 600) : null
  return {
    sentence,
    anchor: base?.anchor ?? terms[0] ?? 'plan',
    kind: base?.kind ?? 'imageAi',
    subject,
    prompt: `${f.size} of ${f.scene}: ${same ?? (words || subject)}`,
    ...(base?.query ? { query: `${words || base.query}`.slice(0, 80) } : {}),
    why: `autre angle (${f.fr}) : la consigne de ce passage est déjà à l’écran`
  }
}

/** What a picture item shows, for the comparisons (its scene, else its prompt or query). */
const sceneOf = (it: GenItem): string => it.shot?.scene ?? it.prompt ?? it.query ?? it.context.subject

/**
 * The pictures of a plan that repeat a subject within REPEAT_WINDOW_S, in French (empty: none). Two base-track pictures
 * repeat when they share their subject or their scenes are alike; a clip shared by two shots (one continuing action) does not.
 */
export function repeatProblems(plan: EditPlan, list: GenList, windowS = REPEAT_WINDOW_S): string[] {
  const items = new Map(list.items.map((i) => [i.id, i]))
  const shots = plan.shots
    .filter((s) => s.track === 'base' && s.kind !== 'avatar' && s.genItem !== undefined)
    .map((s) => ({ s, it: items.get(s.genItem as string) }))
    .filter((x): x is { s: (typeof plan.shots)[number]; it: GenItem } => x.it !== undefined && x.it.kind !== 'avatar')
    .sort((a, b) => a.s.startFrame - b.s.startFrame)
  const common = commonWords(shots.map((x) => sceneOf(x.it)))
  const problems: string[] = []
  for (let i = 0; i < shots.length; i++) {
    const a = shots[i] as (typeof shots)[number]
    for (let j = i + 1; j < shots.length; j++) {
      const b = shots[j] as (typeof shots)[number]
      if ((b.s.startFrame - a.s.startFrame) / plan.fps >= windowS) break
      if (a.it.id === b.it.sameAs || b.it.id === a.it.sameAs || (a.it.sameAs !== undefined && a.it.sameAs === b.it.sameAs)) continue
      const same = normWord(a.it.context.subject) === normWord(b.it.context.subject) || sameScene(sceneOf(a.it), sceneOf(b.it), common)
      if (same) problems.push(`${a.s.id} et ${b.s.id} montrent la même chose à ${Math.round((b.s.startFrame - a.s.startFrame) / plan.fps)} s d’écart (« ${a.it.context.subject} »)`)
    }
  }
  return problems
}
