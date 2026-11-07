// The drawn sets and props of the POV scenes (formats/pov.ts): flat vector places at dusk (a room with its window on the city, a
// street of buildings, a showroom's glass wall, a hall of arched windows, the sea, the open skyline, a village, a stadium, a bank, space)
// and side-view props (cars, a yacht, a plane, a rocket, a desk, a stack of bills…). Each set says where its ground is and how tall a
// figure stands on it. Seeded: the same seed draws the same windows and stars. Pure strings in the 1920 × 1080 world of pov-kit.ts.
import type { PovColor, PovProp, PovSet } from '../formats/pov'
import { seeded } from './base'
import { H, W, bill, f1, f2, type Pal } from './pov-kit'

export interface SetDraw {
  svg: string
  /** Where feet and wheels stand (px) and how tall a figure is there. */
  groundY: number
  figureH: number
}

const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${fill}"${extra}/>`

function sky(p: Pal, id: string, y1 = H, sun: { x: number; y: number; r: number } | null = { x: W * 0.62, y: H * 0.62, r: 70 }): string {
  return `<defs><linearGradient id="s-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.skyTop}"/><stop offset=".55" stop-color="${p.skyMid}"/><stop offset="1" stop-color="${p.skyLow}"/></linearGradient>
<radialGradient id="sun-${id}"><stop offset="0" stop-color="${p.sun}"/><stop offset=".35" stop-color="${p.sun}" stop-opacity=".55"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient></defs>
${rect(0, 0, W, y1, `url(#s-${id})`)}${sun ? `<circle cx="${f1(sun.x)}" cy="${f1(sun.y)}" r="${f1(sun.r * 4)}" fill="url(#sun-${id})"/><circle cx="${f1(sun.x)}" cy="${f1(sun.y)}" r="${f1(sun.r)}" fill="${p.sun}"/>` : ''}`
}

function stars(rnd: () => number, n: number, y1: number): string {
  return Array.from({ length: n }, () => `<circle cx="${f1(rnd() * W)}" cy="${f1(rnd() * y1)}" r="${f1(0.8 + rnd() * 1.5)}" fill="#fff" opacity="${f2(0.2 + rnd() * 0.5)}"/>`).join('')
}

/** A skyline of towers with lit windows standing on `base`, between x0 and x1 (px). */
export function skyline(p: Pal, rnd: () => number, base: number, x0 = 0, x1 = W, tall = 0.42, dark = false): string {
  let x = x0
  let out = ''
  while (x < x1) {
    const w = 46 + rnd() * 90
    const h = H * (0.08 + rnd() * tall)
    const top = base - h
    out += rect(x, top, w + 1, h, dark ? p.bldDark : p.bld)
    if (rnd() < 0.3) out += rect(x + w * 0.4, top - 26, 4, 26, dark ? p.bldDark : p.bld)
    for (let wy = top + 12; wy < base - 10; wy += 16) {
      for (let wx = x + 8; wx < x + w - 10; wx += 13) if (rnd() < 0.34) out += rect(wx, wy, 6, 8, p.win, ` opacity="${f2(0.35 + rnd() * 0.65)}"`)
    }
    x += w + rnd() * 6
  }
  return out
}

/** A window frame of `cols` × `rows` panes over the dusk city (x, y, w, h in px). */
function cityWindow(p: Pal, id: string, rnd: () => number, x: number, y: number, w: number, h: number, cols: number, rows = 1): string {
  const inner = `<svg x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">${sky(p, `${id}w`)}${skyline(p, rnd, H, 0, W, 0.55)}</svg>`
  let bars = ''
  for (let i = 1; i < cols; i++) bars += rect(x + (w * i) / cols - 5, y, 10, h, p.wallDark)
  for (let j = 1; j < rows; j++) bars += rect(x, y + (h * j) / rows - 5, w, 10, p.wallDark)
  return `${inner}${bars}<rect x="${f1(x - 10)}" y="${f1(y - 10)}" width="${f1(w + 20)}" height="${f1(h + 20)}" fill="none" stroke="${p.wallDark}" stroke-width="20"/>`
}

function interior(p: Pal, id: string, floorY: number): string {
  return `<defs><linearGradient id="w-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wallDark}"/><stop offset="1" stop-color="${p.wall}"/></linearGradient>
<radialGradient id="l-${id}" cx="50%" cy="80%" r="60%"><stop offset="0" stop-color="${p.skyLow}" stop-opacity=".22"/><stop offset="1" stop-color="${p.skyLow}" stop-opacity="0"/></radialGradient></defs>
${rect(0, 0, W, floorY, `url(#w-${id})`)}${rect(0, floorY, W, H - floorY, p.floor)}${rect(0, 0, W, H, `url(#l-${id})`)}`
}

/** The set of a scene (its background) and where its ground is. `sign` is a shop's or showroom's name (drawn by the card as text). */
export function drawSet(set: PovSet, p: Pal, seed: string): SetDraw {
  const rnd = seeded(`${seed}:${set}`)
  const id = `${set}${seed}`.replace(/[^a-z0-9]/gi, '')
  switch (set) {
    case 'room':
    case 'bedroom':
    case 'office': {
      const floorY = H * 0.8
      const big = set === 'office'
      const night = set === 'bedroom'
      const ww = big ? W * 0.62 : W * 0.3
      // moteur-pov-2 (independent judge): the reference's rooms differ from shot to shot — the window moves, warm spotlight
      // cones fall from the ceiling, a wall clock, a framed picture or a shelf of coloured boxes furnish the wall (seeded)
      const side = big ? 0.5 : [0.5, 0.3, 0.7][Math.floor(rnd() * 3)]!
      const wx = W * side - ww / 2
      const pp = night ? { ...p, skyLow: p.skyMid } : p
      const free = (x: number): boolean => Math.abs(x - W * side) > ww / 2 + 120
      const spots = Array.from({ length: 1 + Math.floor(rnd() * 2) }, (_, k) => {
        const x = W * (0.25 + k * 0.45 + rnd() * 0.1)
        return `<defs><linearGradient id="s-${id}${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".34"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></linearGradient></defs><path d="M${f1(x - 26)} 0 L${f1(x + 26)} 0 L${f1(x + 210)} ${f1(floorY)} L${f1(x - 210)} ${f1(floorY)}Z" fill="url(#s-${id}${k})"/><rect x="${f1(x - 30)}" y="0" width="60" height="14" rx="4" fill="${p.wallDark}"/>`
      }).join('')
      const clockX = free(W * 0.14) ? W * 0.14 : W * 0.86
      const clock = rnd() < 0.6 ? `<circle cx="${f1(clockX)}" cy="${f1(H * 0.2)}" r="30" fill="#e8e6f0" opacity=".9"/><line x1="${f1(clockX)}" y1="${f1(H * 0.2)}" x2="${f1(clockX)}" y2="${f1(H * 0.2 - 18)}" stroke="#2a2a33" stroke-width="4" stroke-linecap="round"/><line x1="${f1(clockX)}" y1="${f1(H * 0.2)}" x2="${f1(clockX + 13)}" y2="${f1(H * 0.2 + 6)}" stroke="#2a2a33" stroke-width="4" stroke-linecap="round"/>` : ''
      const frameX = free(W * 0.84) ? W * 0.84 : W * 0.16
      const frame = rnd() < 0.6 ? `<rect x="${f1(frameX - 60)}" y="${f1(H * 0.3)}" width="120" height="84" rx="4" fill="#3a2a22" opacity=".95"/><rect x="${f1(frameX - 50)}" y="${f1(H * 0.3 + 10)}" width="100" height="64" fill="#c99a6a" opacity=".55"/>` : ''
      const shelfX = side === 0.3 ? W * 0.68 : W * 0.12
      const colours = ['#e2c046', '#d9554a', '#4f9ed1', '#6dbb6a', '#e8e6f0', '#c07ad1']
      const shelf = !big && rnd() < 0.5 ? Array.from({ length: 2 }, (_, r) => `<rect x="${f1(shelfX)}" y="${f1(H * (0.34 + r * 0.1) + 34)}" width="300" height="6" fill="${p.wallDark}"/>` + Array.from({ length: 12 }, (_, k) => `<rect x="${f1(shelfX + 6 + k * 24)}" y="${f1(H * (0.34 + r * 0.1))}" width="18" height="34" fill="${colours[(k + r * 3) % colours.length]}" opacity=".85"/>`).join('')).join('') : ''
      return {
        svg: `${interior(p, id, floorY)}${stars(rnd, 30, floorY)}${cityWindow(pp, id, rnd, wx, H * 0.18, ww, H * 0.36, big ? 4 : 2, big ? 1 : 2)}${shelf}${clock}${frame}${spots}`,
        groundY: floorY + 24,
        figureH: H * 0.36
      }
    }
    case 'street': {
      const ground = H * 0.78
      let blds = ''
      let x = -20
      while (x < W) {
        const w = 160 + rnd() * 180
        const h = H * (0.3 + rnd() * 0.32)
        const col = rnd() < 0.5 ? p.wall : p.wallDark
        blds += rect(x, ground - h, w, h, col)
        for (let wy = ground - h + 34; wy < ground - 70; wy += 78) for (let wx = x + 26; wx < x + w - 46; wx += 66) blds += rect(wx, wy, 32, 44, rnd() < 0.32 ? p.win : p.wallDark, ` opacity="${f2(rnd() < 0.32 ? 0.75 : 0.9)}"`)
        x += w + 4
      }
      return {
        svg: `${sky(p, id, ground, { x: W * 0.72, y: H * 0.16, r: 46 })}${blds}${rect(0, ground, W, 26, p.wallDark)}${rect(0, ground + 26, W, H - ground, p.floor)}${Array.from({ length: 12 }, (_, i) => rect(i * 170 + 40, ground + 120, 80, 8, '#d9d3c7', ' opacity=".55"')).join('')}`,
        groundY: ground + 70,
        figureH: H * 0.24
      }
    }
    case 'showroom':
    case 'bank':
    case 'hall': {
      const floorY = H * 0.82
      if (set === 'showroom') {
        let mull = ''
        for (let i = 0; i <= 10; i++) mull += rect((i * W) / 10 - 4, H * 0.08, 8, floorY - H * 0.08, p.wallDark)
        const cones = [0.18, 0.5, 0.82].map((c) => `<path d="M${f1(W * c)} ${f1(H * 0.09)} L${f1(W * c - 150)} ${f1(floorY)} L${f1(W * c + 150)} ${f1(floorY)}Z" fill="#fff" opacity=".07"/><circle cx="${f1(W * c)}" cy="${f1(H * 0.1)}" r="6" fill="#fff"/>`).join('')
        return {
          svg: `${sky(p, id, floorY)}${skyline(p, rnd, floorY, 0, W, 0.4)}${mull}${rect(0, H * 0.62, W, 8, p.wallDark)}${rect(0, 0, W, H * 0.08, p.wallDark)}${cones}${rect(0, floorY, W, H - floorY, p.floor)}${rect(0, floorY, W, 4, p.skyLow, ' opacity=".35"')}`,
          groundY: floorY + 40,
          figureH: H * 0.3
        }
      }
      if (set === 'bank') {
        const cols = Array.from({ length: 8 }, (_, i) => rect(W * 0.2 + i * W * 0.085, H * 0.36, 44, floorY - H * 0.36, '#d8cfc2')).join('')
        return {
          svg: `${sky(p, id, floorY, { x: W * 0.85, y: H * 0.2, r: 40 })}<path d="M${f1(W * 0.16)} ${f1(H * 0.36)} L${f1(W * 0.5)} ${f1(H * 0.16)} L${f1(W * 0.84)} ${f1(H * 0.36)}Z" fill="#cfc5b6"/>${rect(W * 0.16, H * 0.33, W * 0.68, 30, '#bdb3a4')}${rect(W * 0.18, H * 0.36, W * 0.64, floorY - H * 0.36, '#8f8577')}${cols}${rect(0, floorY, W, H - floorY, p.floor)}`,
          groundY: floorY + 40,
          figureH: H * 0.24
        }
      }
      const arches = Array.from({ length: 5 }, (_, i) => {
        const x = W * 0.08 + i * W * 0.19
        return `<path d="M${f1(x)} ${f1(H * 0.62)} V${f1(H * 0.26)} A${f1(W * 0.055)} ${f1(W * 0.055)} 0 0 1 ${f1(x + W * 0.11)} ${f1(H * 0.26)} V${f1(H * 0.62)}Z" fill="${p.win}" opacity=".9"/><path d="M${f1(x + W * 0.055)} ${f1(H * 0.2)} V${f1(H * 0.62)} M${f1(x)} ${f1(H * 0.42)} H${f1(x + W * 0.11)}" stroke="${p.wallDark}" stroke-width="8"/>`
      }).join('')
      return { svg: `${interior(p, id, floorY)}${arches}`, groundY: floorY + 40, figureH: H * 0.3 }
    }
    case 'sea': {
      const hz = H * 0.6
      const waves = Array.from({ length: 16 }, () => rect(rnd() * W, hz + 20 + rnd() * (H - hz), 80 + rnd() * 200, 4, '#fff', ` opacity="${f2(0.08 + rnd() * 0.15)}"`)).join('')
      return {
        svg: `${sky(p, id, hz, { x: W * 0.5, y: hz - 10, r: 80 })}<defs><linearGradient id="sea-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.skyLow}" stop-opacity=".85"/><stop offset="1" stop-color="${p.bldDark}"/></linearGradient></defs>${rect(0, hz, W, H - hz, `url(#sea-${id})`)}${waves}`,
        groundY: hz + 110,
        figureH: H * 0.2
      }
    }
    case 'skyline': {
      const base = H * 0.9
      const rays = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2
        return `<path d="M${f1(W / 2)} ${f1(H * 0.62)} L${f1(W / 2 + Math.cos(a) * 1600)} ${f1(H * 0.62 + Math.sin(a) * 1600)} L${f1(W / 2 + Math.cos(a + 0.12) * 1600)} ${f1(H * 0.62 + Math.sin(a + 0.12) * 1600)}Z" fill="${p.sun}" opacity=".07"/>`
      }).join('')
      return {
        svg: `${sky(p, id, H, { x: W / 2, y: H * 0.62, r: 90 })}${rays}${stars(rnd, 25, H * 0.4)}${skyline(p, rnd, base, 0, W, 0.38)}${rect(0, base, W, H - base, p.bldDark)}`,
        groundY: base + 30,
        figureH: H * 0.22
      }
    }
    case 'village': {
      const ground = H * 0.78
      const hills = `<path d="M0 ${f1(ground)} L${f1(W * 0.2)} ${f1(H * 0.38)} L${f1(W * 0.42)} ${f1(ground)}Z M${f1(W * 0.3)} ${f1(ground)} L${f1(W * 0.6)} ${f1(H * 0.3)} L${f1(W * 0.9)} ${f1(ground)}Z M${f1(W * 0.72)} ${f1(ground)} L${f1(W * 0.92)} ${f1(H * 0.42)} L${f1(W * 1.1)} ${f1(ground)}Z" fill="${p.bld}"/>`
      return {
        svg: `${sky(p, id, ground, { x: W * 0.8, y: H * 0.2, r: 40 })}${hills}${rect(0, ground, W, H - ground, p.floor)}`,
        groundY: ground + 60,
        figureH: H * 0.22
      }
    }
    case 'stadium': {
      const field = H * 0.66
      const tiers = Array.from({ length: 5 }, (_, i) => rect(0, H * 0.3 + i * 34, W, 30, i % 2 === 0 ? p.bld : p.bldDark)).join('')
      const fans = Array.from({ length: 260 }, () => `<circle cx="${f1(rnd() * W)}" cy="${f1(H * 0.3 + rnd() * 165)}" r="5" fill="${['#e8552f', '#3b82f6', '#f5c86b', '#ffffff'][Math.floor(rnd() * 4)]}" opacity=".7"/>`).join('')
      return {
        svg: `${sky(p, id, H * 0.3, { x: W * 0.3, y: H * 0.2, r: 50 })}${tiers}${fans}${rect(0, H * 0.47, W, 14, p.wallDark)}<defs><linearGradient id="f-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6b45"/><stop offset="1" stop-color="#1d4a2f"/></linearGradient></defs>${rect(0, H * 0.48, W, H, `url(#f-${id})`)}<path d="M${f1(W / 2)} ${f1(H * 0.48)} V${f1(H)}" stroke="#fff" stroke-width="5" opacity=".35"/>`,
        groundY: field + 120,
        figureH: H * 0.26
      }
    }
    case 'space':
    default: {
      return {
        svg: `${rect(0, 0, W, H, p.skyTop)}${stars(rnd, 160, H)}<circle cx="${f1(W * 0.8)}" cy="${f1(H * 1.15)}" r="${f1(H * 0.6)}" fill="${p.skyMid}"/><circle cx="${f1(W * 0.8)}" cy="${f1(H * 1.15)}" r="${f1(H * 0.6)}" fill="none" stroke="${p.skyLow}" stroke-width="6" opacity=".6"/>`,
        groundY: H * 0.8,
        figureH: H * 0.22
      }
    }
  }
}

/** A prop standing on `groundY` at x (px), `s` its scale (1 = a car about 1/5 of the width). */
export function drawProp(kind: PovProp, p: Pal, x: number, groundY: number, s: number, color: PovColor | undefined, seed: string): string {
  const c = color ? p.colors[color] : undefined
  const g = (inner: string): string => `<g transform="translate(${f1(x)} ${f1(groundY)}) scale(${f2(s)})">${inner}</g>`
  const wheel = (wx: number, r = 26): string => `<circle cx="${wx}" cy="${-r}" r="${r}" fill="#111"/><circle cx="${wx}" cy="${-r}" r="${r * 0.45}" fill="#9aa"/>`
  switch (kind) {
    case 'car':
      return g(`<path d="M-170 -40 Q-170 -78 -130 -82 L-90 -86 L-55 -132 Q-45 -140 -25 -140 L60 -140 Q80 -140 95 -128 L135 -88 L165 -80 Q185 -74 185 -50 L185 -32 L-170 -32Z" fill="${c ?? '#cfd3da'}"/><path d="M-45 -128 L-12 -128 L-12 -92 L-75 -92Z M2 -128 L55 -128 Q66 -128 75 -120 L100 -92 L2 -92Z" fill="#2a3448" opacity=".8"/>${wheel(-105)}${wheel(115)}`)
    case 'sportscar':
      return g(`<path d="M-190 -34 Q-195 -62 -150 -70 L-60 -80 Q-20 -112 40 -110 Q90 -108 130 -80 L185 -66 Q200 -60 198 -38 L196 -30 L-190 -30Z" fill="${c ?? '#f2c230'}"/><path d="M-30 -98 Q10 -106 55 -100 L95 -80 L-50 -80Z" fill="#1f2638" opacity=".85"/>${wheel(-120, 25)}${wheel(130, 25)}<rect x="180" y="-58" width="16" height="8" fill="#fff6c8"/><circle cx="196" cy="-54" r="40" fill="#fff6c8" opacity=".15"/>`)
    case 'oldcar': {
      const rnd = seeded(`${seed}:smoke`)
      const smoke = Array.from({ length: 5 }, (_, i) => `<circle cx="${f1(-30 + rnd() * 30)}" cy="${f1(-170 - i * 34)}" r="${f1(18 + i * 7)}" fill="#c9c4cf" opacity="${f2(0.45 - i * 0.07)}" data-anim="rise" data-at="${f2(i * 0.25)}" data-dur="0.8" data-dy="30"/>`).join('')
      return g(`<path d="M-160 -36 L-160 -88 L-100 -92 L-70 -140 L70 -140 L100 -92 L165 -88 L165 -36Z" fill="${c ?? '#8f96a3'}"/><path d="M-58 -130 L-8 -130 L-8 -96 L-82 -96Z M6 -130 L60 -130 L82 -96 L6 -96Z" fill="#2a3448" opacity=".75"/>${wheel(-100)}${wheel(105)}${smoke}`)
    }
    case 'yacht':
      return g(`<path d="M-330 -70 L330 -70 L260 0 L-280 0Z" fill="#f2f2f4"/><path d="M-200 -70 L-170 -130 L190 -130 L230 -70Z" fill="#e6e6ea"/><path d="M-110 -130 L-90 -175 L120 -175 L140 -130Z" fill="#dcdce2"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${-150 + i * 42}" y="-118" width="26" height="12" fill="#2a3448"/>`).join('')}<rect x="-280" y="-12" width="540" height="6" fill="${p.colors.blue}" opacity=".6"/>`)
    case 'plane':
      return g(`<path d="M-260 -60 Q-260 -90 -200 -92 L200 -92 Q270 -88 285 -66 Q270 -46 200 -42 L-200 -42 Q-260 -44 -260 -60Z" fill="#eef0f4"/><path d="M-40 -66 L60 -66 L-30 20 L-90 20Z M-210 -88 L-180 -88 L-230 -150 L-260 -150Z" fill="#d5d9e2"/>${Array.from({ length: 10 }, (_, i) => `<circle cx="${-150 + i * 34}" cy="-72" r="6" fill="#2a3448"/>`).join('')}`)
    case 'rocket':
      return g(`<path d="M0 -520 Q40 -460 40 -380 L40 -80 L-40 -80 L-40 -380 Q-40 -460 0 -520Z" fill="#f2f2f4"/><path d="M-40 -150 L-90 -60 L-40 -80Z M40 -150 L90 -60 L40 -80Z" fill="${c ?? p.coral}"/><circle cy="-380" r="16" fill="#2a3448"/><path d="M-26 -80 Q0 30 26 -80Z" fill="${p.gold}"/>`)
    case 'desk':
      return g(`<rect x="-170" y="-110" width="340" height="14" fill="${p.wallDark}"/><rect x="-160" y="-96" width="10" height="96" fill="${p.wallDark}"/><rect x="150" y="-96" width="10" height="96" fill="${p.wallDark}"/><rect x="20" y="-220" width="150" height="100" rx="6" fill="#2a3448"/><rect x="30" y="-210" width="130" height="80" fill="#5c7cc4" opacity=".85"/>${Array.from({ length: 4 }, (_, i) => `<rect x="40" y="${-200 + i * 16}" width="${60 + (i % 2) * 40}" height="6" fill="#dfe8ff" opacity=".7"/>`).join('')}<rect x="85" y="-120" width="20" height="10" fill="#2a3448"/>`)
    case 'bills':
      return g(`<g data-anim="growy" data-at="0.1" data-dur="1.6" style="transform-origin:bottom">${Array.from({ length: 28 }, (_, i) => `<rect x="-70" y="${-(i + 1) * 22}" width="140" height="20" fill="${i % 2 === 0 ? p.green : '#9fd0a8'}"/><rect x="-14" y="${-(i + 1) * 22}" width="28" height="20" fill="#e8f2e0" opacity=".85"/>`).join('')}</g>`)
    case 'bed':
      return g(`<rect x="-230" y="-90" width="460" height="60" rx="8" fill="#b5403a"/><rect x="-230" y="-40" width="460" height="40" fill="${p.wallDark}"/><rect x="-240" y="-170" width="22" height="170" fill="${p.gold}"/><rect x="-215" y="-120" width="110" height="34" rx="12" fill="#f2f2f4"/>`)
    case 'house':
      return g(`<rect x="-110" y="-160" width="220" height="160" fill="${c ?? '#c8553d'}"/><path d="M-130 -160 L0 -260 L130 -160Z" fill="#3a2b33"/><rect x="-70" y="-120" width="50" height="50" fill="${p.win}"/><rect x="20" y="-120" width="50" height="50" fill="${p.win}"/><rect x="-22" y="-70" width="44" height="70" fill="#3a2b33"/>`)
    case 'tree':
      return g(`<rect x="-10" y="-120" width="20" height="120" fill="#2a1e26"/><circle cy="-170" r="80" fill="#22182a"/><circle cx="-55" cy="-130" r="55" fill="#22182a"/><circle cx="55" cy="-130" r="55" fill="#22182a"/>`)
    case 'palm':
      return g(`<path d="M-8 0 Q10 -150 30 -300 L44 -300 Q24 -150 12 0Z" fill="#2a1e26"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M37 -300 Q${-60 + i * 50} ${-370 + Math.abs(i - 2) * 25} ${-120 + i * 70} ${-280 + Math.abs(i - 2) * 20}" fill="none" stroke="#2a1e26" stroke-width="18" stroke-linecap="round"/>`).join('')}`)
    case 'tower': {
      const rnd = seeded(`${seed}:tower`)
      return g(`<path d="M-70 0 L-50 -620 L50 -620 L70 0Z" fill="${p.bld}"/><rect x="-4" y="-700" width="8" height="80" fill="${p.bld}"/>${Array.from({ length: 60 }, () => `<rect x="${f1(-40 + rnd() * 74)}" y="${f1(-600 + rnd() * 590)}" width="6" height="8" fill="${p.win}" opacity="${f2(0.3 + rnd() * 0.6)}"/>`).join('')}`)
    }
    case 'safe':
      return g(`<rect x="-100" y="-210" width="200" height="210" rx="10" fill="#5d6273"/><circle cy="-105" r="46" fill="none" stroke="#c9ccd6" stroke-width="10"/><path d="M0 -150 V-60 M-45 -105 H45" stroke="#c9ccd6" stroke-width="8"/>`)
    case 'gold':
      return g(`${[[-90, -40], [0, -40], [90, -40], [-45, -80], [45, -80], [0, -120]].map(([gx, gy]) => `<path d="M${(gx as number) - 42} ${gy} L${(gx as number) - 30} ${(gy as number) - 38} L${(gx as number) + 30} ${(gy as number) - 38} L${(gx as number) + 42} ${gy}Z" fill="${p.gold}" stroke="#b8862c" stroke-width="3"/>`).join('')}`)
    case 'bag':
      return g(`<path d="M-80 0 Q-100 -120 -40 -160 L40 -160 Q100 -120 80 0Z" fill="#8a6a3e"/><path d="M-30 -160 L-50 -200 L50 -200 L30 -160Z" fill="#6f5430"/><text y="-60" text-anchor="middle" font-size="80" font-family="Montserrat" font-weight="800" fill="${p.gold}">$</text>`)
    case 'lamp':
    default:
      return g(`<rect x="-4" y="-260" width="8" height="260" fill="#2a1e26"/><path d="M-40 -260 L40 -260 L25 -300 L-25 -300Z" fill="${p.gold}"/><path d="M-40 -260 L-140 0 L140 0 L40 -260Z" fill="${p.sun}" opacity=".08"/>`)
  }
}

export { bill }
