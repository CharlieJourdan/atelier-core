// motion-montage: the editing kit (formats/edit-kit.ts), the rhythm (edit/rhythm.ts), the grammar (edit/grammar.ts), the camera and the
// transitions of the render (render/camera.ts, render/transitions.ts) and the node `edit.fx`.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyEditKit, boundaryAt, draw, moveFor, revealsOf, voiceAccents } from '../../src/engine/edit/grammar'
import { fitRhythm, measureRhythm, planCuts, quantile, sampleLength, seededRandom } from '../../src/engine/edit/rhythm'
import { EDIT_KITS, EditKit, editKitOf } from '../../src/engine/formats/edit-kit'
import { EDITPLAN_SCHEMA, EditPlan, type CameraKey, type Shot } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { probe } from '../../src/engine/media/probe'
import { fitView, pointAlong, routeCurve, routeEase } from '../../src/engine/motion/geo'
import { MapMoveProps, cameraKeys, worldBox } from '../../src/engine/motion/map-move'
import { editFx } from '../../src/engine/nodes/edit-fx'
import { cameraExpr, cameraFilter, maxZoom, punchExpr, stepExpr } from '../../src/engine/render/camera'
import { GRAPH_INLINE_MAX, runFfmpeg, segmentArgs, segmentSpecs, type SegmentSpec } from '../../src/engine/render/segments'
import { TRANSITION_FRAMES, isBlend, transitionGraph, xfadeName } from '../../src/engine/render/transitions'
import { MEDIA, NO_FFMPEG, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

/** Words of a little narration: sentences of `n` words, a paragraph every 3 sentences, 0.3 s a word, a pause between sentences. */
function wordsOf(sentences: number, n = 8): Word[] {
  const out: Word[] = []
  let t = 0
  for (let s = 0; s < sentences; s++) {
    for (let i = 0; i < n; i++) {
      const w = i === 3 && s % 2 === 0 ? '1987' : i === n - 1 ? 'fin.' : `mot${i}`
      out.push({ w, start: t, end: t + 0.26, sentence: s, paragraph: Math.floor(s / 3) })
      t += 0.3
    }
    t += 0.45
  }
  return out
}

/** A plan of stills cut every `every` seconds over `seconds`. */
function planOf(seconds: number, every: number, extra: Shot[] = []): EditPlan {
  const frames = Math.round(seconds * 30)
  const shots: Shot[] = []
  for (let a = 0, i = 0; a < frames; a += every * 30, i++) {
    shots.push({ id: `s${i}`, track: 'base', startFrame: a, endFrame: Math.min(frames, a + every * 30), kind: 'image.gen', genItem: `g${i}`, transitionIn: 'cut', role: 'base', beat: 0 })
  }
  return EditPlan.parse({
    schema: EDITPLAN_SCHEMA,
    fps: 30,
    size: [1920, 1080],
    frames,
    tracks: { base: shots.map((s) => s.id), overlay: extra.map((s) => s.id), labels: [] },
    captionsPreset: 'classic',
    shots: [...shots, ...extra],
    chapters: [{ title: 'A', startFrame: 0 }, { title: 'B', startFrame: shots[3]?.startFrame ?? 0 }],
    diagnostics: []
  })
}

describe('edit kit', () => {
  it('parses the measured kits and changes one field', () => {
    for (const k of Object.keys(EDIT_KITS) as (keyof typeof EDIT_KITS)[]) expect(() => editKitOf(k)).not.toThrow()
    const k = editKitOf('avatar', { punches: { perMinute: 1 } })
    expect(k.punches.perMinute).toBe(1)
    expect(k.punches.zoom).toBe(1.1)
    expect(EditKit.parse({ rhythm: EDIT_KITS.avatar.rhythm }).transitions.paragraph).toEqual({ dissolve: 1 })
  })
  it('refuses a rhythm whose percentiles are out of order', () => {
    expect(() => EditKit.parse({ rhythm: { hook: { medianS: 3, p10S: 4, p90S: 5 }, body: { medianS: 3, p10S: 1, p90S: 5 } } })).toThrow()
  })
})

describe('rhythm', () => {
  it('measures cuts like a reference', () => {
    const m = measureRhythm([2, 5, 6, 10], 12)
    expect(m.shots).toBe(5)
    expect(m.medianS).toBe(2)
    expect(m.minS).toBe(1)
    expect(m.maxS).toBe(4)
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
  it('samples a profile whose median and percentiles come back', () => {
    const r = { medianS: 3.3, p10S: 2.1, p90S: 5.6 }
    const rand = seededRandom(4)
    const xs = Array.from({ length: 6000 }, () => sampleLength(r, rand)).sort((a, b) => a - b)
    expect(quantile(xs, 0.5)).toBeCloseTo(3.3, 0)
    expect(Math.abs(quantile(xs, 0.1) - 2.1)).toBeLessThan(0.15)
    expect(Math.abs(quantile(xs, 0.9) - 5.6)).toBeLessThan(0.3)
    expect(fitRhythm(r).sigmaHi).toBeGreaterThan(fitRhythm(r).sigmaLo)
  })
  it('cuts on word starts, sentence starts first, at the profile`s pace', () => {
    const words = wordsOf(40)
    const durationS = (words[words.length - 1] as Word).end + 0.3
    const cuts = planCuts({ words, durationS, rhythm: EDIT_KITS.avatar.rhythm, seed: 3 })
    const starts = new Set(words.map((w) => w.start))
    expect(cuts.every((c) => starts.has(c))).toBe(true)
    const m = measureRhythm(cuts, durationS)
    expect(m.medianS).toBeGreaterThan(2)
    expect(m.medianS).toBeLessThan(4.6)
    const sentenceStarts = cuts.filter((c) => words.some((w, i) => w.start === c && i > 0 && (words[i - 1] as Word).sentence !== w.sentence)).length
    expect(sentenceStarts / cuts.length).toBeGreaterThan(0.4)
    expect(planCuts({ words, durationS, rhythm: EDIT_KITS.avatar.rhythm, seed: 3 })).toEqual(cuts)
  })
})

describe('grammar', () => {
  const words = wordsOf(12)
  it('finds accents on numbers and after pauses, louder words more', () => {
    const a = voiceAccents(words)
    expect(a.some((x) => words[x.word]?.w === '1987')).toBe(true)
    const loud = words.map((_, i) => (i === 5 ? 4 : 1))
    expect(voiceAccents(words, loud).some((x) => x.word === 5)).toBe(true)
  })
  it('classes boundaries', () => {
    expect(boundaryAt(words[1]?.start ?? 0, words, [])).toBe('phrase')
    expect(boundaryAt(words[8]?.start ?? 0, words, [])).toBe('sentence')
    expect(boundaryAt(words[24]?.start ?? 0, words, [])).toBe('paragraph')
    expect(boundaryAt(10, words, [10.2])).toBe('chapter')
  })
  it('draws only weighted keys', () => {
    const rand = seededRandom(1)
    for (let i = 0; i < 50; i++) expect(['a', 'b']).toContain(draw({ a: 1, b: 2, c: 0 }, rand, 'z' as string))
    expect(draw({}, rand, 'cut')).toBe('cut')
  })
  it('moves a still at the kit`s speed', () => {
    expect(moveFor('push', 5, 0.03)).toEqual({ kind: 'push', from: 1.02, to: 1.17 })
    expect(moveFor('parallax', 5, 0.03).kind).toBe('parallax')
  })
  it('lists the reveals of cards', () => {
    expect(revealsOf('bars', { rows: [{ atS: 1 }, { atS: 4 }] })).toEqual([{ atS: 1, slot: 'row' }, { atS: 4, slot: 'row' }])
    expect(revealsOf('archive', { punch: 'NO', punchAtS: 2 })).toEqual([{ atS: 2, slot: 'punch' }])
    expect(revealsOf('kinetic', { words: [{ text: 'a', atS: 0.2 }, { text: 'b', atS: 0.5, emphasis: true }] })).toEqual([{ atS: 0.5, slot: 'word' }])
  })
  it('applies a kit: transitions per boundary, moves, punches, sound effects under the cap', () => {
    const durationS = (words[words.length - 1] as Word).end
    const card: Shot = { id: 'm1', track: 'overlay', startFrame: 60, endFrame: 200, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: { template: 'bars', accent: '#d5412f', theme: 'dark', props: { title: 'T', rows: [{ label: 'a', value: 1, atS: 1 }, { label: 'b', value: 2, atS: 3 }] } } as Shot['graphic'] }
    const plan = planOf(durationS, 2.5, [card])
    const kit = editKitOf('pov2d', { transitions: { sentence: { whip: 1 }, paragraph: { push: 1 } } })
    const r = applyEditKit({ plan, words, kit, seed: 1 })
    expect(r.report.transitions.whip ?? 0).toBeGreaterThan(0)
    const base = r.plan.shots.filter((s) => s.track === 'base')
    expect(base.every((s) => s.motion !== undefined)).toBe(true)
    expect(base.filter((s) => s.transitionIn === 'whip').every((s) => s.transitionDir === 'left' || s.transitionDir === 'right')).toBe(true)
    expect(r.report.punches).toBeGreaterThan(0)
    expect(r.report.punches).toBeLessThanOrEqual(Math.floor((kit.punches.perMinute * plan.frames) / 30 / 60))
    expect(r.sfx.length).toBeLessThanOrEqual(Math.floor((kit.sfx.perMinute * plan.frames) / 30 / 60))
    expect(r.sfx.some((e) => e.kind === 'whoosh')).toBe(true)
    expect(r.sfx.some((e) => e.kind === 'tick' && Math.abs(e.atS - 3) < 1e-6)).toBe(true)
    expect(EditPlan.safeParse(r.plan).success).toBe(true)
    // same inputs, same seed: the same edit
    expect(applyEditKit({ plan, words, kit, seed: 1 })).toEqual(r)
  })
  it('keeps the director`s soft transitions unless the kit overrides', () => {
    const plan = planOf(20, 4)
    const shots = plan.shots.map((s) => (s.id === 's2' ? { ...s, transitionIn: 'dissolve' as const } : s))
    const kit = editKitOf('avatar', { transitions: { phrase: { cut: 1 }, sentence: { cut: 1 }, paragraph: { cut: 1 }, chapter: { cut: 1 } } })
    expect(applyEditKit({ plan: { ...plan, shots }, words, kit, seed: 2 }).plan.shots.find((s) => s.id === 's2')?.transitionIn).toBe('dissolve')
    const over = editKitOf('avatar', { transitions: { phrase: { cut: 1 }, sentence: { cut: 1 }, paragraph: { cut: 1 }, chapter: { cut: 1 }, override: true } })
    expect(applyEditKit({ plan: { ...plan, shots }, words, kit: over, seed: 2 }).plan.shots.find((s) => s.id === 's2')?.transitionIn).toBe('cut')
  })
})

describe('camera and transitions (ffmpeg arguments)', () => {
  it('writes eased steps and punches without a bare comma', () => {
    expect(stepExpr(0, 30)).toContain('clip(')
    expect(stepExpr(0, 30)).not.toMatch(/[^\\],/)
    expect(punchExpr(undefined)).toBe('1')
    expect(punchExpr([{ atS: 1, zoom: 1.2, holdS: 1 }])).toContain('0.2000')
    const pan = cameraExpr({ kind: 'pan', from: 1, to: 1, keys: [{ atS: 0, x: 0.2, y: 0.5, zoom: 1 }, { atS: 2, x: 0.8, y: 0.5, zoom: 2 }] }, 90)
    expect(pan.z).toMatch(/^exp\(/)
    expect(cameraFilter({ kind: 'push', from: 1, to: 1.1 }, 60).startsWith('perspective=')).toBe(true)
    expect(maxZoom({ kind: 'pan', from: 1, to: 1, keys: [{ atS: 0, x: 0.5, y: 0.5, zoom: 1.2 }, { atS: 1, x: 0.5, y: 0.5, zoom: 2.4 }] }, [{ atS: 0.5, zoom: 1.1 }])).toBeCloseTo(2.64)
  })
  it('names each transition and smears only a whip', () => {
    expect(xfadeName('whip', 'right')).toBe('slideright')
    expect(xfadeName('flash')).toBe('fadewhite')
    expect(xfadeName('zoom')).toBe('zoomin')
    expect(transitionGraph('whip', 6, 'left', 'format=yuv420p')).toContain('avgblur')
    expect(transitionGraph('push', 10, 'up', 'format=yuv420p')).not.toContain('avgblur')
    expect(isBlend('dip')).toBe(false)
    expect(TRANSITION_FRAMES.whip).toBeLessThan(TRANSITION_FRAMES.dissolve)
  })
  it('keeps the classic segments` arguments and carries a whip from the previous picture', () => {
    const plan = planOf(12, 3)
    const shots = plan.shots.map((s, i) => (i === 1 ? { ...s, motion: { kind: 'push' as const, from: 1, to: 1.1 } } : i === 2 ? { ...s, transitionIn: 'whip' as const, transitionDir: 'right' as const } : s))
    const specs = segmentSpecs(shots, (s) => `${s.id}.png`, 'none')
    expect(specs[2]?.dissolveFrom?.kind).toBe('whip')
    expect(specs[2]?.dissolveFrom?.dir).toBe('right')
    const args = segmentArgs(specs[2] as SegmentSpec, 'out.mp4').join(' ')
    expect(args).toContain('slideright')
    // a classic push without punches: the old filter (old cache keys)
    expect(segmentArgs(specs[1] as SegmentSpec, 'o.mp4').join(' ')).not.toContain('clip(')
  })
})

describe.skipIf(!hasFfmpeg)('render of the new moves (ffmpeg)', () => {
  it('renders a pan, punches, a parallax and each transition at the right length', async () => {
    const { dir, cleanup } = tempDir('kit')
    try {
      const media = MEDIA as NonNullable<typeof MEDIA>
      const signal = new AbortController().signal
      const pic = path.join(dir, 'p.png')
      await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', pic], { signal })
      const base = { frames: 24, dipIn: false, dipOut: false, grade: 'none' }
      const specs: SegmentSpec[] = [
        { ...base, shotId: 'pan', image: pic, motion: { kind: 'pan', from: 1, to: 1, keys: [{ atS: 0, x: 0.3, y: 0.4, zoom: 1.2 }, { atS: 0.6, x: 0.7, y: 0.6, zoom: 2.2 }] } },
        { ...base, shotId: 'punch', image: pic, motion: { kind: 'push', from: 1.02, to: 1.08 }, punches: [{ atS: 0.3, zoom: 1.15, holdS: 0.3 }] },
        { ...base, shotId: 'par', image: pic, motion: { kind: 'parallax', from: 1.04, to: 1.04, depth: 3 } },
        { ...base, shotId: 'pop', image: pic, grade: 'phone', motion: { kind: 'parallax', from: 1.04, to: 1.04, pop: true } },
        ...(['whip', 'push', 'zoom', 'flash', 'match', 'dissolve'] as const).map((k) => ({ ...base, shotId: k, image: pic, motion: undefined, dissolveFrom: { image: pic, motion: { kind: 'push' as const, from: 1, to: 1.1 }, shotFrames: 30, kind: k } }))
      ]
      for (const s of specs) {
        const out = path.join(dir, `${s.shotId}.mp4`)
        await runFfmpeg(media, segmentArgs(s, out), out, signal)
        const p = await probe(media, out, signal, true)
        expect(p.streams[0]?.nb_read_frames, s.shotId).toBe('24')
      }
      expect(existsSync(path.join(dir, 'pan.mp4.graph.txt'))).toBe(false)
      expect(GRAPH_INLINE_MAX).toBeGreaterThan(1000)
    } finally {
      cleanup()
    }
  }, 120_000)

  it('edit.fx sets the kit on the plan and lays the effects into the bed', async () => {
    const { dir, cleanup } = tempDir('editfx')
    try {
      const words = wordsOf(10)
      const plan = planOf((words[words.length - 1] as Word).end, 2.5)
      const ctx = makeCtx(testServices(dir), { seed: 3 })
      const out = await editFx.run(ctx, { plan: art('json.editplan', { value: plan as never }), words: art('json.words', { value: words as never }) }, { kit: 'pov2d', energies: false })
      const outPlan = EditPlan.parse(out.plan?.value)
      expect(outPlan.shots.some((s) => s.motion?.kind === 'parallax' || s.punches?.length)).toBe(true)
      const music = out.music?.files?.[0] as string
      const p = await probe(MEDIA as NonNullable<typeof MEDIA>, music, ctx.signal)
      expect(Math.abs(p.durationS - plan.frames / 30)).toBeLessThan(0.1)
      // without a kit, the node passes the plan on unchanged
      const none = await editFx.run(ctx, { plan: art('json.editplan', { value: plan as never }), words: art('json.words', { value: words as never }) }, { energies: false })
      expect(none.plan?.value).toEqual(plan)
    } finally {
      cleanup()
    }
  }, 60_000)
})

it.skipIf(hasFfmpeg)('media tests', () => {
  expect(NO_FFMPEG).toBeTruthy()
})

describe('moving map (pure)', () => {
  const props = MapMoveProps.parse({
    title: 'Route',
    routes: [{ from: { lat: 41, lon: 29 }, to: { lat: 52.4, lon: 4.9 }, atS: 1 }],
    camera: [
      { atS: 0, view: { west: -10, south: 35, east: 35, north: 60 } },
      { atS: 1, follow: 0, zoom: 2 },
      { atS: 8, place: { lat: 52.4, lon: 4.9 }, zoom: 3 }
    ]
  })
  it('frames every key in its world and turns them into camera keys in time order', () => {
    const box = worldBox(props)
    expect(box.west).toBeLessThan(-10)
    expect(box.east).toBeGreaterThan(35)
    const sv = fitView(box, 16 / 9, 0)
    const keys = cameraKeys(props, sv, 16 / 9, [{ start: 1.15, end: 3.5 }])
    // the view, then the route's head from when it starts drawing (1.15 s) to when it arrives (3.5 s) in ten glided steps, then the place
    expect(keys).toHaveLength(13)
    expect(keys.map((k) => k.atS).filter((_, i) => i !== 0 && i !== 12)).toEqual(Array.from({ length: 11 }, (_, j) => expect.closeTo(1.15 + (2.35 * j) / 10, 9)))
    expect([(keys[0] as CameraKey).atS, (keys[12] as CameraKey).atS]).toEqual([0, 8])
    expect(keys.slice(2, 12).every((k) => k.ease === 'linear')).toBe(true)
    expect((keys[1] as CameraKey).ease).toBeUndefined()
    // the route is followed from Constantinople (east) to Amsterdam (west), the head going west all the way
    const follow = keys.slice(1, 12)
    for (let j = 1; j < follow.length; j++) expect((follow[j] as CameraKey).x).toBeLessThanOrEqual((follow[j - 1] as CameraKey).x + 1e-9)
    const at = (lat: number, lon: number): { x: number; y: number } => ({ x: (lon - sv.west) / (sv.east - sv.west), y: (sv.north - lat) / (sv.north - sv.south) })
    expect(follow[0]).toMatchObject({ x: expect.closeTo(at(41, 29).x, 6), y: expect.closeTo(at(41, 29).y, 6), zoom: 2 })
    expect(follow[10]).toMatchObject({ x: expect.closeTo(at(52.4, 4.9).x, 6), y: expect.closeTo(at(52.4, 4.9).y, 6) })
    expect((keys[12] as CameraKey).zoom).toBe(3)
    expect(keys.every((k) => k.x >= 0 && k.x <= 1 && k.y >= 0 && k.y <= 1)).toBe(true)
  })
  it('follows the head along the curve through the waypoints, at the page’s pace, and leaves it a second before the next key', () => {
    const via = { lat: 48.2, lon: 16.4 }
    const p2 = MapMoveProps.parse({ ...props, routes: [{ ...(props.routes[0] as object), via: [via] }], camera: [props.camera[0], props.camera[1], { atS: 3, place: { lat: 52.4, lon: 4.9 }, zoom: 3 }] })
    const sv = fitView(worldBox(p2), 16 / 9, 0)
    expect(sv.north).toBeGreaterThan(48.2) // the waypoint is in the world
    // the page's curve in 0..1 of the world (as renderMapMove passes it), and the head the page draws at a time
    const aspect = 16 / 9
    const fr = (lat: number, lon: number): { x: number; y: number } => ({ x: ((lon - sv.west) / (sv.east - sv.west)) * aspect, y: (sv.north - lat) / (sv.north - sv.south) })
    const path = routeCurve([fr(41, 29), fr(via.lat, via.lon), fr(52.4, 4.9)]).flatMap((q) => [q.x / aspect, q.y])
    const keys = cameraKeys(p2, sv, aspect, [{ start: 1.15, end: 5.15, path }])
    const follow = keys.filter((k) => k.atS >= 1.15 && k.atS < 3)
    expect(follow).toHaveLength(11)
    // cut a second before the place's key (3 s), not at the end of the drawing (5.15 s)
    expect((follow[10] as CameraKey).atS).toBeCloseTo(2, 9)
    for (const k of follow) {
      const head = pointAlong(path, routeEase((k.atS - 1.15) / 4))
      expect(k.x).toBeCloseTo(head.x, 9)
      expect(k.y).toBeCloseTo(head.y, 9)
    }
    // the same curve when the keys make it themselves from the props
    const own = cameraKeys(p2, sv, aspect, [{ start: 1.15, end: 5.15 }]).filter((k) => k.atS >= 1.15 && k.atS < 3)
    own.forEach((k, j) => expect(k.x).toBeCloseTo((follow[j] as CameraKey).x, 6))
    // the head halfway through its time passes near the waypoint's side of the straight line: the camera does not cut across
    const mid = pointAlong(path, 0.5)
    const straight = { x: (fr(41, 29).x + fr(52.4, 4.9).x) / 2 / aspect, y: (fr(41, 29).y + fr(52.4, 4.9).y) / 2 }
    expect(Math.hypot(mid.x - straight.x, mid.y - straight.y)).toBeGreaterThan(0.01)
  })
  it('glides through a key marked linear and eases into the others', () => {
    // ffmpeg's expression evaluated here: clip, cos, exp, PI and the frame number `on`
    const run = (e: string, on: number): number => new Function('on', 'clip', 'cos', 'exp', 'PI', `return ${e.replace(/\\,/g, ',')}`)(on, (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)), Math.cos, Math.exp, Math.PI) as number
    const keys: CameraKey[] = [{ atS: 0, x: 0.2, y: 0.5, zoom: 2 }, { atS: 1, x: 0.4, y: 0.5, zoom: 2, ease: 'linear' }, { atS: 2, x: 0.6, y: 0.5, zoom: 2, ease: 'linear' }]
    const c = cameraExpr({ kind: 'pan', from: 1, to: 1, keys }, 60)
    expect(c.cx).not.toMatch(/[^\\],/)
    // even speed: a quarter of the way at a quarter of the time, through the middle key without slowing
    expect(run(c.cx, 7.5)).toBeCloseTo(0.25, 3)
    expect(run(c.cx, 30)).toBeCloseTo(0.4, 3)
    expect(run(c.cx, 45)).toBeCloseTo(0.5, 3)
    expect(run(c.cx, 60)).toBeCloseTo(0.6, 3)
    // without `ease` the same keys stop at each (a cosine ease: a quarter of the time is less than a quarter of the way)
    const eased = cameraExpr({ kind: 'pan', from: 1, to: 1, keys: keys.map(({ ease: _e, ...k }) => k) }, 60)
    expect(run(eased.cx, 7.5)).toBeCloseTo(0.2 + 0.2 * (0.5 - 0.5 * Math.cos(Math.PI / 4)), 3)
  })
  it('needs one target per key', () => {
    expect(() => MapMoveProps.parse({ title: 'x', camera: [{ atS: 0 }] })).toThrow()
  })
})
