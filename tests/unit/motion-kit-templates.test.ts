// The motion kit's three templates (motion-montage): `kinetic` (kinetic typography, an overlay), `document` (a page whose phrases are marked on their
// words, a card) and `chart` (a line, an area, a donut or counters, a card). Without a browser: the specs (limits, what checkMotion names), the
// page each one writes (the times of the words, marks and slices), the kinetic grouping into lines and screens, and the runtime's new maths (the
// follow camera, the hand-drawn marks, the trace, the slam and shift presets) run in plain Node. In a real Chromium (skipped, with the reason,
// where there is none): something is drawn where it should be, and only after its time.
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { checkMotion, MOTION_SECONDS, MotionSpec, type MotionSpecInput } from '../../src/engine/formats/motion'
import { phraseSpan } from '../../src/engine/formats/cards'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { motionHtml } from '../../src/engine/motion'
import { zone, type MotionCtx } from '../../src/engine/motion/base'
import { fmt, niceScale, withUnit } from '../../src/engine/motion/doc-chart'
import { bodySize } from '../../src/engine/motion/doc-highlight'
import { docFontCssOf } from '../../src/engine/motion/fonts'
import { kineticScreens, maxChars, screenOuts } from '../../src/engine/motion/kinetic'
import { RUNTIME_JS } from '../../src/engine/motion/runtime'
import { cardAssets } from '../../src/engine/nodes/motion-cards'
import type { Shot } from '../../src/engine/formats/editplan'
import { MEDIA, RESOURCES } from './engine-node-helpers'

const [W, H] = FRAME_SIZES['16:9']
const [PW, PH] = FRAME_SIZES['9:16']
const ctxOf = (w: number, h: number, durationS: number, fontCss = ''): MotionCtx => ({ width: w, height: h, durationS, fontCss })
const html = (spec: MotionSpecInput, w = W, h = H, d = 10, assets = {}): string => motionHtml(spec, ctxOf(w, h, d), assets)

const MEMO = 'By order of the Treasury, the Board has authorised the transfer of 40,000 ounces of silver to the mint. The shipment must leave Seville before the end of the month.'
const kinetic = (props: Record<string, unknown> = {}): MotionSpecInput =>
  ({
    template: 'kinetic',
    props: {
      words: [
        { text: 'They', atS: 1 },
        { text: 'paid', atS: 1.3 },
        { text: 'for', atS: 1.5 },
        { text: 'the', atS: 1.65 },
        { text: 'war', atS: 1.9, emphasis: true },
        { text: 'with', atS: 2.3 },
        { text: 'silver.', atS: 2.6, emphasis: true },
        { text: 'Nothing', atS: 4.5 },
        { text: 'else.', atS: 4.9 }
      ],
      ...props
    }
  }) as MotionSpecInput
const documentSpec = (props: Record<string, unknown> = {}): MotionSpecInput =>
  ({
    template: 'document',
    props: {
      paper: 'typed',
      heading: 'Memorandum',
      date: 'March 3, 1621',
      text: MEMO,
      marks: [
        { phrase: 'authorised the transfer', atS: 2, style: 'highlight' },
        { phrase: 'SEVILLE', atS: 4, style: 'circle' },
        { phrase: 'before the end of the month', atS: 6, style: 'underline' }
      ],
      ...props
    }
  }) as MotionSpecInput
const chart = (props: Record<string, unknown>): MotionSpecInput => ({ template: 'chart', props: { title: 'Prices', ...props } }) as MotionSpecInput
const LINE = chart({ kind: 'line', unit: '%', atS: 1, drawS: 2, accentFrom: 0, points: [{ label: '2019', value: 1 }, { label: '2020', value: 3 }, { label: '2021', value: 2 }, { label: '2022', value: 8 }] })
const DONUT = chart({ kind: 'donut', slices: [{ label: 'A', value: 20, atS: 1 }, { label: 'B', value: 30, atS: 2.2 }, { label: 'C', value: 50, accent: true, atS: 3.4 }] })
const COUNTERS = chart({ kind: 'counters', counters: [{ label: 'Miners', value: 160000, atS: 1 }, { label: 'Share', value: 60, unit: '%', atS: 2.5 }] })

describe('the specs of the three templates', () => {
  it('are registered, with their lengths', () => {
    expect(MOTION_SECONDS.kinetic).toEqual({ min: 1.5, max: 20 })
    expect(MOTION_SECONDS.document).toEqual({ min: 3, max: 40 })
    expect(MOTION_SECONDS.chart).toEqual({ min: 3, max: 60 })
  })

  it('kinetic: 1 to 40 words of 24 characters at most, in the order of the voice, with defaults', () => {
    const r = MotionSpec.parse(kinetic())
    expect(r.template === 'kinetic' && r.props).toMatchObject({ style: 'pop', position: 'center', background: 'none', case: 'as-is' })
    expect(checkMotion(kinetic(), 6)).toEqual([])
    expect(checkMotion(kinetic({ words: [] }), 6)[0]).toMatch(/^motion kinetic: props\.words /)
    expect(checkMotion(kinetic({ words: [{ text: 'x'.repeat(25), atS: 0 }] }), 6)[0]).toMatch(/props\.words\.0\.text /)
    expect(checkMotion(kinetic({ words: Array.from({ length: 41 }, (_, i) => ({ text: 'a', atS: i / 10 })) }), 10)[0]).toMatch(/props\.words /)
    expect(checkMotion(kinetic({ words: [{ text: 'b', atS: 2 }, { text: 'a', atS: 1 }] }), 6)[0]).toMatch(/words must follow the order of the voice/)
    expect(checkMotion(kinetic({ style: 'wobble' }), 6)[0]).toMatch(/props\.style /)
    expect(checkMotion(kinetic(), 5.0)[0]).toMatch(/the last word \(4\.9 s\) comes too late/)
    for (const style of ['pop', 'slam', 'stack', 'typewriter', 'highlight']) expect(checkMotion(kinetic({ style }), 6), style).toEqual([])
  })

  it('document: limits, a mark needs a phrase on a text and a rect on a scan, a phrase that is not in the text is named by checkMotion', () => {
    expect(checkMotion(documentSpec(), 10)).toEqual([])
    expect(checkMotion(documentSpec({ text: 'x'.repeat(701) }), 10)[0]).toMatch(/props\.text /)
    expect(checkMotion(documentSpec({ heading: 'x'.repeat(61) }), 10)[0]).toMatch(/props\.heading /)
    expect(checkMotion(documentSpec({ marks: Array.from({ length: 7 }, () => ({ phrase: 'Board', atS: 1, style: 'box' })) }), 10)[0]).toMatch(/props\.marks /)
    expect(checkMotion(documentSpec({ paper: 'vellum' }), 10)[0]).toMatch(/props\.paper /)
    expect(checkMotion(documentSpec({ marks: [{ phrase: 'the king', atS: 1, style: 'box' }] }), 10)).toContain('motion document: mark 1 phrase is not in the text')
    expect(checkMotion(documentSpec({ marks: [{ atS: 1, style: 'box' }] }), 10)[0]).toMatch(/needs a phrase/)
    expect(checkMotion(documentSpec({ marks: [{ phrase: 'Board', atS: 9.9, style: 'box' }] }), 10)[0]).toMatch(/mark 1 \(9\.9 s\) comes too late/)
    // a scan: no text, marks are rects inside the picture
    const scan = (marks: unknown[]): MotionSpecInput => ({ template: 'document', props: { marks } }) as MotionSpecInput
    expect(checkMotion(scan([{ rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, atS: 1, style: 'highlight' }]), 5)).toEqual([])
    expect(checkMotion(scan([{ phrase: 'x', atS: 1 }]), 5)[0]).toMatch(/needs a rect/)
    expect(checkMotion(scan([{ rect: { x: 0.8, y: 0.2, w: 0.5, h: 0.1 }, atS: 1 }]), 5)[0]).toMatch(/inside the picture/)
  })

  it('phrases are found case-insensitively, spaces collapsed, the first place only', () => {
    expect(phraseSpan(MEMO, 'SEVILLE')).toEqual([MEMO.indexOf('Seville'), MEMO.indexOf('Seville') + 7])
    expect(phraseSpan('a  b\nc', 'b c')).toEqual([2, 5])
    expect(phraseSpan(MEMO, 'the king')).toBeNull()
  })

  it('chart: a kind needs its data; fewer than 2 points, no range and a line that ends after the card are named', () => {
    expect(checkMotion(LINE, 5)).toEqual([])
    expect(checkMotion(DONUT, 6)).toEqual([])
    expect(checkMotion(COUNTERS, 6)).toEqual([])
    expect(checkMotion(chart({ kind: 'line', points: [{ label: 'a', value: 1 }] }), 6)[0]).toMatch(/^motion chart: props\.points /)
    expect(checkMotion(chart({ kind: 'line' }), 6)[0]).toMatch(/points is required for a line chart/)
    expect(checkMotion(chart({ kind: 'donut' }), 6)[0]).toMatch(/slices is required/)
    expect(checkMotion(chart({ kind: 'area', points: [{ label: 'a', value: 2 }, { label: 'b', value: 2 }] }), 6)).toContain('motion chart: the 2 points have the same value, there is no line to draw')
    expect(checkMotion(chart({ kind: 'line', points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], accentFrom: 5 }), 6)[0]).toMatch(/accentFrom is not a point/)
    expect(checkMotion(chart({ kind: 'line', atS: 3, drawS: 3, points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }), 6)[0]).toMatch(/line starts at 3\.0 s and takes 3\.0 s, too long/)
    expect(checkMotion(chart({ kind: 'line', points: Array.from({ length: 25 }, (_, i) => ({ label: `${i}`, value: i })) }), 6)[0]).toMatch(/props\.points /)
    expect(checkMotion(chart({ kind: 'donut', slices: [{ label: 'A', value: 1 }] }), 6)[0]).toMatch(/props\.slices /)
    expect(checkMotion(chart({ kind: 'donut', slices: [{ label: 'A', value: 1 }, { label: 'B', value: 0 }] }), 6)[0]).toMatch(/props\.slices\.1\.value /)
    expect(checkMotion(chart({ kind: 'counters', counters: [] }), 6)[0]).toMatch(/props\.counters /)
    expect(checkMotion(chart({ kind: 'counters', counters: [{ label: 'a', value: 1, atS: 5.9 }] }), 6)[0]).toMatch(/counter 1 \(5\.9 s\) comes too late/)
  })
})

describe('kinetic: words, lines, screens', () => {
  const words = (kinetic().props as { words: { text: string; atS: number; emphasis?: boolean }[] }).words.map((w) => ({ emphasis: false, ...w }))

  it('cuts the words into lines of about 18 characters (12 in a short), three lines a screen, a new screen after a sentence or a pause', () => {
    const screens = kineticScreens(words, 18)
    // « silver. » ends a sentence: what follows is another screen
    expect(screens.map((s) => s.lines.map((l) => l.words.map((x) => x.w.text).join(' ')))).toEqual([['They paid for the', 'war with', 'silver.'], ['Nothing else.']])
    expect(screens[0]?.first).toBe(1)
    expect(screens[1]?.first).toBe(4.5)
    const short = kineticScreens(words, 12)
    for (const s of short) {
      expect(s.lines.length).toBeLessThanOrEqual(3)
      for (const l of s.lines) expect(l.words.length === 1 || l.words.reduce((a, x) => a + x.w.text.length * (x.w.emphasis ? 1.25 : 1), 0) + l.words.length - 1 <= 12).toBe(true)
    }
    // 12 words that never end a sentence: lines of three at most, 3 lines a screen, so 4 screens or fewer
    const long = Array.from({ length: 12 }, (_, i) => ({ text: 'abcdefgh', atS: i * 0.3, emphasis: false }))
    expect(kineticScreens(long, 18).every((s) => s.lines.length <= 3)).toBe(true)
    expect(kineticScreens([{ text: 'a', atS: 0, emphasis: false }, { text: 'b', atS: 3, emphasis: false }], 18)).toHaveLength(2)
    expect(maxChars(ctxOf(W, H, 5))).toBe(18)
    expect(maxChars(ctxOf(PW, PH, 5))).toBe(12)
  })

  it('a screen clears when the next one starts (a little before), never sooner than 0.3 s after its last word, never later than 2.4 s', () => {
    const c = ctxOf(W, H, 8)
    const screens = kineticScreens(words, 18)
    const outs = screenOuts(screens, c)
    expect(outs[0]).toBeCloseTo(Math.min(4.5 - 0.12, 2.6 + 2.4), 6)
    expect(outs[1]).toBeCloseTo(Math.min(7.6, 4.9 + 2.4), 6)
  })
})

describe('the HTML of the three templates', () => {
  it('kinetic: every word is on its time, in each style, in both shapes; the text stays in the zone, escaped', () => {
    for (const aspect of [[W, H], [PW, PH]] as const) {
      const [w, h] = aspect
      const pop = html(kinetic(), w, h, 8)
      expect([...pop.matchAll(/class="wd( em)?" data-anim="pop" data-at="([\d.]+)"/g)].map((m) => m[2])).toEqual(['1.00', '1.30', '1.50', '1.65', '1.90', '2.30', '2.60', '4.50', '4.90'])
      expect(pop.match(/class="wd em"/g)).toHaveLength(2)
      expect(pop).toContain('data-fit="40"')
      expect(pop).toContain('background:transparent')
    }
    const slam = html(kinetic({ style: 'slam' }))
    expect(slam.match(/data-anim="slam"/g)).toHaveLength(9)
    // typewriter: one span per letter, staggered inside the gap to the next word (0.35 s at most)
    const tw = html(kinetic({ style: 'typewriter', words: [{ text: 'Silver', atS: 1 }, { text: 'gold', atS: 3 }] }))
    const times = [...tw.matchAll(/class="lt" data-anim="fade" data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(times).toHaveLength(10)
    expect(times[0]).toBe(1)
    expect(times[5]).toBeLessThan(1.35)
    expect(times[6]).toBe(3)
    // highlight: a box wipes behind each word on its time
    const hl = html(kinetic({ style: 'highlight' }))
    expect([...hl.matchAll(/class="bx" data-anim="wipe" data-at="([\d.]+)"/g)]).toHaveLength(9)
    // stack: the older lines are pushed up by the newer ones (a `shift` for each newer line: two for the first line of three, one for the second)
    const st = html(kinetic({ style: 'stack' }))
    expect(st.match(/data-anim="shift"/g)?.length).toBe(3)
    // the screens clear: the first just before the next starts (4.38), the second 2.4 s after its last word (the way out is at 9.6 s)
    expect(st).toContain('data-out="4.38"')
    expect(st).toContain('data-out="7.30"')
    expect(html(kinetic({ words: [{ text: '<b>&"', atS: 0.5 }] }), W, H, 4)).toContain('&lt;b&gt;&amp;&quot;')
    // backgrounds and case
    expect(html(kinetic({ background: 'scrim' }))).toContain('var(--scrim)')
    expect(html(kinetic({ background: 'solid' }))).toContain('radial-gradient(ellipse 80% 70%')
    expect(html(kinetic({ background: 'none' }))).not.toContain('class="back"')
    expect(html(kinetic({ case: 'upper' }))).toContain('text-transform:uppercase')
    // the text sits inside the zone of the frame
    const c = ctxOf(W, H, 8)
    const z = zone(c)
    expect(html(kinetic({ position: 'lower' }), W, H, 8)).toContain(`left:${z.left}px;top:${z.top}px;width:${z.width}px;height:${z.height}px;display:flex;flex-direction:column;justify-content:flex-end`)
    expect(html(kinetic({ position: 'upper' }))).toContain('justify-content:flex-start')
  })

  it('document: the text is one text node, every mark is a path with its time and the offsets of its phrase, the camera follows them', () => {
    const page = html(documentSpec())
    expect(page).toContain('background:transparent') // the page's own; the card paints its background
    expect(page).toContain(`>${MEMO}</div>`)
    const paths = [...page.matchAll(/<path pathLength="1"[^>]*data-around="dt" data-from="(\d+)" data-to="(\d+)" data-shape="(\w+)"[^>]*data-at="([\d.]+)"[^>]*data-focus-at="([\d.]+)"/g)]
    expect(paths.map((m) => [m[3], m[4], m[5]])).toEqual([['highlight', '2.00', '2.00'], ['circle', '4.00', '4.00'], ['underline', '6.00', '6.00']])
    expect(paths.map((m) => MEMO.slice(Number(m[1]), Number(m[2])))).toEqual(['authorised the transfer', 'Seville', 'before the end of the month'])
    expect(page).toContain('data-follow="1.35"')
    expect(html(documentSpec(), PW, PH)).toContain('data-follow="1.15"')
    // other cameras
    expect(html(documentSpec({ camera: 'still' }))).not.toMatch(/data-follow="|data-zoom data-at/)
    expect(html(documentSpec({ camera: 'push' }))).toContain('data-zoom')
    // a mark whose phrase is not there is not drawn (checkMotion names it)
    expect(html(documentSpec({ marks: [{ phrase: 'the king', atS: 1, style: 'box' }] })).match(/data-shape=/g)).toBeNull()
    // the papers are four different pages; a heading is escaped
    const pages = ['letter', 'newspaper', 'typed', 'parchment'].map((paper) => html(documentSpec({ paper })))
    expect(new Set(pages).size).toBe(4)
    expect(html(documentSpec({ heading: 'A <b>' }))).toContain('A &lt;b&gt;')
    // the same spec is the same page
    expect(html(documentSpec())).toBe(page)
  })

  it('document, a scan: the picture is the sheet and the marks are boxes in its pixels; without a picture a stand-in is drawn', () => {
    const spec = { template: 'document', props: { marks: [{ rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, atS: 1.5, style: 'highlight' }] } } as MotionSpecInput
    const withPicture = html(spec, W, H, 6, { picture: 'data:image/png;base64,AAAA' })
    expect(withPicture).toContain('src="data:image/png;base64,AAAA"')
    expect(withPicture).toMatch(/data-box="[\d. ]+" data-shape="highlight"/)
    expect(withPicture).not.toContain('id="dt"')
    expect(html(spec, W, H, 6)).toContain('class="dpic ph"')
  })

  it('document: the card gives its scan to the sheet only when it has no text', async () => {
    const emit = vi.fn()
    const ctx = { emit } as never
    const shot = (graphic: unknown, genItem?: string): Shot => ({ id: 's1', kind: 'motion', graphic, ...(genItem ? { genItem } : {}) }) as unknown as Shot
    const typed = await cardAssets(ctx, shot(documentSpec()), new Map(), [W, H])
    expect(typed.assets).toEqual({})
    expect(emit).not.toHaveBeenCalled()
    const scan = await cardAssets(ctx, shot({ template: 'document', props: { marks: [{ rect: { x: 0, y: 0, w: 0.5, h: 0.2 }, atS: 1 }] } }, 'item-1'), new Map(), [W, H])
    expect(scan.key).toEqual({ picture: 'none' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }))
  })

  it('chart: the line draws on its times, the area is a wipe per segment, the donut and the counters are on their words', () => {
    const line = html(LINE, W, H, 6)
    // accentFrom 0: one accent path from 1.00 s over 2.00 s; the tag rides the same time
    expect(line).toMatch(/data-draw data-at="1.00" data-dur="2.00" data-ease="linear"/)
    expect(line).toMatch(/data-trace="[\d.,]+" data-trace-vals="1,3,2,8" data-dec="0" data-at="1.00" data-dur="2.00"/)
    expect(line).toContain('data-trace-val data-text')
    expect(line.match(/data-anim="pop" data-at="[\d.]+" data-dur="0.3"/g)).toHaveLength(4)
    const area = html(chart({ ...(LINE.props as object), kind: 'area' } as never), W, H, 6)
    const wipes = [...area.matchAll(/data-anim="wipe" data-at="([\d.]+)" data-dur="([\d.]+)" data-ease="linear"/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(wipes).toHaveLength(3)
    // the segments follow one another and end when the line does
    expect(wipes[0]?.[0]).toBe(1)
    for (let i = 1; i < 3; i++) expect((wipes[i - 1] as number[])[0]! + (wipes[i - 1] as number[])[1]!).toBeCloseTo((wipes[i] as number[])[0] as number, 1)
    expect((wipes[2] as number[])[0]! + (wipes[2] as number[])[1]!).toBeCloseTo(3, 1)
    // the accent part of a line is a second path that starts where the first ends
    const split = html(chart({ ...(LINE.props as object), accentFrom: 2 } as never), W, H, 6)
    expect([...split.matchAll(/data-draw data-at="([\d.]+)" data-dur="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]))).toEqual([expect.any(Number), 3])
    const donut = html(DONUT, W, H, 8)
    expect([...donut.matchAll(/data-draw data-at="([\d.]+)"/g)].map((m) => m[1])).toEqual(['1.00', '2.20', '3.40'])
    expect([...donut.matchAll(/data-count data-from="0" data-to="([\d.]+)" data-dec="0" data-at="([\d.]+)"/g)].map((m) => [m[1], m[2]])).toEqual([['20.000', '1.10'], ['30.000', '2.30'], ['50.000', '3.50']])
    const counters = html(COUNTERS, W, H, 8)
    expect([...counters.matchAll(/data-count data-from="0" data-to="(\d+)" data-dec="0" data-at="([\d.]+)"/g)].map((m) => [m[1], m[2]])).toEqual([['160000', '1.10'], ['60', '2.60']])
    expect(counters).toContain('160 000')
    // in the look of the bars card: a kicker, the title, the source; and the parchment look
    const full = html(chart({ ...(LINE.props as object), kicker: 'Consumer prices', source: 'Script figures' } as never), W, H, 6)
    expect(full).toContain('SOURCE: Script figures')
    expect(full).toContain('Consumer prices')
    expect(html({ ...(LINE as object), theme: 'light' } as MotionSpecInput, W, H, 6)).toContain('class="pbg"')
  })

  it('every template is a valid page in both shapes and the same one every time (no network)', () => {
    for (const spec of [kinetic(), documentSpec(), LINE, DONUT, COUNTERS]) {
      for (const [w, h] of [[W, H], [PW, PH]] as const) {
        const a = html(spec, w, h, 12)
        expect(a).toBe(html(spec, w, h, 12))
        expect(a).toContain('atelierRenderAt')
        expect(a).not.toMatch(/https?:\/\//)
      }
    }
  })

  it('numbers: a round axis, French numbers, the unit on its side', () => {
    expect(niceScale(1, 8, true)).toMatchObject({ lo: 0, hi: 10, step: 2 })
    expect(niceScale(100, 103, false).lo).toBeLessThanOrEqual(100)
    expect(fmt(1234.5, 1)).toBe('1 234,5')
    expect(withUnit('12', '%')).toBe('12 %')
    expect(withUnit('12', '$')).toBe('$12')
    expect(bodySize(100, 800, 600, { bg: '', ink: '', muted: '', face: '', cw: 0.5, lh: 1.5, weight: 400, edge: '' })).toBe(44)
    expect(bodySize(700, 800, 500, { bg: '', ink: '', muted: '', face: '', cw: 0.6, lh: 1.5, weight: 400, edge: '' })).toBeLessThan(30)
  })
})

describe('the new maths of the page clock, in plain Node', () => {
  type Foci = { at: number; x: number; y: number; z?: number }[]
  type O = { lw: number; lh: number; pw: number; ph: number; wide: number; zoom: number; lead: number; dur: number }
  interface M {
    followCam: (f: Foci, o: O, t: number) => { s: number; tx: number; ty: number }
    markPath: (shape: string, rects: { x: number; y: number; w: number; h: number }[], seed: number) => { d: string; sw: number }
    tracePoint: (pts: number[][], k: number) => { x: number; y: number; i: number; f: number }
    look: (p: string, a: number, q: number, dx: number, dy: number) => { o: number; ty: number; tx: number; sx: number }
  }
  const root: { __atelierMotion?: M } = {}
  new Function('window', 'document', RUNTIME_JS)(root, undefined)
  const m = root.__atelierMotion as M
  const O1: O = { lw: 1920, lh: 1080, pw: 1920, ph: 1080, wide: 1, zoom: 1.35, lead: 0.3, dur: 0.8 }
  const FOCI: Foci = [{ at: 2, x: 1200, y: 540 }, { at: 5, x: 800, y: 600 }]

  it('the follow camera starts wide, flies to each focus from 0.3 s before its time, centres on it and holds', () => {
    expect(m.followCam([], O1, 3)).toMatchObject({ s: 1, tx: 0, ty: 0 })
    expect(m.followCam(FOCI, O1, 0)).toMatchObject({ s: 1, tx: 0, ty: 0 })
    expect(m.followCam(FOCI, O1, 1.7)).toMatchObject({ s: 1, tx: 0, ty: 0 })
    const arrived = m.followCam(FOCI, O1, 3)
    expect(arrived.s).toBeCloseTo(1.35, 6)
    expect(1200 * arrived.s + arrived.tx).toBeCloseTo(960, 4)
    expect(540 * arrived.s + arrived.ty).toBeCloseTo(540, 4)
    expect(m.followCam(FOCI, O1, 4)).toEqual(arrived)
    const second = m.followCam(FOCI, O1, 6)
    expect(800 * second.s + second.tx).toBeCloseTo(960, 4)
    expect(600 * second.s + second.ty).toBeCloseTo(540, 4)
    // the flight is eased: slow at the start, a smooth middle
    expect(m.followCam(FOCI, O1, 1.8).s - 1).toBeLessThan(0.02)
  })

  it('never shows what is past the edges of the layer, never jumps, even with flights that overlap', () => {
    const edge: Foci = [{ at: 1, x: 1900, y: 20 }, { at: 1.5, x: 10, y: 1070 }]
    let last = m.followCam(edge, O1, 0)
    for (let t = 0; t <= 4; t += 1 / 30) {
      const c = m.followCam(edge, O1, t)
      expect(c.tx).toBeLessThanOrEqual(1e-9)
      expect(c.tx).toBeGreaterThanOrEqual(1920 - c.s * 1920 - 1e-6)
      expect(c.ty).toBeLessThanOrEqual(1e-9)
      expect(c.ty).toBeGreaterThanOrEqual(1080 - c.s * 1080 - 1e-6)
      expect(Math.abs(c.tx - last.tx)).toBeLessThan(300) // the peak of an eased 1900 px flight is about 240 px a frame
      expect(Math.abs(c.s - last.s)).toBeLessThan(0.05)
      last = c
    }
    // a focus with its own zoom
    expect(m.followCam([{ at: 1, x: 960, y: 540, z: 2 }], O1, 3).s).toBeCloseTo(2, 6)
  })

  it('the marks are hand-drawn: the same seed the same line, a highlight as thick as its text, a circle that encloses its box', () => {
    const one = [{ x: 100, y: 200, w: 300, h: 50 }]
    const two = [...one, { x: 100, y: 250, w: 120, h: 50 }]
    expect(m.markPath('underline', one, 3)).toEqual(m.markPath('underline', one, 3))
    expect(m.markPath('underline', one, 3).d).not.toBe(m.markPath('underline', one, 4).d)
    const hl = m.markPath('highlight', two, 1)
    expect(hl.sw).toBe(40)
    expect(hl.d.match(/M/g)).toHaveLength(2)
    const nums = (d: string): number[][] => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])])
    const circle = nums(m.markPath('circle', one, 2).d)
    expect(Math.min(...circle.map((p) => p[0] as number))).toBeLessThan(100)
    expect(Math.max(...circle.map((p) => p[0] as number))).toBeGreaterThan(400)
    expect(Math.min(...circle.map((p) => p[1] as number))).toBeLessThan(300)
    expect(Math.max(...circle.map((p) => p[1] as number))).toBeGreaterThan(250)
    const box = nums(m.markPath('box', one, 2).d)
    expect(Math.min(...box.map((p) => p[0] as number))).toBeLessThan(100)
    // the strike goes through the middle of the line, the underline sits under it
    const strike = nums(m.markPath('strike', one, 5).d)
    for (const p of strike) expect(Math.abs((p[1] as number) - 228.5)).toBeLessThan(6)
    for (const p of nums(m.markPath('underline', one, 5).d)) expect(p[1]).toBeGreaterThan(240)
  })

  it('a rider follows a polyline by arc length and reads the value under it', () => {
    const pts = [[0, 0], [10, 0], [10, 10]]
    expect(m.tracePoint(pts, 0)).toMatchObject({ x: 0, y: 0, i: 0, f: 0 })
    expect(m.tracePoint(pts, 0.5)).toMatchObject({ x: 10, y: 0 })
    expect(m.tracePoint(pts, 0.75)).toMatchObject({ x: 10, y: 5, i: 1, f: 0.5 })
    expect(m.tracePoint(pts, 1)).toMatchObject({ x: 10, y: 10, i: 1, f: 1 })
    expect(m.tracePoint(pts, 7)).toMatchObject({ x: 10, y: 10 })
  })

  it('the slam lands from 1.6 times its size and shakes a moment; the shift is always shown and moves by its dy', () => {
    expect(m.look('slam', 0, 0, 0, 20)).toMatchObject({ o: 0, sx: 1.6 })
    expect(m.look('slam', 0.55, 0, 0, 20).sx).toBeCloseTo(1, 6)
    expect(m.look('slam', 0.7, 0, 0, 20).ty).not.toBe(0)
    expect(m.look('slam', 1, 0, 0, 20).o).toBe(1)
    expect(m.look('slam', 1, 0, 0, 20).ty).toBeCloseTo(0, 9)
    expect(m.look('shift', 0, 0, 0, -40).o).toBe(1)
    expect(m.look('shift', 0, 0, 0, -40).ty).toBeCloseTo(0, 9)
    expect(m.look('shift', 1, 0, 0, -40)).toMatchObject({ o: 1, ty: -40 })
  })
})

// ---- in a real browser ----------------------------------------------------------------------------------------------------------------------

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const ffmpeg = !!MEDIA && spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : !ffmpeg ? 'no ffmpeg' : ''
const signal = new AbortController().signal
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)

describe.skipIf(skip !== '')(`the three templates in a real browser (${skip || 'Chromium'})`, () => {
  interface Px {
    w: number
    h: number
    data: Buffer
  }
  let fontCss = ''
  /** A frame of a template through the page service, as RGBA pixels. */
  const shot = async (spec: MotionSpecInput, t: number, durationS: number, w = W, h = H): Promise<Px> => {
    fontCss ||= await docFontCssOf(RESOURCES)
    const page = await service.open({ html: motionHtml(spec, { width: w, height: h, durationS, fontCss }), width: w, height: h, signal })
    try {
      const png = await page.frame(t)
      const r = await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { signal, stdin: png })
      expect(r.stdout.length).toBe(w * h * 4)
      return { w, h, data: Buffer.from(r.stdout) }
    } finally {
      await page.close()
    }
  }
  /** The pixels of a frame that satisfy `f(r, g, b, a)`: their count, mean place and right-most x. */
  const find = (px: Px, f: (r: number, g: number, b: number, a: number) => boolean): { n: number; cx: number; cy: number; maxX: number; minY: number; maxY: number } => {
    let n = 0
    let sx = 0
    let sy = 0
    let maxX = -1
    let minY = px.h
    let maxY = -1
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const i = (y * px.w + x) * 4
        if (f(px.data[i] as number, px.data[i + 1] as number, px.data[i + 2] as number, px.data[i + 3] as number)) {
          n++
          sx += x
          sy += y
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, maxX, minY, maxY }
  }
  const white = (r: number, g: number, b: number, a: number): boolean => a > 200 && r > 235 && g > 235 && b > 235
  const red = (r: number, g: number, b: number, a: number): boolean => a > 200 && r > 170 && g < 90 && b < 80
  // the yellow marker over cream paper (multiplied): warm yellow, clearly less blue than the paper
  const marker = (r: number, g: number, b: number): boolean => r > 200 && g > 175 && b < 150

  it('kinetic: nothing is drawn before the first word, the words come on their times, inside the zone, over a transparent frame', async () => {
    const spec = kinetic()
    const before = await shot(spec, 0.5, 8)
    expect(find(before, (_r, _g, _b, a) => a > 0).n).toBe(0)
    const one = await shot(spec, 1.5, 8)
    const all = await shot(spec, 3.2, 8)
    const a = find(one, white)
    const b = find(all, white)
    expect(a.n).toBeGreaterThan(2000)
    expect(b.n).toBeGreaterThan(a.n)
    // the emphasised words are in the accent colour (the blue of the default accent)
    expect(find(all, (r, g, bl, al) => al > 200 && bl > 200 && r < 110 && g > 90 && g < 180).n).toBeGreaterThan(1500)
    // the text stays in the zone: no solid pixel in the caption band under it
    const z = zone(ctxOf(W, H, 8))
    expect(find(all, (_r, _g, _b, al) => al > 128).maxY).toBeLessThanOrEqual(z.bottom)
    // the first screen has cleared by the time the second one is on
    const second = await shot(spec, 5.3, 8)
    expect(find(second, white).cy).toBeGreaterThan(0)
    // a solid background is opaque, a scrim darkens
    const solid = await shot(kinetic({ background: 'solid' }), 0.6, 8)
    expect(find(solid, (_r, _g, _b, al) => al === 255).n).toBe(W * H)
    const scrim = await shot(kinetic({ background: 'scrim' }), 0.6, 8)
    expect(find(scrim, (_r, _g, _b, al) => al > 0 && al < 255).n).toBeGreaterThan(W * H * 0.9)
  }, 60_000)

  it('kinetic: the portrait page fits its words in the narrow zone', async () => {
    const px = await shot(kinetic({ case: 'upper' }), 3.2, 8, PW, PH)
    const z = zone(ctxOf(PW, PH, 8))
    const r = find(px, (_r, _g, _b, a) => a > 128)
    expect(r.n).toBeGreaterThan(2000)
    expect(r.maxY).toBeLessThanOrEqual(z.bottom)
    expect(r.minY).toBeGreaterThanOrEqual(z.top - 4)
  }, 60_000)

  it('document: the highlight colour appears behind the phrase after its time, and the camera brings it to the middle', async () => {
    const still = documentSpec({ camera: 'still', marks: [{ phrase: 'authorised the transfer', atS: 2, style: 'highlight' }] })
    const before = await shot(still, 1.9, 8)
    expect(find(before, marker).n).toBeLessThan(300)
    const after = await shot(still, 3.2, 8)
    const mid = await shot(still, 2.2, 8)
    const a = find(after, marker)
    expect(a.n).toBeGreaterThan(4000)
    // it sweeps: less of it a moment after the start than when it is done
    expect(find(mid, marker).n).toBeLessThan(a.n)
    // the card is opaque
    expect(find(after, (_r, _g, _b, al) => al < 255).n).toBe(0)
    // with the camera following, the marked phrase is brought nearer to the middle of the frame
    const follow = documentSpec({ camera: 'follow', marks: [{ phrase: 'authorised the transfer', atS: 2, style: 'highlight' }] })
    const f = find(await shot(follow, 3.4, 8), marker)
    expect(f.n).toBeGreaterThan(a.n)
    expect(Math.hypot(f.cx - W / 2, f.cy - H / 2)).toBeLessThan(Math.hypot(a.cx - W / 2, a.cy - H / 2))
  }, 90_000)

  it('document: a circle and an underline are drawn in the accent after their times, a scan takes its picture', async () => {
    const still = documentSpec({ camera: 'still', marks: [{ phrase: 'Seville', atS: 2, style: 'circle' }, { phrase: 'before the end of the month', atS: 4, style: 'underline' }] })
    expect(find(await shot(still, 1.9, 8), red).n).toBeLessThan(50)
    const circled = find(await shot(still, 3.2, 8), red)
    expect(circled.n).toBeGreaterThan(300)
    const both = find(await shot(still, 5.5, 8), red)
    expect(both.n).toBeGreaterThan(circled.n)
    // a scanned picture: a red square picture, the sheet is that picture and the mark lands inside it
    const scan = { template: 'document', props: { camera: 'still', marks: [{ rect: { x: 0.2, y: 0.2, w: 0.5, h: 0.1 }, atS: 1, style: 'highlight' }] } } as MotionSpecInput
    fontCss ||= await docFontCssOf(RESOURCES)
    const pic = await service.open({ html: '<body style="margin:0;background:#2f6fd8"></body>', width: 600, height: 800, signal })
    const png = await pic.frame(0)
    await pic.close()
    const page = await service.open({ html: motionHtml(scan, { width: W, height: H, durationS: 6, fontCss }, { picture: `data:image/png;base64,${Buffer.from(png).toString('base64')}` }), width: W, height: H, signal })
    try {
      const r = await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { signal, stdin: await page.frame(3) })
      const px = { w: W, h: H, data: Buffer.from(r.stdout) }
      expect(find(px, (rr, g, b) => b > 180 && rr < 90).n).toBeGreaterThan(100_000)
      // the yellow marker multiplied over the blue picture: a darker teal
      expect(find(px, (rr, g, b) => rr < 80 && g > 85 && g < 130 && b > 100 && b < 150).n).toBeGreaterThan(5000)
    } finally {
      await page.close()
    }
  }, 90_000)

  it('chart: the line grows to the right with the time; the donut sweeps on its words; the counters appear on theirs', async () => {
    // the accent line (accentFrom 0): its right-most pixel moves right as it draws
    const line = LINE
    const xs: number[] = []
    for (const t of [0.8, 1.6, 2.2, 3.4]) xs.push(find(await shot(line, t, 6), red).maxX)
    expect(xs[0]).toBe(-1)
    expect(xs[1] as number).toBeGreaterThan(0)
    expect(xs[2] as number).toBeGreaterThan(xs[1] as number)
    expect(xs[3] as number).toBeGreaterThan(xs[2] as number)
    // the big last value shows when the line is done
    const done = await shot(line, 3.8, 6)
    expect(find(done, (_r, _g, _b, a) => a < 255).n).toBe(0)
  }, 90_000)

  it('chart: the donut sweeps on its words and the counters appear on theirs', async () => {
    // the donut: the accent slice is not there before its time and is a good part of the ring after it
    const before = find(await shot(DONUT, 3.3, 8), red).n
    const after = find(await shot(DONUT, 5.2, 8), red).n
    expect(before).toBeLessThan(300)
    expect(after).toBeGreaterThan(40_000)
    // the counters: white digits only after their time
    const band = (px: Px): number => find(px, white).n
    const c0 = band(await shot(COUNTERS, 0.9, 8))
    const c1 = band(await shot(COUNTERS, 2.6, 8))
    const c2 = band(await shot(COUNTERS, 5, 8))
    expect(c1).toBeGreaterThan(c0)
    expect(c2).toBeGreaterThan(c1)
  }, 90_000)
})
