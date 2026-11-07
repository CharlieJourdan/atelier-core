// The POV cards' data and UI shots (formats/pov.ts): a row of line icons in circles, a grid of icons that fills, a bar that grows against
// a reference shape while its multiplier counts, a line that draws, a phone, a browser window, a sheet of paper with its stamp, and a
// stopwatch, gauges or a clock. Each draws its own ground (the navy blueprint, or the scene defocused behind it). Pure strings.
import type { PovSet, PovShot } from '../formats/pov'
import { esc, typo } from './base'
import { POV_ICONS } from './pov-icons'
import { H, W, bill, cardGround, f1, f2, world, type Pal } from './pov-kit'
import { drawSet } from './pov-sets'

type Shot<K extends PovShot['kind']> = Extract<PovShot, { kind: K }>
const T = (s: string): string => esc(typo(s))
export const pct = (v: number, of: number): string => `${f2((v / of) * 100)}%`

/** The scene `set` defocused behind a card (the reference's blurred plate), or the navy ground. */
export function plateOrGround(set: PovSet | undefined, p: Pal, seed: string): string {
  return set ? `<div class="plate">${world(drawSet(set, p, seed).svg)}</div>` : world(cardGround(p, seed))
}

/** A small tracked label in capitals, centred (or from `x` when `anchor` is left), rising in at `at`. */
export function label(text: string, o: { x?: number; y: number; size?: number; color?: string; at?: number; anchor?: 'center' | 'left'; title?: boolean }): string {
  const left = o.anchor === 'left' ? `left:${pct(o.x ?? 0, W)}` : 'left:0;right:0;text-align:center'
  return `<div class="lbl${o.title ? ' ttl' : ''}" style="${left};top:${pct(o.y, H)};font-size:${o.size ?? 26}px;color:${o.color ?? '#fff'}" data-fit="12" data-anim="rise" data-at="${f2(o.at ?? 0.15)}" data-dur="0.4" data-dy="14">${T(text)}</div>`
}

/** A Lucide icon (pov-icons.ts) stroked in `color`, `size` px; an unknown name draws a plain dot. */
export function icon(name: string, size: number, color: string, stroke = 1.6): string {
  const inner = POV_ICONS[name] ?? POV_ICONS[name.toLowerCase().replace(/\s+/g, '-')] ?? '<circle cx="12" cy="12" r="4"/>'
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}


export function iconsShot(s: Shot<'icons'>, p: Pal, seed: string): string {
  const n = s.items.length
  const times = s.items.map((x, i) => x.atS ?? 0.3 + i * 0.5)
  const gap = s.chain ? Math.min(560, 1640 / n) : Math.min(330, 1500 / n)
  const x0 = W / 2 - ((n - 1) * gap) / 2
  if (s.chain) {
    // dark rounded boxes with a thin gold outline, a line icon, white words, arrows from one to the next (reference frame 8)
    const bw = Math.min(260, gap - 70)
    const boxes = s.items
      .map((x, i) => {
        const cx = x0 + i * gap
        const arrow = i < n - 1 || i === n - 1 ? `<div style="position:absolute;left:${pct(cx + bw / 2 + 8, W)};top:49%;width:${pct(i < n - 1 ? gap - bw - 16 : W, W)};height:3px;background:${p.gold};opacity:.8" data-anim="fade" data-at="${f2((times[i + 1] ?? (times[i] as number) + 0.4) - 0.15)}" data-dur="0.2"><div style="position:absolute;right:-2px;top:-8px;width:0;height:0;border-left:16px solid ${p.gold};border-top:9px solid transparent;border-bottom:9px solid transparent"></div></div>` : ''
        return `${arrow}<div style="position:absolute;left:${pct(cx - bw / 2, W)};top:38%;width:${pct(bw, W)};padding:26px 0 22px;border-radius:22px;background:#1b1d26;border:2px solid ${p.gold};box-shadow:0 20px 50px rgba(0,0,0,.45);text-align:center" data-anim="pop" data-at="${f2(times[i] as number)}" data-dur="0.35">${icon(x.icon, 60, p.gold)}<div class="lbl" style="position:relative;margin-top:16px;font-size:21px;color:#fff" data-fit="12">${T(x.label)}</div></div>`
      })
      .join('')
    // a near-black ground, no heading: the flow alone, its last arrow leaving the frame (moteur-pov-2, independent judge)
    void seed
    return `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 70% at 50% 50%,#141828,#07080d)"></div>${boxes}`
  }
  const items = s.items
    .map((x, i) => {
      const cx = x0 + i * gap
      return `<div style="position:absolute;left:${pct(cx - 80, W)};top:38%;width:${pct(160, W)};text-align:center" data-anim="pop" data-at="${f2(times[i] as number)}" data-dur="0.35"><div style="width:130px;height:130px;margin:0 auto;border-radius:50%;border:4px solid ${p.gold};display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(245,200,107,.25)">${icon(x.icon, 70, p.gold)}</div><div class="lbl" style="position:relative;margin-top:22px;font-size:22px;color:#fff" data-fit="12">${T(x.label)}</div></div>`
    })
    .join('')
  return `${world(cardGround(p, seed))}${s.title ? label(s.title, { y: H * 0.18, size: 28, color: p.gold, at: 0.05, title: true }) : ''}${items}`
}

export function gridShot(s: Shot<'grid'>, p: Pal, seed: string, D: number): string {
  const cols = s.total > 40 ? 12 : 10
  const rows = Math.ceil(s.total / cols)
  const cell = Math.min(118, 760 / rows, 1500 / cols)
  const x0 = W / 2 - (cols * cell) / 2
  const y0 = H * 0.53 - (rows * cell) / 2
  const start = 0.5
  const step = 1 / s.perSecond
  const cells = Array.from({ length: s.total }, (_, i) => {
    const x = x0 + (i % cols) * cell
    const y = y0 + Math.floor(i / cols) * cell
    const at = start + i * step
    const box = `left:${pct(x, W)};top:${pct(y, H)};width:${pct(cell, W)};height:${pct(cell, H)};display:flex;align-items:center;justify-content:center`
    const dim = `<div style="position:absolute;${box};opacity:.14">${icon(s.icon, cell * 0.55, '#dfe6ff')}</div>`
    return at < D - 0.2 ? `${dim}<div style="position:absolute;${box}" data-anim="pop" data-at="${f2(at)}" data-dur="0.25">${icon(s.icon, cell * 0.55, p.gold, 1.8)}</div>` : dim
  }).join('')
  return `${world(cardGround(p, seed))}${s.title ? label(s.title, { y: H * 0.12, size: 24, at: 0.05, title: true }) : ''}${cells}${s.note ? label(s.note, { y: H * 0.88, size: 24, color: p.gold, at: 0.8 }) : ''}`
}

export function compareShot(s: Shot<'compare'>, p: Pal, seed: string, D: number): string {
  const base = H * 0.86
  const refH = H * 0.3
  const rx = W * 0.62
  const shape =
    s.shape === 'mountain'
      ? `<path d="M${f1(rx - 220)} ${f1(base)} L${f1(rx)} ${f1(base - refH)} L${f1(rx + 220)} ${f1(base)}Z" fill="#1d2a5a" stroke="#6f86d6" stroke-width="3"/><path d="M${f1(rx - 55)} ${f1(base - refH * 0.75)} L${f1(rx)} ${f1(base - refH)} L${f1(rx + 55)} ${f1(base - refH * 0.75)}Z" fill="#dfe6ff" opacity=".8"/>`
      : s.shape === 'tower'
        ? `<path d="M${f1(rx - 60)} ${f1(base)} L${f1(rx - 40)} ${f1(base - refH)} L${f1(rx + 40)} ${f1(base - refH)} L${f1(rx + 60)} ${f1(base)}Z" fill="#1d2a5a" stroke="#6f86d6" stroke-width="3"/>`
        : `<rect x="${f1(rx - 60)}" y="${f1(base - refH)}" width="120" height="${f1(refH)}" fill="#1d2a5a" stroke="#6f86d6" stroke-width="3"/>`
  const bx = W * 0.3
  const growAt = 0.4
  const growS = Math.min(2.2, Math.max(1, D - 1))
  const bar = `<div style="position:absolute;left:${pct(bx - 32, W)};width:${pct(64, W)};top:${pct(H * 0.04, H)};height:${pct(base - H * 0.04, H)};border-radius:32px 32px 4px 4px;background:linear-gradient(${p.gold},#c9953c);box-shadow:0 0 40px rgba(245,200,107,.45);transform-origin:bottom" data-anim="growy" data-at="${f2(growAt)}" data-dur="${f2(growS)}" data-ease="inOut"></div>`
  const axis = `<line x1="${f1(bx - 120)}" y1="${f1(H * 0.06)}" x2="${f1(bx - 120)}" y2="${f1(base)}" stroke="#dfe6ff" stroke-opacity=".5" stroke-width="2"/>`
  const times = `<div class="num glow" style="position:absolute;right:12%;top:6%;font-size:56px;color:${p.gold}">×\u00a0<span data-count data-from="1" data-to="${s.times}" data-dec="0" data-at="${f2(growAt)}" data-dur="${f2(growS)}"></span></div>`
  return `${world(cardGround(p, seed) + axis + shape)}${bar}${times}${label(s.label, { x: bx - 160, y: base + 18, size: 20, anchor: 'left', at: 0.2 })}${label(s.ref, { x: rx - 120, y: base + 18, size: 20, anchor: 'left', at: 0.2 })}`
}

export function chartShot(s: Shot<'chart'>, p: Pal, seed: string, D: number): string {
  const x0 = W * 0.2
  const x1 = W * 0.8
  const y0 = H * 0.78
  const y1 = H * 0.28
  const col = s.tone === 'green' ? '#4fd18b' : s.tone === 'red' ? p.coral : p.gold
  const pts = Array.from({ length: 13 }, (_, i) => {
    const k = i / 12
    const v = s.trend === 'down' ? 1 - k * 0.85 : s.trend === 'up-late' ? (k < 0.55 ? 0.12 + k * 0.05 : 0.15 + ((k - 0.55) / 0.45) ** 2 * 0.85) : 0.1 + k * 0.6 + Math.sin(k * 9) * 0.04 + k * k * 0.25
    return `${f1(x0 + (x1 - x0) * k)} ${f1(y0 - (y0 - y1) * v)}`
  })
  const path = `<path d="M${pts.join(' L')}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" data-draw="1" data-at="0.4" data-dur="${f2(Math.min(2.5, Math.max(1, D - 1)))}"/>`
  const axes = `<path d="M${f1(x0)} ${f1(y1 - 40)} V${f1(y0)} H${f1(x1 + 40)}" fill="none" stroke="#dfe6ff" stroke-opacity=".45" stroke-width="2"/>`
  return `${world(cardGround(p, seed) + `<rect x="${f1(x0 - 60)}" y="${f1(y1 - 110)}" width="${f1(x1 - x0 + 140)}" height="${f1(y0 - y1 + 170)}" rx="18" fill="#0a0e26" opacity=".55"/>` + axes + path)}${s.title ? label(s.title, { x: x0 - 30, y: y1 - 90, size: 22, anchor: 'left', at: 0.1 }) : ''}${s.label ? label(s.label, { x: x1 - 200, y: y1 - 40, size: 20, color: col, anchor: 'left', at: 1.6 }) : ''}`
}

export function phoneShot(s: Shot<'phone'>, p: Pal, seed: string, D: number): string {
  const w = 380
  const h = 760
  const lines = s.lines
    .map((x, i) => {
      const big = x.tone !== 'small'
      const col = x.tone === 'red' ? p.coral : x.tone === 'green' ? '#4fd18b' : big ? p.gold : '#9fb2e8'
      return `<div class="${big ? 'num' : 'lbl'}" style="position:relative;margin-top:${big ? 18 : 10}px;font-size:${big ? 62 : 17}px;color:${col}" data-fit="12" data-anim="${big ? 'pop' : 'fade'}" data-at="${f2(x.atS ?? 0.3 + i * 0.25)}" data-dur="0.3">${T(x.text)}</div>`
    })
    .join('')
  const call = s.call
    ? `<div style="margin-top:120px" data-anim="pop" data-at="0.2" data-dur="0.35"><div style="width:120px;height:120px;margin:0 auto;border-radius:50%;background:#3fae5a;display:flex;align-items:center;justify-content:center;font-size:56px">${T(s.call.name.slice(0, 1).toUpperCase())}</div><div class="lbl" style="position:relative;margin-top:18px;font-size:30px">${T(s.call.name)}</div>${s.call.role ? `<div class="lbl" style="position:relative;margin-top:6px;font-size:14px;color:#9fb2e8">${T(s.call.role)}</div>` : ''}</div><div style="position:absolute;bottom:70px;left:0;right:0;display:flex;justify-content:center;gap:110px"><div style="width:74px;height:74px;border-radius:50%;background:#e2483d"></div><div style="width:74px;height:74px;border-radius:50%;background:#3fae5a"></div></div>`
    : ''
  const crack =
    s.crackAtS !== undefined
      ? `<svg style="position:absolute;inset:0" viewBox="0 0 ${w} ${h}" data-anim="fade" data-at="${f2(s.crackAtS)}" data-dur="0.06"><path d="M${w * 0.62} ${h * 0.3} L${w * 0.45} ${h * 0.45} L${w * 0.58} ${h * 0.55} L${w * 0.3} ${h * 0.82} M${w * 0.45} ${h * 0.45} L${w * 0.15} ${h * 0.4} M${w * 0.58} ${h * 0.55} L${w * 0.9} ${h * 0.7} M${w * 0.62} ${h * 0.3} L${w * 0.8} ${h * 0.08}" fill="none" stroke="#fff" stroke-width="2.5" opacity=".85"/></svg>`
      : ''
  void D
  return `${plateOrGround(s.over ?? 'room', p, seed)}<div style="position:absolute;left:50%;top:50%;width:${w}px;height:${h}px;margin:-${h / 2}px 0 0 -${w / 2}px;border-radius:52px;background:#141a3c;border:6px solid #3a4378;box-shadow:0 30px 80px rgba(0,0,0,.5);text-align:center;overflow:hidden" data-anim="rise" data-at="0" data-dur="0.35" data-dy="40"><div class="lbl" style="position:relative;margin-top:56px;font-size:18px;color:#c8d3ff;letter-spacing:.2em">${T(s.app)}</div>${lines}${call}${[0, 1, 2].map((i) => `<div style="height:44px;margin:${i === 0 ? 60 : 14}px 34px 0;border-radius:10px;background:rgba(160,180,255,.1)"></div>`).join('')}${crack}</div>`
}

export function browserShot(s: Shot<'browser'>, p: Pal, seed: string): string {
  const ok = s.status?.tone === 'ok'
  const status = s.status
    ? `<div style="position:relative;margin:36px auto 0;width:62%;padding:30px 0;border-radius:14px;background:${ok ? '#3fae5a' : '#e2483d'};color:#fff;font-size:30px" class="lbl" data-anim="pop" data-at="${f2(s.status.atS ?? 0.8)}" data-dur="0.3"><div style="font-size:44px;line-height:1">${ok ? '✓' : '✕'}</div>${T(s.status.text)}</div>`
    : ''
  const field = s.field
    ? `<div style="margin:60px auto 0;width:70%;text-align:left;padding:18px 24px;border-radius:10px;border:3px solid #c7cde0;color:#1d2440;font-size:30px;font-family:Inter,sans-serif;font-weight:700" data-anim="fade" data-at="0.3" data-dur="0.3">${T(s.field)}</div>`
    : ''
  return `${plateOrGround(s.over ?? 'office', p, seed)}<div style="position:absolute;left:21%;right:21%;top:17%;bottom:17%;border-radius:14px;background:#fdfdff;box-shadow:0 30px 90px rgba(0,0,0,.5);overflow:hidden;text-align:center" data-anim="rise" data-at="0" data-dur="0.35" data-dy="40"><div class="lbl" style="position:relative;text-align:left;padding:14px 22px;font-size:15px;background:#1d2440;color:#c8d3ff">${T(s.title)}</div>${field}${status}</div>`
}

export function paperShot(s: Shot<'paper'>, p: Pal, seed: string): string {
  const lines = Array.from({ length: 6 }, (_, i) => `<div style="height:8px;margin:${i === 0 ? 34 : 18}px 40px 0;width:${60 + ((i * 37) % 35)}%;background:#d6d0c2;border-radius:4px"></div>`).join('')
  const stamp = s.stamp
    ? `<div class="lbl" style="position:absolute;right:30px;bottom:60px;padding:8px 18px;border:4px solid ${p.coral};color:${p.coral};font-size:34px;border-radius:8px;transform:rotate(-12deg)" data-anim="slam" data-at="${f2(s.stamp.atS ?? 0.9)}" data-dur="0.35" data-dy="6">${T(s.stamp.text)}</div>`
    : ''
  return `${plateOrGround(s.over ?? 'office', p, seed)}<div style="position:absolute;left:50%;top:50%;width:560px;height:760px;margin:-380px 0 0 -280px;background:#f4efe3;box-shadow:0 30px 80px rgba(0,0,0,.45);transform:rotate(-2deg);color:#1d2440" data-anim="rise" data-at="0" data-dur="0.4" data-dy="60"><div class="lbl" style="position:relative;margin-top:60px;text-align:center;font-size:40px;letter-spacing:.12em">${T(s.title)}</div>${s.sub ? `<div class="lbl" style="position:relative;margin-top:14px;text-align:center;font-size:18px;color:${p.coral}">${T(s.sub)}</div>` : ''}${lines}${s.value ? `<div class="num" style="position:relative;margin-top:40px;text-align:center;font-size:44px">${T(s.value)}</div>` : ''}${stamp}</div>`
}

export function dialShot(s: Shot<'dial'>, p: Pal, seed: string, D: number): string {
  const cx = W * (s.bills ? 0.4 : 0.5)
  const cy = H * 0.47
  let art: string
  if (s.look === 'gauges') {
    const gauge = (gx: number, unit: string): string =>
      `<circle cx="${f1(gx)}" cy="${f1(cy)}" r="170" fill="none" stroke="#5a6390" stroke-width="4"/>${Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI * (0.75 + (i / 10) * 1.5)
        return `<line x1="${f1(gx + Math.cos(a) * 140)}" y1="${f1(cy + Math.sin(a) * 140)}" x2="${f1(gx + Math.cos(a) * 160)}" y2="${f1(cy + Math.sin(a) * 160)}" stroke="#8f98c4" stroke-width="3"/>`
      }).join('')}<line x1="${f1(gx)}" y1="${f1(cy)}" x2="${f1(gx - 100)}" y2="${f1(cy + 70)}" stroke="${p.coral}" stroke-width="6" stroke-linecap="round"/><text x="${f1(gx)}" y="${f1(cy + 110)}" text-anchor="middle" font-size="22" fill="#8f98c4" font-family="Montserrat">${unit}</text>`
    const blinks = Array.from({ length: Math.ceil(D / 1) }, (_, i) => `<g data-anim="fade" data-at="${f2(i)}" data-dur="0.02" data-out="${f2(i + 0.5)}" data-out-dur="0.02">${`<rect x="${f1(W / 2 - 40)}" y="${f1(cy - 50)}" width="80" height="50" rx="8" fill="#f2a24a"/><circle cx="${f1(W / 2)}" cy="${f1(cy - 25)}" r="70" fill="#f2a24a" opacity=".2"/>`}</g>`).join('')
    art = `${gauge(W / 2 - 360, 'km/h')}${gauge(W / 2 + 360, 'tr/min')}<rect x="${f1(W / 2 - 40)}" y="${f1(cy - 50)}" width="80" height="50" rx="8" fill="none" stroke="#6b5530" stroke-width="3"/>${blinks}`
  } else {
    const r = s.look === 'stopwatch' ? 200 : 230
    const hands = Array.from({ length: Math.ceil(D) + 1 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 60) * Math.PI * 2 * (s.look === 'stopwatch' ? 5 : 1)
      return `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx + Math.cos(a) * r * 0.82)}" y2="${f1(cy + Math.sin(a) * r * 0.82)}" stroke="#e2483d" stroke-width="5" stroke-linecap="round" data-anim="fade" data-at="${f2(i)}" data-dur="0.01" data-out="${f2(i + 1)}" data-out-dur="0.01"/>`
    }).join('')
    const marks = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2
      return `<line x1="${f1(cx + Math.cos(a) * r * 0.86)}" y1="${f1(cy + Math.sin(a) * r * 0.86)}" x2="${f1(cx + Math.cos(a) * r * 0.95)}" y2="${f1(cy + Math.sin(a) * r * 0.95)}" stroke="#2a2f45" stroke-width="5"/>`
    }).join('')
    const top = s.look === 'stopwatch' ? `<rect x="${f1(cx - 22)}" y="${f1(cy - r - 44)}" width="44" height="36" rx="6" fill="#d8d8e0"/>` : `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx + r * 0.4)}" y2="${f1(cy - r * 0.3)}" stroke="#2a2f45" stroke-width="10" stroke-linecap="round"/>`
    art = `${top}<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${r}" fill="#f4f1ea" stroke="#d8d8e0" stroke-width="10"/>${marks}${hands}<circle cx="${f1(cx)}" cy="${f1(cy)}" r="10" fill="#2a2f45"/>`
  }
  const bills = s.bills
    ? Array.from({ length: Math.ceil(D / 0.5) }, (_, i) => `<div style="position:absolute;left:${pct(cx + 260, W)};top:${pct(cy - 30, H)}" data-move="0,0,700,${(i % 3) * 30 - 30}" data-at="${f2(i * 0.5)}" data-dur="1.4" data-ease="linear"><svg width="80" height="44" viewBox="-40 -22 80 44">${bill(0, 0, 70, 0, p)}</svg></div>`).join('')
    : ''
  const warn = s.warning ? label(s.warning, { y: cy + 10, size: 16, color: '#f2a24a', at: 0.2 }) : ''
  return `${world(cardGround(p, seed) + art)}${bills}${warn}${s.caption ? label(s.caption, { y: H * 0.85, size: 24, color: p.gold, at: 0.4 }) : ''}`
}
