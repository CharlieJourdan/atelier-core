// The first-person shot of the POV cards (moteur-briques, formats/pov.ts `hand`): the place defocused behind, and the viewer's own arm
// coming in from a lower corner to hold a thing up — a lottery ticket, a phone, a bank card, a paper, a sticky note, a bill — with its
// few words landing on their own words. Measured on the reference's frames (Le Monde en POV, 2026-11-04 proof): a thick sleeve in the
// narrator's colour, a dark stick-figure hand gripping the lower corner, the object slightly tilted and drifting as if held. Pure
// strings in the 1920 × 1080 world.
import type { PovShot } from '../formats/pov'
import { esc, typo } from './base'
import { H, W, f1, f2, world, type Pal } from './pov-kit'
import { plateOrGround } from './pov-ui'

type Hand = Extract<PovShot, { kind: 'hand' }>
const T = (s: string): string => esc(typo(s))

interface Thing {
  w: number
  h: number
  /** The object's own box style. */
  box: string
  /** Its heading and text colours. */
  head: string
  ink: string
}

function thing(s: Hand, p: Pal): Thing {
  switch (s.hold) {
    case 'phone':
      return { w: 380, h: 760, box: 'border-radius:54px;background:#fbfbfe;border:12px solid #15161c;box-shadow:0 34px 90px rgba(0,0,0,.55)', head: '#6d3fd6', ink: '#1d2440' }
    case 'card':
      return { w: 600, h: 378, box: `border-radius:30px;background:linear-gradient(135deg,${p.colors.green},#1f6d4a);box-shadow:0 30px 80px rgba(0,0,0,.5)`, head: '#ffffff', ink: '#eafff2' }
    case 'paper':
      return { w: 540, h: 720, box: 'border-radius:6px;background:#f6f2e8;box-shadow:0 30px 80px rgba(0,0,0,.5)', head: '#1d2440', ink: '#3a3f55' }
    case 'note':
      return { w: 440, h: 440, box: 'border-radius:4px;background:#f7d35a;box-shadow:0 26px 70px rgba(0,0,0,.45)', head: '#3b2a05', ink: '#3b2a05' }
    case 'bill':
      return { w: 660, h: 310, box: 'border-radius:10px;background:linear-gradient(90deg,#9cc8a0,#cfe6c8 50%,#9cc8a0);border:6px solid #6e9c74;box-shadow:0 26px 70px rgba(0,0,0,.45)', head: '#244a2a', ink: '#244a2a' }
    default:
      // a lottery or shop ticket: cream, a coloured band, numbers in circles, a barcode
      return { w: 640, h: 320, box: 'border-radius:12px;background:#f4efe3;box-shadow:0 30px 80px rgba(0,0,0,.5)', head: '#2b5cd6', ink: '#1d2440' }
  }
}

function lines(s: Hand, t: Thing, p: Pal): string {
  return s.lines
    .map((x, i) => {
      const big = x.tone === 'big'
      const col = x.tone === 'red' ? p.coral : x.tone === 'green' ? '#2f9e5b' : t.ink
      return `<div class="${big ? 'num' : 'lbl'}" style="position:relative;margin-top:${big ? 14 : 8}px;font-size:${big ? (s.hold === 'phone' ? 54 : 46) : x.tone === 'small' ? 20 : 26}px;color:${col}" data-fit="12" data-anim="${big ? 'pop' : 'fade'}" data-at="${f2(x.atS ?? 0.35 + i * 0.25)}" data-dur="0.3">${T(x.text)}</div>`
    })
    .join('')
}

/** The numbers a ticket or a results screen shows: the director's, else seeded ones (five numbers 1–50, two stars 1–12). */
export function ballsOf(s: Pick<Hand, 'balls'>, seed: string): number[] {
  if (s.balls && s.balls.length > 0) return s.balls
  let r = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11)
  const rnd = (n: number): number => ((r = (r * 1103515245 + 12345) >>> 0) % n) + 1
  const main = new Set<number>()
  while (main.size < 5) main.add(rnd(50))
  const stars = new Set<number>()
  while (stars.size < 2) stars.add(rnd(12))
  return [...[...main].sort((a, b) => a - b), ...[...stars].sort((a, b) => a - b)]
}

/** A row of numbered circles, the last two as gold stars when there are seven (a draw's five numbers and two stars). */
function ballRow(nums: readonly number[], ink: string, size: number, at: number): string {
  const stars = nums.length === 7 ? 2 : 0
  return nums
    .map((n, i) => {
      const star = i >= nums.length - stars
      const anim = `data-anim="pop" data-at="${f2(at + i * 0.08)}" data-dur="0.2"`
      // a star: a gold five-point star drawn in SVG with its number over it
      if (star) return `<span class="num" style="position:relative;display:inline-block;width:${size}px;height:${size}px;margin:0 ${Math.round(size * 0.12)}px;vertical-align:middle;text-align:center" ${anim}><svg viewBox="0 0 100 100" width="${size}" height="${size}" style="position:absolute;left:0;top:0"><polygon points="50,3 62,37 98,37 69,58 80,93 50,72 20,93 31,58 2,37 38,37" fill="#e8b631" stroke="#b9861a" stroke-width="3"/></svg><span style="position:relative;line-height:${size + 4}px;font-size:${Math.round(size * 0.34)}px;color:#3b2a05">${n}</span></span>`
      const box = `width:${size - 6}px;height:${size - 6}px;line-height:${size - 6}px;border-radius:50%;border:3px solid ${ink};font-size:${Math.round(size * 0.4)}px`
      return `<span class="num" style="display:inline-block;margin:0 ${Math.round(size * 0.12)}px;vertical-align:middle;text-align:center;${box}" ${anim}>${n}</span>`
    })
    .join('')
}

/** The ticket's own marks: its grid of numbers (and stars), a serial line and a barcode (they make it read as a ticket). */
function ticketMarks(s: Hand, t: Thing, seed: string): string {
  const nums = ballsOf(s, seed)
  const bars = Array.from({ length: 34 }, (_, i) => `<span style="display:inline-block;width:${i % 3 === 0 ? 5 : 2}px;height:46px;margin-right:${i % 4 === 0 ? 4 : 2}px;background:${t.ink}"></span>`).join('')
  // a ticket always shows its grid: five numbers and two stars (the reference's held tickets)
  const grid = ballRow(nums, t.ink, 46, 0.3)
  const serial = (nums.reduce((h, n) => h * 7 + n, 3) % 900000) + 100000
  const fine = `<div class="num" style="position:absolute;right:36px;bottom:30px;font-size:17px;opacity:.75;text-align:right;line-height:1.5">2,50 €<br>N° ${serial}</div>`
  return `<div style="position:relative;margin-top:18px;text-align:center">${grid}</div><div style="position:absolute;left:40px;bottom:26px">${bars}</div>${fine}`
}

/** What a phone's screen shows besides its words: a results page (the numbers drawn, a match badge), an incoming call (a name,
 *  answer and decline), or notifications on a lock screen; plain keeps the words only. */
function phoneScreen(s: Hand, t: Thing, p: Pal, seed: string): string {
  const skeleton = (n: number, from: number): string =>
    Array.from({ length: n }, (_, i) => `<div style="position:relative;margin:14px 34px 0;height:12px;border-radius:6px;background:#dfe2ee;width:${70 - ((i * 17) % 30)}%" data-anim="fade" data-at="${f2(from + i * 0.1)}" data-dur="0.2"></div>`).join('')
  switch (s.detail) {
    case 'results': {
      const nums = ballsOf(s, seed)
      return `<div style="position:relative;margin:${s.title ? 22 : 64}px 0 0;text-align:center;white-space:nowrap">${ballRow(nums, t.ink, 40, 0.45)}</div>` +
        `<div class="lbl" style="position:relative;display:inline-block;margin-top:22px;padding:8px 18px;border-radius:999px;background:#2f9e5b;color:#fff;font-size:20px" data-anim="pop" data-at="${f2(Math.min(1.6, 0.45 + nums.length * 0.08 + 0.3))}" data-dur="0.25">✓ ${nums.length === 7 ? '5 + 2' : String(nums.length)}</div>${skeleton(3, 1)}` +
        // the draws before, as rows of small numbers (the screen reads as a results page, not an empty card)
        [1, 2, 3].map((k) => `<div style="position:relative;margin:${k === 1 ? 30 : 14}px 26px 0;padding:10px 0;border-top:2px solid #e6e8f1;text-align:center;white-space:nowrap;opacity:.7">${ballRow(ballsOf({ balls: undefined }, `${seed}${k}`).slice(0, 5), '#8a90a8', 30, 1.1 + k * 0.15)}</div>`).join('')
    }
    case 'call':
      return `<div style="position:relative;margin:34px auto 0;width:150px;height:150px;border-radius:50%;background:${p.colors.purple};opacity:.85"></div>` +
        `<div style="position:absolute;left:0;right:0;bottom:90px;display:flex;justify-content:space-around">` +
        `<div style="width:92px;height:92px;border-radius:50%;background:#e2453c;box-shadow:0 8px 20px rgba(0,0,0,.25)"><div style="margin:40px auto 0;width:44px;height:12px;border-radius:6px;background:#fff;transform:rotate(-20deg)"></div></div>` +
        `<div style="width:92px;height:92px;border-radius:50%;background:#2f9e5b;box-shadow:0 8px 20px rgba(0,0,0,.25)" data-anim="pop" data-at="0.4" data-dur="0.3"><div style="margin:40px auto 0;width:44px;height:12px;border-radius:6px;background:#fff;transform:rotate(20deg)"></div></div></div>`
    case 'plain':
    case 'message': {
      const clock = `${17 + (seed.length % 5)}:${String(10 + ((seed.charCodeAt(0) || 3) % 49))}`
      const said = s.lines.map((l) => l.text)
      const bubble = (i: number): string =>
        `<div style="position:relative;margin:${i ? 12 : 26}px 26px 0;padding:14px 16px;border-radius:18px;background:#eef0f7;text-align:left" data-anim="rise" data-at="${f2(said[i] !== undefined ? (s.lines[i]?.atS ?? 0.45 + i * 0.5) : 0.45 + i * 0.5)}" data-dur="0.3" data-dy="20"><div style="width:26px;height:26px;border-radius:8px;background:${i ? p.colors.blue : p.coral};display:inline-block;vertical-align:middle"></div>` +
        (said[i] !== undefined
          ? `<div style="display:inline-block;vertical-align:middle;margin-left:12px;max-width:76%"><div class="lbl" style="position:relative;display:block;font-size:13px;color:#8a90a8;letter-spacing:.08em">${i ? 'MESSAGES' : 'NOTIFICATION'}</div><div class="num" style="position:relative;display:block;margin-top:3px;font-size:19px;color:#14161f;font-weight:800;text-transform:none">${T(said[i]!)}</div></div>`
          : `<div style="display:inline-block;vertical-align:middle;margin-left:12px;width:64%;height:12px;border-radius:6px;background:#c9cede"></div><div style="margin:10px 0 0 38px;width:52%;height:10px;border-radius:5px;background:#dadeea"></div>`) +
        `</div>`
      // the reference's lock screen: a violet-to-peach gradient behind the time and the notifications
      return `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#5b3fa8 0%,#b066a8 55%,#f2a07b 100%)"></div><div class="num" style="position:relative;margin-top:${s.title ? 22 : 64}px;font-size:76px;color:#fff">${clock}</div>${bubble(0)}${bubble(1)}`
    }
    default:
      return ''
  }
}

function cardMarks(): string {
  return `<div style="position:absolute;left:46px;top:120px;width:84px;height:62px;border-radius:10px;background:linear-gradient(135deg,#f5d77a,#c79a2e)"></div><div class="num" style="position:absolute;left:46px;bottom:44px;font-size:34px;letter-spacing:.12em;color:#eafff2">•••• 4821</div>`
}

/** The arm and the hand gripping the thing's lower corner (`gx`, `gy` in the world), from the side's lower corner. */
function arm(s: Hand, p: Pal, gx: number, gy: number): string {
  const right = s.side === 'right'
  // a short arm rising from the bottom edge below the thing (the reference: foreshortened, not a long tube from the side)
  const sx = gx + (right ? 230 : -230)
  const sy = H + 220
  const sleeve = p.colors[s.color]
  const cx = (sx + gx) / 2 + (right ? 40 : -40)
  const cy = (sy + gy) / 2 + 20
  const tube = `M${f1(sx)} ${f1(sy)} Q${f1(cx)} ${f1(cy)} ${f1(gx)} ${f1(gy)}`
  // the stick-figure hand: a dark fist, the thumb over the edge
  const dir = right ? -1 : 1
  // moteur-pov-2 (independent judge): a shaded sleeve rather than a flat tube, a small dark hand and a thin stick finger
  return `<path d="${tube}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="140" stroke-linecap="round" transform="translate(${dir * -10},14)"/>` +
    `<path d="${tube}" fill="none" stroke="${sleeve}" stroke-width="118" stroke-linecap="round"/>` +
    `<path d="${tube}" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="40" stroke-linecap="round" transform="translate(${dir * -26},20)"/>` +
    `<path d="${tube}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="26" stroke-linecap="round" transform="translate(${dir * 26},-20)"/>` +
    `<ellipse cx="${f1(gx + dir * 4)}" cy="${f1(gy + 6)}" rx="58" ry="52" fill="#17171d"/><ellipse cx="${f1(gx + dir * -10)}" cy="${f1(gy - 8)}" rx="24" ry="16" fill="rgba(255,255,255,.08)"/>` +
    `<line x1="${f1(gx + dir * 20)}" y1="${f1(gy - 20)}" x2="${f1(gx + dir * 62)}" y2="${f1(gy - 92)}" stroke="#17171d" stroke-width="18" stroke-linecap="round"/>`
}

/** One held thing drawn at its place: its box, its heading, its marks and its words (the screen of a phone). */
function objectHtml(s: Hand, p: Pal, seed: string, cx: number, cy: number, tilt: number, scale = 1): string {
  const t = thing(s, p)
  const lock = s.hold === 'phone' && (s.detail === 'plain' || s.detail === 'message')
  const head = s.title && !lock
    ? s.hold === 'phone'
      ? `<div class="lbl" style="position:relative;margin:58px 28px 0;padding:14px 0;border-radius:14px;background:${t.head};color:#fff;font-size:22px;letter-spacing:.14em">${T(s.title)}</div>`
      : s.hold === 'ticket'
        ? `<div class="lbl" style="position:relative;padding:16px 0;background:${t.head};color:#fff;font-size:26px;letter-spacing:.2em;border-radius:12px 12px 0 0">${T(s.title)}</div>`
        : `<div class="lbl" style="position:relative;margin-top:${s.hold === 'card' ? 34 : 46}px;font-size:${s.hold === 'card' ? 26 : 32}px;color:${t.head};letter-spacing:.14em">${T(s.title)}</div>`
    : ''
  // a phone's status bar (time, battery) and its screen's detail; a ticket's grid; a card's chip
  const status = s.hold === 'phone' ? `<div class="num" style="position:absolute;left:34px;right:34px;top:18px;font-size:17px;color:${t.ink};display:flex;justify-content:space-between"><span>18:42</span><span style="display:inline-block;width:34px;height:15px;border:2px solid ${t.ink};border-radius:4px"></span></div>` : ''
  const marks = s.hold === 'ticket' ? ticketMarks(s, t, seed) : s.hold === 'card' ? cardMarks() : s.hold === 'phone' ? phoneScreen(s, t, p, seed) : ''
  return `<div style="position:absolute;left:${f1(cx - t.w / 2)}px;top:${f1(cy - t.h / 2)}px;width:${t.w}px;height:${t.h}px;${t.box};transform:rotate(${tilt}deg) scale(${scale});text-align:center;overflow:hidden;color:${t.ink}">${status}${head}${marks}<div style="position:relative;${s.hold === 'card' ? 'margin-top:60px' : ''}">${lock ? '' : lines(s, t, p)}</div></div>`
}

/** The first-person shot: the place defocused, the thing held up and drifting, the arm over its corner. */
export function handShot(s: Hand, p: Pal, seed: string, D: number): string {
  const t = thing(s, p)
  const right = s.side === 'right'
  const cx = s.beside ? (right ? W * 0.38 : W * 0.62) : right ? W * 0.45 : W * 0.55
  const cy = H * 0.5
  const tilt = right ? -7 : 7
  // the grip: the thing's lower corner on the arm's side, turned with the thing's tilt
  const lx = (right ? 0.36 : -0.36) * t.w
  const ly = 0.4 * t.h
  const a = (tilt * Math.PI) / 180
  const gx = cx + lx * Math.cos(a) - ly * Math.sin(a)
  const gy = cy + lx * Math.sin(a) + ly * Math.cos(a)
  const object = objectHtml(s, p, seed, cx, cy, tilt)
  // two things side by side (the reference: a ticket by a phone, a ticket by its price): the second one lies beside, unheld
  const other = s.beside ? objectHtml({ ...s, hold: s.beside, detail: s.besideDetail ?? (s.beside === 'ticket' ? 'numbers' : s.beside === 'phone' ? 'results' : 'plain'), title: undefined, lines: [] } as Hand, p, `${seed}b`, right ? W * 0.76 : W * 0.24, H * 0.47, right ? 5 : -5, 0.82) : ''
  // the hand comes up, then drifts a little as a held thing does
  const held = `<div class="layer" data-move="0,0,${right ? -14 : 14},-10" data-at="0.3" data-dur="${f2(Math.max(0.5, D - 0.3))}" data-ease="linear"><div class="layer stage" style="position:absolute;inset:0">${other}${object}${world(arm(s, p, gx, gy))}</div></div>`
  return `${plateOrGround(s.over, p, seed)}<div class="layer" data-anim="rise" data-at="0" data-dur="0.4" data-dy="90">${held}</div>`
}

/** The depth finish over a deep shot: a vignette, a fine film grain, a soft warm bloom from above and dust floating up in the
 *  light (the reference's lit rooms, independent judge 2026-11-05), seeded by the shot. */
export function depthFinish(seed: string, D = 4): string {
  const n = (seed.charCodeAt(0) || 7) % 50
  let r = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rnd = (): number => ((r = (r * 1103515245 + 12345) >>> 0) % 10_000) / 10_000
  const dust = Array.from({ length: 22 }, () => {
    const size = 3 + rnd() * 5
    const x = rnd() * W
    const y = H * (0.15 + rnd() * 0.8)
    return `<div style="position:absolute;left:${f1(x)}px;top:${f1(y)}px" data-move="0,0,${f1((rnd() - 0.5) * 40)},${f1(-30 - rnd() * 60)}" data-at="0" data-dur="${f2(Math.max(1, D))}" data-ease="linear"><div style="width:${f1(size)}px;height:${f1(size)}px;border-radius:50%;background:rgba(255,236,200,${f2(0.25 + rnd() * 0.35)});filter:blur(${f1(size > 6 ? 1.5 : 0.6)}px)"></div></div>`
  }).join('')
  return `<div style="position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;background:radial-gradient(ellipse 55% 45% at 50% 8%,rgba(255,214,150,.20),transparent 70%)"></div>` +
    `<div style="position:absolute;inset:0;pointer-events:none">${dust}</div>` +
    `<div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 75% 70% at 50% 48%,transparent 55%,rgba(0,0,0,.55) 100%)"></div>` +
    `<svg style="position:absolute;inset:0;width:100%;height:100%;opacity:.09;mix-blend-mode:overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><filter id="g${n}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${n}"/></filter><rect width="100%" height="100%" filter="url(#g${n})"/></svg>`
}
