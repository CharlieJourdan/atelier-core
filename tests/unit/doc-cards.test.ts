// The documentary cards (formats/cards.ts, motion/doc-*.ts) — archive in its four frames, bars, timeline. Without a browser: the HTML each card
// produces from its props (frames, quote, excerpt and mark, a stand-in without a picture, text escaped, both frame shapes) and the
// problems `checkMotion` names. In a real Chromium (skipped, with the reason, where there is none): every card is opaque from its first
// frame, the same moment gives the same picture, every text fits its box and stays inside the frame, the bars are proportional and count
// up, the timeline's events do not overlap; and the frames are saved to docs/screens/style-markets/.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkMotion, MotionSpec, type MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { chromiumService, findBrowser } from '../../src/engine/media/browser'
import { motionHtml } from '../../src/engine/motion'
import type { MotionCtx } from '../../src/engine/motion/base'
import { pictureSize } from '../../src/engine/motion/doc-common'
import { excerptTokens } from '../../src/engine/motion/doc-paper'
import { spreadTimes } from '../../src/engine/motion/doc-data'
import { docFontCssOf } from '../../src/engine/motion/fonts'
import { MEDIA, RESOURCES, ROOT } from './engine-node-helpers'

const [W, H] = FRAME_SIZES['16:9']
const [PW, PH] = FRAME_SIZES['9:16']
const ctxOf = (w: number, h: number, durationS: number, fontCss = ''): MotionCtx => ({ width: w, height: h, durationS, fontCss })
const html = (spec: MotionSpecInput, picture?: string, w = W, h = H, d = 8): string => motionHtml(spec, ctxOf(w, h, d), picture ? { picture } : {})

const archive = (props: Record<string, unknown>): MotionSpecInput => ({ template: 'archive', props } as MotionSpecInput)
const BARS: MotionSpecInput = {
  template: 'bars',
  props: {
    kicker: 'Black Monday, Oct 19 1987',
    title: 'Market value lost',
    source: 'Script figures',
    rows: [
      { label: 'U.S. loss', value: 500, display: '$500B' },
      { label: 'Global loss', value: 1700, display: '$1.7T', accent: true, atS: 3 },
      { label: 'Shares traded (millions)', value: 604 }
    ]
  }
}
const timeline = (n: number): MotionSpecInput => {
  const names = ['Treaty signed', 'Fleet leaves Cadiz', 'Silver reaches Seville', 'The crown defaults', 'Mines of Potosi close', 'Smugglers take over', 'A new viceroy', 'Independence']
  return {
    template: 'timeline',
    props: {
      kicker: 'Three centuries of silver',
      title: 'How the empire paid its debts',
      events: names.slice(0, n).map((label, i) => ({ when: `${1550 + i * 37}`, label: label + (i === 2 ? ' after a long, rough crossing' : ''), accent: i === 3 }))
    }
  } as MotionSpecInput
}

describe('the specs of the documentary cards', () => {
  it('every frame, the quote and the excerpt are valid specs', () => {
    for (const frame of ['full', 'board', 'paper', 'tv']) expect(MotionSpec.safeParse(archive({ frame, label: 'Mexico City, c. 1695', sub: 'Cristobal de Villalpando' })).success, frame).toBe(true)
    expect(checkMotion(BARS, 8)).toEqual([])
    expect(checkMotion(timeline(8), 10)).toEqual([])
  })

  it('names what comes too late or does not match', () => {
    expect(checkMotion(archive({ frame: 'paper', excerpt: 'We hold these truths to be self-evident', mark: 'liberty' }), 6)).toContain('motion archive: the mark is not in the excerpt')
    expect(checkMotion({ template: 'bars', props: { title: 't', rows: [{ label: 'a', value: 1, atS: 5.9 }] } }, 6)[0]).toMatch(/row 1 \(5\.9 s\) comes too late/)
    expect(checkMotion({ template: 'timeline', props: { title: 't', events: [{ when: '1', label: 'a' }, { when: '2', label: 'b', atS: 9.8 }] } }, 10)[0]).toMatch(/event 2/)
  })
})

describe('the HTML of the archive card', () => {
  it('draws each frame on its own opaque background, and the four are different pages', () => {
    const pages = Object.fromEntries(['full', 'board', 'paper', 'tv'].map((frame) => [frame, html(archive({ frame, label: 'Silver bar, 1622', sub: 'from the Spanish treasure ship' }))]))
    expect(pages.full).toContain('class="fullw"')
    expect(pages.board).toContain('class="boardw"')
    expect(pages.paper).toContain('class="paperw"')
    expect(pages.tv).toContain('class="tvw"')
    expect(new Set(Object.values(pages)).size).toBe(4)
    for (const page of Object.values(pages)) {
      expect(page).toContain('Silver bar, 1622')
      expect(page).not.toContain('background:transparent;}') // the card paints its own background, the page's stays the host's
    }
  })

  it('a missing picture is a neutral stand-in, a given one is drawn as it is', () => {
    expect(html(archive({ frame: 'board', label: 'x' }))).toContain('ph')
    expect(html(archive({ frame: 'board', label: 'x' }))).not.toContain('<img')
    const uri = 'data:image/jpeg;base64,/9j/AAAA'
    const page = html(archive({ frame: 'full', label: 'x' }), uri)
    expect(page).toContain(`<img class="pic"`)
    expect(page).toContain(uri)
  })

  it('reads the size of a picture from its header (PNG and JPEG) and falls back when it cannot', () => {
    const png = Buffer.alloc(33)
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(900, 20)
    expect(pictureSize(`data:image/png;base64,${png.toString('base64')}`)).toEqual({ w: 640, h: 900 })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(pictureSize(`data:image/jpeg;base64,${jpg.toString('base64')}`)).toEqual({ w: 800, h: 600 })
    expect(pictureSize('data:image/jpeg;base64,/9j/AAAA')).toBeNull()
    expect(pictureSize(undefined)).toBeNull()
  })

  it('a board with a quote puts the quote between two red rules and the label as its attribution; without, the label is a torn strip', () => {
    const q = html(archive({ frame: 'board', label: 'Francisco Pizarro', sub: 'Conquistador', quote: 'Here lies the labour of ten thousand men.' }))
    expect(q).toContain('class="qt"')
    expect(q.match(/class="rule"/g)).toHaveLength(2)
    expect(q).toContain('class="qn">Francisco Pizarro')
    expect(q).not.toContain('class="tag"')
    const plain = html(archive({ frame: 'board', label: 'Francisco Pizarro' }))
    expect(plain).toContain('class="tag"')
    expect(plain).toContain('clip-path:polygon(')
    // the same label always falls the same way
    expect(html(archive({ frame: 'board', label: 'Francisco Pizarro' }))).toBe(plain)
    expect(html(archive({ frame: 'board', label: 'Hernan Cortes' }))).not.toBe(plain)
  })

  it('a paper with an excerpt types it word by word and draws the mark word by word from its time; a mark outside the excerpt draws nothing', () => {
    const excerpt = 'Stocks plunge 508 points, a drop of 22.6 percent, and volume nearly doubles the record'
    const tokens = excerptTokens(excerpt, '508 points, a drop of 22.6 percent')
    expect(tokens.filter((t) => t.mark).map((t) => t.word)).toEqual(['508', 'points,', 'a', 'drop', 'of', '22.6', 'percent,'])
    expect(tokens.map((t) => t.word).join(' ')).toBe(excerpt)
    const page = html(archive({ frame: 'paper', label: 'The New York Times', excerpt, mark: '508 points, a drop of 22.6 percent', markAtS: 4 }))
    expect(page.match(/class="w mk"/g)).toHaveLength(7)
    const wipes = [...page.matchAll(/<i data-anim="wipe" data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(wipes[0]).toBe(4)
    expect(wipes).toEqual([...wipes].sort((a, b) => a - b))
    expect(wipes.at(-1)).toBeLessThan(5.5)
    const none = html(archive({ frame: 'paper', excerpt, mark: 'liberty' }))
    expect(none).not.toContain('class="w mk"')
    // the default mark time is after the last word is typed
    const auto = html(archive({ frame: 'paper', excerpt, mark: 'record' }), undefined, W, H, 12)
    const typed = [...auto.matchAll(/<span class="w[^"]*" data-anim="fade" data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    const mark = Number(/<i data-anim="wipe" data-at="([\d.]+)"/.exec(auto)?.[1])
    expect(mark).toBeGreaterThan(Math.max(...typed))
  })

  it('a punch and lines come at their times, a default of 40 % and 30 % of the card; the texts are escaped', () => {
    const page = html(archive({ frame: 'full', label: '<b>x</b>', punch: 'Belonged to Madrid', lines: ['Own taxes.', 'Own militias.'] }), undefined, W, H, 10)
    expect(page).toMatch(/class="punch"[^>]*data-at="4\.00"/)
    expect(page).toMatch(/<div data-anim="rise" data-at="3\.00"[^>]*>Own taxes\./)
    expect(page).toMatch(/<div data-anim="rise" data-at="3\.55"[^>]*>Own militias\./)
    expect(page).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(page).not.toContain('<b>x</b>')
    expect(html(archive({ frame: 'paper', lines: ['Mini-republics.'] }))).toContain('color:#1d1a18') // dark ink on light paper
  })

  it('every frame is built for a short too (a taller, narrower frame), at the same card', () => {
    for (const frame of ['full', 'board', 'paper', 'tv']) {
      const page = html(archive({ frame, label: 'Hernan Cortes', quote: frame === 'board' ? 'A short quote.' : undefined, excerpt: frame === 'paper' ? 'One line of the treaty.' : undefined }), undefined, PW, PH)
      expect(page, frame).toContain(`width:${PW}px;height:${PH}px`)
    }
  })
})

describe('the HTML of the data cards', () => {
  it('rows spread over the first 60 % of the card, or sit where the spec says; a display is shown as written, a value counts up', () => {
    const times = spreadTimes(4, 10, 0.6)
    expect(times[0]).toBe(0.8)
    expect(times.at(-1)).toBeCloseTo(6, 5)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    const page = html(BARS)
    expect(page).toContain('$1.7T')
    expect(page).toMatch(/data-count data-from="0" data-to="604"/)
    expect(page).toContain('SOURCE: Script figures')
    expect(page).toMatch(/class="bar"[^>]*data-anim="grow" data-at="3\.05"/)
  })

  it('a timeline alternates above and below from five events, never before', () => {
    const few = html(timeline(4))
    const many = html(timeline(6))
    expect(few).toMatch(/class="elab" style="[^"]*top:/)
    expect(few).not.toMatch(/class="elab" style="[^"]*bottom:/)
    expect(many).toMatch(/class="elab" style="[^"]*bottom:/)
    expect(many.match(/class="dot"/g)).toHaveLength(6)
  })

  it('both cards are built for a short too (a vertical timeline, a label above its bar)', () => {
    expect(html(timeline(5), undefined, PW, PH)).toContain('class="tlv"')
    expect(html(BARS, undefined, PW, PH)).toContain('class="bar"')
  })
})

// ---- in a real browser ---------------------------------------------------------------------------------------------------------------------

const exe = findBrowser({ platform: process.platform, env: process.env, home: os.homedir() })
const skip = !exe ? 'no Chromium, Chrome or Edge found (set ATELIER_CHROMIUM)' : ''
const signal = new AbortController().signal
const service = chromiumService(exe ? { executablePath: exe } : {})
afterAll(() => service.close?.(), 60_000)
// saved for a look outside git; ATELIER_SAVE_SCREENS=1 writes them to docs/screens/style-markets/
const SCREENS = process.env.ATELIER_SAVE_SCREENS ? path.join(ROOT, 'docs', 'screens', 'style-markets') : path.join(os.tmpdir(), 'atelier-screens', 'style-markets')

type Pw = { chromium: { launch(o: { executablePath: string }): Promise<PwBrowser> } }
interface PwBrowser {
  newPage(o: unknown): Promise<PwPage>
  close(): Promise<void>
}
interface PwPage {
  setContent(html: string): Promise<void>
  evaluate<T, A>(fn: (a: A) => T, a: A): Promise<T>
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(o: { type: 'jpeg'; quality: number }): Promise<Buffer>
  close(): Promise<void>
}

describe.skipIf(skip !== '')(`the documentary cards in a real browser (${skip || 'Chromium'})`, () => {
  const pw = createRequire(path.join(__dirname, '..', '..', 'package.json'))('playwright-core') as Pw
  let browser: PwBrowser | null = null
  const launch = async (): Promise<PwBrowser> => (browser ??= await pw.chromium.launch({ executablePath: exe as string }))
  afterAll(() => browser?.close(), 60_000)

  /** Sample pictures drawn by the browser itself: a landscape painting-like photograph, a portrait, a document. */
  const draw = async (w: number, h: number, body: string): Promise<string> => {
    const page = await (await launch()).newPage({ viewport: { width: w, height: h } })
    try {
      await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:Georgia,serif">${body}</body></html>`)
      return `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg', quality: 82 })).toString('base64')}`
    } finally {
      await page.close()
    }
  }
  const pictures: { photo: string; portrait: string; document: string } = { photo: '', portrait: '', document: '' }
  let fontCss = ''
  const prepare = async (): Promise<void> => {
    if (pictures.photo) return
    fontCss = await docFontCssOf(RESOURCES)
    pictures.photo = await draw(1600, 1000, `<div style="position:absolute;inset:0;background:linear-gradient(#d8c3a0 0%,#b99468 38%,#6c4f3a 60%,#2e211a 100%)"></div>
<div style="position:absolute;left:1100px;top:130px;width:150px;height:150px;border-radius:50%;background:#f1e2c0;box-shadow:0 0 90px 40px rgba(255,235,190,.5)"></div>
<div style="position:absolute;left:-100px;top:520px;width:1000px;height:600px;border-radius:50%;background:#4a3425"></div>
<div style="position:absolute;left:600px;top:560px;width:1300px;height:700px;border-radius:50%;background:#33231a"></div>
<div style="position:absolute;left:330px;top:280px;width:60px;height:300px;background:#2a1d15"></div><div style="position:absolute;left:300px;top:240px;width:120px;height:60px;background:#2a1d15;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>
<div style="position:absolute;left:760px;top:430px;width:380px;height:160px;background:#241912"></div><div style="position:absolute;left:740px;top:395px;width:420px;height:50px;background:#2c1f17;clip-path:polygon(8% 100%,50% 0,92% 100%)"></div>`)
    pictures.portrait = await draw(720, 940, `<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,#bdb4a6,#5d564d 70%,#2b2724)"></div>
<div style="position:absolute;left:250px;top:150px;width:220px;height:280px;border-radius:50%;background:#8b7766"></div>
<div style="position:absolute;left:120px;top:420px;width:480px;height:600px;border-radius:40% 40% 0 0;background:#2d2a2c"></div>
<div style="position:absolute;left:300px;top:420px;width:120px;height:160px;background:#e8e2d6;clip-path:polygon(0 0,100% 0,50% 100%)"></div>`)
    const lines = Array.from({ length: 30 }, (_, i) => `<div style="height:7px;margin:9px 0;background:#3a3a3a;opacity:${0.55 + (i % 4) * 0.1};width:${i % 7 === 6 ? 60 : 100}%"></div>`).join('')
    pictures.document = await draw(780, 1020, `<div style="position:absolute;inset:0;background:#f6f3ea"></div>
<div style="position:absolute;left:60px;right:60px;top:50px;text-align:center;font:700 54px Georgia,serif;color:#111;letter-spacing:2px;border-bottom:4px double #111;padding-bottom:12px">THE DAILY LEDGER</div>
<div style="position:absolute;left:60px;right:60px;top:170px;font:700 36px Georgia,serif;color:#111;line-height:1.1">STOCKS PLUNGE 508 POINTS, A DROP OF 22.6 PERCENT</div>
<div style="position:absolute;left:60px;right:60px;top:300px">${lines}</div>`)
  }

  const open = async (spec: MotionSpecInput, w: number, h: number, durationS: number, picture?: string): Promise<PwPage> => {
    await prepare()
    const page = await (await launch()).newPage({ viewport: { width: w, height: h } })
    await page.setContent(motionHtml(spec, { width: w, height: h, durationS, fontCss }, picture ? { picture } : {}))
    await page.evaluate(() => document.fonts.ready.then(() => 0))
    return page
  }
  const at = (page: PwPage, t: number): Promise<void> =>
    page.evaluate((time: number) => {
      ;(window as unknown as { atelierRenderAt: (t: number) => void }).atelierRenderAt(time)
    }, t)

  /** Every [data-fit] text fits its box, and what is shown stays inside the frame (a 20 px margin for texts). */
  const audit = (page: PwPage, w: number, h: number): Promise<{ overflow: string[]; outside: string[] }> =>
    page.evaluate(
      (size: { w: number; h: number }) => {
        const overflow = [...document.querySelectorAll<HTMLElement>('[data-fit]')].filter((e) => e.scrollWidth > e.clientWidth + 1 || (e.getAttribute('data-lines') === null && e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).whiteSpace !== 'nowrap')).map((e) => (e.className || e.tagName) + ': ' + (e.textContent ?? '').slice(0, 30))
        const outside = [...document.querySelectorAll<HTMLElement>('.cap,.punch,.lines,.tag,.qt,.qa,.ex,.ttl,.kick,.srcl,.src,.when,.elab,.lab,.val,.plabel,.vw,.vl')].filter((e) => {
          if (Number(getComputedStyle(e).opacity) === 0 && !e.closest('[data-anim]')) return false
          const r = e.getBoundingClientRect()
          return r.width > 0 && (r.left < 20 || r.top < 20 || r.right > size.w - 20 || r.bottom > size.h - 20)
        }).map((e) => (e.className || e.tagName) + ': ' + (e.textContent ?? '').slice(0, 30))
        return { overflow, outside }
      },
      { w, h }
    )

  /** A frame through the real page service (as the node draws it), saved to docs/screens/style-markets/ as a PNG, or a JPEG when it is over 400 KB. */
  const save = async (name: string, spec: MotionSpecInput, t: number, durationS: number, picture?: string, w = W, h = H): Promise<Uint8Array> => {
    await prepare()
    const html = motionHtml(spec, { width: w, height: h, durationS, fontCss }, picture ? { picture } : {})
    const page = await service.open({ html, width: w, height: h, signal })
    try {
      const png = await page.frame(t)
      mkdirSync(SCREENS, { recursive: true })
      const file = path.join(SCREENS, `card-${name}`)
      if (png.length <= 400_000) writeFileSync(`${file}.png`, png)
      else if (MEDIA) {
        const r = await MEDIA.run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', '-'], { signal, stdin: png })
        writeFileSync(`${file}.jpg`, r.stdout)
      }
      return png
    } finally {
      await page.close()
    }
  }
  const opaque = async (png: Uint8Array, w: number, h: number): Promise<boolean> => {
    const r = await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { signal, stdin: png })
    expect(r.stdout.length).toBe(w * h * 4)
    for (let i = 3; i < r.stdout.length; i += 4) if (r.stdout[i] !== 255) return false
    return true
  }
  const ffmpeg = !!MEDIA && spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0

  const ARCHIVES: [string, () => MotionSpecInput, keyof typeof pictures, number][] = [
    ['full', () => archive({ frame: 'full', label: 'Mexico City, c. 1695', sub: 'Cristobal de Villalpando', lines: ['Own taxes.', 'Own militias.', 'Mini-republics.'], linesAtS: 1 }), 'photo', 8],
    ['board', () => archive({ frame: 'board', label: 'Silver bar, 1622', sub: 'from the Spanish treasure ship Atocha', punch: 'Belonged to Madrid', punchAtS: 2 }), 'photo', 8],
    ['board-quote', () => archive({ frame: 'board', label: 'Francisco Pizarro', sub: 'Conquistador, 1478-1541', quote: 'We came to take the gold, and the land was only a road to it.' }), 'portrait', 8],
    ['paper', () => archive({ frame: 'paper', label: 'Leland & Rubinstein 1976', source: 'National Archives, 1987', lines: [] }), 'document', 8],
    ['paper-excerpt', () => archive({ frame: 'paper', label: 'The Daily Ledger', excerpt: 'Stocks plunge 508 points, a drop of 22.6 percent, as volume nearly doubles the record.', mark: 'plunge 508 points, a drop of 22.6 percent', markAtS: 4.5, source: 'The Daily Ledger, Oct 20 1987' }), 'document', 8],
    ['tv', () => archive({ frame: 'tv', label: 'Trading floor, 1987', move: 'pull' }), 'photo', 8]
  ]

  it.each(ARCHIVES)('the %s archive card is opaque from its first frame, repeatable, fits its boxes and stays in the frame; its frames are saved', { timeout: 120_000 }, async (name, spec, pic, d) => {
    const s = spec()
    await prepare()
    const page = await open(s, W, H, d, pictures[pic])
    try {
      await at(page, 7)
      const a = await audit(page, W, H)
      expect(a.overflow, 'text that does not fit').toEqual([])
      expect(a.outside, 'text outside the frame').toEqual([])
    } finally {
      await page.close()
    }
    if (!ffmpeg) return
    for (const [label, t] of [['start', 0], ['mid', 3], ['end', 7]] as const) {
      const png = await save(`archive-${name}-${label}`, s, t, d, pictures[pic])
      expect(await opaque(png, W, H), `${name} at ${t}`).toBe(true)
      if (label === 'mid') expect(Buffer.from(await save(`archive-${name}-${label}`, s, t, d, pictures[pic])).equals(Buffer.from(png))).toBe(true)
    }
  })

  it('the paper card types the excerpt word after word and draws the mark from its time, left to right', { timeout: 60_000 }, async () => {
    const spec = ARCHIVES[4]![1]()
    const page = await open(spec, W, H, 8, pictures.document)
    try {
      const words = async (t: number): Promise<{ shown: number; mark: number[] }> => {
        await at(page, t)
        return page.evaluate(() => ({
          shown: [...document.querySelectorAll<HTMLElement>('.ex .w')].filter((e) => Number(e.style.opacity) > 0.99).length,
          mark: [...document.querySelectorAll<HTMLElement>('.ex .mk i')].map((e) => Number(e.style.opacity) * (e.style.clipPath ? 1 - parseFloat(/inset\(0px? ([\d.]+)%/.exec(e.style.clipPath)?.[1] ?? '0') / 100 : 1))
        }))
      }
      expect((await words(0.5)).shown).toBe(0)
      const mid = await words(2)
      expect(mid.shown).toBeGreaterThan(2)
      expect(mid.shown).toBeLessThan(15)
      expect((await words(4)).mark.every((m) => m === 0)).toBe(true)
      const part = (await words(5)).mark
      expect(part.some((m) => m > 0)).toBe(true)
      expect(part.some((m) => m < 0.5)).toBe(true)
      const end = await words(7)
      expect(end.shown).toBeGreaterThan(10)
      expect(end.mark.every((m) => m > 0.99)).toBe(true)
    } finally {
      await page.close()
    }
  })

  it('the bars are proportional to their values, grow from the left and count up in French; a display is shown as written', { timeout: 60_000 }, async () => {
    const spec: MotionSpecInput = {
      template: 'bars',
      props: { kicker: 'Black Monday', title: 'Shares traded', source: 'Script figures', rows: [{ label: 'Monday', value: 604000 }, { label: 'The week before', value: 151000 }, { label: 'Total loss', value: 1700, display: '$1.7T', accent: true }] }
    }
    const page = await open(spec, W, H, 10)
    try {
      const read = async (t: number): Promise<{ w: number[]; vals: string[]; opacity: number[] }> => {
        await at(page, t)
        return page.evaluate(() => ({
          w: [...document.querySelectorAll<HTMLElement>('.bar')].map((e) => e.getBoundingClientRect().width),
          vals: [...document.querySelectorAll<HTMLElement>('.val')].map((e) => e.textContent ?? ''),
          opacity: [...document.querySelectorAll<HTMLElement>('.val')].map((e) => Number(getComputedStyle(e).opacity))
        }))
      }
      expect((await read(0.2)).w.every((w) => w < 1)).toBe(true)
      const end = await read(9)
      expect(end.w[1]! / end.w[0]!).toBeCloseTo(151000 / 604000, 1)
      expect(end.w[2]! / end.w[0]!).toBeCloseTo(1700 / 604000, 1)
      expect(end.vals[0]).toBe('604 000')
      expect(end.vals[2]).toBe('$1.7T')
      // the rows come one after the other: at the second row's start, the third's bar has not begun
      const early = await read(1.6)
      expect(early.w[0]).toBeGreaterThan(early.w[1]!)
      expect(early.w[2]).toBeLessThan(1)
      expect(early.opacity[0]).toBe(1)
      expect(early.opacity[2], 'a value stays hidden until its row').toBe(0)
      expect(end.opacity.every((o) => o === 1)).toBe(true)
      const a = await audit(page, W, H)
      expect(a.overflow).toEqual([])
      expect(a.outside).toEqual([])
    } finally {
      await page.close()
    }
  })

  it.each([4, 6, 8])('a timeline of %i events never overlaps its texts, and its dots pop on their time', { timeout: 60_000 }, async (n) => {
    const spec = timeline(n)
    const page = await open(spec, W, H, 12)
    try {
      await at(page, 11)
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.when,.elab .et')].map((e) => {
          const r = e.getBoundingClientRect()
          // the box of the text itself (a centred text is narrower than its box)
          const t = document.createRange()
          t.selectNodeContents(e)
          const tr = t.getBoundingClientRect()
          return { l: Math.max(r.left, tr.left), r: Math.min(r.right, tr.right), t: tr.top, b: tr.bottom }
        })
      )
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!
          const b = boxes[j]!
          expect(a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1, `text ${i} overlaps text ${j}`).toBe(false)
        }
      const a = await audit(page, W, H)
      expect(a.overflow).toEqual([])
      expect(a.outside).toEqual([])
      const dots = async (t: number): Promise<number[]> => {
        await at(page, t)
        return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.dot')].map((e) => Number(getComputedStyle(e).opacity)))
      }
      expect((await dots(0.5)).every((o) => o === 0)).toBe(true)
      expect((await dots(11)).every((o) => o > 0.99)).toBe(true)
      const times = spreadTimes(n, 12, 0.7)
      const first = await dots((times[1] as number) - 0.1)
      expect(first[0]).toBeGreaterThan(0.99)
      expect(first[1]).toBe(0)
    } finally {
      await page.close()
    }
    if (!ffmpeg) return
    for (const t of [3, 11]) {
      const png = await save(`timeline-${n}-${t === 3 ? 'mid' : 'end'}`, spec, t, 12)
      expect(await opaque(png, W, H)).toBe(true)
    }
  })

  it('the data cards are opaque from the first frame, and saved (landscape and a short)', { timeout: 120_000 }, async () => {
    if (!ffmpeg) return
    await prepare()
    for (const [name, spec, t] of [['bars-mid', BARS, 4], ['bars-end', BARS, 9]] as const) expect(await opaque(await save(name, spec, t, 10), W, H)).toBe(true)
    expect(await opaque(await save('bars-start', BARS, 0, 10), W, H)).toBe(true)
    await save('bars-portrait', BARS, 9, 10, undefined, PW, PH)
    await save('timeline-portrait', timeline(5), 11, 12, undefined, PW, PH)
    await save('archive-board-portrait', ARCHIVES[1]![1](), 5, 8, pictures.photo, PW, PH)
    await save('archive-paper-portrait', ARCHIVES[4]![1](), 7, 8, pictures.document, PW, PH)
  })
})
