// qualite-montage: the edit review that runs on every render (src/engine/review/), the texts documentary@2 writes (doc2-texts.ts), the
// voice's slivers (voice-trim.ts) and the QC check that reads the review. Pure, no ffmpeg.
import { describe, expect, it } from 'vitest'
import { checkTimeline, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { editCheck } from '../../src/engine/nodes/qc-check'
import { dateText, dateWord } from '../../src/engine/nodes/doc2-texts'
import { pauseCuts, slivers } from '../../src/engine/nodes/voice-trim'
import type { RunCtx } from '../../src/engine/registry'
import { applyPatches, choosePatches, languageOf, renderReviewed, reviewPlan } from '../../src/engine/review'
import { badDateForm, figuresOf, wrongLanguage, type PlanReviewInput } from '../../src/engine/review/checks'
import { frozenDefects, musicDefect, parseFrozen, voiceDefects } from '../../src/engine/review/media'

const F = 30
const shot = (id: string, a: number, b: number, extra: Partial<Shot> = {}): Shot => ({ id, track: 'base', startFrame: a * F, endFrame: b * F, kind: 'stock.video', transitionIn: 'cut', role: 'scene', beat: 0, ...extra })
const planOf = (base: Shot[], overlay: Shot[] = []): EditPlan => ({
  schema: 'atelier.editplan/1',
  fps: 30,
  size: [1920, 1080],
  frames: (base.at(-1) as Shot).endFrame,
  tracks: { base: base.map((s) => s.id), overlay: overlay.map((s) => s.id), labels: [] },
  shots: [...base, ...overlay],
  captionsPreset: 'none',
  chapters: [],
  diagnostics: []
}) as unknown as EditPlan
const sentence = (text: string, from: number, step = 0.4): Word[] =>
  text.split(' ').map((w, k) => ({ w, start: from + k * step, end: from + k * step + step * 0.9, sentence: 0, paragraph: 0 }))
const input = (plan: EditPlan, words: Word[], o: Partial<PlanReviewInput> = {}): PlanReviewInput => ({
  plan,
  words,
  language: 'en',
  clipS: () => undefined,
  isCard: (s) => s.kind === 'motion',
  seen: [],
  ...o
})
const board = (id: string, a: number, b: number, props: Record<string, unknown> = {}): Shot =>
  shot(id, a, b, { kind: 'motion', graphic: { template: 'prints', props: { prints: [{ atS: 0.15 }], move: 'still', ...props } } as Shot['graphic'] })

describe('texts written as the reference writes them', () => {
  it('a date is a date, not the phrase cut from the sentence, and lands on its year', () => {
    expect(dateText('the spring of 1940')).toBe('Spring 1940')
    expect(dateText('By the end of 1942')).toBe('End of 1942')
    expect(dateText('in the summer of 1940')).toBe('Summer 1940')
    expect(dateText('In 1938')).toBe('1938')
    expect(dateText('June 1940')).toBe('June 1940')
    expect(dateText('à la fin de 1942', 'fr')).toBe('Fin 1942')
    expect(dateText('au printemps 1940', 'fr')).toBe('Printemps 1940')
    expect(dateWord('the spring of 1940')).toBe('1940')
    expect(badDateForm('the spring of 1940')).toBe(true)
    expect(badDateForm('By the end of 1942')).toBe(true)
    expect(badDateForm('Spring 1940')).toBe(false)
  })
  it('reads the language from the words and a text in the other one', () => {
    expect(languageOf(sentence('the army of the Reich was in the north and the south of it', 0))).toBe('en')
    expect(languageOf(sentence('le pays est dans les Alpes et la Suisse est au centre de la carte', 0))).toBe('fr')
    expect(wrongLanguage('la fin de la guerre', 'en')).toBe(true)
    expect(wrongLanguage('Operation Tannenbaum', 'en')).toBe(false)
    expect(figuresOf('4,200,000 people in 1942')).toEqual([4200000, 1942])
  })
})

describe('the review of a plan', () => {
  const words = sentence('In the spring of 1940 the German army tore through Western Europe in a matter of weeks and then it stopped at the border of a small country', 0)

  it('finds a board held still, a film that freezes, the hook that waits, and fixes them on the plan', () => {
    const plan = planOf([board('s1', 0, 6.4), shot('s2', 6.4, 12, { genItem: 'i2' }), board('s3', 12, 15, { move: 'settle' })])
    const defects = reviewPlan(input(plan, words, { clipS: (s) => (s.id === 's2' ? 3 : undefined) }))
    const kinds = defects.map((d) => `${d.kind}:${d.shotId}`)
    expect(kinds).toContain('held:s1')
    expect(kinds).toContain('hook_slow:s1')
    expect(kinds).toContain('film_short:s2')
    expect(kinds.some((k) => k.endsWith(':s3'))).toBe(false)
    const fixes = choosePatches(defects)
    // one fix per shot: the board gets a camera, the film's frozen tail goes to the next board
    expect(fixes).toEqual([{ op: 'move', shotId: 's1', zoom: 1.09 }, { op: 'shift', shotId: 's2', toFrame: 6.4 * F + Math.floor(3 * 1.3 * F) }])
    const { plan: fixed, applied } = applyPatches(plan, fixes)
    expect(applied.length).toBe(2)
    expect(checkTimeline(fixed, fixed.frames)).toEqual([])
    expect(fixed.shots.find((s) => s.id === 's1')?.motion).toEqual({ kind: 'push', from: 1, to: 1.09, ease: 'linear' })
    expect(reviewPlan(input(fixed, words, { clipS: (s) => (s.id === 's2' ? 3 : undefined) })).filter((d) => d.kind === 'held' || d.kind === 'film_short')).toEqual([])
  })

  it('finds the same picture again within a minute and drops it into its neighbour', () => {
    const plan = planOf([shot('s1', 0, 12, { genItem: 'a' }), shot('s2', 12, 15, { genItem: 'b', kind: 'stock.photo', motion: { kind: 'push', from: 1, to: 1.09, ease: 'linear' } }), shot('s3', 15, 18, { genItem: 'c', kind: 'stock.photo', motion: { kind: 'push', from: 1, to: 1.09, ease: 'linear' } })])
    const seen = [{ id: 's1', source: 'x' }, { id: 's2', source: 'y' }, { id: 's3', source: 'x' }]
    const defects = reviewPlan(input(plan, words, { seen }))
    const dup = defects.find((d) => d.kind === 'duplicate')
    expect(dup?.shotId).toBe('s3')
    expect(dup?.fix).toEqual({ op: 'drop', shotId: 's3', into: 's2' })
    const { plan: fixed } = applyPatches(plan, choosePatches(defects))
    expect(fixed.tracks.base).toEqual(['s1', 's2'])
    expect(fixed.shots.find((s) => s.id === 's2')?.endFrame).toBe(18 * F)
    expect(checkTimeline(fixed, fixed.frames)).toEqual([])
  })

  it('reads the texts: a phrase for a date, a figure nobody says, a text in another language; a map with no legend', () => {
    const tags = shot('t1', 0, 6, { track: 'overlay', kind: 'motion', graphic: { template: 'doc-tags', props: { tags: [{ kind: 'date', text: 'the spring of 1940', atS: 1.2 }, { kind: 'number', text: '1942', atS: 2 }, { kind: 'bar', text: 'la fin de la guerre', atS: 3 }] } } as Shot['graphic'] })
    const map = shot('s2', 6, 12, { kind: 'motion', graphic: { template: 'map3d', props: { title: 'Europe, summer 1940', camera: { keys: [{ atS: 0 }, { atS: 6 }] }, regions: [{ countries: ['Germany', 'Italy'] }] } } as Shot['graphic'] })
    const plan = planOf([shot('s1', 0, 6, { genItem: 'a' }), map], [tags])
    const defects = reviewPlan(input(plan, words))
    const kinds = defects.map((d) => d.kind)
    expect(kinds).toContain('text_form')
    expect(kinds).toContain('text_unsaid')
    expect(kinds).toContain('text_language')
    expect(kinds).toContain('map_legend')
    // the year said at 1.6 s, its text at 1.2 s: on time
    expect(kinds).not.toContain('text_late')
    expect(defects.find((d) => d.kind === 'text_unsaid')?.fix).toEqual({ op: 'drop_overlay', shotId: 't1' })
    const { plan: fixed } = applyPatches(plan, [{ op: 'drop_overlay', shotId: 't1' }])
    expect(fixed.tracks.overlay).toEqual([])
  })
})

describe('the film and its sound', () => {
  it('maps frozen stretches to their shots, a held picture getting a camera', () => {
    const plan = planOf([shot('s1', 0, 5, { genItem: 'a' }), board('s2', 5, 12, { move: 'settle' })])
    const frozen = parseFrozen('[freezedetect] lavfi.freezedetect.freeze_start: 7.2\n[freezedetect] lavfi.freezedetect.freeze_end: 12.0\n', 12)
    expect(frozen).toEqual([{ start: 7.2, end: 12 }])
    const d = frozenDefects(plan, frozen, 4.5, (s) => s.kind === 'motion')
    expect(d.map((x) => [x.kind, x.shotId, x.fix?.op])).toEqual([['frozen', 's2', 'move']])
  })

  it('hears a hole inside a word and a click, not the pauses between words', () => {
    // 10 ms frames: speech at -15 dB, pauses at -70, the word « None » at 2.0–2.8 s with a hole 2.1–2.35 s; a click at 4.0 s
    const env = new Float32Array(600).fill(-70)
    const speak = (a: number, b: number, db = -15): void => {
      for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) env[i] = db
    }
    speak(0.5, 1.5)
    speak(2.0, 2.1)
    speak(2.35, 2.8)
    env[400] = -20
    const words: Word[] = [
      { w: 'story.', start: 0.5, end: 1.5, sentence: 0, paragraph: 0 },
      { w: 'None', start: 2.0, end: 2.8, sentence: 1, paragraph: 0 }
    ]
    const d = voiceDefects(env, words)
    expect(d.map((x) => x.kind)).toEqual(['audio_dropout', 'audio_click'])
    expect(d[0]?.atS).toBeCloseTo(2.1, 1)
  })

  it('finds music too loud in the pauses', () => {
    const env = new Float32Array(3000).fill(-20)
    const words: Word[] = Array.from({ length: 20 }, (_, k) => ({ w: 'w', start: k * 1.4, end: k * 1.4 + 1, sentence: k, paragraph: 0 }))
    for (const w of words) for (let i = Math.round(w.start * 100); i < Math.round(w.end * 100); i++) env[i] = -14
    expect(musicDefect(env, words)?.kind).toBe('music_loud')
    env.fill(-40)
    for (const w of words) for (let i = Math.round(w.start * 100); i < Math.round(w.end * 100); i++) env[i] = -14
    expect(musicDefect(env, words)).toBeNull()
  })

  it('a burst alone between two silences is a sliver, cut with the pause', () => {
    const regions = [
      { start: 0.5, end: 1.5 },
      { start: 2.0, end: 2.05 },
      { start: 2.3, end: 3.0 }
    ]
    expect(slivers(regions)).toEqual([{ start: 2.0, end: 2.05 }])
    const cuts = pauseCuts(regions, 0.45)
    // the pause 1.5 → 2.3 is cut to 0.45 s, the sliver inside it goes with it
    expect(cuts.some((c) => c.start <= 2.0 && c.end >= 2.05)).toBe(true)
    // a word of 0.2 s is never a sliver
    expect(slivers([{ start: 0, end: 1 }, { start: 1.3, end: 1.5 }, { start: 1.8, end: 2.5 }])).toEqual([])
  })
})

describe('the review loop on a render', () => {
  it('renders, reviews, fixes, renders again; what is left is reported, the rounds are bounded', async () => {
    const plan = planOf([board('s1', 0, 6.4), shot('s2', 6.4, 12, { genItem: 'i2' }), board('s3', 12, 16.5)])
    const renders: EditPlan[] = []
    const ctx = { services: {}, signal: new AbortController().signal, emit: () => undefined } as unknown as RunCtx
    const r = await renderReviewed({
      ctx,
      plan,
      words: sentence('In the spring of 1940 the German army tore through Western Europe', 0, 1.2),
      voice: 'v.flac',
      music: false,
      rounds: 2,
      look: false,
      clipS: (s) => (s.id === 's2' ? 3 : undefined),
      isCard: (s) => s.kind === 'motion',
      dir: '.',
      render: async (pl) => {
        renders.push(pl)
        return { file: 'f.mp4', seen: [] }
      }
    })
    // a render, fixes (a camera on the first board, the frozen film's tail to the last board), a render, the last board now held too
    // long gets its camera (the loop sees what a fix changed), a last render, a review with nothing fixable left
    expect(renders.length).toBe(3)
    expect(r.report.rounds.map((x) => x.applied.length)).toEqual([2, 1, 0])
    expect(r.report.rounds[0]?.defects.length).toBeGreaterThan(r.report.left.length)
    // the hook's boards are still long (the first 6.4 s, the last one now starting at 10.3 s): they move now, and the review still says
    // the hook waits (the director's to cut, not the render's)
    expect(r.report.left.map((d) => `${d.kind}:${d.shotId}`)).toEqual(['hook_slow:s1', 'hook_slow:s3'])
    const qc = editCheck(r.report)
    expect(qc?.status).toBe('warn')
    expect(qc?.data).toMatchObject({ fixed: 3, left: 2 })
  })
})
