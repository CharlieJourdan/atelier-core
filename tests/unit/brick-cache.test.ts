// Custom bricks in a film (docs/ENGINE-SPEC.md §25.2), with a fake sandboxed browser and a fake ffmpeg: `motion.render` draws a `custom:<id>`
// shot from the channel's validated brick in a sandboxed page (with its time budgets), caches it by the brick's content hash and version,
// its values and the look; a brick it does not have, values that do not fit, an overrun, an empty brick are permanent errors that name it,
// a crashed page is retried. The director places a channel's bricks where they say (start, end, each named person) before our templates,
// which keep out of their way; a run of the channel gets them as params (and only a pipeline that draws animations gets them placed).
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineError } from '../../src/engine'
import { Brick, placementOf } from '../../src/engine/formats/brick'
import { EDITPLAN_SCHEMA, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import { MotionParams, motionRender } from '../../src/engine/nodes/motion-render'
import { placeBricks } from '../../src/engine/nodes/director-bricks'
import { placeMotion } from '../../src/engine/nodes/director-motion'
import { MotionPlanParams } from '../../src/engine/nodes/director-motion'
import type { EngineServices } from '../../src/engine/services'
import { applyRunContext } from '../../src/main/production/runs/profile'
import { pipelineFromDrawing } from '../../src/engine/pipelines/from-drawing'
import { MOTION_FILM_DRAWING } from '../../src/engine/pipelines/motion-demo'
import { CARD, fakeBrickBrowser, fakeMedia, type FakeBrickBrowser } from './brick-fixture'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'
import { filmOf } from './motion-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

const v1 = Brick.parse({ ...CARD, version: 1 })
const base: Shot = { id: 's001', track: 'base', startFrame: 0, endFrame: 300, kind: 'stock.photo', genItem: 'item-001', transitionIn: 'cut', role: 'base', beat: 0 }
const custom = (id: string, startFrame: number, endFrame: number, props: Record<string, unknown>, template = 'custom:fiche-personnage'): Shot =>
  ({ id, track: 'overlay', startFrame, endFrame, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: { template, props } }) as Shot
const planOf = (shots: Shot[]): EditPlan => ({
  schema: EDITPLAN_SCHEMA,
  fps: 30,
  size: [1920, 1080],
  frames: 300,
  tracks: { base: ['s001'], overlay: shots.map((s) => s.id), labels: [] },
  captionsPreset: 'highlight',
  shots: [base, ...shots],
  chapters: [],
  diagnostics: []
})
const services = (dir: string, browser: FakeBrickBrowser): EngineServices => ({ ...testServices(dir), media: fakeMedia(), browser })
const run = (dir: string, browser: FakeBrickBrowser, plan: EditPlan, bricks: Brick[] = [v1]) =>
  motionRender.run(makeCtx(services(dir, browser)), { plan: art('json.editplan', { value: plan as never }) }, MotionParams.parse({ bricks }))

describe('motion.render draws a channel’s custom brick', () => {
  it('in a sandboxed page with time budgets, with the brick’s markup and the shot’s values, recorded as custom:<id>', async () => {
    const dir = work('brick-draw')
    const browser = fakeBrickBrowser()
    const out = await run(dir, browser, planOf([custom('b001', 30, 150, { name: 'Élise Moreau', role: 'Gardienne' })]))
    expect(out.graphics?.value).toEqual([{ shotId: 'b001', file: 0, startFrame: 30, endFrame: 150, template: 'custom:fiche-personnage' }])
    expect(browser.opened).toHaveLength(1)
    const page = browser.opened[0]!
    expect(page.sandbox).toEqual({ loadMs: 8000, frameMs: 2500 })
    expect(page.html).toMatch(/Content-Security-Policy/)
    expect(page.html).toContain('Élise Moreau')
    expect(page.html).toContain('Gardienne')
    expect(page.html).toContain('Personnage') // the default of the kicker field
    expect(browser.frames).toBe(120)
    expect(existsSync(out.graphics?.files?.[0] as string)).toBe(true)
  })

  it('caches by the brick’s content hash and version, the values and the look: the same plan opens no page; a new version, other values redraw', async () => {
    const dir = work('brick-cache')
    const plan = planOf([custom('b001', 30, 150, { name: 'Élise Moreau' })])
    const first = fakeBrickBrowser()
    const a = await run(dir, first, plan)
    expect(a.graphics?.meta).toMatchObject({ drawn: 1, cached: 0 })
    const again = fakeBrickBrowser()
    const b = await run(dir, again, plan)
    expect(again.opened).toHaveLength(0)
    expect(b.graphics?.meta).toMatchObject({ drawn: 0, cached: 1 })
    expect(b.graphics?.files).toEqual(a.graphics?.files)
    // the same content as a new version: a new key, drawn again
    const v2 = Brick.parse({ ...CARD, version: 2 })
    const next = fakeBrickBrowser()
    const c = await run(dir, next, plan, [v2])
    expect(next.opened).toHaveLength(1)
    expect(c.graphics?.files?.[0]).not.toBe(a.graphics?.files?.[0])
    // a change of its CSS, same version number: drawn again too (the key is the content, not only the number)
    const restyled = Brick.parse({ ...CARD, css: CARD.css + '\n.role{opacity:0.9}', version: 1 })
    const styled = fakeBrickBrowser()
    await run(dir, styled, plan, [restyled])
    expect(styled.opened).toHaveLength(1)
    // other values: drawn again; the first file is still cached
    const other = fakeBrickBrowser()
    await run(dir, other, planOf([custom('b001', 30, 150, { name: 'Jules Verne' })]))
    expect(other.opened).toHaveLength(1)
    const back = fakeBrickBrowser()
    await run(dir, back, plan)
    expect(back.opened).toHaveLength(0)
  })

  it('a brick it was not given, or values that do not fit, are permanent errors before anything is drawn', async () => {
    const dir = work('brick-bad')
    const browser = fakeBrickBrowser()
    const missing = await run(dir, browser, planOf([custom('b001', 30, 150, { name: 'X' }, 'custom:rappel-abonnement')])).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(EngineError)
    expect((missing as EngineError).message).toMatch(/b001 utilise la brique custom:rappel-abonnement, qui n’est pas validée/)
    const long = await run(dir, browser, planOf([custom('b001', 30, 150, { name: 'x'.repeat(41) })])).catch((e: unknown) => e)
    expect((long as EngineError).code).toBe('bad_input')
    expect((long as EngineError).message).toMatch(/« Fiche personnage » \(custom:fiche-personnage v1\).*name/)
    expect(browser.opened).toHaveLength(0)
  })

  it('an overrun is a permanent error that names the brick (not retried); a crashed page is retried; an empty brick fails, named', async () => {
    const dir = work('brick-fail')
    const slow = fakeBrickBrowser({ failAt: 1, failWith: new EngineError('bad_input', 'drawing the frame at 1.00 s took more than 2500 ms') })
    const e1 = await run(dir, slow, planOf([custom('b001', 30, 150, { name: 'Élise' })])).catch((e: unknown) => e)
    expect((e1 as EngineError).permanent).toBe(true)
    expect((e1 as EngineError).message).toMatch(/La brique « Fiche personnage » \(custom:fiche-personnage v1\) n’a pas pu être dessinée : drawing the frame at 1\.00 s took more than 2500 ms/)
    expect(slow.opened).toHaveLength(1)
    let crashes = 1
    const crashy = fakeBrickBrowser()
    const open = crashy.open.bind(crashy)
    crashy.open = (req) => (crashes-- > 0 ? Promise.reject(new Error('Target crashed')) : open(req))
    const ok = await run(dir, crashy, planOf([custom('b001', 30, 150, { name: 'Élise' })]))
    expect(ok.graphics?.files).toHaveLength(1)
    const empty = fakeBrickBrowser({ empty: () => true })
    const e3 = await run(work('brick-empty'), empty, planOf([custom('b001', 30, 150, { name: 'Élise' })])).catch((e: unknown) => e)
    expect((e3 as EngineError).message).toMatch(/custom:fiche-personnage v1\).*ne dessine rien/)
  })
})

describe('the director places the channel’s bricks', () => {
  const film = filmOf(
    'Cette nuit-là, le professeur Élise Moreau monte au sommet du phare. La lampe tourne depuis cent ans. Elle note tout dans un carnet.\n\nAu matin, la mer a changé de couleur. Personne ne sait pourquoi.',
    { title: 'Le phare' }
  )
  const end = Brick.parse({
    id: 'rappel-abonnement',
    name: 'Rappel d’abonnement',
    version: 3,
    html: '<div class="pill">{{text}}</div>',
    css: '.pill{position:absolute;right:120px;top:200px;padding:20px 30px;border-radius:40px;background:#c62828;font-size:36px}',
    fields: [{ type: 'text', name: 'text', max: 40, default: 'Abonne-toi' }],
    sample: {},
    seconds: { min: 2, max: 5 },
    use: { on: 'end', seconds: 3 }
  })

  it('a person brick on the named person (name and role bound), an end brick before the end; our templates keep out of their way', () => {
    const shots: Shot[] = []
    const b = placeBricks({ bricks: [placementOf(v1)!, placementOf(end)!], words: film.words, beats: film.beats, durationS: film.durationS, shots, accent: '#E11D48', theme: 'dark' })
    expect(b.shots.map((s) => s.graphic?.template)).toEqual(['custom:fiche-personnage', 'custom:rappel-abonnement'])
    const card = b.shots[0]!
    expect(card.graphic).toMatchObject({ props: { name: 'Élise Moreau', role: 'Professeur', kicker: 'Personnage', accent: '#F5B700' }, accent: '#E11D48' })
    const elise = film.words.find((w) => w.w.startsWith('Élise'))!
    expect(card.startFrame / 30).toBeLessThanOrEqual(elise.start)
    expect((card.endFrame - card.startFrame) / 30).toBeCloseTo(4, 1)
    const last = b.shots[1]!
    expect(last.endFrame).toBeLessThanOrEqual(Math.round(film.durationS * 30))
    expect(last.endFrame / 30).toBeGreaterThan(film.durationS - 1)
    expect(b.diagnostics.join()).toMatch(/2 overlay\(s\) from the channel's own bricks/)
    // our templates come after: the lower third of the same person cannot lie over the card
    const m = placeMotion({ beats: film.beats, words: film.words, parsed: film.parsed, title: 'Le phare', durationS: film.durationS, cfg: MotionPlanParams.parse({ share: 0.8, perMinute: 12 }), shots: b.shots })
    for (const s of m.shots) for (const x of b.shots) expect(s.endFrame <= x.startFrame || s.startFrame >= x.endFrame).toBe(true)
  })

  it('a run of the channel gets its validated bricks as params; a pipeline that draws no animation gets none placed', () => {
    const doc = pipelineFromDrawing(MOTION_FILM_DRAWING, { id: 'motion-film', minutes: 1 }).pipeline
    const ctx = { profile: null, inspiration: [], bricks: [v1, end] }
    const out = applyRunContext(doc, ctx)
    const node = (type: string) => out.nodes.find((n) => n.type.startsWith(type))
    expect((node('motion.render')?.params as { bricks: Brick[] }).bricks.map((b) => b.id)).toEqual(['fiche-personnage', 'rappel-abonnement'])
    expect((node('director.plan')?.params as { bricks: { template: string }[] }).bricks.map((b) => b.template)).toEqual(['custom:fiche-personnage', 'custom:rappel-abonnement'])
    const plain = { ...doc, nodes: doc.nodes.filter((n) => !n.type.startsWith('motion.render')) }
    const out2 = applyRunContext(plain, ctx)
    expect((out2.nodes.find((n) => n.type.startsWith('director.plan'))?.params as Record<string, unknown>).bricks).toBeUndefined()
  })
})
