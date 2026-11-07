// The motion templates in a real Chromium (docs/ENGINE-SPEC.md §25 step 4): the browser service photographs a page at any moment of its animation,
// transparent, and the same moment always gives the same picture; the clock of each template does what it says (a bubble is hidden before its
// line and there after it, the dots show between their times, the list scrolls, a long text is made smaller until it fits); a title card is drawn
// to a ProRes file with an alpha channel by the real node. Skipped, with the reason, where there is no Chromium / Chrome / Edge or no complete
// ffmpeg (on a Mac: brew install ffmpeg-full; a browser: ATELIER_CHROMIUM or Playwright's own).
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EDITPLAN_SCHEMA, type EditPlan } from '../../src/engine/formats/editplan'
import type { MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { probe } from '../../src/engine/media/probe'
import { motionHtml } from '../../src/engine/motion'
import { fontCssOf } from '../../src/engine/motion/fonts'
import { MotionParams, motionRender } from '../../src/engine/nodes/motion-render'
import { FFMPEG_PATH, MEDIA, RESOURCES, art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const hasProres = ((): boolean => {
  if (!FFMPEG_PATH) return false
  const r = spawnSync(FFMPEG_PATH, ['-hide_banner', '-v', 'error', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return /\bprores_ks\b/.test(r.stdout ?? '')
})()
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : !hasFfmpeg ? 'no ffmpeg on PATH' : !hasProres ? 'this ffmpeg has no prores_ks encoder' : ''
const signal = new AbortController().signal
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)

/** The PNG's colour type (6 = RGBA) and the frame's pixels as raw RGBA, decoded by ffmpeg. */
async function rgba(png: Uint8Array, w: number, h: number): Promise<Buffer> {
  const r = await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { signal, stdin: png })
  expect(r.stdout.length).toBe(w * h * 4)
  return r.stdout
}
const alphaStats = (px: Buffer): { clear: number; partial: number; solid: number } => {
  let clear = 0
  let partial = 0
  let solid = 0
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i] as number
    if (a === 0) clear++
    else if (a === 255) solid++
    else partial++
  }
  return { clear, partial, solid }
}

describe.skipIf(skip !== '')(`motion templates in a real browser (${skip || 'Chromium + ffmpeg'})`, () => {
  const [W, H] = FRAME_SIZES['16:9']
  const TITLE: MotionSpecInput = { template: 'title', props: { title: 'Le phare oublié d’Ouessant', subtitle: 'Une histoire vraie' } }

  it('photographs a page at any moment, transparent: nothing yet at t=0, a scrim and white text later, frames that differ, and the same moment gives the same picture in any order', { timeout: 120_000 }, async () => {
    const html = motionHtml(TITLE, { width: W, height: H, durationS: 4, fontCss: await fontCssOf(RESOURCES) })
    const page = await service.open({ html, width: W, height: H, signal })
    try {
      const f0 = await page.frame(0)
      const f15 = await page.frame(1.5)
      const f07 = await page.frame(0.7)
      // PNG with an alpha channel
      expect(Buffer.from(f15.slice(0, 8)).toString('hex')).toBe('89504e470d0a1a0a')
      expect((f15 as Uint8Array)[25]).toBe(6)
      const s0 = alphaStats(await rgba(f0, W, H))
      const s15 = alphaStats(await rgba(f15, W, H))
      expect(s0.clear).toBe(W * H) // at t=0 nothing is on screen
      expect(s15.partial).toBeGreaterThan(W * H * 0.5) // the scrim over the picture
      expect(s15.solid).toBeGreaterThan(5000) // the title's white letters
      // the animation moves (0.7 s is mid-way), then holds
      expect(Buffer.from(f15).equals(Buffer.from(f07))).toBe(false)
      // the time is the only input: 1.5 s again, after other moments, is the same picture to the byte
      const again = await page.frame(1.5)
      expect(Buffer.from(again).equals(Buffer.from(f15))).toBe(true)
      await page.frame(3.7)
      expect(Buffer.from(await page.frame(1.5)).equals(Buffer.from(f15))).toBe(true)
      // and the way out: gone again at the end
      const end = alphaStats(await rgba(await page.frame(3.99), W, H))
      expect(end.solid).toBeLessThan(s15.solid / 4)
    } finally {
      await page.close()
    }
  })

  describe('the clock of the templates (read in the page itself)', () => {
    type Pw = { chromium: { launch(o: { executablePath: string }): Promise<{ newPage(o: unknown): Promise<PwPage>; close(): Promise<void> }> } }
    interface PwPage {
      setContent(html: string): Promise<void>
      evaluate<T, A>(fn: (a: A) => T, a: A): Promise<T>
      evaluate<T>(fn: () => T): Promise<T>
      close(): Promise<void>
    }
    const pw = createRequire(path.join(__dirname, '..', '..', 'package.json'))('playwright-core') as Pw
    let browser: Awaited<ReturnType<Pw['chromium']['launch']>> | null = null
    const open = async (spec: MotionSpecInput, w: number, h: number, durationS: number): Promise<PwPage> => {
      browser ??= await pw.chromium.launch({ executablePath: exe as string })
      const page = await browser.newPage({ viewport: { width: w, height: h } })
      await page.setContent(motionHtml(spec, { width: w, height: h, durationS, fontCss: await fontCssOf(RESOURCES) }))
      await page.evaluate(() => document.fonts.ready.then(() => 0))
      return page
    }
    afterAll(() => browser?.close(), 60_000)

    const CONV: MotionSpecInput = {
      template: 'conversation',
      props: {
        speakers: [{ name: 'Léa', side: 'right' }, { name: 'Maël', side: 'left' }],
        turns: [
          { speaker: 0, text: 'Tu dors ?', atS: 1 },
          { speaker: 1, text: 'Non. Je regarde le plafond depuis une heure.', atS: 3 },
          { speaker: 0, text: 'Moi aussi. J’ai entendu du bruit dans le couloir, tu l’as entendu toi aussi ?', atS: 5 },
          { speaker: 1, text: 'Il est trois heures du matin, reste où tu es.', atS: 7 },
          { speaker: 0, text: 'Oui. Et la porte du fond vient de s’ouvrir.', atS: 9 },
          { speaker: 1, text: 'J’arrive tout de suite, ne bouge pas.', atS: 11 }
        ]
      }
    }
    /** What the page shows at `t`: each bubble's opacity, each typing indicator's, and how far the list has gone up. */
    const state = (page: PwPage, t: number) =>
      page.evaluate((time: number) => {
        ;(window as unknown as { atelierRenderAt: (t: number) => void }).atelierRenderAt(time)
        const num = (e: Element): number => Number(getComputedStyle(e).opacity)
        return {
          bubbles: [...document.querySelectorAll('.bub')].map(num),
          typing: [...document.querySelectorAll('.typing')].map(num),
          offset: new DOMMatrix(getComputedStyle(document.querySelector('.list') as Element).transform).m42
        }
      }, t)

    it('a bubble is hidden before its line starts and there after it; the dots show between their times; the list scrolls up to keep the newest bubble in view', { timeout: 60_000 }, async () => {
      const page = await open(CONV, 1080, 1920, 13)
      try {
        const turns = (CONV as { props: { turns: { atS: number }[] } }).props.turns
        for (const [i, t] of turns.entries()) {
          const before = await state(page, t.atS - 0.05)
          const after = await state(page, t.atS + 0.5)
          expect(before.bubbles[i], `bubble ${i + 1} before its line`).toBeLessThan(0.01)
          expect(after.bubbles[i], `bubble ${i + 1} after its line`).toBeGreaterThan(0.99)
          // it was not there earlier either
          expect((await state(page, 0)).bubbles[i]).toBe(0)
        }
        // the dots of the second line: between 0.9 s before it and the line itself
        const typing = async (t: number): Promise<number> => (await state(page, t)).typing[1] as number
        expect(await typing(1.5)).toBe(0)
        expect(await typing(2.5)).toBeGreaterThan(0.9)
        expect(await typing(3.05)).toBe(0)
        // the list: nothing moves while the window has room, then it goes up, never back
        expect((await state(page, 1.5)).offset).toBeCloseTo(0, 3)
        let last = 0
        for (let t = 0; t <= 13; t += 0.2) {
          const o = -(await state(page, t)).offset
          expect(o).toBeGreaterThanOrEqual(last - 0.01)
          last = o
        }
        expect(last).toBeGreaterThan(100)
      } finally {
        await page.close()
      }
    })

    it('a text too long for its box is made smaller until it fits (down to a floor), and a short one keeps its full size', { timeout: 60_000 }, async () => {
      const longName = 'Maximilien de Rochefoucauld-Montmorency'
      const sizeOf = async (spec: MotionSpecInput, sel: string, w: number, h: number): Promise<{ size: number; fits: boolean }> => {
        const page = await open(spec, w, h, 5)
        return page.evaluate((s: string) => {
          ;(window as unknown as { atelierRenderAt: (t: number) => void }).atelierRenderAt(3)
          const e = document.querySelector(s) as HTMLElement
          return { size: parseFloat(getComputedStyle(e).fontSize), fits: e.scrollWidth <= e.clientWidth + 1 }
        }, sel)
      }
      const short = await sizeOf({ template: 'lower-third', props: { name: 'Élise Moreau' } }, '.nm', W, H)
      const long = await sizeOf({ template: 'lower-third', props: { name: longName } }, '.nm', W, H)
      expect(short.size).toBe(58)
      expect(long.size).toBeLessThan(58)
      expect(long.size).toBeGreaterThanOrEqual(26)
      expect(long.fits).toBe(true)
      // a vertical frame has a narrower box
      const tall = await sizeOf({ template: 'lower-third', props: { name: longName } }, '.nm', 1080, 1920)
      expect(tall.fits).toBe(true)
    })

    it('the counter counts up from its start to its value in French and stops there', { timeout: 60_000 }, async () => {
      const page = await open({ template: 'figure', props: { value: 12000, suffix: ' navires', label: 'passés devant ses fenêtres' } }, W, H, 6)
      const text = (t: number): Promise<string> =>
        page.evaluate((time: number) => {
          ;(window as unknown as { atelierRenderAt: (t: number) => void }).atelierRenderAt(time)
          return (document.querySelector('.live') as HTMLElement).textContent ?? ''
        }, t)
      expect(await text(0.1)).toBe('0')
      const mid = Number((await text(0.9)).replace(/\D/g, ''))
      expect(mid).toBeGreaterThan(100)
      expect(mid).toBeLessThan(12000)
      expect(await text(4)).toBe('12 000')
    })
  })

  it('the node draws a title card to a ProRes 4444 file: its length, its size, an alpha channel; the second run is the cache', { timeout: 180_000 }, async () => {
    const t = tempDir('motion-real')
    try {
      const plan: EditPlan = {
        schema: EDITPLAN_SCHEMA,
        fps: 30,
        size: [1920, 1080],
        frames: 120,
        tracks: { base: ['s1'], overlay: ['m1'], labels: [] },
        captionsPreset: 'highlight',
        shots: [
          { id: 's1', track: 'base', startFrame: 0, endFrame: 120, kind: 'stock.photo', genItem: 'i', transitionIn: 'cut', role: 'base', beat: 0 },
          { id: 'm1', track: 'overlay', startFrame: 0, endFrame: 75, kind: 'motion', transitionIn: 'cut', role: 'scene', beat: 0, graphic: TITLE as never }
        ],
        chapters: [],
        diagnostics: []
      }
      const services = { ...testServices(t.dir), browser: service }
      const out = await motionRender.run(makeCtx(services), { plan: art('json.editplan', { value: plan as never }) }, MotionParams.parse({}))
      const file = out.graphics?.files?.[0] as string
      const info = await probe(MEDIA as NonNullable<typeof MEDIA>, file, signal, true)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect(v).toMatchObject({ codec_name: 'prores', width: 1920, height: 1080, r_frame_rate: '30/1' })
      expect(v?.pix_fmt).toMatch(/^yuva/)
      expect(Number(v?.nb_read_frames)).toBe(75)
      expect(out.graphics?.meta).toMatchObject({ drawn: 1, cached: 0 })
      const again = await motionRender.run(makeCtx(services), { plan: art('json.editplan', { value: plan as never }) }, MotionParams.parse({}))
      expect(again.graphics?.meta).toMatchObject({ drawn: 0, cached: 1 })
    } finally {
      t.cleanup()
    }
  })
})
