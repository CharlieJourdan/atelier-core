// The browser service of the motion templates (src/engine/media/browser.ts) without a browser: where it looks for one on each OS (a simulated
// macOS and Linux are tested on whatever machine this runs on), how it starts and shares one Chromium between pages, what it says when there is
// none, and what the plain-Node host gives a node. A stub stands for Playwright's driver; the real one is in motion-browser.test.ts.
import { describe, expect, it } from 'vitest'
import { AbortError, EngineError } from '../../src/engine'
import { nodeHost } from '../../src/engine/host'
import { browserCandidates, chromiumService, findBrowser, type BrowserEnv } from '../../src/engine/media/browser'
import { need } from '../../src/engine/services'
import { makeCtx, tempDir } from './engine-node-helpers'

const env = (over: Partial<BrowserEnv>): BrowserEnv => ({ platform: 'linux', env: {}, home: '/home/c', exists: () => false, list: () => [], ...over })

describe('where a Chromium may be', () => {
  it('Windows: ATELIER_CHROMIUM first, then the newest headless shell and Chromium of Playwright’s cache, then Chrome and Edge of the system', () => {
    const list = (d: string): string[] => (d.endsWith('ms-playwright') ? ['chromium-1217', 'chromium-1248', 'chromium_headless_shell-1217', 'ffmpeg-1011', 'winldd-1007'] : [])
    const c = browserCandidates(env({ platform: 'win32', env: { ATELIER_CHROMIUM: 'C:\\x\\chrome.exe', LOCALAPPDATA: 'C:\\Users\\c\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' }, home: 'C:\\Users\\c', list }))
    expect(c[0]).toBe('C:\\x\\chrome.exe')
    expect(c[1]).toBe('C:\\Users\\c\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1217\\chrome-headless-shell-win64\\chrome-headless-shell.exe')
    // the newest Chromium first
    expect(c[2]).toBe('C:\\Users\\c\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe')
    expect(c[3]).toContain('chromium-1217')
    expect(c).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(c).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('macOS (simulated): Playwright’s cache in ~/Library/Caches, then Chrome, Chromium and Edge in /Applications', () => {
    const list = (d: string): string[] => (d === '/Users/charlie/Library/Caches/ms-playwright' ? ['chromium_headless_shell-1217', 'chromium-1217'] : [])
    const c = browserCandidates(env({ platform: 'darwin', home: '/Users/charlie', list }))
    expect(c[0]).toBe('/Users/charlie/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell')
    expect(c[1]).toContain('/chromium-1217/chrome-mac-arm64/')
    expect(c).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(c).toContain('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    expect(c.some((p) => p.includes('\\'))).toBe(false)
  })

  it('PLAYWRIGHT_BROWSERS_PATH moves the cache; Linux looks in ~/.cache and /usr/bin', () => {
    const seen: string[] = []
    browserCandidates(env({ platform: 'linux', env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw' }, list: (d) => (seen.push(d), []) }))
    expect(seen[0]).toBe('/opt/pw')
    expect(browserCandidates(env({ platform: 'linux' }))).toContain('/usr/bin/chromium')
    const seen2: string[] = []
    browserCandidates(env({ platform: 'linux', list: (d) => (seen2.push(d), []) }))
    expect(seen2[0]).toBe('/home/c/.cache/ms-playwright')
  })

  it('findBrowser is the first that exists, or null', () => {
    expect(findBrowser(env({ platform: 'darwin', home: '/Users/c', exists: (p) => p.endsWith('Chromium') }))).toBe('/Applications/Chromium.app/Contents/MacOS/Chromium')
    expect(findBrowser(env({ platform: 'darwin', home: '/Users/c' }))).toBeNull()
  })
})

// ---- the service, with a stub for Playwright's driver -------------------------------------------------------------------------------

function stubDriver() {
  const log: string[] = []
  let disconnect: (() => void) | null = null
  const driver = {
    chromium: {
      launch: (o: { executablePath?: string; headless: boolean; args?: string[] }) => {
        log.push(`launch ${o.executablePath ?? ''} headless=${String(o.headless)}`)
        return Promise.resolve({
          on: (_event: 'disconnected', cb: () => void) => void (disconnect = cb),
          newPage: (v: { viewport: { width: number; height: number }; deviceScaleFactor: number }) => {
            log.push(`page ${v.viewport.width}x${v.viewport.height}@${v.deviceScaleFactor}`)
            return Promise.resolve({
              setContent: (html: string) => (log.push(`content ${html.length}`), Promise.resolve()),
              evaluate: (fn: (a: number) => unknown, a?: number) => (log.push(a === undefined ? 'wait fonts' : `seek ${a}`), Promise.resolve(undefined)),
              screenshot: (o: { type: string; omitBackground: boolean }) => (log.push(`shot ${o.type} transparent=${String(o.omitBackground)}`), Promise.resolve(new Uint8Array([1, 2, 3]))),
              close: () => (log.push('page closed'), Promise.resolve())
            })
          },
          close: () => (log.push('browser closed'), Promise.resolve())
        })
      }
    }
  }
  return { driver: () => Promise.resolve(driver as never), log, crash: () => disconnect?.() }
}

describe('the service', () => {
  const signal = new AbortController().signal

  it('starts one headless Chromium at the first page, shares it, loads the page, waits for the fonts, photographs a transparent PNG, and closes it', async () => {
    const s = stubDriver()
    const svc = chromiumService({ executablePath: '/x/chrome', driver: s.driver })
    expect(s.log).toEqual([]) // nothing starts before a page is asked for
    const a = await svc.open({ html: '<p>a</p>', width: 1920, height: 1080, signal })
    const b = await svc.open({ html: '<p>b</p>', width: 1080, height: 1920, signal })
    expect(s.log.filter((l) => l.startsWith('launch'))).toEqual(['launch /x/chrome headless=true'])
    expect(s.log).toContain('page 1920x1080@1')
    expect(s.log).toContain('page 1080x1920@1')
    expect(await a.frame(0.5)).toEqual(new Uint8Array([1, 2, 3]))
    expect(s.log.slice(-2)).toEqual(['seek 0.5', 'shot png transparent=true'])
    await a.close()
    await b.close()
    await svc.close?.()
    expect(s.log.at(-1)).toBe('browser closed')
  })

  it('a browser that dies is started again by the next page', async () => {
    const s = stubDriver()
    const svc = chromiumService({ executablePath: '/x/chrome', driver: s.driver })
    await svc.open({ html: '<p/>', width: 100, height: 100, signal })
    s.crash()
    await svc.open({ html: '<p/>', width: 100, height: 100, signal })
    expect(s.log.filter((l) => l.startsWith('launch'))).toHaveLength(2)
  })

  it('without any browser it says so in French, as a permanent missing_tool error; a cancel is a cancel', async () => {
    const svc = chromiumService({ env: { platform: 'linux', env: {}, home: '/nowhere', exists: () => false, list: () => [] }, driver: stubDriver().driver })
    const err = await svc.open({ html: '', width: 10, height: 10, signal }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).code).toBe('missing_tool')
    expect((err as EngineError).message).toMatch(/Aucun navigateur/)
    const ac = new AbortController()
    ac.abort()
    await expect(chromiumService({ executablePath: '/x', driver: stubDriver().driver }).open({ html: '', width: 10, height: 10, signal: ac.signal })).rejects.toBeInstanceOf(AbortError)
  })

  it('a driver that cannot be loaded or a browser that will not start is a clear missing_tool too', async () => {
    const noDriver = chromiumService({ executablePath: '/x', driver: () => Promise.reject(new EngineError('missing_tool', 'Le pilote du navigateur (playwright-core) est introuvable')) })
    await expect(noDriver.open({ html: '', width: 1, height: 1, signal })).rejects.toThrow(/pilote/)
    const bad = chromiumService({ executablePath: '/x', driver: () => Promise.resolve({ chromium: { launch: () => Promise.reject(new Error('spawn ENOENT\n at x')) } } as never) })
    await expect(bad.open({ html: '', width: 1, height: 1, signal })).rejects.toThrow(/n’a pas pu démarrer \(spawn ENOENT\)/)
  })
})

describe('the plain-Node host', () => {
  it('gives the nodes a browser service (started only when a graphic is drawn); a host that is given another one keeps it', async () => {
    const t = tempDir('host-browser')
    try {
      const host = nodeHost({ dataDir: t.dir, resourcesDir: t.dir })
      expect(host.services.browser).toBeDefined()
      expect(need(makeCtx(host.services), 'browser')).toBe(host.services.browser)
      const mine = { open: () => Promise.reject(new Error('mine')) }
      const own = nodeHost({ dataDir: t.dir, resourcesDir: t.dir, extra: { browser: mine } })
      expect(own.services.browser).toBe(mine)
      await host.cleanup()
      await own.cleanup()
    } finally {
      t.cleanup()
    }
  })
})
