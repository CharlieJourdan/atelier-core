// The motion look (src/engine/motion/look.ts): what a style gives `motion.render` so its graphics take the film's period, palette and
// texture. Without a look (or with `modern`) every page is the same markup as before; a paper look changes the faces, the colours and the
// texture of kinetic type and charts, routes the documentary cards to their parchment, validates its fields and is part of the cache key of
// the graphics it changes (and only of those).
import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { EDITPLAN_SCHEMA, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import type { MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { motionHtml } from '../../src/engine/motion'
import type { MotionCtx } from '../../src/engine/motion/base'
import { PARCH } from '../../src/engine/motion/doc-parchment'
import { MotionLook, resolveLook } from '../../src/engine/motion/look'
import { motionRender, MotionParams } from '../../src/engine/nodes/motion-render'
import type { BrowserService, EngineServices, MediaService } from '../../src/engine/services'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const [W, H] = FRAME_SIZES['16:9']
const ctx: MotionCtx = { width: W, height: H, durationS: 6, fontCss: '' }

const KINETIC = (style: string, background = 'none'): MotionSpecInput =>
  ({
    template: 'kinetic',
    props: { style, background, words: [{ text: 'Une', atS: 0.3 }, { text: 'tulipe', atS: 0.6 }, { text: 'valait', atS: 1 }, { text: 'une', atS: 1.4 }, { text: 'maison', atS: 1.8, emphasis: true }] }
  }) as MotionSpecInput
const LINE: MotionSpecInput = {
  template: 'chart',
  props: { kicker: 'Haarlem', title: 'Le prix d’un bulbe', kind: 'area', unit: 'florins', accentFrom: 3, atS: 1, drawS: 3, points: [1000, 1400, 2200, 5500, 320].map((value, i) => ({ label: `m${i}`, value })) }
} as MotionSpecInput
const COUNTERS: MotionSpecInput = { template: 'chart', props: { title: 'Le bulbe le plus cher', kind: 'counters', counters: [{ label: 'florins', value: 10000, atS: 1 }] } } as MotionSpecInput
const DONUT: MotionSpecInput = { template: 'chart', props: { title: 'Qui a perdu', kind: 'donut', slices: [{ label: 'Les uns', value: 40 }, { label: 'Les autres', value: 60, accent: true }] } } as MotionSpecInput
const BARS: MotionSpecInput = { template: 'bars', props: { title: 'Les ventes', rows: [{ label: 'Haarlem', value: 30 }, { label: 'Amsterdam', value: 50 }] } } as MotionSpecInput
const TITLE: MotionSpecInput = { template: 'title', props: { title: 'La tulipe' } }
const ALL: MotionSpecInput[] = [KINETIC('pop'), KINETIC('slam', 'scrim'), KINETIC('stack'), KINETIC('highlight', 'solid'), KINETIC('typewriter'), LINE, COUNTERS, DONUT, BARS, TITLE]

describe('the look input', () => {
  it('validates: a preset name, or a preset with a palette, a type and a texture; modern takes no overrides; nothing unknown', () => {
    for (const ok of ['modern', 'period', 'newsprint', { preset: 'period' }, { preset: 'period', palette: { accent: '#5a1e12' }, type: 'condensed', texture: 'grain' }, { preset: 'newsprint', texture: 'none' }])
      expect(MotionLook.safeParse(ok).success, JSON.stringify(ok)).toBe(true)
    for (const bad of ['sepia', { preset: 'period', palette: { accent: 'red' } }, { preset: 'period', type: 'gothic' }, { preset: 'period', glow: true }, { preset: 'modern', texture: 'paper' }, { preset: 'modern', palette: { ink: '#000000' } }])
      expect(MotionLook.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    expect(MotionParams.safeParse({ look: 'period' }).success).toBe(true)
    expect(MotionParams.safeParse({ look: { preset: 'sepia' } }).success).toBe(false)
    expect(MotionParams.parse({}).look).toBeUndefined()
  })

  it('resolves: no look and modern are the templates’ own look (null); period is ink on ivory, a red-brown, a serif, the paper texture', () => {
    expect(resolveLook(undefined)).toBeNull()
    expect(resolveLook('modern')).toBeNull()
    expect(resolveLook('period')).toEqual({ preset: 'period', paper: PARCH.paper, paperDeep: PARCH.paperDeep, tag: PARCH.tag, ink: PARCH.ink, accent: PARCH.brown, muted: PARCH.muted, type: 'serif', texture: 'paper' })
    expect(resolveLook('newsprint')).toMatchObject({ type: 'condensed', texture: 'grain', ink: '#161616' })
    // an override keeps the rest of its preset; an accent too light for the paper is pulled toward the ink until it reads
    const o = resolveLook({ preset: 'period', palette: { accent: '#f0d000' }, texture: 'none' })
    expect(o).toMatchObject({ paper: PARCH.paper, type: 'serif', texture: 'none' })
    expect(o?.accent).not.toBe('#f0d000')
  })
})

describe('the pages', () => {
  it('without a look, or with modern, every template writes the same markup as before', () => {
    for (const spec of ALL) {
      const before = motionHtml(spec, ctx)
      expect(motionHtml(spec, ctx, {}, undefined)).toBe(before)
      expect(motionHtml(spec, ctx, {}, 'modern')).toBe(before)
      expect(motionHtml(spec, ctx, {}, { preset: 'modern' })).toBe(before)
      // none of the paper look's marks leak into the default pages
      expect(before).not.toMatch(/Instrument Serif|url\(#lhb\)|card::before|class="ctx"/)
    }
    // the kinetic type of before: Oswald, glow, the shaking slam
    const k = motionHtml(KINETIC('slam'), ctx)
    expect(k).toContain("font-family:'Oswald'")
    expect(k).toContain('text-shadow')
    expect(k).toMatch(/data-anim="slam" data-at="[\d.]+" data-dur="0.4" data-dy="14"/)
  })

  it('period kinetic type: ink and a serif on a paper label (texture, double rule), the accent in italic, calm entries, no glow, no shake', () => {
    const k = motionHtml(KINETIC('pop'), ctx, {}, 'period')
    expect(k).toContain(".kz{position:absolute;inset:0;font-family:'Instrument Serif'")
    expect(k).toContain(`color:${PARCH.ink}`)
    expect(k).toContain(`.wd.em{font-size:1.18em;line-height:.9;color:${PARCH.brown};font-style:italic;}`)
    expect(k).toContain('<div class="card"><svg class="ctx"')
    expect(k).toContain('feTurbulence')
    expect(k).toContain('.card::before')
    expect(k).not.toContain('text-shadow')
    expect(k).not.toContain('Oswald')
    expect(k).not.toContain('data-anim="pop"')
    // the slam is an ink stamp: the same landing scale, no shake (dy 0)
    const s = motionHtml(KINETIC('slam', 'scrim'), ctx, {}, 'period')
    expect(s).toMatch(/data-anim="slam" data-at="[\d.]+" data-dur="0.3" data-dy="0"/)
    expect(s).not.toMatch(/data-dy="(14|26)"/)
    // scrim: the picture washed with the paper, the words on their label (bare words on the wash were fitted down to 40 px: a tiny « ×20 »);
    // solid: a sheet of it with bare words
    expect(s).toContain('class="back wash"')
    expect(s).toContain('<div class="card">')
    expect(motionHtml(KINETIC('highlight', 'solid'), ctx, {}, 'period')).not.toContain('<div class="card">')
    expect(motionHtml(KINETIC('highlight', 'solid'), ctx, {}, 'period')).toMatch(/class="back" data-anim="fade"[^>]*><svg class="ltx"/)
    // newsprint: the same build in its own paper, ink and condensed face
    const n = motionHtml(KINETIC('pop'), ctx, {}, 'newsprint')
    expect(n).toContain("font-family:'Oswald'")
    expect(n).toContain('#161616')
    expect(n).not.toContain('font-style:italic')
  })

  it('period chart: drawn in ink on the paper (hatched area, open rings, an ink-framed tag), serif numbers, a plate mark', () => {
    const c = motionHtml(LINE, ctx, {}, 'period')
    expect(c).toContain('<pattern id="lhb"')
    expect(c).toContain('fill="url(#lhb)"')
    expect(c).toContain('fill="url(#lha)"')
    expect(c).toContain(`fill="${PARCH.paper}" stroke="${PARCH.ink}"`)
    expect(c).toContain('stroke-dasharray="2 7"')
    expect(c).toMatch(/\.tbub\{background:#f6edd6;color:#2b2118;border:1\.5px solid #2b2118/)
    expect(c).toContain("font-family:'Instrument Serif'")
    expect(c).toContain('.doc::after')
    expect(c).not.toContain('Oswald')
    const k = motionHtml(COUNTERS, ctx, {}, 'period')
    expect(k).toMatch(/\.cnum\{[^}]*font-family:'Instrument Serif'[^}]*font-weight:400/)
    expect(k).toContain(`border-top:2.5px solid ${PARCH.brown}`)
    // the parchment chart of before (theme light, no look) is not the engraved one
    expect(motionHtml({ ...LINE, theme: 'light' } as MotionSpecInput, ctx)).not.toContain('url(#lhb)')
  })

  it('the documentary cards take their parchment variant under a paper look, whatever the spec’s theme', () => {
    // the same card as the parchment one (only the overlay colour variables of the page's :root, unused by an opaque card, differ)
    const card = (h: string): string => h.replace(/^:root\{.*\}$/m, '')
    expect(card(motionHtml(BARS, ctx, {}, 'period'))).toBe(card(motionHtml({ ...BARS, theme: 'light' } as MotionSpecInput, ctx)))
    expect(card(motionHtml(BARS, ctx, {}, 'period'))).not.toBe(card(motionHtml(BARS, ctx)))
    expect(motionHtml(BARS, ctx, {}, 'period')).toContain(`background:${PARCH.paper}`)
    // an overlay without a look choice is not touched
    expect(motionHtml(TITLE, ctx, {}, 'period')).toBe(motionHtml(TITLE, ctx))
  })
})

// ---- the node: the look reaches the pages and the cache keys ------------------------------------------------------------------------------

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function fakeBrowser(): BrowserService & { opened: string[] } {
  const b = {
    opened: [] as string[],
    async open(req: { html: string }) {
      b.opened.push(req.html)
      let n = 0
      return { frame: () => Promise.resolve(new Uint8Array([137, 80, 78, 71, ++n])), close: () => Promise.resolve() }
    }
  }
  return b
}
function fakeMedia(): MediaService {
  return {
    async run(_tool, args, opts) {
      if (args.includes('-filters')) return { stdout: Buffer.from(' T.. scale  Scale\n'), stderr: '' }
      if (args.includes('-encoders')) return { stdout: Buffer.from(' V....D prores_ks   Apple ProRes (iCodec Pro)\n'), stderr: '' }
      if (opts?.stdin && !(opts.stdin instanceof Uint8Array)) for await (const _f of opts.stdin) void _f
      await writeFile(args.at(-1) as string, 'mov')
      return { stdout: Buffer.alloc(0), stderr: '' }
    },
    stream: () => {
      throw new Error('not used')
    }
  }
}
const shot = (id: string, startFrame: number, graphic: MotionSpecInput): Shot => ({ id, track: 'overlay', startFrame, endFrame: startFrame + 120, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: graphic as never })
const plan: EditPlan = {
  schema: EDITPLAN_SCHEMA,
  fps: 30,
  size: [1920, 1080] as never,
  frames: 300,
  tracks: { base: ['s001'], overlay: ['k1', 't1'], labels: [] },
  captionsPreset: 'highlight',
  shots: [{ id: 's001', track: 'base', startFrame: 0, endFrame: 300, kind: 'stock.photo', genItem: 'item-001', transitionIn: 'cut', role: 'base', beat: 0 }, shot('k1', 0, KINETIC('pop')), shot('t1', 150, TITLE)],
  chapters: [],
  diagnostics: []
}

describe('motion.render with a look', () => {
  it('draws the kinetic page in the look with its serif embedded; the look is in the key of the graphics it changes, and only theirs', async () => {
    const t = tempDir('look')
    cleanups.push(t.cleanup)
    const run = async (look?: MotionLook): Promise<{ browser: ReturnType<typeof fakeBrowser>; meta: unknown }> => {
      const browser = fakeBrowser()
      const services: EngineServices = { ...testServices(t.dir), media: fakeMedia(), browser }
      const out = await motionRender.run(makeCtx(services), { plan: art('json.editplan', { value: plan as never }) }, MotionParams.parse(look ? { look } : {}))
      return { browser, meta: out.graphics?.meta }
    }
    const none = await run()
    expect(none.meta).toMatchObject({ drawn: 2, cached: 0 })
    // modern is no look: the same keys, nothing redrawn
    expect((await run('modern')).meta).toMatchObject({ drawn: 0, cached: 2 })
    // period: the kinetic overlay is drawn again (on paper, Instrument Serif embedded), the title is not
    const period = await run('period')
    expect(period.meta).toMatchObject({ drawn: 1, cached: 1 })
    expect(period.browser.opened[0]).toContain('class="card"')
    expect(period.browser.opened[0]).toMatch(/@font-face\{font-family:'Instrument Serif';font-weight:400;font-style:normal;src:url\(data:font\/woff2;base64,/)
    expect((await run('period')).meta).toMatchObject({ drawn: 0, cached: 2 })
    // another paper look is another file
    expect((await run({ preset: 'period', palette: { accent: '#5a1e12' } })).meta).toMatchObject({ drawn: 1, cached: 1 })
  })
})
