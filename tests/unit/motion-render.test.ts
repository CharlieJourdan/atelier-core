// `motion.render@1` (docs/ENGINE-SPEC.md §25) with a fake browser and a fake ffmpeg: which pages it opens (the HTML of each template, the frame's
// size), which frames it photographs (frame i at exactly i/30 s, in order), what it pipes to ffmpeg and what it records, the per-graphic cache,
// the retries, and the permanent errors. The real browser and the real encoder are in motion-browser.test.ts and render-motion-overlay.test.ts.
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { AbortError, EngineError } from '../../src/engine'
import { EDITPLAN_SCHEMA, type EditPlan, type Shot } from '../../src/engine/formats/editplan'
import type { MotionSpecInput } from '../../src/engine/formats/motion'
import { motionRender, MotionParams, motionShots } from '../../src/engine/nodes/motion-render'
import type { BrowserService, EngineServices, MediaService } from '../../src/engine/services'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

/** A browser that records what it is asked; each frame is a few bytes naming its time. */
function fakeBrowser(o: { failOpens?: number; failWith?: Error } = {}): BrowserService & { opened: { html: string; width: number; height: number }[]; times: number[][]; closed: number } {
  let fails = o.failOpens ?? 0
  const b = {
    opened: [] as { html: string; width: number; height: number }[],
    times: [] as number[][],
    closed: 0,
    async open(req: { html: string; width: number; height: number }) {
      if (fails > 0) {
        fails--
        throw o.failWith ?? new Error('Target crashed')
      }
      b.opened.push({ html: req.html, width: req.width, height: req.height })
      const mine: number[] = []
      b.times.push(mine)
      return {
        frame: (t: number) => {
          mine.push(t)
          return Promise.resolve(new Uint8Array([137, 80, 78, 71, mine.length]))
        },
        close: () => {
          b.closed++
          return Promise.resolve()
        }
      }
    }
  }
  return b
}

/** An ffmpeg that lists the encoders the node asks for, counts the frames piped to it and writes the output file it was told to. */
function fakeMedia(): MediaService & { runs: string[][]; frames: number[] } {
  const m = {
    runs: [] as string[][],
    frames: [] as number[],
    async run(_tool: 'ffmpeg' | 'ffprobe', args: string[], opts: { stdin?: AsyncIterable<Uint8Array> | Uint8Array }) {
      if (args.includes('-filters')) return { stdout: Buffer.from(' T.. scale  Scale\n'), stderr: '' }
      if (args.includes('-encoders')) return { stdout: Buffer.from(' V....D prores_ks   Apple ProRes (iCodec Pro)\n'), stderr: '' }
      m.runs.push(args)
      let n = 0
      if (opts.stdin && !(opts.stdin instanceof Uint8Array)) for await (const _frame of opts.stdin) n++
      m.frames.push(n)
      await writeFile(args.at(-1) as string, `mov of ${n} frames`)
      return { stdout: Buffer.alloc(0), stderr: '' }
    },
    stream: () => {
      throw new Error('not used')
    }
  }
  return m
}

const base: Shot = { id: 's001', track: 'base', startFrame: 0, endFrame: 300, kind: 'stock.photo', genItem: 'item-001', transitionIn: 'cut', role: 'base', beat: 0 }
const motion = (id: string, startFrame: number, endFrame: number, graphic: MotionSpecInput): Shot => ({ id, track: 'overlay', startFrame, endFrame, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: graphic as never })
const TITLE: MotionSpecInput = { template: 'title', props: { title: 'Le phare oublié d’Ouessant' } }
const LOWER: MotionSpecInput = { template: 'lower-third', props: { name: 'Élise Moreau', role: 'Professeur' } }
const planOf = (shots: Shot[], size: [number, number] = [1920, 1080]): EditPlan => ({
  schema: EDITPLAN_SCHEMA,
  fps: 30,
  size: size as never,
  frames: 300,
  tracks: { base: ['s001'], overlay: shots.map((s) => s.id), labels: [] },
  captionsPreset: 'highlight',
  shots: [base, ...shots],
  chapters: [],
  diagnostics: []
})
const params = MotionParams.parse({})
const services = (dir: string, browser: BrowserService | undefined, media: MediaService): EngineServices => ({ ...testServices(dir), media, ...(browser ? { browser } : {}) })

describe('motion.render with a fake browser', () => {
  it('draws one file per motion shot: the template’s page at the frame’s size, frame i at i/30 s, in order, piped to ffmpeg as ProRes 4444', async () => {
    const dir = work('draw')
    const browser = fakeBrowser()
    const media = fakeMedia()
    const plan = planOf([motion('m001', 6, 126, TITLE), motion('m002', 150, 240, LOWER)])
    const ctx = makeCtx(services(dir, browser, media))
    const out = await motionRender.run(ctx, { plan: art('json.editplan', { value: plan as never }) }, params)
    expect(out.graphics?.files).toHaveLength(2)
    expect(out.graphics?.value).toEqual([
      { shotId: 'm001', file: 0, startFrame: 6, endFrame: 126, template: 'title' },
      { shotId: 'm002', file: 1, startFrame: 150, endFrame: 240, template: 'lower-third' }
    ])
    expect(out.graphics?.meta).toMatchObject({ count: 2, drawn: 2, cached: 0, alpha: true, width: 1920, height: 1080, fps: 30, codec: 'prores_4444' })
    // one page per graphic, with the page of its template (the props are written in it) and the frame's size
    expect(browser.opened.map((p) => [p.width, p.height])).toEqual([[1920, 1080], [1920, 1080]])
    const byTitle = browser.opened.findIndex((p) => p.html.includes('oublié'))
    expect(byTitle).toBeGreaterThanOrEqual(0)
    expect(browser.opened.some((p) => p.html.includes('Élise') && p.html.includes('Professeur'))).toBe(true)
    // exactly as many frames as the shot, each at i/30 s, in order (the same graphic is the same whenever it is drawn)
    const lens = browser.times.map((t) => t.length).sort((a, b) => a - b)
    expect(lens).toEqual([90, 120])
    for (const t of browser.times) expect(t).toEqual(t.map((_, i) => i / 30))
    expect(media.frames.sort((a, b) => a - b)).toEqual([90, 120])
    // the encoder: PNG frames in, ProRes 4444 with alpha out, as many frames as the shot
    const args = media.runs[0] as string[]
    expect(args.join(' ')).toMatch(/-f image2pipe -framerate 30 -c:v png -i - -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le/)
    expect(await readFile(out.graphics?.files?.[0] as string, 'utf8')).toMatch(/^mov of \d+ frames$/)
    expect(browser.closed).toBe(2)
  })

  it('a vertical film is drawn in a vertical page', async () => {
    const dir = work('tall')
    const browser = fakeBrowser()
    const conv: MotionSpecInput = {
      template: 'conversation',
      props: { speakers: [{ name: 'Léa', side: 'right' }, { name: 'Maël', side: 'left' }], turns: [{ speaker: 0, text: 'Tu dors ?', atS: 0.5 }, { speaker: 1, text: 'Non.', atS: 1.8 }] }
    }
    await motionRender.run(makeCtx(services(dir, browser, fakeMedia())), { plan: art('json.editplan', { value: planOf([motion('m001', 0, 90, conv)], [1080, 1920]) as never }) }, params)
    expect(browser.opened[0]).toMatchObject({ width: 1080, height: 1920 })
    expect(browser.opened[0]?.html).toContain('width:1080px;height:1920px')
    expect(browser.times[0]).toHaveLength(90)
  })

  it('caches each graphic by its spec, size and length: the same plan opens no page, one edited text redraws only that graphic', async () => {
    const dir = work('cache')
    const media = fakeMedia()
    const first = fakeBrowser()
    const plan = planOf([motion('m001', 6, 126, TITLE), motion('m002', 150, 240, LOWER)])
    await motionRender.run(makeCtx(services(dir, first, media)), { plan: art('json.editplan', { value: plan as never }) }, params)
    const again = fakeBrowser()
    const out = await motionRender.run(makeCtx(services(dir, again, media)), { plan: art('json.editplan', { value: plan as never }) }, params)
    expect(again.opened).toHaveLength(0)
    expect(out.graphics?.meta).toMatchObject({ drawn: 0, cached: 2 })
    // the lower third's role is edited: only it is drawn again
    const edited = planOf([motion('m001', 6, 126, TITLE), motion('m002', 150, 240, { template: 'lower-third', props: { name: 'Élise Moreau', role: 'Directrice' } })])
    const third = fakeBrowser()
    const out3 = await motionRender.run(makeCtx(services(dir, third, media)), { plan: art('json.editplan', { value: edited as never }) }, params)
    expect(third.opened).toHaveLength(1)
    expect(third.opened[0]?.html).toContain('Directrice')
    expect(out3.graphics?.meta).toMatchObject({ drawn: 1, cached: 1 })
    // the same graphic moved in the film is the same file (its place is not part of what it looks like)
    const moved = planOf([motion('m001', 12, 132, TITLE)])
    const fourth = fakeBrowser()
    await motionRender.run(makeCtx(services(dir, fourth, media)), { plan: art('json.editplan', { value: moved as never }) }, params)
    expect(fourth.opened).toHaveLength(0)
  })

  it('a plan with no animated overlay gives no file and needs no browser', async () => {
    const dir = work('none')
    const out = await motionRender.run(makeCtx(services(dir, undefined, fakeMedia())), { plan: art('json.editplan', { value: planOf([]) as never }) }, params)
    expect(out.graphics).toMatchObject({ files: [], value: [], meta: { count: 0 } })
    expect(motionShots(planOf([]))).toEqual([])
  })

  it('without a browser the film is made without its overlays, with a visible French warning (not a failed video)', async () => {
    const dir = work('nobrowser')
    const plan = planOf([motion('m001', 6, 126, TITLE)])
    const ctx = makeCtx(services(dir, undefined, fakeMedia()))
    const out = await motionRender.run(ctx, { plan: art('json.editplan', { value: plan as never }) }, params)
    expect(out.graphics).toMatchObject({ files: [], value: [], meta: { count: 0, skipped: 1 } })
    const warn = ctx.reports.find((r) => r.kind === 'log' && r.level === 'warn') as { text: string } | undefined
    expect(warn?.text).toMatch(/Animations sautées \(1\) : aucun navigateur/)
  })

  it('a graphic the template cannot draw is a permanent error that names the shot, the template and what is wrong, before anything is drawn', async () => {
    const dir = work('bad')
    const browser = fakeBrowser()
    // a title on screen for one second: shorter than the two it needs
    const short = planOf([motion('m001', 0, 30, TITLE)])
    const err = await motionRender.run(makeCtx(services(dir, browser, fakeMedia())), { plan: art('json.editplan', { value: short as never }) }, params).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).code).toBe('bad_input')
    expect((err as EngineError).message).toMatch(/m001.*motion title.*shorter than the 2 s/)
    expect(browser.opened).toHaveLength(0)
    // a field too long does not even make a plan
    const long = planOf([motion('m001', 0, 120, { template: 'title', props: { title: 'x'.repeat(90) } })])
    const err2 = await motionRender.run(makeCtx(services(dir, browser, fakeMedia())), { plan: art('json.editplan', { value: long as never }) }, params).catch((e: unknown) => e)
    expect((err2 as EngineError).code).toBe('bad_input')
    expect((err2 as EngineError).message).toMatch(/props\.title/)
  })

  it('a page that crashes is retried with a fresh page; a missing browser or a cancel is not retried; three failures end the node', async () => {
    const dir = work('retry')
    const plan = planOf([motion('m001', 6, 126, TITLE)])
    const inputs = { plan: art('json.editplan', { value: plan as never }) }
    const flaky = fakeBrowser({ failOpens: 2 })
    const ctx = makeCtx(services(dir, flaky, fakeMedia()))
    const out = await motionRender.run(ctx, inputs, params)
    expect(out.graphics?.files).toHaveLength(1)
    expect(ctx.reports.filter((r) => r.kind === 'log' && r.level === 'warn')).toHaveLength(2)
    const dead = fakeBrowser({ failOpens: 5 })
    await expect(motionRender.run(makeCtx(services(work('retry-3'), dead, fakeMedia())), inputs, params)).rejects.toThrow(/crashed/)
    // a browser that cannot start (none found) is not retried: the overlays are skipped with a warning
    const missing = fakeBrowser({ failOpens: 5, failWith: new EngineError('missing_tool', 'Aucun navigateur') })
    const skippedOut = await motionRender.run(makeCtx(services(work('retry-m'), missing, fakeMedia())), inputs, params)
    expect(skippedOut.graphics).toMatchObject({ files: [], meta: { skipped: 1, reason: 'Aucun navigateur' } })
    expect(missing.opened).toHaveLength(0)
    const ac = new AbortController()
    ac.abort()
    await expect(motionRender.run(makeCtx(services(work('retry-a'), fakeBrowser(), fakeMedia()), { signal: ac.signal }), inputs, params)).rejects.toBeInstanceOf(AbortError)
  })
})
