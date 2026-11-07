// The prints board (formats/cards.ts `prints`, clone-markets-2): several white-bordered prints dropped one by one on a dark slate, a
// cream paper or a kraft file folder (the « dossier » look: its labels and bars are red rubber stamps), each on its word, each with its label (typed on black tape, a torn white strip, or a black serif box), and red quote bars
// that wipe in over them. Measured on the reference's first three minutes: prints land on their word, labels ≈ 0.5 s later, typed
// labels at ≈ 20 letters a second, a red bar wipes in in ≈ 0.4 s; the board holds 3–11 s with no camera move beyond a slight push.
import { DOC_PALETTE, type CardAssets, type PrintsCardProps } from '../formats/cards'
import { esc, pick, seeded, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { tornClip } from './doc-board'
import { FONT, PICTURE_CSS, aspectOfPicture, cameraAttrs, f2, fitBox, originOf, pictureTag, tiltOf } from './doc-common'

/** The typewriter face of the tape labels (a system monospace: nothing to bundle). */
const MONO = "'Courier Prime','Courier New',Courier,monospace"
/** Seconds per typed letter (≈ 20 a second, measured on « TO BE ARRESTED »). */
export const TYPE_STEP_S = 0.05

/** Seconds the first print takes to glide to its place on the board (36J1 shots 323, 325, 337: 1–1.7 s). */
export const REFLOW_S = 1.3

/** The frames of a film inside a print: all decoded in the page, the runtime shows one at a time. */
const flipTag = (frames: readonly string[], fps: number, colour: boolean): string =>
  `<div class="pflip" data-flip="${fps}">${frames.map((u, i) => `<img class="pimg${colour ? ' col' : ''}" alt="" src="${u}" style="opacity:${i === 0 ? 1 : 0}">`).join('')}</div>`

interface Slot {
  x: number
  y: number
  w: number
  h: number
  tilt: number
}

/**
 * Where each print sits, at the reference's measured sizes (clone-markets-2, round 2): one or two prints are large (up to 62 % of the
 * height, centred at 30 % and 70 % of the width, the right side left free for a box label or a quote bar when there is one print);
 * three prints share the width (29 % each, zigzag); four are a row of 21 %; five to eight are two rows (the first the longer).
 */
export function printSlots(aspects: readonly number[], c: MotionCtx, seed: string, layout: PrintsCardProps['layout'] = 'auto'): Slot[] {
  const n = aspects.length
  const portrait = c.height > c.width
  const rows = n <= 4 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)]
  const rnd = seeded('prints|' + seed)
  const out: Slot[] = []
  // documentary-2: a lone print centred (≈ 42 % of the width) or large (≈ 62 %), measured on the reference's boards
  if (n === 1 && !portrait && (layout === 'centre' || layout === 'large')) {
    const big = layout === 'large'
    const box = fitBox(aspects[0] ?? 1.5, c.width * (big ? 0.62 : 0.42), c.height * (big ? 0.8 : 0.64))
    const cx = c.width * 0.5
    const cy = c.height * (big ? 0.47 : 0.45)
    return [{ x: Math.round(cx - box.w / 2), y: Math.round(cy - box.h / 2), w: box.w, h: box.h, tilt: tiltOf(`${seed}|0`, big ? 1.4 : 2.2) }]
  }
  if (n <= 2 && !portrait) {
    const centres = n === 1 ? [0.3] : [0.3, 0.7]
    aspects.forEach((a, i) => {
      const box = fitBox(a, c.width * 0.42, c.height * 0.62)
      const cx = c.width * (centres[i] ?? 0.5)
      const cy = c.height * (0.43 + (i === 1 ? 0.01 : 0))
      out.push({ x: Math.round(cx - box.w / 2), y: Math.round(cy - box.h / 2), w: box.w, h: box.h, tilt: tiltOf(`${seed}|${i}`, 2.2) })
    })
    return out
  }
  const marginX = c.width * 0.025
  const cols = Math.max(...rows)
  const cellW = (c.width - 2 * marginX) / cols
  const rowH = c.height * (rows.length > 1 ? 0.42 : n === 3 ? 0.62 : 0.56)
  const top = c.height * (rows.length > 1 ? 0.05 : n === 3 ? 0.12 : 0.18)
  let k = 0
  rows.forEach((count, r) => {
    // a short second row is centred under the first
    const x0 = (c.width - cellW * count) / 2
    for (let i = 0; i < count; i++, k++) {
      const box = fitBox(aspects[k] ?? 1.5, cellW * 0.9, rowH * (n === 3 ? 0.62 : 0.72))
      const stagger = n === 3 ? ([-0.12, 0.12, -0.04][i] ?? 0) : (rnd() - 0.5) * 0.05
      const cx = x0 + cellW * (i + 0.5)
      const cy = top + r * rowH + rowH * (0.42 + stagger)
      out.push({ x: Math.round(cx - box.w / 2), y: Math.round(Math.max(4, cy - box.h / 2)), w: box.w, h: box.h, tilt: tiltOf(`${seed}|${k}`, 2.6) })
    }
  })
  return out
}

/** A typed label: one span per letter, each appearing on its own beat from `at`. */
function typed(text: string, at: number): string {
  return [...typo(text).toUpperCase()]
    .map((ch, i) => (ch === ' ' ? ' ' : `<span data-anim="fade" data-at="${f2(at + i * TYPE_STEP_S)}" data-dur="0.02">${esc(ch)}</span>`))
    .join('')
}

/** The page of a prints board. */
export function printsCard(p: PrintsCardProps, c: MotionCtx, assets: CardAssets): Part {
  const paper = p.surface !== 'slate'
  const manila = p.surface === 'manila'
  const D = c.durationS
  const pics = p.prints.map((_, i) => assets.pictures?.[i])
  const seed = p.prints.map((x) => x.label ?? '').join('|') || 'prints'
  // a lone print with texts beside it or a bar sits on the left third (the side layout); without, it is centred
  const layout = p.layout !== 'auto' ? p.layout : p.prints.length !== 1 ? 'auto' : p.side.length > 0 || p.bars.length > 0 ? 'side' : 'centre'
  const slots = printSlots(
    pics.map((u) => aspectOfPicture(u)),
    c,
    seed,
    layout
  )
  // the reference's boards of two to four: the first print sits large and alone, and glides to its place as the next one lands
  const secondAt = p.prints[1]?.atS
  const reflowAt = p.reflow && p.prints.length >= 2 && secondAt !== undefined && secondAt >= 1.2 ? secondAt - 0.15 : null
  const prints = p.prints
    .map((pr, i) => {
      const s = slots[i] as Slot
      const border = Math.max(8, Math.round(Math.max(s.w, s.h) * 0.03))
      const at = pr.atS ?? 0.15 + i * 0.6
      const labelAt = pr.labelAtS ?? at + 0.5
      const label = !pr.label
        ? ''
        : pr.tag === 'torn'
          ? `<div class="pl below" data-anim="rise" data-at="${f2(labelAt)}" data-dur="0.35" data-dy="10"><div class="torn" style="clip-path:${tornClip(pr.label)}"><div class="tt" data-fit="14">${esc(typo(pr.label))}</div>${pr.sub ? `<div class="ts" data-fit="10">${esc(typo(pr.sub))}</div>` : ''}</div></div>`
          : pr.tag === 'stamp'
            ? `<div class="pl below"><div class="stamp" style="transform:rotate(${(tiltOf(pr.label, 4) - 3).toFixed(1)}deg)" data-anim="pop" data-at="${f2(labelAt)}" data-dur="0.22">${esc(typo(pr.label).toUpperCase())}</div></div>`
          : pr.tag === 'box'
            ? `<div class="pl ${p.prints.length > 2 ? 'below' : (p.prints.length === 2 && i === 1) || layout === 'centre' || layout === 'large' ? 'corner' : 'side'}" data-anim="wipe" data-at="${f2(labelAt)}" data-dur="0.45"><div class="bx"><div class="bt" data-fit="16">${esc(typo(pr.label))}</div>${pr.sub ? `<div class="bs" data-fit="11">${esc(typo(pr.sub))}</div>` : ''}</div></div>`
            : `<div class="pl below"><div class="tape" data-anim="fade" data-at="${f2(labelAt)}" data-dur="0.12">${typed(pr.label, labelAt + 0.1)}</div></div>`
      const film = pr.film ? assets.films?.[i] : undefined
      const inside = film && film.length > 1 ? flipTag(film, assets.filmFps ?? 10, pr.colour) : pictureTag(pics[i], pr.colour ? 'pimg col' : 'pimg')
      const one = `<div class="pw" style="left:${s.x - border}px;top:${s.y - border}px;width:${s.w + 2 * border}px;height:${s.h + 2 * border}px" data-anim="drop" data-at="${f2(at)}" data-dur="0.4" data-dy="70"><div class="pt" style="transform:rotate(${s.tilt}deg)"><div class="print" style="padding:${border}px">${inside}</div></div>${label}</div>`
      if (i > 0 || reflowAt === null) return one
      const box = fitBox(aspectOfPicture(pics[0]), c.width * 0.5, c.height * 0.72)
      const cx = s.x + s.w / 2
      const cy = s.y + s.h / 2
      return `<div class="prf" style="transform-origin:${Math.round(cx)}px ${Math.round(cy)}px" data-reframe="${(c.width / 2 - cx).toFixed(1)},${(c.height * 0.46 - cy).toFixed(1)},${(box.w / s.w).toFixed(4)}" data-at="${f2(reflowAt)}" data-dur="${f2(REFLOW_S)}">${one}</div>`
    })
    .join('')
  // the extra tags: typed under the row, right of the last print
  const last = slots[slots.length - 1] as Slot
  const step = last.w + c.width * 0.04
  const extras = p.extraTags
    .map((t, i) => `<div class="pl free" style="left:${Math.round(last.x + step * (i + 1))}px;top:${Math.round(last.y + last.h + 22)}px;width:${last.w}px"><div class="tape" data-anim="fade" data-at="${f2(t.atS ?? D * 0.6)}" data-dur="0.12">${typed(t.label, (t.atS ?? D * 0.6) + 0.1)}</div></div>`)
    .join('')
  // red bars: over a print, beside a lone print, or across the board
  // (each bar is kept inside its room — a print's width plus its gutter, the free side, the board — and made smaller until it fits: two
  // long bars over neighbouring prints never run into each other, documentary-2)
  const lone = slots.length === 1 ? (slots[0] as Slot) : undefined
  const sideX = lone ? Math.round(lone.x + lone.w + c.width * 0.035) : 0
  const sideW = lone ? Math.max(120, Math.round(c.width - sideX - c.width * 0.03)) : 0
  const bars = p.bars
    .map((b, i) => {
      const at = f2(b.atS ?? D * 0.5)
      const over = b.over !== undefined ? slots[b.over] : undefined
      const room = over ? Math.round(over.w + c.width * 0.02) : lone ? sideW : Math.round(c.width * 0.9)
      const style = over
        ? `left:${Math.round(over.x + over.w / 2)}px;top:${Math.round(over.y - pick(c, 34, 30))}px;transform:translateX(-50%)`
        : lone
          ? `left:${sideX}px;top:${Math.round(lone.y + lone.h * 0.42 + i * 70)}px`
          : `left:50%;top:${Math.round(c.height * 0.12 + i * 70)}px;transform:translateX(-50%)`
      return manila
        ? `<div class="barw" style="${style}"><div class="stamp big" style="transform:rotate(${(tiltOf(b.text, 4) - 2).toFixed(1)}deg)" data-anim="pop" data-at="${at}" data-dur="0.22">${esc(typo(b.text).toUpperCase())}</div></div>`
        : `<div class="barw" style="${style}"><div class="bar" data-anim="wipe" data-at="${at}" data-dur="0.4" data-fit="14" style="max-width:${room}px">${esc(typo(b.text).toUpperCase())}</div></div>`
    })
    .join('')
  // documentary-2: the texts beside a lone print (a big figure, a typed date, a box label, plain words), stacked in the free side
  const side = lone
    ? p.side
        .map((t, i) => {
          const at = t.atS ?? 0.8 + i * 0.7
          const top = Math.round(lone.y + lone.h * (p.side.length === 1 ? 0.36 : 0.16 + i * 0.3))
          const inner =
            t.kind === 'number'
              ? `<div class="snum" data-anim="blur" data-at="${f2(at)}" data-dur="0.6" data-dy="14" data-blur="8"><div class="sb" data-fit="20" style="max-width:${sideW}px">${esc(typo(t.text))}</div>${t.sub ? `<div class="ss" data-fit="12" style="max-width:${sideW}px">${esc(typo(t.sub))}</div>` : ''}</div>`
              : t.kind === 'date'
                ? `<div class="dbox" data-anim="fade" data-at="${f2(at)}" data-dur="0.12">${typed(t.text, at + 0.08)}</div>`
                : t.kind === 'box'
                  ? `<div data-anim="wipe" data-at="${f2(at)}" data-dur="0.45"><div class="bx" style="max-width:${sideW}px"><div class="bt" data-fit="16">${esc(typo(t.text))}</div>${t.sub ? `<div class="bs" data-fit="11">${esc(typo(t.sub))}</div>` : ''}</div></div>`
                  : `<div class="swords" data-anim="fade" data-at="${f2(at)}" data-dur="0.5" data-fit="16" style="max-width:${sideW}px">${esc(typo(t.text))}</div>`
          return `<div class="pl free" style="left:${sideX}px;top:${top}px;width:${sideW}px;justify-content:flex-start">${inner}</div>`
        })
        .join('')
    : ''
  // documentary-2: a typed date at the top left corner of the first print
  const first = slots[0] as Slot
  const dateAt = p.date ? (p.date.atS ?? (p.prints[0]?.atS ?? 0.15) + 0.5) : 0
  const date = p.date
    ? `<div class="pl free" style="left:${Math.round(first.x - pick(c, 30, 20))}px;top:${Math.round(first.y - pick(c, 34, 30))}px;justify-content:flex-start"><div class="dbox" data-anim="fade" data-at="${f2(dateAt)}" data-dur="0.12">${typed(p.date.text, dateAt + 0.08)}</div></div>`
    : ''
  const bg = manila
    ? 'radial-gradient(ellipse 90% 85% at 50% 42%,#d8b77e 0%,#c9a265 58%,#9c7742 100%)'
    : paper
    ? 'radial-gradient(ellipse 90% 85% at 50% 45%,#ece4d2 0%,#ddd3bd 62%,#bdb29b 100%)'
    : `radial-gradient(ellipse 85% 80% at 50% 42%,#4a4744 0%,#353230 48%,${DOC_PALETTE.slateDeep} 100%)`
  return {
    css: `${PICTURE_CSS}
.prw{position:absolute;inset:0;overflow:hidden;background:${bg}}
.prw .stage{position:absolute;inset:0;transform-origin:${p.move === 'still' || p.move === 'settle' ? '50% 50%' : originOf(p.move)}}
.prf{position:absolute;inset:0}
.pflip{position:relative;width:100%;height:100%;overflow:hidden}
.pflip .pimg{position:absolute;inset:0;filter:grayscale(1) contrast(1.5) brightness(.9)}
.pw{position:absolute}
.pt{position:absolute;inset:0}
.print{position:absolute;inset:0;background:#f4f1ea;box-shadow:${paper ? '0 16px 30px rgba(60,40,15,.32),0 3px 8px rgba(60,40,15,.3)' : '0 22px 44px rgba(0,0,0,.6),0 5px 12px rgba(0,0,0,.45)'}}
.pimg{display:block;width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.12) brightness(.98)}
.pl{position:absolute;display:flex;justify-content:center}
.pl.below{left:-20%;right:-20%;top:calc(100% + ${pick(c, 16, 14)}px)}
.pl.side{left:calc(100% + ${pick(c, 28, 20)}px);top:22%;justify-content:flex-start}
.pl.corner{right:-4%;top:-5%;justify-content:flex-end}
.pl.free{justify-content:center}
.tape{background:#141210;color:#e9e4da;font-family:${MONO};font-weight:700;font-size:${pick(c, 23, 20)}px;letter-spacing:.16em;padding:${pick(c, 6, 5)}px ${pick(c, 14, 12)}px;white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,.5)}
.torn{background:#f4f1ea;color:#0d0c0b;padding:${pick(c, 12, 10)}px ${pick(c, 30, 24)}px ${pick(c, 13, 11)}px;text-align:center;filter:drop-shadow(0 5px 6px rgba(0,0,0,.5));max-width:${Math.round(c.width * 0.34)}px}
.torn .tt{font-family:${FONT.serif};font-weight:500;font-size:${pick(c, 40, 32)}px;line-height:1.15;white-space:nowrap;overflow:hidden}
.torn .ts{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 21, 18)}px;color:#55514a;white-space:nowrap;overflow:hidden}
.bx{background:rgba(8,7,6,.9);padding:${pick(c, 10, 9)}px ${pick(c, 20, 16)}px ${pick(c, 12, 10)}px;box-shadow:0 8px 20px rgba(0,0,0,.4);max-width:${Math.round(c.width * 0.34)}px}
.bx .bt{font-family:${FONT.serif};font-weight:400;font-size:${pick(c, 40, 30)}px;line-height:1.15;color:#fff;white-space:nowrap;overflow:hidden;text-transform:uppercase;letter-spacing:.02em}
.bx .bs{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 22, 18)}px;color:#b9b3a9;white-space:nowrap;overflow:hidden;margin-top:2px}
.stamp{display:inline-block;color:#b3261e;border:4px solid #b3261e;border-radius:6px;font-family:${FONT.cond};font-weight:700;font-size:${pick(c, 30, 26)}px;letter-spacing:.14em;line-height:1;padding:${pick(c, 8, 7)}px ${pick(c, 16, 14)}px ${pick(c, 7, 6)}px;white-space:nowrap;mix-blend-mode:multiply;opacity:.92;-webkit-mask-image:radial-gradient(circle at 30% 40%,#000 55%,rgba(0,0,0,.72) 75%,#000 100%)}
.stamp.big{font-size:${pick(c, 46, 40)}px;border-width:5px}
.barw{position:absolute;white-space:nowrap}
.bar{display:inline-block;overflow:hidden;background:${DOC_PALETTE.red};color:#fff;font-family:${FONT.serif};font-weight:500;font-size:${pick(c, 38, 30)}px;letter-spacing:.03em;line-height:1.1;padding:${pick(c, 8, 7)}px ${pick(c, 16, 14)}px ${pick(c, 9, 8)}px;box-shadow:0 8px 18px rgba(0,0,0,.45)}
.pimg.col{filter:contrast(1.04)}
.dbox{display:inline-block;background:rgba(10,9,8,.92);color:#f2efe9;font-family:${FONT.serif};font-size:${pick(c, 28, 26)}px;letter-spacing:.06em;padding:6px ${pick(c, 14, 12)}px 7px;box-shadow:0 6px 16px rgba(0,0,0,.45);white-space:nowrap}
.snum{color:${paper ? '#1d1a17' : '#f4f1ea'};font-family:${FONT.serif};text-align:left;${paper ? '' : 'text-shadow:0 3px 14px rgba(0,0,0,.6);'}}
.snum .sb{font-size:${pick(c, 96, 80)}px;font-weight:600;line-height:1;white-space:nowrap;overflow:hidden}
.snum .ss{font-size:${pick(c, 28, 24)}px;font-style:italic;letter-spacing:.1em;text-transform:uppercase;margin-top:6px;white-space:nowrap;overflow:hidden}
.swords{color:${paper ? '#1d1a17' : '#f4f1ea'};font-family:${FONT.serif};font-size:${pick(c, 44, 36)}px;white-space:nowrap;overflow:hidden}`,
    body: `<div class="prw"><div class="stage" ${p.move === 'still' ? '' : p.move === 'settle' ? `data-zoom data-at="0" data-dur="${f2(D)}" data-z0="1" data-z1="${(1 + p.moveZoom).toFixed(4)}" data-ease="settle"` : cameraAttrs(p.move, 0.03, D)}>${prints}${extras}${date}${side}${bars}</div></div>`
  }
}
