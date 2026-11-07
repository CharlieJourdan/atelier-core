// The message conversation (docs/ENGINE-SPEC.md §25) for conversation and story channels: a chat window whose bubbles appear one by
// one, each when its line starts in the voice (the plan gives the turns with the times of the words), with the typing dots of the
// speaker just before, the list scrolling up to keep the newest bubble in view, two or more speakers (the one who "writes" on the
// right in colour, the others on the left, their names above their bubbles when there are more than two people). Our own drawing:
// generic rounded bubbles, no platform assets. The window stays above the band where the captions are drawn.
import type { z } from 'zod'
import type { ConversationProps } from '../formats/motion'
import { esc, outAt, pick, typo, zone, type MotionCtx } from './base'
import type { Part } from './cards'

const f = (n: number): string => n.toFixed(2)

/** Colour of a person's avatar circle: stable per name, readable with white text. */
const AVATARS = ['#2563EB', '#C2410C', '#047857', '#7C3AED', '#BE185D', '#0F766E']
export const avatarColour = (name: string): string => AVATARS[[...name].reduce((n, ch) => (n * 31 + (ch.codePointAt(0) ?? 0)) % 9973, 7) % AVATARS.length] as string

/** When the dots of each turn start: asked for, else just before the bubble (and after the bubble before it when that is later). */
export function typingStarts(turns: z.infer<typeof ConversationProps>['turns']): number[] {
  return turns.map((t, i) => {
    if (t.typingS !== undefined) return Math.min(t.typingS, t.atS)
    const prev = turns[i - 1]
    // the same person goes on: no dots, the bubble just comes
    if (prev && prev.speaker === t.speaker) return t.atS
    const wanted = prev ? Math.max(prev.atS + 0.2, t.atS - 0.9) : Math.max(0, t.atS - 0.8)
    return Math.max(0, Math.min(wanted, t.atS - 0.25))
  })
}

export function conversation(p: z.infer<typeof ConversationProps>, c: MotionCtx): Part {
  const z0 = zone(c)
  const out = outAt(c)
  const group = p.speakers.length > 2
  const w = pick(c, 760, z0.width)
  const h = pick(c, z0.height, z0.height)
  const left = Math.round((c.width - w) / 2)
  const head = pick(c, 104, 120)
  const text = pick(c, 33, 44)
  const typing = typingStarts(p.turns)
  const others = p.speakers.filter((s) => s.side === 'left').map((s) => s.name)
  const title = p.title ?? (others.length > 0 ? others.join(', ') : (p.speakers[0]?.name ?? ''))
  const initial = (n: string): string => (Array.from(n.trim())[0] ?? '?').toUpperCase()
  const rows = p.turns
    .map((t, i) => {
      const sp = p.speakers[t.speaker] ?? p.speakers[0]
      const side = sp?.side ?? 'left'
      const prev = p.turns[i - 1]
      const streak = prev !== undefined && prev.speaker === t.speaker
      const named = group && side === 'left' && !streak
      const dots = typing[i] as number
      return `<div class="row ${side}${streak ? ' streak' : ''}" data-row-at="${f(dots)}">
${named ? `<div class="who" data-anim="fade" data-at="${f(dots)}" data-dur="0.2">${esc(sp?.name ?? '')}</div>` : ''}
<div class="bub" data-anim="pop" data-at="${f(t.atS)}" data-dur="0.32">${esc(typo(t.text))}</div>
${dots < t.atS ? `<div class="typing" data-typing data-from="${f(dots)}" data-to="${f(t.atS)}"><i></i><i></i><i></i></div>` : ''}
</div>`
    })
    .join('\n')
  return {
    css: `
.chat{position:absolute;left:${left}px;top:${z0.top}px;width:${w}px;height:${h}px;border-radius:${pick(c, 44, 52)}px;overflow:hidden;background:var(--panel);border:1px solid var(--line);box-shadow:0 22px 70px rgba(0,0,0,.5)}
.chat .head{height:${head}px;display:flex;align-items:center;gap:${pick(c, 18, 22)}px;padding:0 ${pick(c, 30, 36)}px;border-bottom:1px solid var(--line)}
.chat .av{flex:none;width:${Math.round(head * 0.58)}px;height:${Math.round(head * 0.58)}px;border-radius:50%;background:${avatarColour(title)};color:#fff;font-weight:700;font-size:${Math.round(head * 0.3)}px;display:flex;align-items:center;justify-content:center}
.chat .nm{font-size:${pick(c, 34, 42)}px;font-weight:700;white-space:nowrap;overflow:hidden;max-width:${w - 220}px}
.chat .view{position:absolute;left:0;right:0;top:${head}px;bottom:0;overflow:hidden}
.chat .list{position:relative;padding:${pick(c, 24, 30)}px ${pick(c, 26, 32)}px ${pick(c, 30, 40)}px}
.row{position:relative;display:flex;flex-direction:column;margin-top:${pick(c, 20, 26)}px}
.row.streak{margin-top:${pick(c, 7, 9)}px}
.row.right{align-items:flex-end}.row.left{align-items:flex-start}
.who{font-size:${Math.round(text * 0.66)}px;color:var(--muted);margin:0 ${pick(c, 18, 22)}px 5px;font-weight:700}
.bub{max-width:80%;padding:${pick(c, 16, 20)}px ${pick(c, 24, 30)}px ${pick(c, 18, 22)}px;font-size:${text}px;line-height:1.28;border-radius:${pick(c, 30, 38)}px;overflow-wrap:anywhere}
.row.right .bub{background:var(--chip);color:var(--chip-text);border-bottom-right-radius:${pick(c, 9, 11)}px;transform-origin:right bottom}
.row.left .bub{background:var(--other);color:var(--other-text);border-bottom-left-radius:${pick(c, 9, 11)}px;transform-origin:left bottom}
.typing{position:absolute;bottom:0;display:flex;gap:${pick(c, 9, 11)}px;align-items:center;padding:${pick(c, 20, 25)}px ${pick(c, 24, 30)}px;border-radius:${pick(c, 30, 38)}px;opacity:0}
.row.right .typing{right:0;background:var(--chip)}.row.left .typing{left:0;background:var(--other)}
.typing i{display:block;width:${pick(c, 13, 16)}px;height:${pick(c, 13, 16)}px;border-radius:50%;background:var(--other-text);opacity:.8}
.row.right .typing i{background:var(--chip-text)}`,
    body: `<div class="chat" data-anim="rise" data-at="0" data-dy="30" data-dur="0.4" data-out="${f(out)}">
<div class="head"><div class="av">${esc(initial(title))}</div><div class="nm" data-fit="22">${esc(typo(title))}</div></div>
<div class="view" data-scroll data-pad="${pick(c, 24, 30)}"><div class="list">
${rows}
</div></div></div>`
  }
}
