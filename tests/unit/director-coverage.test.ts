// Coverage per section of the animated overlays and the hook's own label quota : the opening and every
// later chunk keep their own cap and gap, two consecutive overlays never share a template, a colliding cue slides later; absent, the
// whole-film share decides as before.
import { describe, expect, it } from 'vitest'
import { FPS } from '../../src/engine/formats/timing'
import { MotionPlanParams, coverageSections, placeMotion } from '../../src/engine/nodes/director-motion'
import { DirectorParams, buildPlan, type BeatDraft } from '../../src/engine/nodes/director-cuts'
import { makeFilm } from './film-fixture'
import { filmOf } from './motion-fixture'

// a long narration full of figures, people and places: more cues than any cap lets through
const SENTENCES = [
  'Le professeur Élise Moreau a compté 12 000 navires devant le port.',
  'Le capitaine Jean Dupont a perdu 3 500 tonnes de blé à Brest.',
  'Ils étaient 40 % à refuser de partir à Lorient.',
  'Le budget était de 7 millions d’euros, une somme énorme.',
  'Le docteur Paul Martin a soigné 1 200 marins à Nantes.',
  'Près de 9 000 lettres sont arrivées à Rennes cet hiver.'
]
const LONG = Array.from({ length: 4 }, () => SENTENCES.join(' ')).join('\n\n')
const film = filmOf(LONG)
const input = (over: Record<string, unknown>) => ({ beats: film.beats, words: film.words, parsed: film.parsed, title: film.outline.title, durationS: film.durationS, cfg: MotionPlanParams.parse(over), shots: [] })
const coverage = { hookS: 30, hookShare: 0.5, chunkS: 30, chunkShare: 0.2, hookGapS: 0.4, gapS: 1, slideS: 4.5, sameKindPenalty: 0.4, sameKindWindowS: 20, noRepeatInRow: true }

describe('coverage per section', () => {
  it('the film is the hook, then chunks', () => {
    expect(coverageSections(95, MotionPlanParams.parse({ coverage: {} }).coverage as never)).toEqual([
      { startS: 0, endS: 60, share: 0.62, gapS: 0.4 },
      { startS: 60, endS: 95, share: 0.42, gapS: 1 }
    ])
  })

  it('every section stays under its cap; the hook is covered more than the rest; no two overlays in a row share a template', () => {
    expect(film.durationS).toBeGreaterThan(90)
    const r = placeMotion(input({ share: 0.8, perMinute: 12, titleCard: false, coverage }))
    const spans = r.shots.map((s) => ({ a: s.startFrame / FPS, b: s.endFrame / FPS, t: s.graphic?.template }))
    const covered = (from: number, to: number): number => spans.reduce((n, x) => n + Math.max(0, Math.min(x.b, to) - Math.max(x.a, from)), 0)
    for (const s of coverageSections(film.durationS, coverage)) expect(covered(s.startS, s.endS), `${s.startS}`).toBeLessThanOrEqual(s.share * (s.endS - s.startS) + 0.05)
    expect(covered(0, 30) / 30).toBeGreaterThan(covered(30, film.durationS) / (film.durationS - 30))
    for (let i = 1; i < spans.length; i++) expect(spans[i]?.t, `${i}`).not.toBe(spans[i - 1]?.t)
    expect(r.diagnostics.some((d) => d.startsWith('motion coverage: 0–30 s'))).toBe(true)
  })

  it('later sections keep their minimum gap', () => {
    const r = placeMotion(input({ share: 0.8, perMinute: 12, titleCard: false, coverage: { ...coverage, chunkShare: 0.6, gapS: 3 } }))
    const after = r.shots.filter((s) => s.startFrame / FPS >= 30)
    for (let i = 1; i < after.length; i++) expect(((after[i]?.startFrame ?? 0) - (after[i - 1]?.endFrame ?? 0)) / FPS).toBeGreaterThanOrEqual(3 - 1 / FPS)
  })

  it('without coverage the whole-film share decides, as before', () => {
    const before = placeMotion(input({ share: 0.2, perMinute: 12, titleCard: false }))
    expect(before.diagnostics.some((d) => d.startsWith('motion coverage'))).toBe(false)
    const seconds = before.shots.reduce((n, s) => n + (s.endFrame - s.startFrame) / FPS, 0)
    expect(seconds).toBeLessThanOrEqual(0.2 * film.durationS + 1e-6)
  })
})

describe('the hook’s own label quota', () => {
  const FILM = makeFilm(600)
  // a figure said once per beat: more label candidates than any quota
  const drafts = new Map<number, BeatDraft>()
  for (const b of FILM.beats) {
    const t = b.text.split(/\s+/).find((w) => /^\d{3}$/.test(w))
    if (t) drafts.set(b.i, { beat: b.i, subject: 'sujet', stockQuery: 'harbor crane', imagePrompt: 'a harbor at dawn', labels: [{ text: t, anchorWords: t }] })
  }
  const labelsOf = (over: Record<string, unknown>) =>
    buildPlan({ beats: FILM.beats, words: FILM.words, durationS: FILM.durationS, title: FILM.outline.title, script: FILM.script, drafts, p: DirectorParams.parse(over), seed: 3, diagnostics: [] }).plan.shots.filter(
      (s) => s.track === 'labels'
    )

  it('counts the hook and the rest apart; absent, one quota for the whole film', () => {
    const hookOf = (ls: { startFrame: number }[]) => ls.filter((l) => l.startFrame / FPS < 60).length
    const apart = labelsOf({ labelsPerMin: 1, labelsHookPerMin: 3 })
    expect(hookOf(apart)).toBeLessThanOrEqual(3)
    expect(apart.length - hookOf(apart)).toBeLessThanOrEqual(Math.round((1 * (FILM.durationS - 60)) / 60))
    // one quota for the whole film takes the hook's figures first; counted apart, the body keeps its own
    const one = labelsOf({ labelsPerMin: 1 })
    expect(one).toHaveLength(Math.round(FILM.durationS / 60))
    expect(apart.length - hookOf(apart)).toBeGreaterThan(one.length - hookOf(one))
  })
})
