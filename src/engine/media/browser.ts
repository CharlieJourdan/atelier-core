// The headless browser of the motion templates (docs/ENGINE-SPEC.md §25), as a `BrowserService`. The engine stays pure: this module only
// speaks to Playwright's driver (loaded when the first page opens, so a host that never draws motion never loads it) and to a Chromium
// that is already on the machine (the one Playwright downloaded for the tests, or the Chrome / Edge / Chromium of the system). Nothing is
// downloaded here. The browser starts at the first page and is closed by `close()`.
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AbortError, EngineError } from '../errors'
import type { BrowserPage, BrowserSandbox, BrowserService, PageInspection } from '../services'
import { INSPECT } from './browser-inspect'

export interface BrowserEnv {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  exists?: (p: string) => boolean
  /** Names inside a folder (for the versioned folders of Playwright's cache). */
  list?: (dir: string) => string[]
}

const WIN_APPS = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'Chromium/Application/chrome.exe']
const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
]
const LINUX_APPS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge']

/**
 * Where a Chromium may be, best first: `ATELIER_CHROMIUM`, the newest headless shell then Chromium in Playwright's cache (`PLAYWRIGHT_BROWSERS_PATH`
 * or the per-OS default), then the browsers installed on the system. Pure given `env`: a simulated macOS is tested on Windows.
 */
export function browserCandidates(e: BrowserEnv): string[] {
  const win = e.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const list = e.list ?? ((d: string) => (existsSync(d) ? readdirSync(d) : []))
  const out: string[] = []
  if (e.env.ATELIER_CHROMIUM) out.push(e.env.ATELIER_CHROMIUM)
  const cache =
    e.env.PLAYWRIGHT_BROWSERS_PATH && e.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
      ? e.env.PLAYWRIGHT_BROWSERS_PATH
      : win
        ? p.join(e.env.LOCALAPPDATA ?? p.join(e.home, 'AppData', 'Local'), 'ms-playwright')
        : e.platform === 'darwin'
          ? p.join(e.home, 'Library', 'Caches', 'ms-playwright')
          : p.join(e.home, '.cache', 'ms-playwright')
  const newest = (prefix: string): string[] =>
    list(cache)
      .filter((n) => n.startsWith(`${prefix}-`))
      .sort((a, b) => Number(b.slice(prefix.length + 1)) - Number(a.slice(prefix.length + 1)))
  const shell = win ? ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'] : e.platform === 'darwin' ? ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'] : ['chrome-headless-shell-linux64', 'chrome-headless-shell']
  const full = win ? ['chrome-win64', 'chrome.exe'] : e.platform === 'darwin' ? ['chrome-mac-arm64', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'] : ['chrome-linux64', 'chrome']
  for (const d of newest('chromium_headless_shell')) out.push(p.join(cache, d, ...shell))
  for (const d of newest('chromium')) out.push(p.join(cache, d, ...full))
  if (win) {
    for (const base of [e.env.PROGRAMFILES, e.env['PROGRAMFILES(X86)'], e.env.LOCALAPPDATA].filter((x): x is string => !!x)) for (const a of WIN_APPS) out.push(p.join(base, ...a.split('/')))
  } else out.push(...(e.platform === 'darwin' ? MAC_APPS : LINUX_APPS))
  return out
}

/** The first candidate that exists, or null. */
export function findBrowser(e: BrowserEnv): string | null {
  const exists = e.exists ?? existsSync
  return browserCandidates(e).find((c) => exists(c)) ?? null
}

// ---- the little of Playwright's API we use (its types are a devDependency; the driver is loaded by name) ----------------------------------
interface PwRoute {
  request(): { url(): string }
  abort(code?: string): Promise<void>
}
interface PwPage {
  setContent(html: string, o?: { waitUntil?: 'load'; timeout?: number }): Promise<void>
  evaluate<T>(fn: (arg: number) => T, arg: number): Promise<T>
  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T>(expression: string): Promise<T>
  screenshot(o: { type: 'png'; omitBackground: boolean; timeout?: number }): Promise<Uint8Array>
  close(o?: { runBeforeUnload?: boolean }): Promise<void>
  route?(url: string, handler: (route: PwRoute) => unknown): Promise<void>
  on?(event: 'console' | 'pageerror', cb: (m: PwConsole & Error) => void): unknown
  context?(): { newCDPSession(p: PwPage): Promise<PwCdp> }
}
interface PwCdp {
  send(method: string, params?: Record<string, unknown>): Promise<{ data?: string }>
}
interface PwConsole {
  type(): string
  text(): string
}
interface PwBrowser {
  on?(event: 'disconnected', cb: () => void): unknown
  newPage(o: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    offline?: boolean
    serviceWorkers?: 'block'
    acceptDownloads?: boolean
    javaScriptEnabled?: boolean
  }): Promise<PwPage>
  close(): Promise<void>
}
interface PwDriver {
  chromium: { launch(o: { executablePath?: string; headless: boolean; args?: string[] }): Promise<PwBrowser> }
}

export interface ChromiumOptions {
  /** A Chromium to use; default: the first `browserCandidates` that exists. */
  executablePath?: string
  env?: Partial<BrowserEnv>
  /** Loads the Playwright driver (tests give a stub). */
  driver?: () => Promise<PwDriver>
  /**
   * Ask Chromium for GPU rasterisation (default: off unless `ATELIER_BROWSER_GPU=1`). About a quarter faster per frame on a desktop GPU, but
   * on Windows several pages drawn at once sometimes fail to give a frame (« Unable to capture screenshot »), so the software path, the one
   * a server has anyway, is the default.
   */
  gpu?: boolean
}

/** Chromium's switches: sRGB, no scrollbars, and GPU rasterisation when asked (about a quarter faster per frame on a desktop GPU). */
export function launchArgs(platform: NodeJS.Platform, gpu: boolean): string[] {
  // software WebGL (SwiftShader) stays allowed where no GPU is asked for: the 3D map card draws with WebGL on a CPU-only server too
  const base = ['--force-color-profile=srgb', '--hide-scrollbars', ...(gpu ? [] : ['--enable-unsafe-swiftshader'])]
  if (!gpu) return base
  return [...base, '--enable-gpu-rasterization', '--ignore-gpu-blocklist', ...(platform === 'win32' ? ['--use-angle=d3d11'] : [])]
}

/**
 * Playwright's driver, loaded by a fixed name on the spot (the engine's boundary rule) and not bound into any bundle: a dev dependency that the
 * installed app may not carry. Looked up from this module first, then from the folder the process runs in (the project's `node_modules`).
 */
function loadDriver(): Promise<PwDriver> {
  const here = import.meta.url
  const cwd = pathToFileURL(path.join(process.cwd(), 'noop.js')).href
  const tries: (() => unknown)[] = [
    () => createRequire(here)('playwright-core'),
    () => createRequire(here)('playwright'),
    () => createRequire(cwd)('playwright-core'),
    () => createRequire(cwd)('playwright')
  ]
  for (const t of tries) {
    try {
      return Promise.resolve(t() as PwDriver)
    } catch {
      // try the next place
    }
  }
  return Promise.reject(new EngineError('missing_tool', 'Le pilote du navigateur (playwright-core) est introuvable : les animations ne peuvent pas être dessinées sur cet ordinateur.'))
}

/**
 * Moves a page's clock to `t` and photographs it: the document's own `atelierRenderAt(t)` and every CSS / Web animation set to `t`. A page
 * that draws asynchronously (a WebGL map, motion/map3d.ts) also defines `atelierFrameReady()`: its promise resolves once frame `t` is drawn,
 * and the picture is taken only then.
 */
const SEEK = (t: number): Promise<unknown> | undefined => {
  const w = window as unknown as { atelierRenderAt?: (t: number) => void; atelierFrameReady?: () => Promise<unknown> }
  w.atelierRenderAt?.(t)
  for (const a of document.getAnimations()) {
    a.pause()
    a.currentTime = t * 1000
  }
  return w.atelierFrameReady?.()
}

/** Longest wait for one fast capture before it is asked again. */
const CAPTURE_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EngineError('internal', `${what} took more than ${ms} ms`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

/**
 * Moves the clock like SEEK, then returns a key of what the page shows: two 32-bit FNV-1a hashes of every inline style the runtime wrote
 * and every counted text. A page with CSS / Web animations gets a key of its own each time (nothing can be skipped on it).
 */
const SEEK_KEY = async (t: number): Promise<string> => {
  const w = window as unknown as { atelierRenderAt?: (t: number) => void; atelierFrameReady?: () => Promise<unknown> }
  w.atelierRenderAt?.(t)
  // a page that draws asynchronously says when frame t is on screen (after the key's inputs are written, before the picture)
  const ready = w.atelierFrameReady?.()
  const anims = document.getAnimations()
  for (const a of anims) {
    a.pause()
    a.currentTime = t * 1000
  }
  if (anims.length > 0) {
    if (ready) await ready
    return `t${t}`
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const add = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 16777619)
      h2 = Math.imul(h2 ^ c, 2246822519)
    }
  }
  for (const el of Array.from(document.querySelectorAll('[style]'))) add(`${el.getAttribute('style') ?? ''}|`)
  for (const el of Array.from(document.querySelectorAll('[data-count],[data-text]'))) add(`${el.textContent ?? ''}|`)
  if (ready) await ready
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`
}

/**
 * The same for a sandboxed page, run as a task of the page's own event loop (a message to itself) rather than inside the driver's
 * evaluation: code the driver evaluates may use eval whatever the page's CSP says, a task of the page may not. Its errors reject.
 */
const SEEK_SANDBOXED = (t: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      try {
        const w = window as unknown as { atelierRenderAt?: (t: number) => void }
        w.atelierRenderAt?.(t)
        for (const a of document.getAnimations()) {
          a.pause()
          a.currentTime = t * 1000
        }
        resolve(0)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      } finally {
        ch.port1.close()
      }
    }
    ch.port2.postMessage(0)
  })

/** The browser service of this machine: starts Chromium when the first page opens, one browser for all the pages. */
export function chromiumService(o: ChromiumOptions = {}): BrowserService {
  let browser: Promise<PwBrowser> | null = null
  const start = (): Promise<PwBrowser> => {
    const env: BrowserEnv = { platform: process.platform, env: process.env, home: os.homedir(), ...o.env }
    const exe = o.executablePath ?? findBrowser(env)
    if (!exe) return Promise.reject(new EngineError('missing_tool', 'Aucun navigateur (Chromium, Chrome ou Edge) n’a été trouvé : installe-en un pour les animations, puis relance l’étape.'))
    return (o.driver ?? loadDriver)()
      .then((pw) => pw.chromium.launch({ executablePath: exe, headless: true, args: launchArgs(process.platform, o.gpu ?? process.env.ATELIER_BROWSER_GPU === '1') }))
      .then((b) => {
        // a browser that dies is started again by the next page (the node retries the graphic)
        b.on?.('disconnected', () => (browser = null))
        return b
      })
  }
  return {
    fastCapture: true,
    async open({ html, width, height, signal, sandbox }) {
      if (signal.aborted) throw new AbortError()
      browser ??= start()
      let b: PwBrowser
      try {
        b = await browser
      } catch (e) {
        browser = null
        if (e instanceof EngineError) throw e
        throw new EngineError('missing_tool', `Le navigateur n’a pas pu démarrer (${(e as Error).message.split('\n')[0]}).`)
      }
      if (sandbox) return sandboxedPage(b, { html, width, height, signal, sandbox })
      const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      await page.setContent(html, { waitUntil: 'load' })
      // the fonts are embedded: wait until they are decoded so the first frame is already set in them
      await page.evaluate(() => document.fonts.ready.then(() => 0) as unknown as number)
      // the fast capture speaks to the page's DevTools session (no screenshot bookkeeping; `optimizeForSpeed` encodes quickly)
      let cdp: Promise<PwCdp> | null = null
      const session = async (): Promise<PwCdp> => {
        const ctx = page.context?.()
        if (!ctx) throw new EngineError('missing_tool', 'Le pilote du navigateur ne donne pas accès à la capture rapide.')
        cdp ??= ctx.newCDPSession(page).then(async (c) => {
          await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
          return c
        })
        return cdp
      }
      const view: BrowserPage = {
        async frame(t) {
          await page.evaluate(SEEK, t)
          return page.screenshot({ type: 'png', omitBackground: true })
        },
        async capture(t, c) {
          const key = await page.evaluate(SEEK_KEY, t)
          if (c.lastKey !== undefined && key === c.lastKey) return { key, image: null }
          const cdpSession = await session()
          const params = { format: c.format, ...(c.format === 'jpeg' ? { quality: c.quality ?? 92 } : {}), optimizeForSpeed: true, captureBeyondViewport: false }
          // a frame the compositor does not give in time is asked again (twice); then the error is the node's to retry
          for (let attempt = 0; ; attempt++) {
            try {
              const shot = await withTimeout(cdpSession.send('Page.captureScreenshot', params), CAPTURE_MS, `photographing the frame at ${t.toFixed(2)} s`)
              return { key, image: Buffer.from(shot.data ?? '', 'base64') }
            } catch (e) {
              if (attempt >= 2) throw e
            }
          }
        },
        close: () => page.close()
      }
      return view
    },
    async close() {
      const b = browser
      browser = null
      if (b) await (await b.catch(() => null))?.close()
    }
  }
}

/**
 * A page of untrusted content (a custom brick, docs/ENGINE-SPEC.md §25.2), in its own browser context: offline, service workers blocked,
 * EVERY request aborted and reported (a `data:` or `blob:` URL is not a request; the page's own CSP blocks the rest first), console and
 * uncaught errors kept, a time budget to load and to draw each frame. A page that overruns is closed (its renderer with it) and the error is
 * permanent: the brick is wrong, not the machine.
 */
async function sandboxedPage(b: PwBrowser, o: { html: string; width: number; height: number; signal: AbortSignal; sandbox: BrowserSandbox }): Promise<BrowserPage> {
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, offline: true, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true })
  if (!page.route || !page.on) {
    await page.close().catch(() => undefined)
    throw new EngineError('missing_tool', 'Ce pilote de navigateur ne sait pas isoler une page : les briques sur mesure ne peuvent pas être dessinées ici.')
  }
  const found = { console: [] as string[], blocked: [] as string[] }
  await page.route('**/*', (route) => {
    if (found.blocked.length < 50) found.blocked.push(route.request().url().slice(0, 200))
    return route.abort('blockedbyclient').catch(() => undefined)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && found.console.length < 50) found.console.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => {
    if (found.console.length < 50) found.console.push(`uncaught: ${String(e.message).slice(0, 300)}`)
  })
  let dead = false
  const kill = (): void => {
    dead = true
    void page.close({ runBeforeUnload: false }).catch(() => undefined)
  }
  const within = async <T>(work: Promise<T>, ms: number, what: string): Promise<T> => {
    if (dead) throw new EngineError('bad_input', 'the page was closed after an earlier overrun')
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        kill()
        reject(new EngineError('bad_input', `${what} took more than ${ms} ms (a frame is drawn from t alone, quickly: no loop that never ends)`))
      }, ms)
    })
    try {
      return await Promise.race([work, late])
    } catch (e) {
      if (e instanceof EngineError) throw e
      throw new EngineError('bad_input', `${what} failed: ${String((e as Error).message).split('\n')[0]?.slice(0, 300) ?? ''}`)
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    if (o.signal.aborted) throw new AbortError()
    await within(page.setContent(o.html, { waitUntil: 'load', timeout: o.sandbox.loadMs + 1000 }), o.sandbox.loadMs, 'loading the page')
    await within(page.evaluate(() => document.fonts.ready.then(() => 0) as unknown as number), o.sandbox.loadMs, 'loading the fonts')
    const state = await within(
      page.evaluate(() => {
        const w = window as unknown as { atelierReady?: unknown; atelierError?: unknown }
        return { ready: w.atelierReady === true, error: typeof w.atelierError === 'string' ? w.atelierError : null }
      }),
      o.sandbox.loadMs,
      'starting the page'
    )
    if (state.error !== null || !state.ready) throw new EngineError('bad_input', `the page's script failed when it started: ${state.error ?? 'it never said it was ready'}`)
  } catch (e) {
    kill()
    throw e
  }
  return {
    async frame(t) {
      await within(page.evaluate(SEEK_SANDBOXED, t), o.sandbox.frameMs, `drawing the frame at ${t.toFixed(2)} s`)
      return within(page.screenshot({ type: 'png', omitBackground: true, timeout: o.sandbox.frameMs + 1000 }), o.sandbox.frameMs, `photographing the frame at ${t.toFixed(2)} s`)
    },
    problems: () => ({ console: [...found.console], blocked: [...found.blocked] }),
    inspect: () => within(page.evaluate<PageInspection>(INSPECT), o.sandbox.frameMs, 'measuring the text'),
    close: async () => {
      if (!dead) {
        dead = true
        await page.close({ runBeforeUnload: false }).catch(() => undefined)
      }
    }
  }
}
