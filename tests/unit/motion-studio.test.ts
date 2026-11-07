// The motion studio (decision 0111): the glyph reader gives real outlines (composites resolved: É), the schema checks its card, the measured
// style turns into a look, the recipes give cards that parse and land inside their length, the template is a documentary card the plan
// accepts, and a card is drawn for real by three.js in headless Chromium (software WebGL, the CPU server's path): frames change while the
// scene builds, the same moment gives the same picture, a still stretch keeps its frame key (photographed once). The browser part is
// skipped, with the reason, where there is no Chromium / Chrome / Edge.
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isCardTemplate } from '../../src/engine/formats/cards'
import { checkMotion, MotionSpec } from '../../src/engine/formats/motion'
import { StudioProps, studioChars, studioProblems, type StudioPropsInput } from '../../src/engine/formats/studio'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { motionHtml } from '../../src/engine/motion'
import { prepareStudio, studioHtml } from '../../src/engine/motion/studio'
import { glyphsOf } from '../../src/engine/motion/studio-font'
import { branchScene, heroScene, nodeScene, stackScene, studioLookOf, timelapseScene } from '../../src/engine/motion/studio-style'
import { RESOURCES } from './engine-node-helpers'

const FONTS = path.join(RESOURCES, 'fonts')
const look = studioLookOf({ palette: ['#0B1020', '#F4A86A', '#3B5FD9', '#FFFFFF'], fonts: ['bold wide grotesque sans'], texture: 'dark glossy 3D glass cards, soft grain', easing: 'snappy pops with overshoot' })

describe('glyph outlines', () => {
  it('reads simple and composite glyphs of the bundled fonts', async () => {
    const g = await glyphsOf(FONTS, 'wide', ['A', 'É', '0', ' ', '€'])
    expect(g.glyphs.A?.d).toMatch(/^M [-\d.]+ [-\d.]+ /)
    expect(g.glyphs.A?.adv).toBeGreaterThan(0.4)
    // É = E plus its accent: more contours than E alone
    const e = await glyphsOf(FONTS, 'wide', ['E'])
    expect((g.glyphs['É']?.d.match(/M/g) ?? []).length).toBeGreaterThan((e.glyphs.E?.d.match(/M/g) ?? []).length)
    // the digit 0 has a hole: two contours
    expect((g.glyphs['0']?.d.match(/M/g) ?? []).length).toBe(2)
    expect(g.glyphs[' ']).toEqual({ adv: expect.any(Number), d: '' })
    for (const face of ['sans', 'semi', 'condensed', 'serif'] as const) expect((await glyphsOf(FONTS, face, ['R'])).glyphs.R?.d.length).toBeGreaterThan(20)
  })
})

describe('the studio card', () => {
  it('turns a measured style into a look', () => {
    expect(look.palette?.accent).toBe('#F4A86A')
    expect(look.palette?.cool).toBe('#3B5FD9')
    expect(look.face).toBe('wide')
    expect(look.glow).toBeGreaterThan(0.4)
    expect(look.springs?.type?.d).toBeLessThan(26)
    expect(studioLookOf({ fonts: ['bold condensed sans'] }).face).toBe('condensed')
    expect(studioLookOf({}).face).toBe('sans')
  })

  const recipes: [string, number, StudioPropsInput][] = [
    ['branch', 7, branchScene({ value: 1500, unit: 'Mds $', parts: 4, look, d: 7 })],
    ['stack', 6, stackScene({ value: '1 500', unit: 'Mds $', label: 'Fonds', stack: [{ label: 'A', weight: 2 }, { label: 'B', weight: 1 }], stackLabel: 'Deux', look, d: 6 })],
    ['node', 5, nodeScene({ title: 'ADIA', sub: ['Abu Dhabi'], traits: ['Passif', 'Ultra diversifié'], look, d: 5 })],
    ['hero', 7, heroScene({ shape: 'vault', pills: ['Fuites'], look, d: 7 })],
    ['timelapse', 10, timelapseScene({ years: [[0, 247], [10, 362]], era: 'Roman Lutetia', houses: { start: 5, end: 20, growS: 4 }, wallAtS: 3, d: 10 })]
  ]
  it.each(recipes)('the %s recipe gives a card that parses and lands inside its length', (_, d, props) => {
    const p = StudioProps.parse(props)
    expect(studioProblems(p, d)).toEqual([])
    expect(checkMotion({ template: 'studio', props, accent: '#3B82F6', theme: 'dark' }, d)).toEqual([])
    expect(studioChars(p).length).toBeGreaterThanOrEqual(0)
  })

  it('is a documentary card of the plan, with its own problems', () => {
    expect(isCardTemplate('studio')).toBe(true)
    const late: StudioPropsInput = { items: [{ kind: 'text', text: 'Late', atS: 5 }] }
    expect(checkMotion({ template: 'studio', props: late }, 3).join(' ')).toMatch(/too late/)
    expect(checkMotion({ template: 'studio', props: late }, 40).join(' ')).toMatch(/longer than the 30 s/)
    expect(() => MotionSpec.parse({ template: 'studio', props: { items: [] } })).toThrow()
    // not prepared: the ground only, never a scene without its library
    expect(motionHtml({ template: 'studio', props: late }, { width: 640, height: 360, durationS: 6, fontCss: '' })).not.toContain('TH_CORE')
  })

  it('prepares the library and only the glyphs it writes', async () => {
    const a = await prepareStudio({ items: [{ kind: 'text', text: 'Été' }, { kind: 'counter', to: 12, suffix: '%' }] }, { libraryRoot: RESOURCES })
    expect(a.lib.version).toMatch(/^0\.\d+/)
    expect(a.lib.main).toContain("'./three.core.js'")
    expect(Object.keys(a.fonts.wide?.glyphs ?? {}).sort()).toEqual(expect.arrayContaining(['É', 't', 'é', '%', '1', '2']))
  })
})

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
describe.skipIf(!exe)('drawn by three.js in headless Chromium (software WebGL)', () => {
  const browser = chromiumService({ gpu: false })
  afterAll(async () => {
    await browser.close?.()
  })
  it('builds over time, repeats a moment exactly and keeps a still stretch photographed once', async () => {
    const props = branchScene({ value: 1500, unit: 'Mds $', parts: 3, look: { ...look, grain: 0 }, d: 6, times: { rise: 0.8, branches: 1.4 } })
    const assets = await prepareStudio(props, { libraryRoot: RESOURCES })
    const html = studioHtml(props, { width: 320, height: 180, durationS: 6, fontCss: '' }, assets)
    const page = await browser.open({ html, width: 320, height: 180, signal: new AbortController().signal })
    try {
      const early = await page.frame(0.02)
      const late = await page.frame(4)
      const again = await page.frame(4)
      expect(Buffer.compare(Buffer.from(early), Buffer.from(late))).not.toBe(0)
      expect(Buffer.compare(Buffer.from(late), Buffer.from(again))).toBe(0)
      const k1 = await page.capture?.(5.2, { format: 'jpeg' })
      const k2 = await page.capture?.(5.8, { format: 'jpeg', lastKey: k1?.key })
      expect(k2?.key).toBe(k1?.key)
      expect(k2?.image).toBeNull()
    } finally {
      await page.close()
    }
  }, 120_000)
})

describe('the director calls the studio', () => {
  it('gives a studio card for each kind of beat, in the measured style, that fits its length', async () => {
    const { studioSpec } = await import('../../src/engine/motion/studio-style')
    const m = { palette: ['#0B1020', '#F4A86A', '#3B5FD9'], fonts: ['wide grotesque'], texture: 'glossy 3D', easing: 'snappy' }
    const beats = [
      { kind: 'split', value: 1500, unit: 'Mds $', parts: 4 },
      { kind: 'equals', value: '1 500', label: 'Fonds', stack: [{ label: 'A', weight: 1 }] },
      { kind: 'entity', title: 'ADIA', traits: ['Passif'] },
      { kind: 'hero', shape: 'coin', pills: ['Or'] },
      { kind: 'timelapse', years: [[0, 100], [8, 200]], era: 'Rome', houses: { start: 0, end: 10, growS: 5 } }
    ] as const
    for (const b of beats) {
      const spec = studioSpec(b as never, m, 8)
      expect(spec.template).toBe('studio')
      expect(checkMotion(spec, 8)).toEqual([])
    }
  })
})
