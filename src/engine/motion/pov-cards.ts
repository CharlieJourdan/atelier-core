// The POV card (formats/pov.ts): one shot of a 2D motion-design story, full frame and opaque. This file draws the scene, the face
// close-up, the title, the number, the list and the ring, and sends the other kinds to pov-ui.ts. Measures and timings come from the
// reference frames (research note style-monde-pov-2026-11 (old repository) § 6): numbers count up in 1–2 s (ease out), a checklist ticks once a
// second, a ring ticks once a second, a new value lands ≈ 1 s after the last one, text never longer than a few words.
import type { PovCardProps, PovFigures, PovShot, PovType } from '../formats/pov'
import { faceOf } from './styled'
import { esc, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { H, PALETTES, POV_CSS, W, cardGround, confetti, crowd, f1, f2, faceSvg, figure, rain, world, type Pal } from './pov-kit'
import { depthFinish, handShot } from './pov-hand'
import { drawProp, drawSet } from './pov-sets'
import { pct } from './pov-ui'
import { browserShot, compareShot, chartShot, dialShot, gridShot, iconsShot, label, paperShot, phoneShot, plateOrGround } from './pov-ui'

/** How the POV cards are drawn (in their cache key): 2 = moteur-briques' depth bloom and dust, chain icons, hand shots; 4 =
 *  moteur-pov-2's measured cast (silhouettes, rim, expressive faces) and the held things' details; 5–6 = its independent judge's
 *  rounds (hoodie sleeves, lock screens, the arm from the bottom edge, the full-width flow). */
export const POV_VERSION = 8

type Shot<K extends PovShot['kind']> = Extract<PovShot, { kind: K }>


/** The measured type of the cards (moteur-briques): the face, capitals, the titles' accent and a rule under them. */
export function povTypeCss(t: PovType, p: Pal): string {
  const face = faceOf({ face: t.face })
  return `
.pov{font-family:${face.family};font-weight:${face.weight};font-style:${face.style ?? 'normal'}}
.pov .lbl{text-transform:${t.upper ? 'uppercase' : 'none'}}
.pov .ttl{color:${t.accent ?? p.gold} !important}${t.titleRule ? `
.pov .ttl::after{content:'';display:block;width:56px;height:3px;margin:12px auto 0;border-radius:2px;background:${t.accent ?? p.gold}}` : ''}`
}
const T = (s: string): string => esc(typo(s))

function scene(s: Shot<'scene'>, p: Pal, seed: string, D: number, look?: PovFigures): string {
  const set = drawSet(s.set, p, seed)
  const fh = set.figureH
  // a figure asleep lies on a bed even when the director named none
  const sleeper = s.cast.find((c) => c.pose === 'sleep')
  const bed = sleeper && !s.props.some((x) => x.kind === 'bed') ? world(drawProp('bed', p, sleeper.x * W, set.groundY, fh / (H * 0.3), undefined, seed)) : ''
  const props = s.props
    .map((x, i) => {
      const art = drawProp(x.kind, p, x.x * W, set.groundY, x.scale * (fh / (H * 0.3)), x.color, `${seed}${i}`)
      const timed = x.atS !== undefined ? `<g data-anim="pop" data-at="${f2(x.atS)}" data-dur="0.35">${art}</g>` : art
      const lab = x.label ? label(x.label, { y: set.groundY + 14, size: 22, at: (x.atS ?? 0) + 0.15, anchor: 'left', x: x.x * W - 80 }) : ''
      if (x.drive) return `<div class="layer" data-move="0,0,${f1(x.drive * W)},0" data-at="0.3" data-dur="${f2(Math.max(1, D - 0.3))}">${world(timed)}${lab}</div>`
      return `<div class="layer">${world(timed)}${lab}</div>`
    })
    .join('')
  const people = s.cast
    .map((c) => {
      const x = c.x * W
      // a sleeper lies on the mattress of the bed (its top is 90 units above the ground at the prop's scale)
      if (c.pose === 'sleep') return world(figure(c, p, x, set.groundY - 90 * (fh / (H * 0.3)), fh, 0, look))
      if (c.pose !== 'walk') return world(figure(c, p, x, set.groundY, fh, 0, look))
      const steps = Math.ceil(D / 0.25)
      const legs = Array.from({ length: steps }, (_, i) => `<g data-anim="fade" data-at="${f2(i * 0.25)}" data-dur="0.01" data-out="${f2((i + 1) * 0.25)}" data-out-dur="0.01">${figure(c, p, x, set.groundY, fh, i, look)}</g>`).join('')
      return `<div class="layer" data-move="0,0,${f1((c.walk ?? 0.15) * W)},0" data-at="0" data-dur="${f2(D)}" data-ease="linear">${world(legs)}</div>`
    })
    .join('')
  const back = s.crowd > 0 ? crowd(s.crowd, p, set.groundY - fh * 0.15, fh * 0.6, seed) : ''
  const sign = s.sign ? `<div class="lbl" style="left:0;right:0;top:2.2%;text-align:center;font-size:24px;letter-spacing:.24em;color:#fff;opacity:.9">${T(s.sign)}</div>` : ''
  const tag = s.tag
    // the reference's time card: plain bold yellow capitals in the top-right corner (« 4 JOURS PLUS TARD »), no box
    ? `<div style="position:absolute;right:5%;top:9%;text-align:right" data-anim="fade" data-at="${f2(s.tag.atS ?? 0.3)}" data-dur="0.3"><span class="lbl" style="position:relative;display:inline-block;color:${p.gold};font-size:30px;font-weight:800;letter-spacing:.04em">${T(s.tag.text)}</span></div>`
    : ''
  // a scene stays sharp even on a deep channel: the reference defocuses its place only behind close-ups (a held thing, a phone,
  // a number over the room), never its wide shots (independent judge, 2026-11-05); `soft` still asks for the plate
  const ground = s.soft ? `<div class="plate">${world(set.svg + back)}</div>` : world(set.svg + back)
  const inner = `${ground}${bed}${props}${people}${s.soft ? '' : sign}`
  const cam =
    s.camera === 'push'
      ? `<div class="layer" data-zoom="1" data-z0="1" data-z1="${f2(Math.min(1.08, 1 + 0.025 * D))}" data-at="0" data-dur="${f2(D)}" data-ease="linear">${inner}</div>`
      : s.camera === 'left' || s.camera === 'right'
        ? `<div class="layer" data-move="0,0,${s.camera === 'left' ? 48 : -48},0" data-at="0" data-dur="${f2(D)}" data-ease="linear"><div class="layer" style="transform:scale(1.06)">${inner}</div></div>`
        : `<div class="layer">${inner}</div>`
  return `${cam}${tag}${s.rain !== 'none' ? rain(s.rain, D, p, seed) : ''}`
}

function title(s: Shot<'title'>, p: Pal, seed: string, D: number): string {
  const set = drawSet(s.set, p, seed)
  // a question is two-tone: a white line, then the last line larger in the accent coral (« LE TICKET PEUT-IL / EXPIRER ? »)
  const question = s.lines.at(-1)?.trim().endsWith('?') === true && s.lines.length > 1
  const lines = s.lines.map((l, i) => {
    const last = i === s.lines.length - 1
    const style = question ? `font-size:${last ? 92 : 58}px;color:${last ? p.coral : '#ffffff'}` : `font-size:96px;color:${p.gold}`
    return `<div class="num${question ? '' : ' glow'}" style="position:relative;line-height:1.1;${style}" data-fit="40" data-anim="rise" data-at="${f2(0.15 + i * 0.18)}" data-dur="0.5" data-dy="30">${T(l.toUpperCase())}</div>`
  }).join('')
  return `${world(set.svg)}<div style="position:absolute;left:6%;right:6%;top:24%;text-align:center">${s.kicker ? `<div class="lbl" style="position:relative;font-size:30px;color:#fff;margin-bottom:10px" data-anim="fade" data-at="0.05" data-dur="0.3">${T(s.kicker)}</div>` : ''}${lines}</div>${s.confetti ? `${confetti(W / 2, H * 0.36, 0.25, p, seed, 12)}${rain('bills', D, p, seed)}` : ''}`
}

const numText = (v: number | undefined, t: string | undefined, unit: string | undefined): string => {
  const body = t ?? new Intl.NumberFormat('fr-FR').format(v ?? 0).replace(/[\u202f\u00a0]/g, '\u00a0')
  // a text that already ends with its unit (« 1 000 MDS $ ») does not get it twice
  return unit && !body.trimEnd().endsWith(unit) ? `${body}\u00a0${unit}` : body
}

function number(s: Shot<'number'>, p: Pal, seed: string, D: number): string {
  const n = s.steps.length
  const times = s.steps.map((x, i) => x.atS ?? 0.2 + (i * Math.max(0.6, D - 1.4)) / Math.max(1, n))
  const unit = s.unit ? `<span style="font-size:.8em">\u00a0${esc(s.unit)}</span>` : ''
  let body: string
  const cy = s.kicker || s.sub || s.note ? 46 : 50
  if (s.mode === 'stack') {
    // each new value lands big and gold under the old ones, which shrink and get a red strike
    body = s.steps
      .map((x, i) => {
        const last = i === n - 1
        const y = cy - (n - 1 - i) * 7 - (last ? 0 : 4)
        const size = last ? 92 : 36
        const strike = last ? '' : `<div style="position:absolute;left:-4%;right:-4%;top:52%;height:4px;background:${p.coral}" data-anim="grow" data-at="${f2(times[i + 1] as number)}" data-dur="0.3"></div>`
        return `<div style="position:absolute;left:0;right:0;top:${y}%;margin-top:-${Math.round(size * 0.6)}px;text-align:center"><span class="num${last ? ' glow' : ''}" style="position:relative;font-size:${size}px;color:${last ? p.gold : '#e9ecf8'}" data-anim="pop" data-at="${f2(times[i] as number)}" data-dur="0.35">${T(numText(x.value, x.text, s.unit))}${strike}</span></div>`
      })
      .join('')
  } else {
    // one number in the middle: each step counts from the value before (or is written when it is a text)
    body = s.steps
      .map((x, i) => {
        const from = i === 0 ? (s.mode === 'down' ? x.value : 0) : s.steps[i - 1]?.value
        // a counter going down with one value keeps falling all along the shot (the reference: ≈ 0.001 % in 4 s)
        const lone = s.mode === 'down' && n === 1 && x.value !== undefined && x.text === undefined
        if (lone) return `<div style="position:absolute;left:0;right:0;top:${cy}%;margin-top:-62px;text-align:center" data-anim="rise" data-at="0" data-dur="0.3"><span class="num glow" style="font-size:104px;color:${p.gold}" data-fit="40"><span data-count data-from="${x.value}" data-to="${Math.round((x.value as number) * (1 - 0.000008 * D))}" data-dec="0" data-at="0.2" data-dur="${f2(Math.max(0.5, D - 0.3))}" data-ease="linear"></span>${unit}</span></div>`
        const t0 = times[i] as number
        const next = times[i + 1]
        const out = next !== undefined ? ` data-out="${f2(next)}" data-out-dur="0.05"` : ''
        const inner =
          x.value !== undefined && from !== undefined && from !== x.value && x.text === undefined
            ? `<span data-count data-from="${from}" data-to="${x.value}" data-dec="${Number.isInteger(x.value) ? 0 : 1}" data-at="${f2(t0)}" data-dur="${f2(Math.min(2, Math.max(0.8, (next ?? D) - t0 - 0.3)))}"></span>${unit}`
            : T(numText(x.value, x.text, s.unit))
        return `<div style="position:absolute;left:0;right:0;top:${cy}%;margin-top:-62px;text-align:center" data-anim="${i === 0 ? 'rise' : 'fade'}" data-at="${f2(t0)}" data-dur="${i === 0 ? 0.4 : 0.05}"${out}><span class="num glow" style="font-size:104px;color:${p.gold}" data-fit="40">${inner}</span></div>`
      })
      .join('')
  }
  const kicker = s.kicker ? label(s.kicker, { y: H * (cy / 100) - 120, size: 24, color: '#fff', at: 0.05, title: true }) : ''
  const sub = s.sub ? label(s.sub, { y: H * (cy / 100) + 70, size: 28, color: '#9fc1ff', at: (times[0] as number) + 0.4 }) : ''
  const note = s.note
    ? s.bar !== undefined
      ? label(s.note, { x: W * 0.28, y: H * ((cy + 14) / 100) + 22, size: 20, color: p.coral, anchor: 'left', at: (times[0] as number) + 0.5 })
      : label(s.note, { y: H * (cy / 100) + (s.sub ? 118 : 80), size: 22, color: p.coral, at: (times.at(-1) as number) + 0.2 })
    : ''
  const bar =
    s.bar !== undefined
      ? `<div style="position:absolute;left:28%;right:28%;top:${cy + 14}%;height:10px;border-radius:6px;background:rgba(255,255,255,.12)"><div style="height:100%;width:${f1(Math.max(0.01, s.bar) * 100)}%;border-radius:6px;background:${p.coral};transform-origin:left" data-anim="grow" data-at="${f2((times[0] as number) + 0.3)}" data-dur="0.8"></div></div>`
      : ''
  const burst = s.confetti ? confetti(W / 2, H * (cy / 100), (times.at(-1) as number) + 0.2, p, seed) : ''
  return `${plateOrGround(s.over, p, seed)}${kicker}${body}${sub}${note}${bar}${burst}`
}

function list(s: Shot<'list'>, p: Pal, seed: string, D: number): string {
  const n = s.items.length
  const times = s.items.map((x, i) => x.atS ?? 0.3 + i * Math.min(1, Math.max(0.4, (D - 1) / n)))
  const top = s.title ? 30 : 22
  const step = Math.min(11, 56 / n)
  const rows = s.items
    .map((x, i) => {
      const y = top + i * step
      const t = times[i] as number
      if (s.style === 'pill')
        return `<div style="position:absolute;left:30%;right:30%;top:${f1(y)}%;padding:14px 26px;border-radius:999px;background:rgba(14,18,48,.82);border:2px solid rgba(160,180,255,.35)" data-anim="left" data-dx="60" data-at="${f2(t)}" data-dur="0.3"><span class="lbl" style="position:relative;font-size:28px;color:#dfe6ff" data-fit="14">${T(x.text)}</span></div>`
      return `<div style="position:absolute;left:24%;right:12%;top:${f1(y)}%;display:flex;align-items:center;gap:22px" data-anim="rise" data-at="${f2(t - 0.2)}" data-dur="0.3" data-dy="10"><svg width="46" height="46" viewBox="0 0 46 46"><rect x="3" y="3" width="40" height="40" rx="8" fill="none" stroke="#dfe6ff" stroke-width="4"/><path d="M11 24 L20 33 L36 13" fill="none" stroke="${p.gold}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" data-anim="pop" data-at="${f2(t)}" data-dur="0.25"/></svg><span class="lbl" style="position:relative;font-size:34px;color:#fff" data-fit="14">${T(x.text)}</span></div>`
    })
    .join('')
  return `${plateOrGround(s.over, p, seed)}${s.title ? label(s.title, { y: H * 0.17, size: 28, color: p.gold, at: 0.05, title: true }) : ''}${rows}`
}

const clock = (sec: number): string => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function ring(s: Shot<'ring'>, p: Pal, seed: string, D: number): string {
  const r = 210
  const cx = W / 2
  const cy = H * 0.44
  const arc = `<circle cx="${cx}" cy="${f1(cy)}" r="${r}" fill="none" stroke="${p.gold}" stroke-opacity=".18" stroke-width="10"/><circle cx="${cx}" cy="${f1(cy)}" r="${r}" fill="none" stroke="${p.gold}" stroke-width="10" pathLength="1" stroke-dasharray="1 1" transform="rotate(-90 ${cx} ${f1(cy)})" style="transform-box:view-box;transform-origin:0 0" data-draw="1" data-at="0.05" data-dur="0.9"/>`
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2
    return `<line x1="${f1(cx + Math.cos(a) * (r + 26))}" y1="${f1(cy + Math.sin(a) * (r + 26))}" x2="${f1(cx + Math.cos(a) * (r + (i % 5 === 0 ? 40 : 32)))}" y2="${f1(cy + Math.sin(a) * (r + (i % 5 === 0 ? 40 : 32)))}" stroke="${p.gold}" stroke-opacity=".3" stroke-width="3"/>`
  }).join('')
  const big = (txt: string, extra: string): string => `<div style="position:absolute;left:0;right:0;top:${pct(cy, H)};margin-top:-${(txt.length > 6 ? 56 : 72) + (s.sub ? 18 : 0)}px;text-align:center"${extra}><span class="num glow" style="font-size:${txt.length > 6 ? 84 : 120}px;color:${p.gold}">${T(txt)}</span></div>`
  let center = ''
  if (s.countdownS !== undefined) {
    const n = Math.ceil(D) + 1
    center = Array.from({ length: n }, (_, i) => big(clock(Math.max(0, (s.countdownS as number) - i)), ` data-anim="fade" data-at="${i === 0 ? '0.2' : f2(i)}" data-dur="${i === 0 ? 0.3 : 0.01}" data-out="${f2(i + 1)}" data-out-dur="0.01"`)).join('')
  } else if (s.center) center = big(s.center, ' data-anim="pop" data-at="0.25" data-dur="0.4"')
  const sub = s.sub ? label(s.sub, { y: cy + 62, size: 26, color: '#9fc1ff', at: 0.4 }) : ''
  const cap = s.caption ? label(s.caption, { y: cy + r + 70, size: 28, color: '#fff', at: 0.6 }) : ''
  const note = s.note ? label(s.note, { y: cy + r + 112, size: 22, color: p.coral, at: 1 }) : ''
  return `${world(cardGround(p, seed) + ticks + arc)}${center}${sub}${cap}${note}${s.confetti ? confetti(cx, cy, 0.4, p, seed) : ''}`
}

/** The body of a POV card: its own opaque ground and its shot, timed on its words. */
export function povCard(props: PovCardProps, c: MotionCtx): Part {
  const p = PALETTES[props.palette]
  const s = props.shot
  const D = c.durationS
  const seed = props.seed.replace(/[^A-Za-z0-9]/g, '') || 'pov'
  const deep = props.depth === 'deep'
  const body = ((): string => {
    switch (s.kind) {
      case 'scene':
        return scene(s, p, seed, D, props.figures)
      case 'hand':
        return handShot(s, p, seed, D)
      case 'face':
        return `${plateOrGround(s.over ?? 'room', p, seed)}${world(faceSvg({ color: s.color, hair: s.hair, moods: s.moods, pal: p, durationS: D }))}`
      case 'title':
        return title(s, p, seed, D)
      case 'number':
        return number(s, p, seed, D)
      case 'list':
        return list(s, p, seed, D)
      case 'ring':
        return ring(s, p, seed, D)
      case 'icons':
        return iconsShot(s, p, seed)
      case 'grid':
        return gridShot(s, p, seed, D)
      case 'compare':
        return compareShot(s, p, seed, D)
      case 'chart':
        return chartShot(s, p, seed, D)
      case 'phone':
        return phoneShot(s, p, seed, D)
      case 'browser':
        return browserShot(s, p, seed)
      case 'paper':
        return paperShot(s, p, seed)
      case 'dial':
        return dialShot(s, p, seed, D)
    }
  })()
  return { css: POV_CSS + (props.type ? povTypeCss(props.type, p) : ''), body: `<div class="pov" style="background:${p.card}">${body}${deep ? depthFinish(seed, D) : ''}</div>` }
}
