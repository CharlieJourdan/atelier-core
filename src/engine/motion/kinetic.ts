// Kinetic typography (docs/ENGINE-SPEC.md §25, motion-montage): the spoken words set on the picture, each entering ON its time. An overlay,
// transparent unless the spec asks for a scrim or a solid slate. The words are cut into lines (about 18 characters in a film, 12 in a
// short) and the lines into screens of three at most; a screen clears when the next one starts. Five ways to enter: pop, slam, stack
// (lines pushed up by the newer ones), typewriter (letter by letter) and highlight (all set, a box wipes behind each word on its time).
import type { KineticProps } from '../formats/motion'
import { contrast, esc, outAt, pick, zone, type MotionCtx, type Theme } from './base'
import type { Part } from './cards'
import { FONT } from './doc-common'
import { facesOf, lookTexture, paperSheet, rgba, vignetteOf, type PaperLook } from './look'

type Word = KineticProps['words'][number]

export interface KLine {
  /** The words of the line with their index in the spec's list. */
  words: { w: Word; i: number }[]
}
export interface KScreen {
  lines: KLine[]
  /** The first and the last word's time. */
  first: number
  last: number
}

/** A pause this long (seconds) between two words starts a new screen. */
export const SCREEN_GAP_S = 1.4
/** How many characters a line takes (an emphasised word counts 1.25 times its length). */
export const maxChars = (c: MotionCtx): number => pick(c, 18, 12)

const charsOf = (w: Word): number => w.text.length * (w.emphasis ? 1.25 : 1)

/** The words cut into screens of lines: a new line when the next word would pass the width, a new screen after a long pause, after a sentence or four lines. */
export function kineticScreens(words: readonly Word[], max: number, maxLines = 3): KScreen[] {
  const screens: KScreen[] = []
  let cur: KScreen | null = null
  let len = 0
  words.forEach((w, i) => {
    const prev = words[i - 1]
    const fresh = !cur || (prev !== undefined && (w.atS - prev.atS > SCREEN_GAP_S || /[.!?…]["»”)]*$/.test(prev.text)))
    if (fresh || !cur) {
      cur = { lines: [{ words: [{ w, i }] }], first: w.atS, last: w.atS }
      screens.push(cur)
      len = charsOf(w)
      return
    }
    if (len + 1 + charsOf(w) > max) {
      if (cur.lines.length >= maxLines) {
        cur = { lines: [{ words: [{ w, i }] }], first: w.atS, last: w.atS }
        screens.push(cur)
      } else cur.lines.push({ words: [{ w, i }] })
      len = charsOf(w)
      return
    }
    ;(cur.lines.at(-1) as KLine).words.push({ w, i })
    cur.last = w.atS
    len += 1 + charsOf(w)
  })
  return screens
}

/** When each screen clears: just before the next one starts, at most 2.4 s after its last word and at least 0.3 s after it; the last one at the overlay's way out. */
export function screenOuts(screens: readonly KScreen[], c: MotionCtx): number[] {
  return screens.map((s, k) => {
    const next = screens[k + 1]
    return next ? Math.max(Math.min(next.first - 0.12, s.last + 2.4), s.last + 0.3) : Math.min(outAt(c), s.last + 2.4)
  })
}

const f = (n: number): string => n.toFixed(2)
const mixWhite = (hex: string, k: number): string => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('')
/** The accent made lighter in small steps until it reads on a dark backing (4.5:1). */
function liftOnDark(accent: string, bg: string): string {
  let out = accent
  for (let k = 0; k < 20 && contrast(out, bg) < 4.5; k++) out = mixWhite(accent, (k + 1) * 0.05)
  return out
}

/** The word's markup in a style; `at` is its spoken time, `gap` the time to the next word of the film. */
function wordHtml(w: Word, style: KineticProps['style'], gap: number): string {
  const em = w.emphasis ? ' em' : ''
  const text = esc(w.text)
  switch (style) {
    case 'pop':
      return `<span class="wd${em}" data-anim="pop" data-at="${f(w.atS)}" data-dur="${w.emphasis ? 0.38 : 0.3}" data-dy="22">${text}</span>`
    case 'slam':
      return `<span class="wd${em}" data-anim="slam" data-at="${f(w.atS)}" data-dur="0.4" data-dy="${w.emphasis ? 26 : 14}">${text}</span>`
    case 'stack':
      return `<span class="wd${em}" data-anim="rise" data-at="${f(w.atS)}" data-dur="0.32" data-dy="26">${text}</span>`
    case 'typewriter': {
      const letters = [...w.text]
      const total = Math.min(0.35, Math.max(0.08, gap * 0.9))
      const step = total / letters.length
      return `<span class="wd${em}">${letters.map((ch, k) => `<span class="lt" data-anim="fade" data-at="${f(w.atS + k * step)}" data-dur="0.03">${esc(ch)}</span>`).join('')}</span>`
    }
    case 'highlight':
      return `<span class="wd${em}"><i class="bx" data-anim="wipe" data-at="${f(w.atS)}" data-dur="0.2" data-ease="linear"></i><span class="tx">${text}</span></span>`
  }
}

export function kinetic(p: KineticProps, c: MotionCtx, t: Theme, accent: string, look: PaperLook | null = null): Part {
  if (look) return paperKinetic(p, c, look)
  const z = zone(c)
  const screens = kineticScreens(p.words, maxChars(c))
  const outs = screenOuts(screens, c)
  const end = outAt(c)
  const solid = p.background === 'solid'
  const emphasis = t.dark ? liftOnDark(accent, solid ? '#0b0e14' : '#000000') : t.chip
  const justify = { center: 'center', upper: 'flex-start', lower: 'flex-end' }[p.position]
  const shadow = solid ? '' : t.dark ? 'text-shadow:0 3px 26px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.7);' : 'text-shadow:0 2px 22px rgba(255,255,255,.8),0 1px 2px rgba(255,255,255,.7);'
  const sizeOf = (lines: number): number => pick(c, [150, 136, 120], [128, 116, 104])[Math.min(3, lines) - 1] as number
  const boxBg = t.dark ? 'rgba(14,17,24,.86)' : 'rgba(255,255,255,.92)'

  const body = screens
    .map((s, k) => {
      const size = sizeOf(s.lines.length)
      const lh = Math.round(size * 1.2)
      const gapOf = (i: number): number => {
        const nx = p.words[i + 1]
        return nx ? nx.atS - (p.words[i] as Word).atS : 0.5
      }
      const lineHtml = (l: KLine): string => `<div class="ln">${l.words.map(({ w, i }) => wordHtml(w, p.style, gapOf(i))).join('')}</div>`
      let inner: string
      if (p.style === 'stack' && s.lines.length > 1) {
        // every line enters at the bottom slot and is pushed up one slot by each newer line
        const n = s.lines.length
        inner = `<div class="stk" style="height:${n * lh}px">${s.lines
          .map((l, j) => {
            const pushes = s.lines.slice(j + 1).map((m) => (m.words[0] as { w: Word }).w.atS - 0.05)
            const open = pushes.map((at) => `<div class="pw" data-anim="shift" data-at="${f(at)}" data-dur="0.3" data-dy="${-lh}">`).join('')
            return `<div class="slot" style="top:${(n - 1) * lh}px;height:${lh}px">${open}${lineHtml(l)}${'</div>'.repeat(pushes.length)}</div>`
          })
          .join('')}</div>`
      } else inner = s.lines.map(lineHtml).join('')
      return `<div class="scr" style="font-size:${size}px;--lh:${lh}px" data-fit="40" data-anim="fade" data-at="${f(Math.max(0, s.first - 0.1))}" data-dur="0.08" data-out="${f(outs[k] as number)}" data-out-dur="0.2" data-dy="26">${inner}</div>`
    })
    .join('\n')

  const backing =
    p.background === 'scrim'
      ? `<div class="back" style="background:var(--scrim)" data-anim="fade" data-at="0" data-dur="0.3" data-out="${f(end)}"></div>`
      : solid
        ? `<div class="back" style="background:${t.dark ? 'radial-gradient(ellipse 80% 70% at 50% 42%,#171c27 0%,#0a0d13 78%)' : 'radial-gradient(ellipse 80% 70% at 50% 42%,#f8f5ee 0%,#e9e4d8 80%)'}" data-anim="fade" data-at="0" data-dur="0.15" data-out="${f(end)}"></div>`
        : ''

  return {
    css: `
.back{position:absolute;inset:0}
.kz{position:absolute;inset:0;font-family:${p.face === 'serif' ? FONT.serif : `'Oswald','Inter','Segoe UI','Helvetica Neue',Arial,sans-serif`};font-weight:${p.face === 'serif' ? 600 : 700};color:var(--fg)}
.scr{position:absolute;left:${z.left}px;top:${z.top}px;width:${z.width}px;height:${z.height}px;display:flex;flex-direction:column;justify-content:${justify};align-items:center;line-height:1.15;letter-spacing:.015em;${p.case === 'upper' ? 'text-transform:uppercase;' : ''}${shadow}}
.ln{display:flex;justify-content:center;align-items:baseline;gap:.26em;white-space:nowrap;width:100%}
.wd{display:inline-block;position:relative;white-space:nowrap}
.wd.em{font-size:1.25em;line-height:.9;color:${emphasis}}
.stk{position:relative;width:100%}
.slot{position:absolute;left:0;width:100%}
.pw{width:100%;height:100%}
.slot .ln{height:100%;align-items:center}
.bx{position:absolute;left:-.14em;right:-.14em;top:.02em;bottom:-.04em;border-radius:.12em;background:${boxBg};box-shadow:0 .06em .3em rgba(0,0,0,.25)}
.em .bx{background:${t.chip}}
.tx{position:relative}
.em .tx{color:${t.chipText}}
${p.style === 'highlight' ? '.scr{text-shadow:none}' : ''}`,
    body: `${backing}<div class="kz">\n${body}\n</div>`
  }
}

// ---- the paper looks (motion look, look.ts) -------------------------------------------------------------------------------------------

/** A word in a paper look: calm entries (a fade that rises a little; `slam` becomes an ink stamp that lands without shaking; `highlight` a
 *  hatched rule drawn under the word). */
function paperWordHtml(w: Word, style: KineticProps['style'], gap: number): string {
  const em = w.emphasis ? ' em' : ''
  const text = esc(w.text)
  switch (style) {
    case 'pop':
      return `<span class="wd${em}" data-anim="rise" data-at="${f(Math.max(0, w.atS - 0.05))}" data-dur="0.55" data-dy="14">${text}</span>`
    case 'slam':
      // the slam's scale (1.6× down to 1 in the first 55 % of its time) with no shake (dy 0): a stamp pressed on the page
      return `<span class="wd${em}" data-anim="slam" data-at="${f(w.atS)}" data-dur="0.3" data-dy="0">${text}</span>`
    case 'stack':
      return `<span class="wd${em}" data-anim="rise" data-at="${f(Math.max(0, w.atS - 0.05))}" data-dur="0.5" data-dy="20">${text}</span>`
    case 'typewriter': {
      const letters = [...w.text]
      const total = Math.min(0.35, Math.max(0.08, gap * 0.9))
      const step = total / letters.length
      return `<span class="wd${em}">${letters.map((ch, k) => `<span class="lt" data-anim="fade" data-at="${f(w.atS + k * step)}" data-dur="0.06">${esc(ch)}</span>`).join('')}</span>`
    }
    case 'highlight':
      return `<span class="wd${em}"><i class="bx" data-anim="wipe" data-at="${f(w.atS)}" data-dur="0.35" data-ease="linear"></i><span class="tx">${text}</span></span>`
  }
}

/**
 * Kinetic type in a paper look: the words in the look's ink and display face, no glow. With no backing, each screen is set on a label of the
 * look's paper (its texture, a thin double ink frame) laid on the picture; `scrim` washes the whole picture with the paper; `solid` is a
 * sheet of it. Stressed words in the look's accent (in italic, with a serif).
 */
function paperKinetic(p: KineticProps, c: MotionCtx, l: PaperLook): Part {
  const z = zone(c)
  const screens = kineticScreens(p.words, maxChars(c))
  const outs = screenOuts(screens, c)
  const end = outAt(c)
  const faces = facesOf(l)
  // a paper look sets the words on a label of its paper, over the picture or over a wash of it; only a solid sheet takes bare words
  const label = p.background !== 'solid'
  const justify = { center: 'center', upper: 'flex-start', lower: 'flex-end' }[p.position]
  const upper = p.case === 'upper'
  const sizeOf = (lines: number): number => pick(c, [140, 126, 112], [118, 108, 98])[Math.min(3, lines) - 1] as number
  // a line's width in em, for the label behind stacked lines (they sit in absolute slots that do not size it)
  const emOf = (n: number): number => n * (faces.weight === 400 ? (upper ? 0.62 : 0.46) : upper ? 0.58 : 0.5)

  const body = screens
    .map((s, k) => {
      const size = sizeOf(s.lines.length)
      const lh = Math.round(size * 1.18)
      const gapOf = (i: number): number => {
        const nx = p.words[i + 1]
        return nx ? nx.atS - (p.words[i] as Word).atS : 0.5
      }
      const lineHtml = (ln: KLine): string => `<div class="ln">${ln.words.map(({ w, i }) => paperWordHtml(w, p.style, gapOf(i))).join('')}</div>`
      let inner: string
      if (p.style === 'stack' && s.lines.length > 1) {
        const n = s.lines.length
        const widest = Math.max(...s.lines.map((ln) => ln.words.reduce((a, { w }) => a + w.text.length * (w.emphasis ? 1.18 : 1) + 1, -1)))
        inner = `<div class="stk" style="height:${n * lh}px;width:${emOf(widest).toFixed(2)}em">${s.lines
          .map((ln, j) => {
            const pushes = s.lines.slice(j + 1).map((m) => (m.words[0] as { w: Word }).w.atS - 0.05)
            const open = pushes.map((at) => `<div class="pw" data-anim="shift" data-at="${f(at)}" data-dur="0.45" data-dy="${-lh}">`).join('')
            return `<div class="slot" style="top:${(n - 1) * lh}px;height:${lh}px">${open}${lineHtml(ln)}${'</div>'.repeat(pushes.length)}</div>`
          })
          .join('')}</div>`
      } else inner = s.lines.map(lineHtml).join('')
      const set = label ? `<div class="card">${lookTexture(l, 'ctx', `k${k}`)}${inner}</div>` : inner
      return `<div class="scr" style="font-size:${size}px;--lh:${lh}px" data-fit="40" data-anim="fade" data-at="${f(Math.max(0, s.first - 0.35))}" data-dur="0.3" data-out="${f(outs[k] as number)}" data-out-dur="0.4" data-dy="0">${set}</div>`
    })
    .join('\n')

  const sheet = paperSheet(l, 'back')
  const backing =
    p.background === 'scrim'
      ? `<div class="back wash" data-anim="fade" data-at="0" data-dur="0.5" data-out="${f(end)}">${sheet.body}</div>`
      : p.background === 'solid'
        ? `<div class="back" data-anim="fade" data-at="0" data-dur="0.3" data-out="${f(end)}">${sheet.body}</div>`
        : ''
  const italic = l.type === 'serif' ? 'font-style:italic;' : ''
  const hatch = (col: string): string => `repeating-linear-gradient(135deg,${col} 0 1.5px,transparent 1.5px 6px)`

  return {
    css: `${sheet.css}
.back.wash{background:${rgba(l.paper, 0.45)}}
.back.wash .lvg{background:${l.texture === 'none' ? 'none' : `radial-gradient(ellipse 80% 78% at 50% 48%,transparent 40%,${rgba(l.paperDeep, 0.6)} 100%)`}}
.kz{position:absolute;inset:0;font-family:${faces.display};font-weight:${faces.weight};color:${l.ink}}
.scr{position:absolute;left:${z.left}px;top:${z.top}px;width:${z.width}px;height:${z.height}px;display:flex;flex-direction:column;justify-content:${justify};align-items:center;line-height:1.12;letter-spacing:${upper ? '.05em' : '.005em'};${upper ? 'text-transform:uppercase;' : ''}}
.card{position:relative;display:flex;flex-direction:column;align-items:center;max-width:100%;padding:.2em .72em .28em;background:${l.tag};border:1px solid ${rgba(l.ink, 0.7)};box-shadow:0 18px 44px rgba(18,10,2,.42),0 2px 6px rgba(18,10,2,.3)}
.card .ctx{position:absolute;left:0;top:0;mix-blend-mode:multiply;pointer-events:none}
.card::after{content:"";position:absolute;inset:0;pointer-events:none;background:${vignetteOf(l)}}
.card::before{content:"";position:absolute;inset:14px;pointer-events:none;border:2px solid ${l.ink};outline:1px solid ${rgba(l.ink, 0.75)};outline-offset:4px}
.ln{position:relative;z-index:1;display:flex;justify-content:center;align-items:baseline;gap:.24em;white-space:nowrap;width:100%}
.wd{display:inline-block;position:relative;white-space:nowrap}
.wd.em{font-size:1.18em;line-height:.9;color:${l.accent};${italic}}
.stk{position:relative;z-index:1;max-width:100%}
.slot{position:absolute;left:0;width:100%}
.pw{width:100%;height:100%}
.slot .ln{height:100%;align-items:center}
.bx{position:absolute;left:0;right:0;bottom:.02em;height:.13em;border-top:2px solid ${l.ink};background:${hatch(l.ink)}}
.em .bx{border-color:${l.accent};background:${hatch(l.accent)}}
.tx{position:relative}`,
    body: `${backing}<div class="kz">\n${body}\n</div>`
  }
}
