// The data cards (formats/cards.ts) on the dark warped grid: bars (rows whose bars grow and whose values count up, each on its word) and a
// timeline (a line drawn across the card, each dated event popping on it). Both start from the same background and header.
import type { BarsCardProps, TimelineCardProps } from '../formats/cards'
import { DOC_PALETTE } from '../formats/cards'
import { esc, isPortrait, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { DARK_CSS, FONT, f2, warpedGrid } from './doc-common'
import { DARK_STYLE, PARCH, hatchedBar, parchmentHeader, type DocStyle } from './doc-parchment'

const GREY_BAR = '#8a847c'

/** Where the rows of a card land when the spec gives no times: spread from 0.8 s over the first 60 % of the card (the header takes 0.5 s). */
export function spreadTimes(n: number, durationS: number, endFrac: number): number[] {
  const first = 0.8
  const last = Math.max(first, Math.min(durationS * endFrac, durationS - 1.2))
  const step = n > 1 ? Math.max(0.3, (last - first) / (n - 1)) : 0
  return Array.from({ length: n }, (_, i) => Math.round((first + i * step) * 100) / 100)
}

const SOURCE_RE = /^source\s*:/i
/** The dark background, the grid, and the kicker, the title and the source at the top. */
export function header(c: MotionCtx, seed: string, kicker: string | undefined, title: string, source: string | undefined): Part {
  const m = pick(c, 120, 64)
  const kTop = pick(c, 96, 130)
  const tTop = kTop + (kicker ? pick(c, 42, 44) : 0)
  const srcLine = source ? (SOURCE_RE.test(source) ? source : `SOURCE: ${source}`) : ''
  return {
    css: `${DARK_CSS}
.doc .kick{position:absolute;left:${m}px;top:${kTop}px;font-weight:700;font-size:${pick(c, 22, 24)}px;letter-spacing:.24em;text-transform:uppercase;color:${DOC_PALETTE.red};white-space:nowrap;overflow:hidden;max-width:${c.width - 2 * m}px}
.doc .ttl{position:absolute;left:${m}px;top:${tTop}px;font-family:${FONT.cond};font-weight:600;font-size:${pick(c, 54, 62)}px;line-height:1.15;letter-spacing:.035em;text-transform:uppercase;color:#fff;white-space:nowrap;overflow:hidden;max-width:${pick(c, c.width - 2 * m - 420, c.width - 2 * m)}px;padding-bottom:6px}
.doc .srcl{position:absolute;right:${m}px;top:${pick(c, kTop - 2, 62)}px;font-weight:600;font-size:${pick(c, 20, 20)}px;letter-spacing:.07em;color:#8f8981;white-space:nowrap;overflow:hidden;max-width:${pick(c, 420, c.width - 2 * m)}px}`,
    body: `<div class="doc"><div class="glow"></div><div class="gridw" data-anim="fade" data-at="0.05" data-dur="0.55">${warpedGrid(c, seed)}</div>
${kicker ? `<div class="kick" data-fit="14" data-anim="rise" data-at="0.2" data-dur="0.4" data-dy="14">${esc(typo(kicker))}</div>` : ''}
<div class="ttl" data-fit="26" data-anim="rise" data-at="0.3" data-dur="0.5" data-dy="18">${esc(typo(title))}</div>
${srcLine ? `<div class="srcl" data-fit="12" data-anim="fade" data-at="0.4" data-dur="0.5">${esc(typo(srcLine))}</div>` : ''}`,
    // the closing tag of .doc is added by the card, after its own parts
  }
}

const decimalsOf = (v: number): number => Math.min(3, (String(v).split('.')[1] ?? '').length)

export function barsCard(p: BarsCardProps, c: MotionCtx, look: DocStyle = DARK_STYLE): Part {
  const parch = look.kind === 'parchment'
  const D = c.durationS
  const portrait = isPortrait(c)
  const m = pick(c, 120, 64)
  const head = parch ? parchmentHeader(c, look, p.kicker, p.title, p.source, false) : header(c, p.title, p.kicker, p.title, p.source)
  const n = p.rows.length
  const max = Math.max(...p.rows.map((r) => r.value), 0)
  const y0 = Math.round(c.height * pick(c, 0.37, 0.3))
  const pitch = Math.min(pick(c, 136, 200), Math.round((c.height * 0.93 - y0) / n))
  const valueW = pick(c, 330, 420)
  const labelW = pick(c, 330, c.width - 2 * m - valueW)
  const barX = pick(c, m + 370, m)
  const barMax = portrait ? c.width - 2 * m : c.width - m - valueW - barX - 50
  const times = spreadTimes(n, D, 0.6)
  const rows = p.rows
    .map((r, i) => {
      const at = r.atS ?? (times[i] as number)
      const y = y0 + i * pitch
      const w = Math.max(8, Math.round((max > 0 ? r.value / max : 0) * barMax))
      const col = r.accent ? DOC_PALETTE.red : GREY_BAR
      const barH = pick(c, 22, 26)
      const barY = portrait ? y + 58 : y + Math.round((pick(c, 46, 0) - barH) / 2) + 4
      const value = r.display
        ? `<span data-anim="rise" data-at="${f2(at + 0.45)}" data-dur="0.4" data-dy="10" style="display:inline-block">${esc(typo(r.display))}</span>`
        : `<span data-count data-from="0" data-to="${r.value}" data-dec="${decimalsOf(r.value)}" data-at="${f2(at + 0.1)}" data-dur="0.85"></span>`
      return `<div class="row">
<div class="lab" data-fit="14" style="left:${m}px;top:${y}px;width:${labelW}px" data-anim="rise" data-at="${f2(at)}" data-dur="0.4" data-dy="10">${esc(typo(r.label))}</div>
<div class="bar" style="left:${barX}px;top:${barY}px;width:${w}px;height:${barH}px;${parch ? hatchedBar(!!r.accent, look) : `background:${col}`}" data-anim="grow" data-at="${f2(at + 0.05)}" data-dur="0.6"></div>
<div class="val" data-anim="fade" data-at="${f2(at + 0.1)}" data-dur="0.25" style="top:${y - pick(c, 2, 4)}px;color:${parch ? (r.accent ? look.accent : PARCH.ink) : r.accent ? DOC_PALETTE.red : '#fff'};width:${valueW}px;left:${c.width - m - valueW}px">${value}</div></div>`
    })
    .join('\n')
  if (parch) {
    // an engraved table: a double rule above the first row, a hairline between rows and a double rule under the last
    const rowH = portrait ? 96 : 46
    const gap = Math.round((pitch - rowH) / 2)
    const rule = (cls: string, top: number, at: number): string => `<div class="hr ${cls}" style="top:${top}px" data-anim="wipe" data-at="${f2(at)}" data-dur="0.6" data-ease="linear"></div>`
    const rules = [rule('d', y0 - gap, 0.5), ...p.rows.map((r, i) => rule(i === n - 1 ? 'd' : 's', y0 + i * pitch + rowH + gap, (r.atS ?? (times[i] as number)) + 0.1))].join('\n')
    return {
      css: `${head.css}
.doc .lab{position:absolute;height:${pick(c, 46, 40)}px;line-height:${pick(c, 46, 40)}px;font-weight:600;font-size:${pick(c, 23, 25)}px;letter-spacing:.14em;text-transform:uppercase;color:${PARCH.muted};white-space:nowrap;overflow:hidden}
.doc .bar{position:absolute;transform-origin:left center}
.doc .val{position:absolute;text-align:right;font-weight:600;font-size:${pick(c, 50, 58)}px;line-height:${pick(c, 46, 40)}px;height:${pick(c, 46, 56)}px;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}`,
      body: `${head.body}\n${rules}\n${rows}\n</div>`
    }
  }
  return {
    css: `${head.css}
.doc .lab{position:absolute;height:${pick(c, 46, 40)}px;line-height:${pick(c, 46, 40)}px;font-weight:700;font-size:${pick(c, 22, 24)}px;letter-spacing:.17em;text-transform:uppercase;color:#a7a198;white-space:nowrap;overflow:hidden}
.doc .bar{position:absolute;transform-origin:left center}
.doc .val{position:absolute;text-align:right;font-family:${FONT.cond};font-weight:600;font-size:${pick(c, 46, 54)}px;line-height:${pick(c, 46, 40)}px;height:${pick(c, 46, 56)}px;letter-spacing:.02em;white-space:nowrap;font-variant-numeric:tabular-nums}`,
    body: `${head.body}\n${rows}\n</div>`
  }
}

export function timelineCard(p: TimelineCardProps, c: MotionCtx, look: DocStyle = DARK_STYLE): Part {
  const parch = look.kind === 'parchment'
  const ink = parch ? PARCH.ink : '#fff'
  const hot = parch ? look.accent : DOC_PALETTE.red
  /** One mark of the line: a round dot on the dark card, an ink diamond (drawn by an inner element: the runtime owns the clip-path of an animated one) on the parchment. */
  const mark = (pos: string, col: string, accent: boolean | undefined, at: number): string =>
    parch
      ? `<div class="dot" style="${pos}" data-anim="pop" data-at="${f2(at)}" data-dur="0.35"><i style="background:${col}"></i></div>`
      : `<div class="dot" style="${pos};background:${col};${accent ? 'box-shadow:0 0 0 7px rgba(213,65,47,.28)' : ''}" data-anim="pop" data-at="${f2(at)}" data-dur="0.35"></div>`
  const D = c.durationS
  const portrait = isPortrait(c)
  const head = parch ? parchmentHeader(c, look, p.kicker, p.title, undefined) : header(c, p.title, p.kicker, p.title, undefined)
  const n = p.events.length
  const times = spreadTimes(n, D, 0.7)
  const at = p.events.map((e, i) => e.atS ?? (times[i] as number))
  const lastAt = Math.max(...at)
  const m = pick(c, 120, 64)
  const dot = pick(c, 28, 28)
  const parts: string[] = []
  let css: string
  if (!portrait) {
    const alt = n > 4
    const L = m + 40
    const R = c.width - m - 40
    const pitch = (R - L) / n
    const y = Math.round(c.height * 0.56)
    const bw = Math.round(alt ? Math.min(pitch * 1.85, 400) : Math.min(pitch * 0.88, 460))
    const whenH = 54
    const lineAt = 0.45
    parts.push(`<div class="tl" style="left:${L}px;top:${y - 2}px;width:${R - L}px" data-anim="wipe" data-at="${f2(lineAt)}" data-dur="${f2(Math.max(1, lastAt - lineAt + 0.2))}" data-ease="linear"></div>`)
    p.events.forEach((e, i) => {
      const x = Math.round(L + pitch * (i + 0.5))
      const col = e.accent ? hot : ink
      const above = alt && i % 2 === 0
      const whenPos = !alt || above ? `bottom:${c.height - (y - dot / 2 - 14)}px` : `top:${y + dot / 2 + 14}px`
      const labelPos = !alt
        ? `top:${y + dot / 2 + 20}px`
        : above
          ? `bottom:${c.height - (y - dot / 2 - 14 - whenH - 9)}px`
          : `top:${y + dot / 2 + 14 + whenH + 9}px`
      parts.push(`${mark(`left:${x - dot / 2}px;top:${y - dot / 2}px;width:${dot}px;height:${dot}px`, col, e.accent, at[i] as number)}
<div class="when" style="left:${x - bw / 2}px;width:${bw}px;height:${whenH}px;${whenPos};color:${col}" data-fit="18" data-anim="rise" data-at="${f2((at[i] as number) + 0.08)}" data-dur="0.4" data-dy="14">${esc(typo(e.when))}</div>
<div class="elab" style="left:${x - bw / 2}px;width:${bw}px;${labelPos};${above ? 'display:flex;align-items:flex-end;justify-content:center;' : ''}" data-anim="rise" data-at="${f2((at[i] as number) + 0.28)}" data-dur="0.45" data-dy="14"><div class="et" data-fit="16" data-lines="4" style="width:100%">${esc(typo(e.label))}</div></div>`)
    })
    css = parch
      ? `
.doc .tl{position:absolute;height:3px;background:${PARCH.ink}}
.doc .when{position:absolute;display:flex;align-items:flex-end;justify-content:center;font-weight:700;font-size:${alt ? 40 : 48}px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;line-height:1.1;padding-bottom:4px;font-variant-numeric:lining-nums}
.doc .elab{position:absolute;max-height:150px;text-align:center}
.doc .et{font-style:italic;font-weight:400;font-size:${alt ? 27 : 31}px;line-height:1.28;color:${PARCH.ink};max-height:150px;overflow:hidden}
.doc .dot{position:absolute}
.doc .dot i{display:block;width:100%;height:100%;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}`
      : `
.doc .tl{position:absolute;height:4px;background:rgba(255,255,255,.62);border-radius:2px}
.doc .when{position:absolute;display:flex;align-items:flex-end;justify-content:center;font-family:${FONT.cond};font-weight:600;font-size:${alt ? 40 : 48}px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;line-height:1.1;padding-bottom:4px}
.doc .elab{position:absolute;max-height:150px;text-align:center}
.doc .et{font-family:${FONT.serif};font-weight:400;font-size:${alt ? 26 : 30}px;line-height:1.28;color:#f2efe9;max-height:150px;overflow:hidden}
.doc .dot{position:absolute;border-radius:50%}`
  } else {
    // a short: the line runs down the card and each event sits to its right
    const lx = Math.round(c.width * 0.2)
    const top = Math.round(c.height * 0.3)
    const bottom = Math.round(c.height * 0.92)
    const pitch = (bottom - top) / n
    const tw = c.width - m - (lx + 48)
    parts.push(`<div class="tlv" style="left:${lx - 2}px;top:${top}px;height:${bottom - top}px" data-anim="growy" data-at="0.45" data-dur="${f2(Math.max(1, lastAt - 0.25))}" data-ease="linear"></div>`)
    p.events.forEach((e, i) => {
      const yc = Math.round(top + pitch * (i + 0.5))
      const col = e.accent ? hot : ink
      parts.push(`${mark(`left:${lx - dot / 2}px;top:${yc - dot / 2}px;width:${dot}px;height:${dot}px`, col, e.accent, at[i] as number)}
<div class="evv" style="left:${lx + 48}px;top:${Math.round(yc - pitch * 0.46)}px;width:${tw}px;height:${Math.round(pitch * 0.92)}px"><div class="vw" style="color:${col}" data-fit="18" data-anim="rise" data-at="${f2((at[i] as number) + 0.08)}" data-dur="0.4" data-dy="14">${esc(typo(e.when))}</div><div class="vl" data-fit="16" data-anim="rise" data-at="${f2((at[i] as number) + 0.28)}" data-dur="0.45" data-dy="14">${esc(typo(e.label))}</div></div>`)
    })
    css = parch
      ? `
.doc .tlv{position:absolute;width:3px;background:${PARCH.ink};transform-origin:center top}
.doc .dot{position:absolute}
.doc .dot i{display:block;width:100%;height:100%;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.doc .evv{position:absolute;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.doc .vw{font-weight:700;font-size:46px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;line-height:1.2;font-variant-numeric:lining-nums}
.doc .vl{font-style:italic;font-size:31px;line-height:1.25;color:${PARCH.ink};max-height:${Math.round(pitch * 0.92 - 48)}px;overflow:hidden}`
      : `
.doc .tlv{position:absolute;width:4px;background:rgba(255,255,255,.62);border-radius:2px;transform-origin:center top}
.doc .dot{position:absolute;border-radius:50%}
.doc .evv{position:absolute;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.doc .vw{font-family:${FONT.cond};font-weight:600;font-size:44px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;line-height:1.2}
.doc .vl{font-family:${FONT.serif};font-size:30px;line-height:1.25;color:#f2efe9;max-height:${Math.round(pitch * 0.92 - 48)}px;overflow:hidden}`
  }
  return { css: `${head.css}${css}`, body: `${head.body}\n${parts.join('\n')}\n</div>` }
}
