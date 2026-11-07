// The sandbox of the custom bricks in a real Chromium (docs/ENGINE-SPEC.md §25.2): a brick's page has no network (every request is blocked
// and reported, the CSP refuses the rest first), no Node, no eval, a time budget to start and per frame (an endless loop is cut and named), and
// the lint reads the real layout (a name too big for its box overflows, text in the caption band leaves the safe area, grey on grey fails
// the contrast, an invisible brick is empty). Skipped, with the reason, where there is no Chromium / Chrome / Edge; the overlay file check
// also needs an ffmpeg with ProRes.
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { EngineError } from '../../src/engine'
import { Brick, resolveValues, type BrickValues } from '../../src/engine/formats/brick'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { coverage, decodePng } from '../../src/engine/media/png'
import { brickPage } from '../../src/engine/motion/brick-page'
import { drawBrick, previewBrick } from '../../src/engine/motion/brick-render'
import { fontCssOf } from '../../src/engine/motion/fonts'
import { CARD, CARD_OVERFLOW } from './brick-fixture'
import { FFMPEG_PATH, MEDIA, RESOURCES, tempDir } from './engine-node-helpers'

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const skip = exe ? '' : 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)'
const hasProres = ((): boolean => {
  if (!FFMPEG_PATH) return false
  const r = spawnSync(FFMPEG_PATH, ['-hide_banner', '-v', 'error', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return /\bprores_ks\b/.test(r.stdout ?? '')
})()
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)
const signal = new AbortController().signal
const SANDBOX = { loadMs: 5000, frameMs: 1500 }
const W = 1920
const H = 1080
const look = { accent: '#3B82F6', theme: 'dark' as const }
const dirs: (() => void)[] = []
afterAll(() => dirs.forEach((d) => d()))
const work = (label: string): string => {
  const t = tempDir(label)
  dirs.push(t.cleanup)
  return t.dir
}

const brick = (over: Partial<Brick> = {}): Brick => Brick.parse({ ...CARD, version: 1, ...over })
const valuesOf = (b: Brick): BrickValues => {
  const r = resolveValues(b, b.sample)
  if (!r.ok) throw new Error(r.problems.join())
  return r.values
}
/** A brick's real page (its CSP and nonce), even for a brick the static checks would refuse: the walls are tested, not the checks. */
const pageOf = async (b: Brick, durationS = 4): Promise<string> => brickPage(b, valuesOf(b), { width: W, height: H, durationS, fontCss: await fontCssOf(RESOURCES) }, look)

describe.skipIf(!!skip)(`a brick's page in a real Chromium${skip ? ` (skipped: ${skip})` : ''}`, () => {
  it('has no network: an address in the markup is refused by the CSP and a request that gets past it is blocked and reported', async () => {
    // through the brick's own page: the CSP refuses the picture before any request
    const csp = await service.open({ html: await pageOf(brick({ html: CARD.html + '<img src="http://127.0.0.1:9/spy.png">' })), width: W, height: H, signal, sandbox: SANDBOX })
    await csp.frame(1)
    const p1 = csp.problems?.()
    await csp.close()
    expect(p1?.console.join(' ')).toMatch(/Content Security Policy|Refused to load/i)
    // a page without our CSP (the second wall alone): every request is aborted at the browser and listed; fetch fails in the page
    const bare = `<!doctype html><html><body><img src="http://127.0.0.1:9/a.png"><script>window.atelierReady = true; fetch('http://127.0.0.1:9/b').then(() => document.title = 'leaked', () => document.title = 'blocked')</script></body></html>`
    const page = await service.open({ html: bare, width: 320, height: 200, signal, sandbox: SANDBOX })
    await page.frame(0)
    await new Promise((r) => setTimeout(r, 300))
    const p2 = page.problems?.()
    await page.close()
    expect(p2?.blocked.some((u) => u.startsWith('http://127.0.0.1:9/a.png'))).toBe(true)
    expect(p2?.blocked.some((u) => u.startsWith('http://127.0.0.1:9/b'))).toBe(true)
  }, 60_000)

  it('has no Node and no eval: require and process are not there, eval is refused by the CSP', async () => {
    const node = await service.open({
      html: await pageOf(brick({ script: "brick.render = function () { if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('node is here'); };" })),
      width: W,
      height: H,
      signal,
      sandbox: SANDBOX
    })
    await expect(node.frame(1)).resolves.toBeInstanceOf(Uint8Array)
    await node.close()
    const ev = await service.open({ html: await pageOf(brick({ script: "brick.render = function () { eval('1 + 1'); };" })), width: W, height: H, signal, sandbox: SANDBOX })
    await expect(ev.frame(1)).rejects.toThrow(/EvalError|unsafe-eval|Content Security Policy/i)
    await ev.close()
  }, 60_000)

  it('cuts a frame that never ends (a permanent error that says so), and the browser draws the next page as before', async () => {
    const loop = await service.open({ html: await pageOf(brick({ script: 'brick.render = function (t) { if (t > 0.5) { for (;;) {} } };' })), width: W, height: H, signal, sandbox: SANDBOX })
    await expect(loop.frame(0.2)).resolves.toBeInstanceOf(Uint8Array)
    const t0 = Date.now()
    const err = await loop.frame(1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).permanent).toBe(true)
    expect((err as EngineError).message).toMatch(/drawing the frame at 1\.00 s took more than 1500 ms/)
    expect(Date.now() - t0).toBeLessThan(6000)
    await loop.close()
    const next = await service.open({ html: await pageOf(brick()), width: W, height: H, signal, sandbox: SANDBOX })
    expect(coverage(decodePng(await next.frame(2)))).toBeGreaterThan(0.01)
    await next.close()
  }, 60_000)

  it('a script that throws when it starts, or at a frame, is the brick’s error', async () => {
    await expect(service.open({ html: await pageOf(brick({ script: "throw new Error('boom at start')" })), width: W, height: H, signal, sandbox: SANDBOX })).rejects.toThrow(/failed when it started: boom at start/)
    const p = await service.open({ html: await pageOf(brick({ script: "brick.render = function (t) { if (t > 1) throw new Error('boom at ' + t); };" })), width: W, height: H, signal, sandbox: SANDBOX })
    await expect(p.frame(0.5)).resolves.toBeInstanceOf(Uint8Array)
    await expect(p.frame(2)).rejects.toThrow(/boom at 2/)
    await p.close()
  }, 60_000)

  it('the lint reads the real layout: the name too big overflows, the fixed card passes', async () => {
    const fontCss = await fontCssOf(RESOURCES)
    const base = { size: [W, H] as [number, number], look, fontCss, browser: service, media: null, signal, clip: false, sandbox: SANDBOX }
    const bad = await previewBrick({ ...base, brick: Brick.parse({ ...CARD_OVERFLOW, version: 1 }), outDir: work('lint-bad') })
    expect(bad.error).toBeNull()
    expect(bad.lint.map((i) => i.rule)).toContain('overflow')
    expect(bad.lint.find((i) => i.rule === 'overflow')?.message).toMatch(/Élise Moreau/)
    const good = await previewBrick({ ...base, brick: brick(), outDir: work('lint-good') })
    expect(good.lint).toEqual([])
    expect(good.stills.map((s) => s.share)).toEqual([0, 0.5, 1])
    expect(good.stills[1]!.coverage).toBeGreaterThan(0.02)
    // text in the caption band, grey on grey, and nothing drawn at all
    const low = await previewBrick({ ...base, brick: brick({ css: CARD.css!.replace('top:calc(var(--safe-bottom) - 250px)', 'top:900px') }), outDir: work('lint-low') })
    expect(low.lint.map((i) => i.rule)).toContain('safe-area')
    const grey = await previewBrick({ ...base, brick: brick({ css: CARD.css + '\n.card{background:#777777} .name,.role,.kicker{color:#8a8a8a}' }), outDir: work('lint-grey') })
    expect(grey.lint.map((i) => i.rule)).toContain('contrast')
    const none = await previewBrick({ ...base, brick: brick({ css: CARD.css + '\n.card{display:none}' }), outDir: work('lint-none') })
    expect(none.lint.map((i) => i.rule)).toContain('empty')
  }, 120_000)

  it.skipIf(!hasProres)('in a film, a brick that draws nothing is a permanent error that names it (the overlay file is not kept)', async () => {
    const dir = work('draw-none')
    const b = brick({ css: CARD.css + '\n.card{opacity:0 !important}' })
    const err = await drawBrick({ brick: b, values: valuesOf(b), ctx: { width: W, height: H, durationS: 1, fontCss: '' }, look, browser: service, media: MEDIA!, frames: 30, out: `${dir}/none.mov`, signal, sandbox: SANDBOX }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).permanent).toBe(true)
    expect((err as EngineError).message).toMatch(/La brique « Fiche personnage » \(custom:fiche-personnage v1\) .*ne dessine rien/)
  }, 60_000)
})
