// documentary-2: the measured archive documentary. The sequencer keeps the reference's variety rules (no non-film pattern twice in a row,
// maps / charts / documents apart, the boards' layouts rotating, the families near their measured shares), the scene check never lets a
// text the narration does not say reach the screen, the plan builder makes archive films and drawn cards only, and the new bricks draw
// what the reference shows (texts over a film, the boards' layouts and side texts, the old-TV frame). No browser, no network.
import { describe, expect, it } from 'vitest'
import { checkMotion, type MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES, type Beat, type Word } from '../../src/engine/formats/timing'
import { motionHtml } from '../../src/engine/motion'
import type { MotionCtx } from '../../src/engine/motion/base'
import { printSlots } from '../../src/engine/motion/doc-prints'
import { segmentArgs } from '../../src/engine/render/segments'
import { buildDoc2, slotsOf } from '../../src/engine/nodes/director-doc2'
import { sentencesOf } from '../../src/engine/nodes/director-mix'
import { DOC2_PROFILE, familyOf } from '../../src/engine/nodes/doc2-profile'
import { checkScene, fakeScene, saidIn, type Doc2Scene } from '../../src/engine/nodes/doc2-scene'
import { familyShares, sequenceDoc2, sequenceProblems, type Doc2Slot } from '../../src/engine/nodes/doc2-sequence'

const [W, H] = FRAME_SIZES['16:9']
const ctx = (durationS = 6): MotionCtx => ({ width: W, height: H, durationS, fontCss: '' })

/** A narration of `n` sentences of about `len` seconds, with the scenes `sceneOf` gives. */
function slotsFrom(n: number, len: number, sceneOf: (i: number) => Partial<Doc2Scene>): Doc2Slot[] {
  return Array.from({ length: n }, (_, i) => ({ sentence: i + 1, start: i * len, end: (i + 1) * len, part: 0, scene: { sentence: i + 1, film: `film ${i}`, ...sceneOf(i) } }))
}
/** Every sentence has a film and a photo; some name a person, list things, give a figure, a map, a chart, a document. */
const rich = (i: number): Partial<Doc2Scene> => ({
  photo: `photo ${i}`,
  ...(i % 4 === 1 ? { person: { name: `Person ${i}`, query: `portrait ${i}` } } : {}),
  ...(i % 7 === 3 ? { photos: [{ query: 'a' }, { query: 'b' }, { query: 'c' }] } : {}),
  ...(i % 5 === 2 ? { number: { text: '124', label: 'officers' } } : {}),
  ...(i % 6 === 0 ? { map: { title: 'Europe', center: { lat: 47, lon: 8 }, zoom: 4, regions: [], pins: [], routes: [], facts: [] } } : {}),
  ...(i % 13 === 5 ? { chart: { title: 'Gold', rows: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] } } : {}),
  ...(i % 11 === 4 ? { document: { title: 'Order', text: 'All bridges are to be destroyed', mark: 'destroyed' } } : {})
})

describe('the documentary-2 sequencer', () => {
  const slots = slotsFrom(240, 5, rich)
  const units = sequenceDoc2(slots, { seed: '7' })

  it('never shows a non-film pattern twice in a row, and keeps maps, charts and documents their measured gaps apart', () => {
    expect(sequenceProblems(units)).toEqual([])
    units.forEach((u, i) => {
      if (i > 0 && u.pattern !== 'film') expect(u.pattern, `unit ${i}`).not.toBe(units[i - 1]?.pattern)
    })
    // never three units of the same non-film family in a row (the reference does it 1–5 times in 30 minutes, always prints)
    const fams = units.map((u) => familyOf(u.pattern))
    const threes = fams.filter((f, i) => i >= 2 && f !== 'film' && f === fams[i - 1] && f === fams[i - 2]).length
    expect(threes).toBeLessThanOrEqual(5)
  })

  it('keeps the families near their measured shares and rotates the boards through their layouts', () => {
    const s = familyShares(units)
    expect(s.film).toBeGreaterThan(0.25)
    expect(s.film).toBeLessThan(0.5)
    expect(s.prints).toBeGreaterThan(0.3)
    expect(s.map).toBeGreaterThan(0.05)
    expect(s.map).toBeLessThan(0.2)
    const layouts = new Set(units.filter((u) => familyOf(u.pattern) === 'prints').map((u) => u.pattern))
    expect(layouts.size).toBeGreaterThanOrEqual(4)
    // some boards on cream paper, in runs, most on the slate
    const boards = units.filter((u) => familyOf(u.pattern) === 'prints')
    const cream = boards.filter((u) => u.cream).length / boards.length
    expect(cream).toBeGreaterThan(0.05)
    expect(cream).toBeLessThan(0.4)
  })

  it('leads the hook with film, and stops a run of film clips at the measured length', () => {
    const hook = familyShares(units.filter((u) => u.start < DOC2_PROFILE.hookS))
    expect(hook.film).toBeGreaterThan(0.4)
    let run = 0
    for (const u of units) {
      run = u.pattern === 'film' ? run + Math.max(1, Math.round((u.end - u.start) / DOC2_PROFILE.filmClipS)) : 0
      expect(run).toBeLessThanOrEqual(DOC2_PROFILE.filmRunMax + 3)
    }
  })

  it('shows a map, a chart or a document only when the words give one, and is the same for the same seed', () => {
    const plain = sequenceDoc2(slotsFrom(60, 5, () => ({ photo: 'p' })), { seed: '1' })
    expect(plain.some((u) => ['map', 'chart', 'document'].includes(u.pattern))).toBe(false)
    expect(sequenceDoc2(slots, { seed: '7' })).toEqual(units)
  })
})

describe('the scene check', () => {
  it('keeps what the sentence says and drops a name, a date, a figure or a quote it does not', () => {
    const sentence = 'In May 1940, Henri Guisan had 430,000 men ready to fight to the last cartridge.'
    const ok = checkScene({ sentence: 1, person: { name: 'Henri Guisan', query: 'Guisan' }, date: 'May 1940', number: { text: '430,000', label: 'men' }, quote: 'to the last cartridge' }, sentence, sentence)
    expect(ok.dropped).toEqual([])
    const bad = checkScene({ sentence: 1, person: { name: 'Adolf Hitler', query: 'Hitler' }, date: 'June 1941', number: { text: '500,000', label: 'men' }, quote: 'a pimple on Europe' }, sentence, sentence)
    expect(bad.dropped).toHaveLength(4)
    expect(bad.scene.person).toBeUndefined()
    // the portrait search survives as a photo: the picture stays, the text goes
    expect(bad.scene.photo).toBe('Hitler')
    expect(saidIn('henri GUISAN', sentence)).toBe(true)
  })
})

describe('the documentary-2 plan', () => {
  // twenty sentences of four words each, 0.5 s a word
  const words: Word[] = Array.from({ length: 80 }, (_, k) => ({ w: k % 4 === 3 ? `w${k}.` : `w${k}`, start: k * 0.5, end: k * 0.5 + 0.45, sentence: Math.floor(k / 4), paragraph: 0 }))
  const D = 40
  const sentences = sentencesOf(words, D)
  const beats: Beat[] = [{ i: 0, text: 'all', start: 0, end: D, firstWord: 0, lastWord: 79, sentenceIdx: [0], paragraph: 0, tags: [], keyTerms: [], cutPoints: [] }]
  const scenes = new Map(sentences.map((s) => [s.n, { ...fakeScene({ n: s.n, start: s.start, end: s.end, text: s.text }, beats[0]), photo: `photo ${s.n}`, film: `film ${s.n}`, ...(s.n % 3 === 0 ? { date: `w${(s.n - 1) * 4 + 1}` } : {}) }]))
  const slots = slotsOf(sentences, words, scenes, beats)
  const units = sequenceDoc2(slots, { seed: '3' })
  const built = buildDoc2({ units, words, sentences, beats, D, seed: '3' })

  it('makes archive films and drawn cards only: nothing generated, every card drawable, the films mostly in the old-TV frame', () => {
    expect(built.items.every((i) => i.kind === 'stock.photo' || i.kind === 'stock.video')).toBe(true)
    const base = built.shots.filter((s) => s.track === 'base')
    for (const s of base.filter((x) => x.kind === 'motion')) expect(checkMotion(s.graphic, (s.endFrame - s.startFrame) / 30)).toEqual([])
    const films = base.filter((s) => s.kind === 'stock.video')
    expect(films.length).toBeGreaterThan(0)
    expect(films.filter((s) => s.film === 'tv').length).toBeGreaterThanOrEqual(films.length / 2)
    // the base track covers the narration with no gap
    const sorted = [...base].sort((a, b) => a.startFrame - b.startFrame)
    sorted.forEach((s, i) => i > 0 && expect(s.startFrame).toBe(sorted[i - 1]?.endFrame))
  })

  it('cuts a long sentence in two stretches at a word', () => {
    // (qualite-montage) after the hook's opening: the hook's own first seconds cut every ≈ 4 s
    const body: Word[] = Array.from({ length: 30 }, (_, k) => ({ w: `x${k}`, start: 30 + k * 0.6, end: 30 + k * 0.6 + 0.5, sentence: 1, paragraph: 0 }))
    const words: Word[] = [{ w: 'Intro.', start: 0.2, end: 0.6, sentence: 0, paragraph: 0 }, ...body]
    const parts = slotsOf(sentencesOf(words, 48), words, new Map(), []).filter((p) => p.sentence === 2)
    expect(parts.length).toBe(2)
    expect(body.some((w) => Math.abs(w.start - (parts[0]?.end ?? -1)) < 1e-9)).toBe(true)
    const early = body.map((w) => ({ ...w, start: w.start - 30, end: w.end - 30, sentence: 0 }))
    expect(slotsOf(sentencesOf(early, 18), early, new Map(), []).length).toBe(3)
    // a hook sentence with no word to cut at (two long words) stays one stretch: the slots still cover it end to end
    const two: Word[] = [{ w: 'Long', start: 0.2, end: 3.4, sentence: 0, paragraph: 0 }, { w: 'words.', start: 3.5, end: 5.6, sentence: 0, paragraph: 0 }]
    const slots = slotsOf(sentencesOf(two, 5.8), two, new Map(), [])
    expect(slots.at(-1)?.end).toBe(5.8)
    slots.forEach((x, i) => i > 0 && expect(x.start).toBe(slots[i - 1]?.end))
  })
})

describe('the bricks documentary-2 draws with', () => {
  it('lays the texts over a film where the reference does, a second one at the same place stacked away', () => {
    const html = motionHtml({ template: 'doc-tags', props: { tags: [{ kind: 'bar', text: 'A pimple on the face of Europe', atS: 1 }, { kind: 'chapter', text: 'The hostage strategy', atS: 2 }] } } as MotionSpecInput, ctx())
    const bottoms = [...html.matchAll(/bottom:(\d+)px/g)].map((m) => Number(m[1]))
    expect(new Set(bottoms).size).toBe(2)
    const typed = motionHtml({ template: 'doc-tags', props: { tags: [{ kind: 'date', text: '25 July 1940', atS: 0.5 }] } } as MotionSpecInput, ctx())
    expect(typed.match(/data-dur="0.02"/g)?.length).toBe('25JULY1940'.length)
  })

  it('places a lone print centred, large or on the side, and keeps every bar inside its own room', () => {
    const [centre] = printSlots([1.5], ctx(), 's', 'centre')
    const [large] = printSlots([1.5], ctx(), 's', 'large')
    const [side] = printSlots([1.5], ctx(), 's', 'side')
    expect(Math.abs((centre?.x ?? 0) + (centre?.w ?? 0) / 2 - W / 2)).toBeLessThan(2)
    expect(large?.w ?? 0).toBeGreaterThan(centre?.w ?? 0)
    expect((side?.x ?? 0) + (side?.w ?? 0) / 2).toBeLessThan(W * 0.4)
    // two long bars over two prints: each is kept to its print's width and shrunk to fit (Charlie's 02/11 capture: they overlapped)
    const two = motionHtml({ template: 'prints', props: { prints: [{ atS: 0.2 }, { atS: 0.8 }], bars: [{ text: 'Une insulte au cœur de l’Europe', over: 0, atS: 1 }, { text: 'Un refuge pour ses ennemis', over: 1, atS: 2 }] } } as MotionSpecInput, ctx())
    const rooms = [...two.matchAll(/class="bar"[^>]*data-fit="14" style="max-width:(\d+)px"/g)].map((m) => Number(m[1]))
    expect(rooms).toHaveLength(2)
    for (const r of rooms) expect(r).toBeLessThan(W * 0.46)
    // a figure and a date beside a lone print
    const sideHtml = motionHtml({ template: 'prints', props: { layout: 'side', prints: [{ atS: 0.2 }], side: [{ kind: 'number', text: '124', sub: 'army officers investigated' }, { kind: 'date', text: 'May 1940' }] } } as MotionSpecInput, ctx())
    expect(sideHtml).toContain('class="snum"')
    expect(sideHtml).toContain('class="dbox"')
  })

  it('frames an archive film 4:3 in the old-TV mask over its own blurred sides', () => {
    const args = segmentArgs({ shotId: 's', frames: 90, image: 'film.mp4', clip: { file: 'film.mp4', durationS: 3 }, motion: undefined, dipIn: false, dipOut: false, grade: 'archive-film', film: 'tv', filmMask: 'tv-mask.png' }, 'out.mp4')
    const graph = args[args.indexOf('-filter_complex') + 1] ?? ''
    expect(args).toContain('tv-mask.png')
    expect(graph).toContain("crop='min(iw,ih*4/3)':ih")
    expect(graph).toContain('boxblur')
    expect(graph).toContain('hue=s=0')
    // without the frame, the film fills the picture as before
    const full = segmentArgs({ shotId: 's', frames: 90, image: 'film.mp4', clip: { file: 'film.mp4', durationS: 3 }, motion: undefined, dipIn: false, dipOut: false, grade: 'none' }, 'out.mp4')
    expect(full).not.toContain('tv-mask.png')
  })
})

describe('the scene pass reads the model leniently and searches the archives in steps', () => {
  it('drops a wrong field, never the whole scene (round 1: one bad field made the hook fall back to key terms)', async () => {
    const { lenientScene } = await import('../../src/engine/nodes/doc2-scene')
    const sc = lenientScene({ sentence: 4, film: 'German tanks France 1940', map: { title: 'Europe', center: { lat: 47, lon: 8 }, zoom: 42 }, date: 'May 1940', photos: 'not a list' })
    expect(sc).toMatchObject({ sentence: 4, film: 'German tanks France 1940', date: 'May 1940' })
    // a zoom out of range is brought into it (the map is kept)
    expect(sc?.map?.zoom).toBe(8)
    expect(sc?.photos).toBeUndefined()
    expect(lenientScene({ film: 'no sentence' })).toBeNull()
  })

  it('asks the archives as written, then without the years, then with the first words', async () => {
    const { queryLadder } = await import('../../src/engine/nodes/visuals-film-plan')
    expect(queryLadder('Swiss army soldiers 1940')).toEqual(['Swiss army soldiers 1940', 'Swiss army soldiers'])
    expect(queryLadder('German infantry march France 1940')).toEqual(['German infantry march France 1940', 'German infantry march France', 'German infantry march'])
  })
})

describe('a map or a chart with one wrong part keeps the rest', () => {
  it('clamps the zoom, fixes a tone, drops a pin without coordinates', async () => {
    const { lenientScene } = await import('../../src/engine/nodes/doc2-scene')
    const sc = lenientScene({ sentence: 2, map: { title: 'Europe, summer 1940', center: { lat: 47, lon: 8 }, zoom: 12, regions: [{ countries: ['Germany', 'Italy'], tone: 'crimson' }, { countries: 'Switzerland', tone: 'gold' }], pins: [{ label: 'Bern', lat: 46.9, lon: 7.4 }, { label: 'Nowhere' }] } })
    expect(sc?.map?.zoom).toBe(8)
    expect(sc?.map?.regions.map((r) => r.tone)).toEqual(['red', 'gold'])
    expect(sc?.map?.pins.map((p) => p.label)).toEqual(['Bern'])
  })
})

describe('figures said in words are written in digits', () => {
  it('reads English and French numbers, and leaves what it cannot read', async () => {
    const { digitsOf } = await import('../../src/engine/nodes/doc2-figures')
    expect(digitsOf('Four point two million')).toBe('4,200,000')
    expect(digitsOf('Twenty-two')).toBe('22')
    expect(digitsOf('about a dozen')).toBe('12')
    expect(digitsOf('quatre millions', 'fr')).toBe('4 000 000')
    expect(digitsOf('five more years')).toBeNull()
    expect(digitsOf('1940')).toBeNull()
  })
})

describe('short sentences make one board', () => {
  it('merges « Then Denmark. Norway. Belgium. » into one stretch whose places become prints', async () => {
    const { mergeShort } = await import('../../src/engine/nodes/director-doc2')
    const s = (n: number, a: number, b: number, place: string): Doc2Slot => ({ sentence: n, start: a, end: b, part: 0, scene: { sentence: n, film: 'German army 1940', photo: `${place} 1940`, place: { name: place } } })
    const merged = mergeShort([s(1, 0, 1.2, 'Denmark'), s(2, 1.2, 2.3, 'Norway'), s(3, 2.3, 3.5, 'Belgium'), s(4, 3.5, 9, 'France')])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.scene.photos?.map((p) => p.label)).toEqual(['Denmark', 'Norway', 'Belgium'])
    expect(merged[1]?.start).toBe(3.5)
  })
})

describe('a figure says what it counts', () => {
  it('takes the words after it when the model gave none', async () => {
    const { countedBy } = await import('../../src/engine/nodes/director-doc2')
    expect(countedBy('Twenty-two cantons. Four national languages.', 'Twenty-two')).toBe('cantons')
    expect(countedBy('Four point two million people, in a country', 'Four point two million')).toBe('people')
    expect(countedBy('nothing here', 'twelve')).toBeUndefined()
  })
})

describe('a figure written with what it counts', () => {
  it('splits the digits from the words after them', async () => {
    const { splitFigure } = await import('../../src/engine/nodes/doc2-figures')
    expect(splitFigure('Four point two million people')).toEqual({ digits: '4,200,000', rest: 'people' })
    expect(splitFigure('Twenty-two cantons')).toEqual({ digits: '22', rest: 'cantons' })
    expect(splitFigure('no figure here')).toBeNull()
  })
})
