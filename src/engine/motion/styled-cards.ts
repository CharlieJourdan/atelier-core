// The templates of the channel-styled card family (styled.ts): title, figure, list, quote, lower third, kinetic type and chart, each
// drawn in the channel's measured palette, face, easing, texture and coverage. Same props as our templates (formats/motion.ts,
// formats/cards.ts), so the director's plan does not change: only the look comes from the clone's Style Definition.
import type { z } from 'zod'
import type { ChartCardProps } from '../formats/cards'
import type { FigureProps, KineticProps, ListProps, LowerThirdProps, QuoteProps, TitleProps } from '../formats/motion'
import { esc, outAt, pick, typo, zone, type MotionCtx } from './base'
import { figureText } from './cards'
import { landAnim, landS, styledPage, type CardStyle, type StyledTemplate } from './styled'

interface Part { css: string; body: string }
const f = (n: number): string => n.toFixed(2)

/** The box a card's content is centred in: the whole frame for a full-screen card, the safe zone over a picture. */
function frame(c: MotionCtx, s: CardStyle): { left: number; top: number; width: number; height: number } {
  if (s.fullScreen) {
    const padX = pick(c, 150, 70)
    const padY = pick(c, 110, 160)
    return { left: padX, top: padY, width: c.width - 2 * padX, height: c.height - 2 * padY }
  }
  const z0 = zone(c)
  return { left: z0.left, top: z0.top, width: z0.width, height: z0.height }
}

const box = (c: MotionCtx, s: CardStyle): string => {
  const b = frame(c, s)
  return `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;display:flex;flex-direction:column;justify-content:center`
}

/** Words that land one after the other in the measured easing. */
function words(s: CardStyle, text: string, start: number, step: number, dur: number, out: number): string {
  return typo(text)
    .split(/\s+/)
    .map((w, i) => `<span class="w" ${landAnim(s)} data-at="${f(start + i * step)}" data-dur="${f(dur)}" data-dy="30" data-out="${f(out)}">${esc(w)}</span>`)
    .join(' ')
}

function title(p: z.infer<typeof TitleProps>, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = landS(s, c)
  const n = p.title.split(/\s+/).length
  const step = Math.min(0.08, (d * 2) / n)
  const size = pick(c, 118, 100)
  return {
    css: `.t{${box(c, s)}}.t .in{padding:${pick(c, 56, 44)}px ${pick(c, 70, 48)}px}
.kick{font-size:${pick(c, 34, 30)}px;letter-spacing:.16em;color:var(--accent);margin-bottom:22px;text-transform:uppercase}
.ttl{font-size:${size}px;line-height:1.08;letter-spacing:-.01em;max-height:${Math.round(size * 1.08 * 3 + 12)}px;overflow:hidden}
.w{display:inline-block}.sub{margin-top:26px;font-size:${pick(c, 48, 40)}px;line-height:1.25;color:var(--muted)}`,
    body: `<div class="t"><div class="in panel" ${landAnim(s, 'fade')} data-at="0" data-dur="${f(d)}" data-out="${f(out)}">
${p.kicker ? `<div class="kick" ${landAnim(s)} data-at="${f(d * 0.5)}" data-dur="${f(d)}" data-dy="16">${esc(typo(p.kicker))}</div>` : ''}
<div class="ttl up" data-fit="44" data-lines="3">${words(s, p.title, d * 0.6, step, d, out)}</div>
${p.subtitle ? `<div class="sub" ${landAnim(s)} data-at="${f(d * 0.6 + n * step + 0.1)}" data-dur="${f(d)}" data-dy="20">${esc(typo(p.subtitle))}</div>` : ''}
</div></div>`
  }
}

function figure(p: z.infer<typeof FigureProps>, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = landS(s, c)
  const size = pick(c, 240, 190)
  const count = Math.min(2, Math.max(0.4, (out - d) * 0.6))
  return {
    css: `.fw{${box(c, s)};align-items:${s.fullScreen ? 'center' : 'flex-start'}}
.fig{padding:${pick(c, 54, 44)}px ${pick(c, 72, 48)}px;text-align:${s.fullScreen ? 'center' : 'left'}}
.num{position:relative;font-size:${size}px;line-height:1.04;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--accent);letter-spacing:-.02em}
.num .ghost{visibility:hidden}.num .live{position:absolute;left:0;right:0;top:0;white-space:nowrap}
.num .pre,.num .suf{font-size:.45em;color:var(--ink)}
.lab{margin-top:16px;font-size:${pick(c, 50, 42)}px;line-height:1.22;color:var(--ink);max-width:${pick(c, 1300, 900)}px}`,
    body: `<div class="fw"><div class="fig panel" ${landAnim(s, 'fade')} data-at="0" data-dur="${f(d)}" data-out="${f(out)}">
<div class="num" data-fit="72">${p.prefix ? `<span class="pre">${esc(p.prefix)}</span>` : ''}<span class="ghost">${esc(figureText(p))}</span><span class="live" data-count data-from="${p.from}" data-to="${p.value}" data-dec="${p.decimals}" data-at="${f(d * 0.5)}" data-dur="${f(count)}"></span>${p.suffix ? `<span class="suf"> ${esc(typo(p.suffix))}</span>` : ''}</div>
<div class="lab up" data-fit="26" data-lines="2" ${landAnim(s)} data-at="${f(d)}" data-dur="${f(d)}" data-dy="18">${esc(typo(p.label))}</div>
</div></div>`
  }
}

function list(p: z.infer<typeof ListProps>, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = landS(s, c)
  const items = p.order === 'desc' ? [...p.items].reverse() : p.items
  const spread = Math.max(0.3, (out - 0.6) / (items.length + 1))
  return {
    css: `.lw{${box(c, s)}}.lw .in{padding:${pick(c, 50, 40)}px ${pick(c, 64, 44)}px}
.hd{font-size:${pick(c, 64, 54)}px;margin-bottom:26px;color:var(--accent)}
.it{display:flex;align-items:baseline;gap:26px;font-size:${pick(c, 56, 46)}px;line-height:1.18;margin:12px 0}
.it .n{color:var(--accent);min-width:1.2em}`,
    body: `<div class="lw"><div class="in panel" ${landAnim(s, 'fade')} data-at="0" data-dur="${f(d)}" data-out="${f(out)}">
${p.heading ? `<div class="hd up" ${landAnim(s)} data-at="${f(d * 0.4)}" data-dur="${f(d)}" data-dy="18">${esc(typo(p.heading))}</div>` : ''}
${items
  .map((it, i) => {
    const at = it.atS ?? d + i * spread
    const n = p.order === 'desc' ? p.items.length - i : i + 1
    return `<div class="it" ${landAnim(s, 'left')} data-at="${f(at)}" data-dur="${f(d)}" data-dx="-40">${p.numbered ? `<span class="n">${n}</span>` : ''}<span>${esc(typo(it.text))}</span></div>`
  })
  .join('\n')}
</div></div>`
  }
}

function quote(p: z.infer<typeof QuoteProps>, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = landS(s, c)
  const n = p.text.split(/\s+/).length
  return {
    css: `.qw{${box(c, s)};align-items:center}.q{padding:${pick(c, 60, 46)}px ${pick(c, 84, 50)}px;max-width:${pick(c, 1400, 960)}px}
.q .mk{font-size:${pick(c, 200, 160)}px;line-height:.6;color:var(--accent)}
.q .tx{font-size:${pick(c, 64, 54)}px;line-height:1.22}.q .w{display:inline-block}.q .by{margin-top:22px;font-size:${pick(c, 38, 32)}px;color:var(--muted)}`,
    body: `<div class="qw"><div class="q panel" ${landAnim(s, 'fade')} data-at="0" data-dur="${f(d)}" data-out="${f(out)}"><div class="mk">“</div>
<div class="tx" data-fit="30" data-lines="4">${words(s, p.text, d, Math.min(0.06, 1.6 / n), d, out + 5)}</div>
${p.attribution ? `<div class="by" ${landAnim(s)} data-at="${f(d + 0.3)}" data-dur="${f(d)}" data-dy="14">— ${esc(typo(p.attribution))}</div>` : ''}
</div></div>`
  }
}

function lowerThird(p: z.infer<typeof LowerThirdProps>, c: MotionCtx, s: CardStyle): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const d = landS(s, c)
  const panel = s.texture === 'glass' ? '' : `background:${s.ground};`
  return {
    css: `.lt{position:absolute;left:${z0.left}px;bottom:${c.height - z0.bottom}px;display:flex;align-items:stretch}
.lt .bar{width:12px;background:var(--accent);margin-right:14px;border-radius:4px}
.lt .card{${panel}padding:${pick(c, 22, 18)}px ${pick(c, 40, 30)}px;border-radius:16px}
.lt .nm{font-size:${pick(c, 58, 48)}px;line-height:1.1;white-space:nowrap}.lt .rl{margin-top:6px;font-size:${pick(c, 34, 28)}px;color:var(--muted);white-space:nowrap}`,
    body: `<div class="lt" ${landAnim(s, 'left')} data-at="0" data-dur="${f(d)}" data-dx="-60" data-out="${f(out)}"><div class="bar"></div><div class="card panel">
<div class="nm up" data-fit="26">${esc(typo(p.name))}</div>${p.role ? `<div class="rl" data-fit="20">${esc(typo(p.role))}</div>` : ''}</div></div>`
  }
}

function kinetic(p: KineticProps, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = Math.min(0.35, landS(s, c))
  const top = p.position === 'upper' ? '18%' : p.position === 'lower' ? '58%' : '38%'
  const upper = p.case === 'upper' || s.upper
  return {
    css: `.kw{position:absolute;left:${pick(c, 140, 60)}px;right:${pick(c, 140, 60)}px;top:${s.fullScreen ? '0' : top};${s.fullScreen ? 'bottom:0;display:flex;align-items:center;justify-content:center;' : ''}text-align:center}
.kw .ln{font-size:${pick(c, 120, 96)}px;line-height:1.08;${upper ? 'text-transform:uppercase;' : ''}}
.kw .w{display:inline-block;margin:0 .12em}.kw .em{color:var(--accent)}`,
    body: `<div class="kw"><div class="ln" data-fit="48">${p.words
      .map((w) => `<span class="w${w.emphasis ? ' em' : ''}" ${landAnim(s)} data-at="${f(w.atS)}" data-dur="${f(d)}" data-dy="26" data-out="${f(out)}">${esc(typo(w.text))}</span>`)
      .join('')}</div></div>`
  }
}

function chart(p: ChartCardProps, c: MotionCtx, s: CardStyle): Part {
  const out = outAt(c)
  const d = landS(s, c)
  const b = frame(c, s)
  const w = b.width - 120
  const h = b.height - pick(c, 260, 360)
  const head = `<div class="kick">${p.kicker ? esc(typo(p.kicker)) : ''}</div><div class="ct up">${esc(typo(p.title))}</div>${p.source ? `<div class="src">${esc(typo(p.source))}</div>` : ''}`
  const css = `.cw{${box(c, s)}}.cw .in{padding:${pick(c, 46, 36)}px ${pick(c, 60, 40)}px;position:relative}
.kick{font-size:${pick(c, 30, 26)}px;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;min-height:4px}
.ct{font-size:${pick(c, 62, 52)}px;line-height:1.1;margin:8px 0 18px}.src{position:absolute;right:${pick(c, 60, 40)}px;top:${pick(c, 46, 36)}px;font-size:24px;color:var(--muted)}
.tick{font-size:${pick(c, 28, 24)}px;fill:var(--muted);font-family:var(--face)}.val{font-size:${pick(c, 40, 34)}px;fill:var(--ink);font-family:var(--face)}
.cn{display:flex;gap:60px;justify-content:center}.cn .c{text-align:center}.cn .v{font-size:${pick(c, 150, 110)}px;color:var(--accent);font-variant-numeric:tabular-nums}.cn .l{font-size:${pick(c, 40, 34)}px;color:var(--ink)}`
  let graph = ''
  if ((p.kind === 'line' || p.kind === 'area') && p.points) {
    const pts = p.points
    const lo = Math.min(0, ...pts.map((q) => q.value))
    const hi = Math.max(...pts.map((q) => q.value))
    const x = (i: number): number => (i / (pts.length - 1)) * w
    const y = (v: number): number => h - ((v - lo) / (hi - lo || 1)) * h
    const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(q.value).toFixed(1)}`).join(' ')
    const area = p.kind === 'area' ? `<path d="${line} L${w} ${h} L0 ${h}Z" fill="${'var(--accent)'}" opacity=".18" data-anim="fade" data-at="${f((p.atS ?? 0) + p.drawS * 0.6)}" data-dur="${f(d)}"/>` : ''
    const last = pts[pts.length - 1]!
    graph = `<svg width="${w}" height="${h + 50}" viewBox="0 -10 ${w} ${h + 60}" style="overflow:visible">${area}
<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" data-draw data-at="${f((p.atS ?? 0))}" data-dur="${f(p.drawS)}" data-ease="${s.easing === 'back' ? 'out' : s.easing}"/>
${pts.map((q, i) => (i === 0 || i === pts.length - 1 || pts.length <= 8 ? `<text class="tick" x="${x(i).toFixed(1)}" y="${h + 40}" text-anchor="middle">${esc(q.label)}</text>` : '')).join('')}
<text class="val" x="${(x(pts.length - 1) - 10).toFixed(1)}" y="${(y(last.value) - 22).toFixed(1)}" text-anchor="end" data-anim="fade" data-at="${f((p.atS ?? 0) + p.drawS)}" data-dur="${f(d)}">${esc(last.display ?? `${last.value}${p.unit ?? ''}`)}</text></svg>`
  } else if (p.kind === 'donut' && p.slices) {
    const total = p.slices.reduce((a, q) => a + q.value, 0)
    const r = Math.min(h, w) / 2.6
    let acc = 0
    graph = `<svg width="${w}" height="${h}" viewBox="${-w / 2} ${-h / 2} ${w} ${h}">${p.slices
      .map((q, i) => {
        const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2
        acc += q.value
        const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        const d0 = `M${(Math.cos(a0) * r).toFixed(1)} ${(Math.sin(a0) * r).toFixed(1)} A${r} ${r} 0 ${large} 1 ${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}`
        const colour = q.accent ? 'var(--accent)' : i % 2 ? 'var(--muted)' : 'var(--ink)'
        const am = (a0 + a1) / 2
        return `<path d="${d0}" fill="none" stroke="${colour}" stroke-width="${(r * 0.36).toFixed(0)}" pathLength="1" stroke-dasharray="1 1" data-draw data-at="${f((q.atS ?? 0))}" data-dur="${f(d * 2)}"/>
<text class="tick" x="${(Math.cos(am) * r * 1.5).toFixed(1)}" y="${(Math.sin(am) * r * 1.5).toFixed(1)}" text-anchor="middle" data-anim="fade" data-at="${f((q.atS ?? 0) + d)}" data-dur="${f(d)}">${esc(q.label)}</text>`
      })
      .join('')}</svg>`
  } else if (p.kind === 'counters' && p.counters) {
    graph = `<div class="cn">${p.counters
      .map((q) => `<div class="c" ${landAnim(s)} data-at="${f((q.atS ?? 0))}" data-dur="${f(d)}" data-dy="24"><div class="v"><span data-count data-from="0" data-to="${q.value}" data-dec="${q.dec ?? 0}" data-at="${f((q.atS ?? 0))}" data-dur="1.2"></span>${q.unit ? esc(q.unit) : ''}</div><div class="l">${esc(typo(q.label))}</div></div>`)
      .join('')}</div>`
  }
  return { css, body: `<div class="cw"><div class="in panel" ${landAnim(s, 'fade')} data-at="0" data-dur="${f(d)}" data-out="${f(out)}">${head}${graph}</div></div>` }
}

/** The page of a styled card for one of the family's templates (`props` already parsed by the template's schema). */
export function styledCardHtml(template: StyledTemplate, props: unknown, c: MotionCtx, s: CardStyle): string {
  const part = ((): Part => {
    switch (template) {
      case 'title':
        return title(props as z.infer<typeof TitleProps>, c, s)
      case 'figure':
        return figure(props as z.infer<typeof FigureProps>, c, s)
      case 'list':
        return list(props as z.infer<typeof ListProps>, c, s)
      case 'quote':
        return quote(props as z.infer<typeof QuoteProps>, c, s)
      case 'lower-third':
        return lowerThird(props as z.infer<typeof LowerThirdProps>, c, s)
      case 'kinetic':
        return kinetic(props as KineticProps, c, s)
      case 'chart':
        return chart(props as ChartCardProps, c, s)
    }
  })()
  // the lower third never fills the frame, whatever the coverage of the cards
  const style = template === 'lower-third' ? { ...s, fullScreen: false } : s
  return styledPage(c, style, part.css, part.body)
}
