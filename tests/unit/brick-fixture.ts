// Shared pieces of the custom-brick tests (docs/ENGINE-SPEC.md §25.2): a sample brick of ours (a « fiche personnage » card), its overflowing
// first try, a fake sandboxed browser (frames are small PNGs drawn or empty, the text layout is what the test says) and a fake ffmpeg that
// writes the file it is told to. No network, no model.
import { writeFile } from 'node:fs/promises'
import type { BrickInput } from '../../src/engine/formats/brick'
import { testPicture } from '../../src/engine/media/png'
import type { BrowserSandbox, BrowserService, MediaService, PageInspection, TextBox } from '../../src/engine/services'

export const CARD_CSS = [
  '.card{position:absolute;left:var(--safe-left);top:calc(var(--safe-bottom) - 250px);width:760px;height:220px;padding:26px 36px;border-radius:24px;background:rgba(14,17,24,0.94);border-left:8px solid var(--f-accent)}',
  '.kicker{font-size:28px;line-height:34px;color:var(--f-accent);text-transform:uppercase;letter-spacing:0.08em}',
  '.name{font-size:64px;line-height:76px;font-weight:700;white-space:nowrap;overflow:hidden}',
  '.role{font-size:34px;line-height:42px;color:rgba(255,255,255,0.82)}'
].join('\n')

export const CARD: Omit<BrickInput, 'version'> = {
  id: 'fiche-personnage',
  name: 'Fiche personnage',
  description: 'Présente une personne de l’histoire : son nom en grand, son rôle dessous, la couleur de la chaîne.',
  html: '<div class="card" data-anim="rise" data-at="0.1" data-dur="0.5" data-out="3.6"><div class="kicker">{{kicker}}</div><div class="name" data-fit="30">{{name}}</div><div class="role">{{role}}</div></div>',
  css: CARD_CSS,
  script: "var card = document.querySelector('.card');\nbrick.render = function (t) { card.style.borderLeftWidth = (4 + 8 * brick.ease.out(brick.at(t, 0.1, 0.6))).toFixed(1) + 'px'; };",
  fields: [
    { type: 'text', name: 'name', max: 40 },
    { type: 'text', name: 'role', max: 50, default: 'Témoin' },
    { type: 'text', name: 'kicker', max: 24, default: 'Personnage' },
    { type: 'color', name: 'accent', default: '#F5B700' }
  ],
  sample: { name: 'Élise Moreau', role: 'Gardienne du phare d’Ouessant' },
  seconds: { min: 2, max: 6 },
  use: { on: 'person', seconds: 4, bind: { name: 'name', role: 'role' }, max: 2 }
}

/** The first try: the name is set far too big and cut by its box (no fitting). */
export const CARD_OVERFLOW: Omit<BrickInput, 'version'> = {
  ...CARD,
  html: CARD.html.replace(' data-fit="30"', ''),
  css: CARD_CSS.replace('.name{font-size:64px;line-height:76px', '.name{font-size:150px;line-height:160px')
}

/** A text box the fake browser reports. */
export const box = (text: string, o: Partial<TextBox> = {}): TextBox => ({ text, x: 140, y: 600, w: 500, h: 70, fontPx: 64, color: 'rgb(255, 255, 255)', backing: 'rgba(14, 17, 24, 0.94)', shadow: false, clipped: false, opacity: 1, ...o })

/** What the fake browser lays out for a brick's page: a clipped name when its CSS sets it at 150 px. */
export function cardLayout(html: string): PageInspection {
  const big = html.includes('font-size:150px')
  return { texts: [box('Personnage', { fontPx: 28, y: 590, h: 34, color: 'rgb(245, 183, 0)' }), box('Élise Moreau', { clipped: big, fontPx: big ? 150 : 64, w: big ? 1100 : 420 }), box('Gardienne du phare', { fontPx: 34, y: 690, h: 42 })] }
}

export interface FakeBrickBrowser extends BrowserService {
  opened: { html: string; width: number; height: number; sandbox: BrowserSandbox | undefined }[]
  frames: number
  closed: number
}

/**
 * A sandboxed browser that draws nothing real: each frame is a 64×36 PNG with a filled rectangle (or empty when `empty` says so), its text
 * layout is `layout(html)`, its blocked requests `blocked`. `failAt` makes the frame at that time fail like an overrun does.
 */
export function fakeBrickBrowser(o: { layout?: (html: string) => PageInspection; empty?: (html: string, t: number) => boolean; blocked?: string[]; failAt?: number; failWith?: Error } = {}): FakeBrickBrowser {
  const b: FakeBrickBrowser = {
    opened: [],
    frames: 0,
    closed: 0,
    open: (req) => {
      b.opened.push({ html: req.html, width: req.width, height: req.height, sandbox: req.sandbox })
      return Promise.resolve({
        frame: (t: number) => {
          b.frames++
          if (o.failAt !== undefined && Math.abs(t - o.failAt) < 1e-6) return Promise.reject(o.failWith ?? new Error('frame failed'))
          return Promise.resolve(testPicture(64, 36, o.empty?.(req.html, t) ? null : { x: 4, y: 20, w: 30, h: 10 }))
        },
        inspect: () => Promise.resolve(o.layout?.(req.html) ?? { texts: [] }),
        problems: () => ({ console: [], blocked: o.blocked ?? [] }),
        close: () => {
          b.closed++
          return Promise.resolve()
        }
      })
    }
  }
  return b
}

/** An ffmpeg that answers the encoder checks, drains the piped frames and writes the file it was told to (its last argument). */
export function fakeMedia(): MediaService & { runs: string[][] } {
  const m = {
    runs: [] as string[][],
    async run(_tool: 'ffmpeg' | 'ffprobe', args: string[], opts: { stdin?: AsyncIterable<Uint8Array> | Uint8Array }) {
      if (args.includes('-filters')) return { stdout: Buffer.from(' T.. scale  Scale\n'), stderr: '' }
      if (args.includes('-encoders')) return { stdout: Buffer.from(' V....D prores_ks   Apple ProRes (iCodec Pro)\n'), stderr: '' }
      m.runs.push(args)
      let n = 0
      if (opts.stdin && !(opts.stdin instanceof Uint8Array)) for await (const _frame of opts.stdin) n++
      await writeFile(args.at(-1) as string, `file of ${n} frames`)
      return { stdout: Buffer.alloc(0), stderr: '' }
    },
    stream: () => {
      throw new Error('not used')
    }
  }
  return m
}
