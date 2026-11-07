// The paper frame of an archive card: a document on light graph paper (slightly warped, never changing over time). With an excerpt the
// sheet slides to the left half, the excerpt is typed word by word on the right and its mark is underlined and highlighted in red,
// word after word, left to right.
import { DOC_PALETTE } from '../formats/cards'
import { esc, isPortrait, pick, typo } from './base'
import { FONT, cameraAttrs, f2, fitBox, originOf, pictureTag, tiltOf, unit, type FrameIn, type FrameOut } from './doc-common'
import { PARCH, PAPER_CSS, paperBackdrop } from './doc-parchment'

interface Token {
  word: string
  mark: boolean
}
/** The excerpt cut into words; a word is part of the mark when it overlaps the first place `mark` is found (none when it is not there). */
export function excerptTokens(excerpt: string, mark: string | undefined): Token[] {
  const at = mark ? excerpt.indexOf(mark) : -1
  const end = at + (mark?.length ?? 0)
  return [...excerpt.matchAll(/\S+/g)].map((m) => ({ word: m[0], mark: at >= 0 && m.index < end && m.index + m[0].length > at }))
}

export function paperFrame({ p, c, picture, aspect, look }: FrameIn): FrameOut {
  const parch = look.kind === 'parchment'
  const D = c.durationS
  const portrait = isPortrait(c)
  const ex = p.excerpt !== undefined
  const seed = Math.floor(unit(p.label ?? p.excerpt ?? 'paper', 'warp') * 90) + 1
  const tilt = tiltOf(p.label ?? 'paper', 1.4)
  const sheetBox = ex
    ? portrait
      ? fitBox(aspect, c.width * 0.7, c.height * 0.4)
      : fitBox(aspect, c.width * 0.4, c.height * 0.76)
    : fitBox(aspect, pick(c, c.width * 0.5, c.width * 0.8), pick(c, c.height * 0.76, c.height * 0.6))
  const cx = ex ? (portrait ? c.width / 2 : c.width * 0.27) : c.width / 2
  const cy = ex ? (portrait ? c.height * 0.28 : c.height * 0.47) : c.height * 0.46
  const left = Math.round(cx - sheetBox.w / 2)
  const top = Math.round(cy - sheetBox.h / 2)
  const slide = ex ? `data-anim="right" data-dx="${Math.round(c.width * 0.22)}"` : 'data-anim="rise" data-dy="46"'

  // the excerpt: words appearing one by one, then the mark
  const tokens = ex ? excerptTokens(p.excerpt as string, p.mark) : []
  const n = Math.max(1, tokens.length)
  const typeAt = 0.9
  const step = Math.min(0.11, 2.2 / n)
  const markWords = tokens.filter((t) => t.mark).length
  const markAt = p.markAtS ?? Math.min(Math.max(typeAt + n * step + 0.35, D * 0.5), Math.max(typeAt, D - 1.4))
  const markDur = Math.min(1.1, 0.26 * Math.max(1, markWords))
  let mi = 0
  const words = tokens
    .map((t, i) => {
      const at = f2(typeAt + i * step)
      if (!t.mark) return `<span class="w" data-anim="fade" data-at="${at}" data-dur="0.14">${esc(typo(t.word))}</span>`
      const wAt = f2(markAt + (mi * markDur) / markWords)
      // the highlight reaches over the space before the next word, so the marked words read as one stroke (the last stops at its word)
      const end = ++mi === markWords ? ' style="right:-.04em"' : ''
      return `<span class="w mk" data-anim="fade" data-at="${at}" data-dur="0.14">${esc(typo(t.word))}<i data-anim="wipe" data-at="${wAt}" data-dur="${f2(markDur / markWords + 0.05)}" data-ease="linear"${end}></i></span>`
    })
    .join(' ')
  const ox = portrait ? 80 : Math.round(c.width * 0.53)
  const ow = portrait ? c.width - 160 : Math.round(c.width * 0.39)
  const oy = portrait ? Math.round(c.height * 0.5) : Math.round(c.height * 0.1)
  const oh = portrait ? Math.round(c.height * 0.4) : Math.round(c.height * 0.76)
  const excerptBox = ex
    ? `<div class="exwrap" style="left:${ox}px;top:${oy}px;width:${ow}px;height:${oh}px"><div class="ex" data-fit="24" style="max-height:${oh}px">${words}</div></div>`
    : ''
  // the label sits bottom left (red bar, condensed capitals), or top left when white-on-dark lines would take that corner
  const labelTop = p.lines.length > 0
  const label = p.label
    ? `<div class="plabel" style="${labelTop ? `top:${pick(c, 54, 80)}px` : `bottom:${pick(c, 62, 120)}px`}" data-anim="rise" data-at="0.5" data-dur="0.5" data-dy="14"><i></i><div><div class="pl" data-fit="14">${esc(typo(p.label))}</div>${p.sub ? `<div class="ps" data-fit="12">${esc(typo(p.sub))}</div>` : ''}</div></div>`
    : ''

  return {
    css: `
.paperw{position:absolute;inset:0;overflow:hidden;background:${parch ? PARCH.paper : DOC_PALETTE.paper}}${parch ? PAPER_CSS : ''}
.paperw .stage{position:absolute;inset:0;transform-origin:${originOf(p.move)}}
.pgrid{position:absolute;left:-60px;top:-60px;width:${c.width + 120}px;height:${c.height + 120}px;filter:url(#warp);background:
 linear-gradient(rgba(170,170,162,.13) 1px,transparent 1px) 0 0/8px 8px,
 linear-gradient(90deg,rgba(170,170,162,.13) 1px,transparent 1px) 0 0/8px 8px,
 linear-gradient(${DOC_PALETTE.paperLine} 1.5px,transparent 1.5px) 0 0/40px 40px,
 linear-gradient(90deg,${DOC_PALETTE.paperLine} 1.5px,transparent 1.5px) 0 0/40px 40px}
.plit{position:absolute;inset:0;background:radial-gradient(ellipse 70% 68% at 50% 44%,rgba(255,255,255,.5),transparent 72%),radial-gradient(ellipse 125% 115% at 50% 50%,transparent 58%,rgba(110,100,80,.2) 100%)}
.sheetw{position:absolute;left:${left}px;top:${top}px;width:${sheetBox.w}px;height:${sheetBox.h}px}
.sheet{position:absolute;inset:0;transform:rotate(${tilt}deg);box-shadow:${parch ? '0 14px 30px rgba(72,46,16,.3),0 2px 7px rgba(72,46,16,.28),0 0 0 1px rgba(72,46,16,.2)' : '0 28px 52px rgba(60,48,30,.34),0 3px 9px rgba(60,48,30,.3),0 0 0 1px rgba(60,48,30,.14)'};background:#fbfaf6}
${parch ? '.sheet::after{content:"";position:absolute;inset:0;background:rgba(222,196,146,.4);mix-blend-mode:multiply}\n' : ''}.sheet .pimg{display:block;width:100%;height:100%;object-fit:cover;filter:${parch ? 'contrast(1.04) sepia(.3) saturate(.8)' : 'contrast(1.04)'}}
.exwrap{position:absolute;display:flex;align-items:center}
.ex{font-family:${FONT.serif};font-weight:400;font-size:${pick(c, 40, 44)}px;line-height:1.45;color:${parch ? PARCH.ink : '#1f1c19'};overflow:hidden;width:100%}
.ex .w{display:inline-block;position:relative;isolation:isolate}
.ex .mk i{position:absolute;left:0;right:-.26em;top:.16em;bottom:-.04em;z-index:-1;${parch ? `background:${look.accent}1c;border-bottom:.08em solid ${look.accent}` : `background:rgba(213,65,47,.2);border-bottom:.1em solid ${DOC_PALETTE.red}`};opacity:1}
.plabel{position:absolute;left:${pick(c, 60, 48)}px;display:flex;gap:14px;align-items:stretch;max-width:${Math.round(c.width * (ex && !portrait ? 0.42 : 0.7))}px}
.plabel i{display:block;width:${parch ? 3 : 5}px;background:${parch ? look.accent : DOC_PALETTE.red};flex:none}
.plabel .pl{font-family:${parch ? FONT.serif : FONT.cond};font-weight:600;font-size:${pick(c, 26, 26)}px;letter-spacing:${parch ? '.16em' : '.13em'};text-transform:uppercase;color:${parch ? PARCH.ink : '#2b2825'};white-space:nowrap;overflow:hidden;line-height:1.25}
.plabel .ps{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 21, 20)}px;color:${parch ? PARCH.muted : '#6b665e'};white-space:nowrap;overflow:hidden;margin-top:2px}`,
    body: `${parch ? '' : `<svg width="0" height="0" style="position:absolute"><filter id="warp" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency=".0034 .0048" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"/></filter></svg>
`}<div class="paperw">${parch ? paperBackdrop(c) : ''}<div class="stage" ${cameraAttrs(p.move, 0.04, D)}>${parch ? '' : '<div class="pgrid"></div><div class="plit"></div>'}<div class="sheetw" ${slide} data-at="0.1" data-dur="0.65"><div class="sheet">${pictureTag(picture, 'pimg')}</div></div>${excerptBox}</div>${label}</div>`,
    linesLeft: pick(c, 80, 60),
    ink: parch ? PARCH.ink : '#1d1a18',
    srcInk: parch ? PARCH.muted : '#8b867d',
    shadow: false,
    ...(parch ? { punch: { bg: look.accent, ink: PARCH.tag, shadow: '0 8px 18px rgba(72,46,16,.38)' }, srcSerif: true } : {})
  }
}
