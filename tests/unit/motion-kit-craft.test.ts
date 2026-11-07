// motion-montage, round 2 (Charlie's review of the showcase): spoken numbers read and set on their word, long holds cut in on a word,
// transitions only where they mean something and under a cap, punch-ins that never come back out, gliding moves, no sound effect unless a
// style measured them.
import { describe, expect, it } from 'vitest'
import { applyEditKit, hasPurpose, moveFor } from '../../src/engine/edit/grammar'
import { cutIns, repeatedPictures } from '../../src/engine/edit/inserts'
import { measureMotion, motionAdvice, motionBrief } from '../../src/engine/edit/motion-fit'
import { spelledValue, spokenNumbers, writeNumber } from '../../src/engine/edit/numbers'
import { EDIT_KITS, EditKit, editKitOf } from '../../src/engine/formats/edit-kit'
import { EDITPLAN_SCHEMA, EditPlan, type Shot } from '../../src/engine/formats/editplan'
import { MotionSpec } from '../../src/engine/formats/motion'
import type { Word } from '../../src/engine/formats/timing'
import { cameraExpr, glideExpr } from '../../src/engine/render/camera'

/** Timed words of a text, 0.32 s a word, a sentence per full stop. */
function wordsOf(text: string): Word[] {
  let t = 0
  let s = 0
  return text.split(/\s+/).map((w) => {
    const word = { w, start: t, end: t + 0.28, sentence: s, paragraph: 0 }
    t += 0.32
    if (/[.!?]$/.test(w)) s++
    return word
  })
}

function planOf(frames: number, cuts: number[], extra: Shot[] = []): EditPlan {
  const edges = [0, ...cuts, frames]
  const shots: Shot[] = edges.slice(0, -1).map((a, i) => ({ id: `s${i}`, track: 'base', startFrame: a, endFrame: edges[i + 1] as number, kind: 'image.gen', genItem: `g${i}`, transitionIn: 'cut', role: 'base', beat: 0 }))
  return EditPlan.parse({ schema: EDITPLAN_SCHEMA, fps: 30, size: [1920, 1080], frames, tracks: { base: shots.map((s) => s.id), overlay: extra.map((s) => s.id), labels: [] }, captionsPreset: 'classic', shots: [...shots, ...extra], chapters: [{ title: 'A', startFrame: 0 }], diagnostics: [] })
}

describe('spoken numbers', () => {
  it('reads French numbers in letters and digits', () => {
    expect(spelledValue([1000, 6, 100, 30, 7])).toBe(1637)
    expect(spelledValue([10, 1000])).toBe(10000)
    expect(spelledValue([4, 20, 10])).toBe(90)
    expect(spelledValue([60, 10])).toBe(70)
    expect(spelledValue([20, 1])).toBe(21)
    expect(writeNumber(10000, 'fr')).toBe('10 000')
    expect(writeNumber(2500000, 'en')).toBe('2,500,000')
  })
  it('finds what the showcase says and how it is written', () => {
    const words = wordsOf(
      "Amsterdam, mille six cent trente-sept. En trois mois à peine, le prix d’un bulbe est multiplié par vingt. Un seul Semper Augustus atteint dix mille florins. Les prix ont doublé, puis 40 % des marchands ont fait faillite, soit 10 000 personnes."
    )
    const found = spokenNumbers(words, 'fr')
    expect(found.map((n) => [n.kind, n.text])).toEqual([
      ['year', '1637'],
      ['times', '×20'],
      ['amount', '10 000 florins'],
      ['times', '×2'],
      ['percent', '40 %'],
      ['amount', '10 000 personnes']
    ])
    // on the number's own word
    const x20 = found[1] as (typeof found)[number]
    expect(words[x20.first]?.w).toBe('vingt.')
    expect(x20.atS).toBe(words[x20.first]?.start)
  })
  it('reads English', () => {
    const found = spokenNumbers(wordsOf('Prices went up twenty times. Two hundred and fifty thousand people left in 1846.'), 'en')
    expect(found.map((n) => n.text)).toEqual(['×20', '250,000 people', '1846'])
  })
  it('leaves small counts and articles alone', () => {
    expect(spokenNumbers(wordsOf('Une seule tulipe, en trois mois, vaut plus qu’une maison.'), 'fr')).toEqual([])
  })
})

describe('kit, round 2', () => {
  it('has no sound effect unless a style measured some', () => {
    expect(EditKit.parse({ rhythm: EDIT_KITS.avatar.rhythm }).sfx.perMinute).toBe(0)
    expect(editKitOf('documentary').sfx.perMinute).toBe(0)
    expect(editKitOf('avatar').sfx.perMinute).toBe(0)
    expect(editKitOf('pov2d').sfx.perMinute).toBeGreaterThan(0)
  })
  it('sets the numbers the voice says on their word, over stills only, never over another overlay', () => {
    const words = wordsOf('Le prix est ensuite multiplié par vingt en un hiver. Puis tout le marché du pays tombe et il atteint dix mille florins.')
    const frames = Math.round(((words.at(-1) as Word).end + 2) * 30)
    const plan = planOf(frames, [Math.round(4.5 * 30)])
    const kit = editKitOf('documentary', { numbers: { show: true, perMinute: 20, minGapS: 1 }, camera: { maxHoldS: null } })
    const r = applyEditKit({ plan, words, kit, seed: 1 })
    const nums = r.plan.shots.filter((s) => s.id.startsWith('num'))
    expect(nums.map((s) => (s.graphic as { props: { words: { text: string }[] } }).props.words[0]?.text)).toEqual(['×20', '10 000 florins'])
    expect(r.plan.tracks.overlay).toEqual(nums.map((s) => s.id))
    for (const s of nums) expect(MotionSpec.safeParse(s.graphic).success).toBe(true)
    // on the word: the overlay starts 0.15 s before it and its word lands on it
    const vingt = words.find((w) => w.w === 'vingt') as Word
    const first = nums[0] as Shot
    expect(Math.abs(first.startFrame / 30 + ((first.graphic as { props: { words: { atS: number }[] } }).props.words[0]?.atS ?? 0) - vingt.start)).toBeLessThan(0.04)
    expect(EditPlan.safeParse(r.plan).success).toBe(true)
    // a card under the word, or another overlay on it: nothing added
    const card: Shot = { id: 'o1', track: 'overlay', startFrame: 0, endFrame: frames, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: { template: 'title', accent: '#d5412f', theme: 'dark', props: { title: 'T' } } as Shot['graphic'] }
    expect(applyEditKit({ plan: planOf(frames, [Math.round(4.5 * 30)], [card]), words, kit, seed: 1 }).report.numbers).toBe(0)
  })
  it('cuts a still held too long into a closer framing, on a word, each part at least 2 s', () => {
    const words = wordsOf('Un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq vingt-six')
    const plan = planOf(9 * 30, [])
    const kit = editKitOf('documentary', { camera: { maxHoldS: 6 }, numbers: { show: false } })
    const { base, added } = cutIns(plan.shots, words, kit)
    expect(base.map((s) => s.id)).toEqual(['s0', 's0c'])
    const [a, b] = base as [Shot, Shot]
    expect(a.endFrame).toBe(b.startFrame)
    expect(words.some((w) => Math.round(w.start * 30) === b.startFrame)).toBe(true)
    expect(Math.min(a.endFrame - a.startFrame, b.endFrame - b.startFrame)).toBeGreaterThanOrEqual(60)
    expect(b.genItem).toBe(a.genItem)
    expect(b.motion?.from).toBeGreaterThanOrEqual(kit.camera.cutInZoom)
    expect(b.motion?.ease).toBe('glide')
    expect(added.has('s0c')).toBe(true)
    const r = applyEditKit({ plan, words, kit, seed: 3 })
    expect(r.plan.tracks.base).toEqual(['s0', 's0c'])
    expect(r.plan.shots.find((s) => s.id === 's0c')?.transitionIn).toBe('cut')
    expect(r.report.cutIns).toBe(1)
    expect(EditPlan.safeParse(r.plan).success).toBe(true)
  })
  it('keeps a transition only where it means something, and under the cap', () => {
    const still = (id: string, a: number, b: number, item: string): Shot => ({ id, track: 'base', startFrame: a, endFrame: b, kind: 'image.gen', genItem: item, transitionIn: 'cut', role: 'base', beat: 0 })
    const card = { ...still('c', 0, 90, 'x'), kind: 'motion' } as Shot
    expect(hasPurpose('match', still('a', 0, 90, 'p'), still('b', 90, 180, 'p'), 'sentence')).toBe(true)
    expect(hasPurpose('match', still('a', 0, 90, 'p'), still('b', 90, 180, 'q'), 'sentence')).toBe(false)
    expect(hasPurpose('whip', still('a', 0, 90, 'p'), still('b', 90, 180, 'q'), 'phrase')).toBe(true)
    expect(hasPurpose('whip', still('a', 0, 300, 'p'), still('b', 300, 390, 'q'), 'phrase')).toBe(false)
    expect(hasPurpose('zoom', still('a', 0, 90, 'p'), card, 'sentence')).toBe(true)
    expect(hasPurpose('flash', still('a', 0, 90, 'p'), still('b', 90, 180, 'q'), 'sentence')).toBe(false)
    expect(hasPurpose('flash', still('a', 0, 90, 'p'), still('b', 90, 180, 'q'), 'chapter')).toBe(true)
    // a kit that wants a flash at every sentence gets none (no disclosure there); one that wants dissolves gets at most its cap
    const words = wordsOf(Array.from({ length: 40 }, (_, i) => (i % 4 === 3 ? 'fin.' : 'mot')).join(' '))
    const plan = planOf(390, [60, 120, 180, 240, 300, 360].map((x) => x - 0))
    const flashy = editKitOf('documentary', { transitions: { sentence: { flash: 1 }, phrase: { flash: 1 } }, camera: { maxHoldS: null } })
    expect(applyEditKit({ plan, words, kit: flashy, seed: 1 }).report.transitions.flash ?? 0).toBe(0)
    const soft = editKitOf('documentary', { transitions: { sentence: { dissolve: 1 }, phrase: { dissolve: 1 }, perMinute: 4 }, camera: { maxHoldS: null } })
    const blends = Object.entries(applyEditKit({ plan, words, kit: soft, seed: 1 }).report.transitions).filter(([k]) => k !== 'cut').reduce((a, [, n]) => a + (n ?? 0), 0)
    expect(blends).toBeLessThanOrEqual(Math.floor((4 * 390) / 30 / 60))
  })
  it('lands a punch-in only near a still`s end and never brings it back out', () => {
    const words = wordsOf(Array.from({ length: 60 }, (_, i) => (i % 6 === 5 ? 'FIN!' : 'mot')).join(' '))
    const frames = Math.round(((words.at(-1) as Word).end + 1) * 30)
    const plan = planOf(frames, Array.from({ length: Math.floor(frames / 120) }, (_, i) => (i + 1) * 120).filter((x) => x < frames))
    const kit = editKitOf('avatar', { punches: { perMinute: 20, minGapS: 1, maxAfterS: 2 }, camera: { maxHoldS: null } })
    const r = applyEditKit({ plan, words, kit, seed: 1 })
    const punched = r.plan.shots.filter((s) => s.punches?.length)
    expect(punched.length).toBeGreaterThan(0)
    for (const s of punched) {
      for (const p of s.punches ?? []) {
        expect(p.holdS).toBeUndefined()
        expect((s.endFrame - s.startFrame) / 30 - p.atS).toBeLessThanOrEqual(2 + 1e-6)
      }
    }
  })
  it('glides: an even speed in the middle of a long move, eased ends, and a push towards the subject', () => {
    const g = glideExpr(300)
    expect(g).not.toMatch(/[^\\],/)
    const at = (expr: string, on: number): number => {
      const js = expr.replace(/\\,/g, ',').replace(/clip\(/g, 'Math.min(Math.max(').replace(/,([^,()]+),([^,()]+)\)/g, ',$1),$2)')
      return Function('on', `return ${js}`)(on) as number
    }
    expect(at(g, 0)).toBeCloseTo(0, 6)
    expect(at(g, 299)).toBeCloseTo(1, 6)
    // even speed in the middle: equal steps
    expect(at(g, 150) - at(g, 140)).toBeCloseTo(at(g, 110) - at(g, 100), 6)
    // eased start: the first step is smaller than a middle one
    expect(at(g, 2) - at(g, 0)).toBeLessThan(at(g, 152) - at(g, 150))
    const toward = cameraExpr({ kind: 'push', from: 1.02, to: 1.2, focus: { x: 0.6, y: 0.1, w: 0.3, h: 0.3 }, ease: 'glide' }, 300)
    expect(toward.cx).not.toBe('0.5')
    expect(toward.cy).not.toBe('0.5')
  })
})

describe('motion that fits the channel', () => {
  it('measures what motion design a reference has, and its look', () => {
    const shots = [
      { start: 0, end: 6, text: 'Carte satellite de l’Europe, régions en rouge, un trajet animé' },
      { start: 6, end: 12, text: 'Archive footage of soldiers marching' },
      { start: 12, end: 18, text: 'Graphique animé en barres sur vieux papier sépia' },
      { start: 18, end: 24, text: 'A letter on parchment, a phrase underlined in red' },
      { start: 24, end: 60, text: 'Black and white film of a city' }
    ]
    const m = measureMotion(shots)
    expect(m.graphicsShare).toBe(0.3)
    expect(m.perMinute.map).toBe(1)
    expect(m.perMinute.data).toBe(1)
    expect(m.perMinute.document).toBe(1)
    expect(m.look).toBe('period')
  })
  it('clones a reference that has motion design and proposes what it lacks', () => {
    const a = motionAdvice({ graphicsShare: 0.3, perMinute: { map: 1, data: 1 }, look: 'modern' }, { register: 'documentary', subjectYear: 1637 })
    expect(a.mode).toBe('clone')
    expect(a.look).toBe('modern')
    expect(a.families.map((f) => f.family)).toEqual(['map', 'data'])
    expect(a.proposals.some((p) => p.includes('period look'))).toBe(true)
    expect(a.proposals.some((p) => p.includes('×20'))).toBe(true)
    expect(a.avoid.some((x) => x.includes('neon'))).toBe(true)
  })
  it('proposes motion in the look of the subject’s era when the reference has none, and nothing that does not fit', () => {
    const doc = motionAdvice({ graphicsShare: 0, perMinute: {} }, { register: 'documentary', subjectYear: 1637 })
    expect(doc.mode).toBe('propose')
    expect(doc.look).toBe('period')
    expect(doc.families.map((f) => f.family)).toContain('map')
    expect(motionAdvice(undefined, { register: 'documentary', subjectYear: 1942 }).look).toBe('newsprint')
    const vlog = motionAdvice(undefined, { register: 'vlog' })
    expect(vlog.look).toBe('modern')
    expect(vlog.families.every((f) => f.family === 'strap' || f.family === 'words')).toBe(true)
    expect(motionBrief(doc)).toContain('Propose adding some')
    expect(motionBrief(doc)).toContain('neon')
  })
})

describe('round 3: repeated pictures and measured stillness', () => {
  const shot = (id: string, a: number, b: number, item: string, tr: Shot['transitionIn'] = 'cut'): Shot => ({ id, track: 'base', startFrame: a, endFrame: b, kind: 'image.gen', genItem: item, transitionIn: tr, role: 'base', beat: 0 })
  it('flags the same picture twice in a row, except a match or an allowed cut-in', () => {
    const base = [shot('a', 0, 90, 'p'), shot('b', 90, 180, 'p'), shot('c', 180, 270, 'q'), shot('d', 270, 360, 'q', 'match'), shot('e', 360, 450, 'q')]
    expect(repeatedPictures(base)).toEqual(['le plan b (0:03) montre la même image que le plan a', 'le plan e (0:12) montre la même image que le plan d'])
    expect(repeatedPictures(base, new Set(['b', 'e']))).toEqual([])
  })
  it('the kits hold stills still by default (measured on the references) and no longer cut in', () => {
    expect(editKitOf('documentary').camera.stills.still).toBeGreaterThan(editKitOf('documentary').camera.stills.push ?? 0)
    for (const k of ['documentary', 'avatar', 'pov2d'] as const) expect(editKitOf(k).camera.maxHoldS).toBeNull()
    expect(moveFor('still', 5, 0.02)).toEqual({ kind: 'push', from: 1.03, to: 1.03 })
  })
})

