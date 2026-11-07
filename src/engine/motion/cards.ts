// Four of our motion templates (docs/ENGINE-SPEC.md §25): the title card, the lower third, the big figure with its counter and the quote
// card. Each returns the CSS and the markup of its page; `pageHtml` (base.ts) wraps them. Every measure comes in two sizes (a landscape
// film, a short) and every text sits in a box the runtime can shrink it to (`data-fit`, with a floor). Only Inter 600 and 700 are bundled.
import type { z } from 'zod'
import type { FigureProps, LowerThirdProps, QuoteProps, TitleProps } from '../formats/motion'
import { esc, outAt, pick, typo, zone, type MotionCtx } from './base'

export interface Part {
  css: string
  body: string
}

const f = (n: number): string => n.toFixed(2)

/** Words as inline blocks that rise one after the other (`start` seconds, `step` between two words). */
function words(text: string, start: number, step: number, out: number, anim = 'rise', dy = 36): string {
  return typo(text)
    .split(/\s+/)
    .map((w, i) => `<span class="w" data-anim="${anim}" data-at="${f(start + i * step)}" data-dur="0.5" data-dy="${dy}" data-out="${f(out)}">${esc(w)}</span>`)
    .join(' ')
}

export function titleCard(p: z.infer<typeof TitleProps>, c: MotionCtx): Part {
  const out = outAt(c)
  const pad = pick(c, 160, 70)
  const size = pick(c, 124, 108)
  const n = p.title.split(/\s+/).length
  const step = Math.min(0.09, 1.2 / n)
  const subAt = 0.5 + n * step + 0.15
  return {
    css: `
.scrim{position:absolute;inset:0;background:var(--scrim)}
.box{position:absolute;left:${pad}px;right:${pad}px;top:${pick(c, 330, 520)}px}
.kick{font-size:${pick(c, 34, 32)}px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:${pick(c, 26, 22)}px}
.bar{width:${pick(c, 170, 130)}px;height:9px;border-radius:5px;background:var(--accent);transform-origin:left center;margin-bottom:${pick(c, 34, 30)}px}
.ttl{font-size:${size}px;line-height:1.08;font-weight:700;max-height:${Math.round(size * 1.08 * 3 + size * 0.2)}px;padding-bottom:${Math.round(size * 0.12)}px;overflow:hidden;letter-spacing:-.01em}
.w{display:inline-block}
.sub{margin-top:${pick(c, 30, 26)}px;font-size:${pick(c, 50, 42)}px;line-height:1.25;color:var(--muted);max-width:${pick(c, 1400, 900)}px}`,
    body: `<div class="scrim" data-anim="fade" data-at="0" data-dur="0.4" data-out="${f(out)}"></div>
<div class="box">
${p.kicker ? `<div class="kick" data-anim="rise" data-at="0.2" data-dy="20" data-out="${f(out)}">${esc(typo(p.kicker))}</div>` : ''}
<div class="bar" data-anim="grow" data-at="0.3" data-dur="0.5" data-out="${f(out)}"></div>
<div class="ttl" data-fit="44">${words(p.title, 0.45, step, out)}</div>
${p.subtitle ? `<div class="sub" data-anim="rise" data-at="${f(subAt)}" data-dy="24" data-out="${f(out)}">${esc(typo(p.subtitle))}</div>` : ''}
</div>`
  }
}

export function lowerThird(p: z.infer<typeof LowerThirdProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const name = pick(c, 58, 50)
  return {
    css: `
.lt{position:absolute;left:${z0.left}px;bottom:${c.height - z0.bottom}px;display:flex;align-items:stretch}
.lt .bar{width:12px;border-radius:6px;background:var(--accent);transform-origin:center bottom;margin-right:14px}
.lt .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:${pick(c, 24, 20)}px ${pick(c, 44, 36)}px ${pick(c, 26, 22)}px ${pick(c, 36, 30)}px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.lt .nm{font-size:${name}px;line-height:1.1;font-weight:700;white-space:nowrap;overflow:hidden;max-width:${pick(c, 980, 780)}px;padding-bottom:4px}
.lt .rl{margin-top:8px;font-size:${Math.round(name * 0.58)}px;line-height:1.2;color:var(--muted);white-space:nowrap;overflow:hidden;max-width:${pick(c, 980, 780)}px}`,
    body: `<div class="lt">
<div class="bar" data-anim="growy" data-at="0.05" data-dur="0.4" data-out="${f(out)}"></div>
<div class="card" data-anim="wipe" data-at="0.15" data-dur="0.6" data-out="${f(out)}">
<div class="nm" data-fit="26" data-anim="rise" data-at="0.5" data-dy="18" data-dur="0.45">${esc(typo(p.name))}</div>
${p.role ? `<div class="rl" data-fit="20" data-anim="rise" data-at="0.65" data-dy="18" data-dur="0.45">${esc(typo(p.role))}</div>` : ''}
</div></div>`
  }
}

/** The figure's text as the counter will end on it (also the ghost that keeps the panel from growing while it counts). */
export function figureText(p: z.infer<typeof FigureProps>): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals }).format(p.value).replace(/[\u202f\u00a0]/g, '\u00a0')
}

export function figure(p: z.infer<typeof FigureProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const size = pick(c, 230, 190)
  const padX = pick(c, 64, 48)
  const dur = Math.min(2, Math.max(1, (out - 0.5) * 0.6))
  // a short unit (%, €, km) stands next to the number; a longer one (« personnes ») gets its own line under it
  const longUnit = p.suffix.trim().length > 6
  return {
    css: `
.fw{position:absolute;left:${z0.left}px;top:${z0.top}px;width:${z0.width}px;height:${z0.height}px;display:flex;align-items:center}
.fig{position:relative;width:${pick(c, 'max-content', '100%')};max-width:100%;padding:${pick(c, 54, 46)}px ${padX}px ${pick(c, 56, 48)}px;background:var(--panel);border:1px solid var(--line);border-radius:34px;box-shadow:0 18px 60px rgba(0,0,0,.4);overflow:hidden}
.fig .top{position:absolute;left:0;top:0;height:8px;width:100%;background:var(--accent);transform-origin:left center}
.num{position:relative;font-size:${size}px;line-height:1.05;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-.02em;width:max-content;max-width:${z0.width - 2 * padX}px;overflow:hidden;padding-bottom:6px}
.num .ghost{visibility:hidden}
.num .live{position:absolute;left:0;top:0;white-space:nowrap}
.num .pre,.num .suf{font-size:.46em;color:var(--accent);font-weight:700;letter-spacing:0}
.num .suf{margin-left:.15em}.num .pre{margin-right:.12em}
.unit{margin-top:2px;font-size:${pick(c, 66, 56)}px;line-height:1.1;font-weight:700;color:var(--accent);white-space:nowrap;overflow:hidden;max-width:${z0.width - 2 * padX}px;padding-bottom:4px}
.lab{margin-top:${pick(c, 18, 14)}px;font-size:${pick(c, 46, 42)}px;line-height:1.22;color:var(--muted);max-width:${pick(c, 1000, z0.width - 2 * padX)}px;max-height:${Math.round(pick(c, 46, 42) * 1.22 * 2 + 6)}px;overflow:hidden}`,
    body: `<div class="fw"><div class="fig" data-anim="pop" data-at="0" data-dur="0.5" data-out="${f(out)}">
<div class="top" data-anim="grow" data-at="0.2" data-dur="0.6"></div>
<div class="num" data-fit="72">${p.prefix ? `<span class="pre">${esc(p.prefix)}</span>` : ''}<span class="ghost">${esc(figureText(p))}</span><span class="live" data-count data-from="${p.from}" data-to="${p.value}" data-dec="${p.decimals}" data-at="0.35" data-dur="${f(dur)}"></span>${p.suffix && !longUnit ? `<span class="suf">${esc(typo(p.suffix))}</span>` : ''}</div>
${longUnit ? `<div class="unit" data-fit="28" data-anim="rise" data-at="0.5" data-dy="16" data-dur="0.45">${esc(typo(p.suffix.trim()))}</div>` : ''}
<div class="lab" data-fit="26" data-anim="rise" data-at="0.65" data-dy="20" data-dur="0.5">${esc(typo(p.label))}</div>
</div></div>`
  }
}

export function quote(p: z.infer<typeof QuoteProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const w = pick(c, 1320, z0.width)
  const size = pick(c, 66, 58)
  const boxH = pick(c, 330, 520)
  const n = p.text.split(/s+/).length
  const step = Math.min(0.07, 1.8 / n)
  return {
    css: `
.qw{position:absolute;left:0;top:${z0.top}px;width:${c.width}px;height:${z0.height}px;display:flex;align-items:center;justify-content:center}
.q{position:relative;width:${w}px;padding:${pick(c, 70, 60)}px ${pick(c, 90, 56)}px ${pick(c, 56, 48)}px;background:var(--panel);border:1px solid var(--line);border-radius:34px;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.q .mark{position:absolute;left:${pick(c, 40, 30)}px;top:${pick(c, -26, -20)}px;font-size:${pick(c, 260, 220)}px;line-height:1;color:var(--accent);font-weight:700}
.q .txt{position:relative;font-size:${size}px;line-height:1.22;font-weight:700;max-height:${boxH}px;overflow:hidden;padding-top:${pick(c, 34, 30)}px;letter-spacing:-.005em}
.q .w{display:inline-block}
.q .by{margin-top:22px;font-size:${pick(c, 38, 34)}px;color:var(--muted)}`,
    body: `<div class="qw"><div class="q" data-anim="rise" data-at="0" data-dy="40" data-dur="0.55" data-out="${f(out)}">
<div class="mark">“</div>
<div class="txt" data-fit="30">${words(p.text, 0.4, step, out + 5, 'fade', 0)}</div>
${p.attribution ? `<div class="by" data-anim="rise" data-at="${f(0.4 + n * step + 0.2)}" data-dy="16">— ${esc(typo(p.attribution))}</div>` : ''}
</div></div>`
  }
}
