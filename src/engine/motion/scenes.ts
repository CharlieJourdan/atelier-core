// Two more of our motion templates (docs/ENGINE-SPEC.md §25): the list that reveals its items one after the other (a top-N when
// numbered, counting down) and the map pin, a stylised place label (no map tiles: a drawn graticule and a few blobs of land seeded
// by the place's name, so the same place always looks the same). Same contract as cards.ts.
import type { z } from 'zod'
import type { ListProps, MapPinProps } from '../formats/motion'
import { blobPath, esc, outAt, pick, seeded, typo, zone, type MotionCtx } from './base'
import type { Part } from './cards'

const f = (n: number): string => n.toFixed(2)

/** When each item shows: the times the plan gives, else spread evenly between 0.7 s and a second before the way out. */
export function itemTimes(items: readonly { atS?: number | undefined }[], durationS: number): number[] {
  const first = 0.7
  const last = Math.max(first + 0.4, durationS - 1.6)
  const step = items.length > 1 ? (last - first) / (items.length - 1) : 0
  return items.map((it, i) => it.atS ?? first + i * step)
}

export function list(p: z.infer<typeof ListProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const n = p.items.length
  const w = pick(c, 980, z0.width)
  const head = p.heading ? pick(c, 96, 90) : 0
  const pad = pick(c, 44, 38)
  const rowH = Math.min(pick(c, 118, 124), Math.floor((z0.height - head - 2 * pad) / n))
  const h = head + 2 * pad + rowH * n
  const top = z0.top + Math.max(0, Math.round((z0.height - h) / 2))
  const times = itemTimes(p.items, c.durationS)
  const rows = p.items
    .map((it, i) => {
      const num = p.order === 'desc' ? n - i : i + 1
      return `<div class="it" style="height:${rowH}px" data-anim="left" data-at="${f(times[i] as number)}" data-dx="160" data-dur="0.5" data-out="${f(out)}">
${p.numbered ? `<div class="no">${num}</div>` : '<div class="dot"></div>'}<div class="tx" data-fit="24">${esc(typo(it.text))}</div></div>`
    })
    .join('\n')
  const circle = Math.round(rowH * 0.68)
  return {
    css: `
.ls{position:absolute;left:${pick(c, z0.left, z0.left)}px;top:${top}px;width:${w}px;height:${h}px;padding:${pad}px ${pick(c, 50, 38)}px;background:var(--panel);border:1px solid var(--line);border-radius:34px;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.ls .hd{height:${head}px;font-size:${pick(c, 38, 34)}px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;white-space:nowrap;overflow:hidden}
.it{display:flex;align-items:center;gap:${pick(c, 28, 22)}px}
.it .no{flex:none;width:${circle}px;height:${circle}px;border-radius:50%;background:var(--chip);color:var(--chip-text);font-weight:700;font-size:${Math.round(circle * 0.56)}px;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.it .dot{flex:none;width:18px;height:18px;border-radius:50%;background:var(--accent);margin:0 ${Math.round((circle - 18) / 2)}px}
.it .tx{flex:1;min-width:0;font-size:${pick(c, 54, 48)}px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;padding-bottom:4px}`,
    body: `<div class="ls" data-anim="rise" data-at="0" data-dy="30" data-dur="0.5" data-out="${f(out)}">
${p.heading ? `<div class="hd" data-fit="20" data-anim="fade" data-at="0.2">${esc(typo(p.heading))}</div>` : ''}
${rows}
</div>`
  }
}

export function mapPin(p: z.infer<typeof MapPinProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const w = pick(c, 940, z0.width)
  const h = pick(c, 580, 660)
  const left = pick(c, z0.left, z0.left)
  const top = z0.top + Math.max(0, Math.round((z0.height - h) / 2))
  const rnd = seeded(`${p.place}|${p.region ?? ''}`)
  const px = Math.round(w * (0.34 + rnd() * 0.32))
  const py = Math.round(h * (0.3 + rnd() * 0.22))
  const lands = Array.from({ length: 4 }, () => blobPath(rnd, w * (0.15 + rnd() * 0.7), h * (0.15 + rnd() * 0.5), Math.min(w, h) * (0.16 + rnd() * 0.14)))
  const grid: string[] = []
  for (let x = 0; x <= w; x += 80) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`)
  for (let y = 0; y <= h; y += 80) grid.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`)
  return {
    css: `
.mp{position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;border-radius:34px;overflow:hidden;background:linear-gradient(160deg,#17202f,#0b1019);box-shadow:0 18px 60px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.16)}
.mp svg.bg{position:absolute;inset:0}
.mp .ring{position:absolute;left:${px - 38}px;top:${py - 38}px;width:76px;height:76px;border-radius:50%;border:5px solid var(--accent)}
.mp .pin{position:absolute;left:${px - 34}px;top:${py - 96}px;width:68px;height:96px}
.mp .tag{position:absolute;left:0;right:0;bottom:0;padding:${pick(c, 30, 28)}px ${pick(c, 44, 36)}px ${pick(c, 34, 30)}px;background:linear-gradient(0deg,rgba(5,8,13,.92),rgba(5,8,13,.0));color:#fff}
.mp .pl{font-size:${pick(c, 64, 58)}px;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;padding-bottom:4px}
.mp .cp{margin-top:6px;font-size:${pick(c, 34, 32)}px;color:rgba(255,255,255,.76);white-space:nowrap;overflow:hidden}`,
    body: `<div class="mp" data-anim="pop" data-at="0" data-dur="0.5" data-out="${f(out)}">
<svg class="bg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g stroke="rgba(255,255,255,.07)" stroke-width="2">${grid.join('')}</g>
<g fill="rgba(255,255,255,.075)" stroke="rgba(255,255,255,.16)" stroke-width="2">${lands.map((d) => `<path d="${d}"/>`).join('')}</g></svg>
<div class="ring" data-pulse data-at="0.9" data-period="1.5"></div>
<div class="pin" data-anim="drop" data-at="0.35" data-dur="0.7" data-dy="260"><svg viewBox="0 0 68 96" width="68" height="96"><path d="M34 94C34 94 4 58 4 34a30 30 0 0 1 60 0C64 58 34 94 34 94Z" fill="var(--accent)" stroke="#fff" stroke-width="4"/><circle cx="34" cy="34" r="11" fill="#fff"/></svg></div>
<div class="tag" data-anim="rise" data-at="0.9" data-dy="26" data-dur="0.5">
<div class="pl" data-fit="30">${esc(typo(p.place))}</div>
${p.caption || p.region ? `<div class="cp" data-fit="20">${esc(typo(p.caption ?? p.region ?? ''))}</div>` : ''}
</div></div>`
  }
}
