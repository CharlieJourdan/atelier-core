// Window-size proof (app-ux-robustesse): every screen of the shell at several window sizes, from the minimum (1024 px)
// to 4K, and at the content sizes that 125 % / 150 % Windows scaling gives. Each shot is taken, then the page is
// checked for a horizontal scrollbar on the document and for content poking out of the window. Screenshots go OUTSIDE
// git (ATELIER_UX_SHOTS, default <temp folder>/atelier-ux-shots). Throwaway userData with the example workspace, no model.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pagesOf, type SectionId } from '../../src/shared/sections'
import { noDesktopReason } from './desktop'
import { launchAtelier, type Atelier } from './launch'

const OUT = process.env.ATELIER_UX_SHOTS || path.join(os.tmpdir(), 'atelier-ux-shots')
const SIZES: readonly [number, number][] = [
  [1024, 640], // the minimum
  [1280, 720], // 1920×1080 at 150 %
  [1536, 864], // 1920×1080 at 125 %
  [1920, 1080],
  [2560, 1440], // 4K at 150 %
  [3840, 2160] // 4K at 100 %
]
const SECTIONS: readonly SectionId[] = ['accueil', 'planning', 'production', 'agents', 'conversations', 'cerveau', 'chaines', 'monetisation', 'ordinateurs', 'reglages']

const skipReason = noDesktopReason()

/** Elements whose box leaves the window on the right/bottom, or text clipped by its own box with no ellipsis. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth + 1) out.push(`document scrolls horizontally (${de.scrollWidth} > ${de.clientWidth})`)
    const vw = window.innerWidth
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.className).slice(0, 50)}`
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' || cs.visibility === 'hidden') continue
      // visible text that leaves the right edge of the window
      if (r.left < vw && r.right > vw + 2 && (el.children.length === 0 || el.matches('button,a,h1,h2,h3'))) {
        // inside a horizontal scroller it is expected
        let p: Element | null = el.parentElement
        let scroller = false
        while (p) {
          const o = getComputedStyle(p).overflowX
          if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= vw + 1) {
            scroller = true
            break
          }
          p = p.parentElement
        }
        if (!scroller) out.push(`leaves the window: ${name(el)} right=${Math.round(r.right)} > ${vw}`)
      }
      // text clipped by its own box (no ellipsis, no wrap): leaf with text, overflow hidden, scrollWidth > clientWidth
      if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2) {
        out.push(`clipped text: ${name(el)} "${(el.textContent ?? '').trim().slice(0, 40)}" ${el.scrollWidth} > ${el.clientWidth}`)
      }
    }
    return out.slice(0, 12)
  })
}

/** Resizes the window for real while the screen allows it; bigger sizes are emulated by Electron at that view size. */
async function setSize(atelier: Atelier, w: number, h: number): Promise<void> {
  const { app, page } = atelier
  await app.evaluate(({ BrowserWindow, screen }, [cw, ch]) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const wa = screen.getPrimaryDisplay().workAreaSize
    win.webContents.disableDeviceEmulation()
    win.setMinimumSize(1, 1)
    if (cw! <= wa.width - 40 && ch! <= wa.height - 40) {
      win.setContentSize(cw!, ch!)
      return
    }
    win.setContentSize(wa.width - 40, wa.height - 40)
    win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: cw!, height: ch! }, viewPosition: { x: 0, y: 0 }, viewSize: { width: cw!, height: ch! }, deviceScaleFactor: 1, scale: 1 })
  }, [w, h])
  await page.waitForFunction(([cw]) => Math.abs(window.innerWidth - cw!) < 40, [w, h])
}

const MIN_AND_4K: readonly [number, number][] = [
  [1024, 640],
  [3840, 2160]
]

test.describe('Layout of the welcome and the first run', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(600_000)

  test('the welcome screen and the first-run onboarding at the minimum window and on 4K', async () => {
    mkdirSync(OUT, { recursive: true })
    const welcome = await launchAtelier({ name: 'layout-welcome', runner: false, account: 'welcome', firstRun: true })
    try {
      const report: string[] = []
      for (const [w, h] of MIN_AND_4K) {
        await setSize(welcome, w, h)
        await welcome.page.waitForTimeout(500)
        const tag = `${w}x${h}-welcome`
        await welcome.page.screenshot({ path: path.join(OUT, `${tag}.png`) })
        for (const x of await layoutProblems(welcome.page)) report.push(`${tag}: ${x}`)
      }
      expect(report, report.join(String.fromCharCode(10))).toEqual([])
    } finally {
      await welcome.close()
    }
    const first = await launchAtelier({ name: 'layout-firstrun', runner: false, account: 'welcome', firstRun: true })
    try {
      await first.page.evaluate(() => (window as unknown as { atelier: { call: (m: string, ...a: unknown[]) => Promise<unknown> } }).atelier.call('settings.set', 'app.offline', true))
      await first.page.waitForTimeout(1500)
      const report: string[] = []
      for (const [w, h] of MIN_AND_4K) {
        await setSize(first, w, h)
        await first.page.waitForTimeout(500)
        const tag = `${w}x${h}-firstrun`
        await first.page.screenshot({ path: path.join(OUT, `${tag}.png`) })
        for (const x of await layoutProblems(first.page)) report.push(`${tag}: ${x}`)
      }
      expect(report, report.join(String.fromCharCode(10))).toEqual([])
    } finally {
      await first.close()
    }
  })
})

test.describe('Layout at several window sizes', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(600_000)

  let atelier: Atelier

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    atelier = await launchAtelier({ name: 'layout', runner: false, example: true })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('every section, page and size', async () => {
    const { app, page } = atelier
    const report: string[] = []
    for (const [w, h] of SIZES) {
      // The window is resized for real while the screen allows it; bigger sizes (2560, 4K) are emulated by Electron,
      // which renders the page at that view size inside the window.
      const real = await app.evaluate(({ BrowserWindow, screen }, [cw, ch]) => {
        const win = BrowserWindow.getAllWindows()[0]!
        const wa = screen.getPrimaryDisplay().workAreaSize
        win.webContents.disableDeviceEmulation()
        win.setMinimumSize(1, 1)
        if (cw! <= wa.width - 40 && ch! <= wa.height - 40) {
          win.setContentSize(cw!, ch!)
          return true
        }
        win.setContentSize(wa.width - 40, wa.height - 40)
        win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: cw!, height: ch! }, viewPosition: { x: 0, y: 0 }, viewSize: { width: cw!, height: ch! }, deviceScaleFactor: 1, scale: 1 })
        return false
      }, [w, h])
      await page.waitForFunction(([cw]) => Math.abs(window.innerWidth - cw!) < 40, [w, h])
      void real
      for (const section of SECTIONS) {
        await page.getByTestId(`rail-${section}`).click()
        const pages = pagesOf(section)
        const tabs = section === 'reglages' ? pages : section === 'production' ? ['apercu', 'pipeline', 'bibliotheque'] : [undefined]
        for (const p of tabs) {
          if (p) await page.getByTestId(`page-${section}-${p}`).click().catch(() => undefined)
          await page.waitForTimeout(250)
          const tag = `${w}x${h}-${section}${p ? `-${p}` : ''}`
          await page.screenshot({ path: path.join(OUT, `${tag}.png`) })
          const probs = await layoutProblems(page)
          for (const x of probs) report.push(`${tag}: ${x}`)
        }
      }
    }
    console.log(report.join('\n') || 'no layout problem found')
    expect(report, report.join('\n')).toEqual([])
  })
})
