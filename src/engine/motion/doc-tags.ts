// The texts the documentary lays over an archive film (formats/motion.ts `doc-tags`, documentary-2): a date typed in a black box (top
// left of the film), a big serif figure with what it counts (top centre), a person's name on a torn white strip (bottom), a red bar with
// white serif capitals (a quote, a key phrase, a chapter's title: bottom centre), small typed tags, plain white serif words. Measured on
// five videos of the reference channel: each lands on its word (≈ 0.15 s after), the typed ones at ≈ 20 letters a second, a bar wipes in
// in 0.4 s. Two tags never share a place: the second one at the same place stacks under (or over) the first.
import type { DocTagsProps } from '../formats/motion'
import { esc, pick, typo, type MotionCtx } from './base'
import type { Part } from './cards'
import { tornClip } from './doc-board'
import { FONT, f2 } from './doc-common'
import { TYPE_STEP_S } from './doc-prints'

const MONO = "'Courier Prime','Courier New',Courier,monospace"

type Tag = DocTagsProps['tags'][number]
type Place = NonNullable<Tag['place']>
/** Where each kind sits when the spec does not say (the reference's spots). */
export const DEFAULT_PLACE: Record<Tag['kind'], Place> = { date: 'top-left', number: 'top', name: 'bottom', bar: 'bottom', chapter: 'bottom', tag: 'bottom-left', words: 'centre' }

function typed(text: string, at: number): string {
  return [...typo(text).toUpperCase()].map((ch, i) => (ch === ' ' ? ' ' : `<span data-anim="fade" data-at="${f2(at + i * TYPE_STEP_S)}" data-dur="0.02">${esc(ch)}</span>`)).join('')
}

function tagHtml(t: Tag, at: number): string {
  switch (t.kind) {
    case 'date':
      return `<div class="dbox" data-anim="fade" data-at="${f2(at)}" data-dur="0.12">${typed(t.text, at + 0.08)}</div>`
    case 'tag':
      return `<div class="tape" data-anim="fade" data-at="${f2(at)}" data-dur="0.12">${typed(t.text, at + 0.08)}</div>`
    case 'number':
      return `<div class="num" data-anim="blur" data-at="${f2(at)}" data-dur="0.6" data-dy="14" data-blur="8"><div class="big" data-fit="10">${esc(typo(t.text))}</div>${t.sub ? `<div class="sub" data-fit="10">${esc(typo(t.sub))}</div>` : ''}</div>`
    case 'name':
      return `<div class="torn" style="clip-path:${tornClip(t.text)}" data-anim="rise" data-at="${f2(at)}" data-dur="0.4" data-dy="12"><div class="tt" data-fit="14">${esc(typo(t.text))}</div>${t.sub ? `<div class="ts" data-fit="10">${esc(typo(t.sub))}</div>` : ''}</div>`
    case 'words':
      return `<div class="words" data-anim="fade" data-at="${f2(at)}" data-dur="0.5" data-fit="12">${esc(typo(t.text))}</div>`
    default:
      // a bar or a chapter's title: red, white serif capitals, wiping in
      return `<div class="bar" data-anim="wipe" data-at="${f2(at)}" data-dur="0.4" data-fit="12">${esc(typo(t.text).toUpperCase())}</div>`
  }
}

/** The page of the tags: each at its place, a second one at the same place stacked away from the edge. */
export function docTags(p: DocTagsProps, c: MotionCtx): Part {
  const used = new Map<Place, number>()
  // the film sits 4:3 in the middle of a 16:9 frame: the tags stay over it (its left edge is at 12.5 % of the width)
  const filmLeft = c.width > c.height ? Math.round((c.width - (c.height * 4) / 3) / 2) : 0
  const body = p.tags
    .map((t, i) => {
      const place = t.place ?? DEFAULT_PLACE[t.kind]
      const k = used.get(place) ?? 0
      used.set(place, k + 1)
      const step = pick(c, 86, 80) * k
      const at = t.atS ?? 0.2 + i * 0.6
      const pos =
        place === 'top-left'
          ? `left:${filmLeft + pick(c, 64, 40)}px;top:${pick(c, 70, 160) + step}px`
          : place === 'top'
            ? `left:0;right:0;top:${pick(c, 110, 260) + step * 2}px;display:flex;justify-content:center`
            : place === 'bottom-left'
              ? `left:${filmLeft + pick(c, 64, 40)}px;bottom:${pick(c, 110, 300) + step}px`
              : place === 'centre'
                ? `left:${filmLeft + pick(c, 80, 40)}px;right:${filmLeft + pick(c, 80, 40)}px;top:${Math.round(c.height * 0.42) + step}px;display:flex;justify-content:center`
                : `left:${filmLeft}px;right:${filmLeft}px;bottom:${pick(c, 96, 320) + step}px;display:flex;justify-content:center`
      return `<div class="slot" style="${pos}">${tagHtml(t, at)}</div>`
    })
    .join('')
  const maxW = Math.round(c.width > c.height ? (c.height * 4) / 3 - 120 : c.width - 80)
  return {
    css: `
.slot{position:absolute;white-space:nowrap}
.dbox{display:inline-block;background:rgba(10,9,8,.92);color:#f2efe9;font-family:${FONT.serif};font-size:${pick(c, 30, 34)}px;letter-spacing:.06em;padding:${pick(c, 7, 8)}px ${pick(c, 16, 18)}px ${pick(c, 8, 9)}px;box-shadow:0 6px 16px rgba(0,0,0,.45)}
.tape{display:inline-block;background:#141210;color:#e9e4da;font-family:${MONO};font-weight:700;font-size:${pick(c, 23, 26)}px;letter-spacing:.16em;padding:${pick(c, 6, 7)}px ${pick(c, 14, 16)}px;box-shadow:0 4px 10px rgba(0,0,0,.5)}
.num{color:#f4f1ea;font-family:${FONT.serif};text-align:center;text-shadow:0 3px 18px rgba(0,0,0,.85);max-width:${maxW}px}
.num .big{font-size:${pick(c, 120, 130)}px;font-weight:600;line-height:1;white-space:nowrap;overflow:hidden}
.num .sub{font-size:${pick(c, 34, 38)}px;font-style:italic;letter-spacing:.12em;margin-top:6px;text-transform:uppercase;white-space:nowrap;overflow:hidden}
.torn{display:inline-block;background:#f4f1ea;color:#0d0c0b;padding:${pick(c, 12, 14)}px ${pick(c, 30, 32)}px ${pick(c, 13, 14)}px;text-align:center;filter:drop-shadow(0 5px 6px rgba(0,0,0,.6));transform:rotate(-2deg);max-width:${maxW}px}
.torn .tt{font-family:${FONT.serif};font-weight:500;font-size:${pick(c, 36, 40)}px;white-space:nowrap;overflow:hidden}
.torn .ts{font-family:${FONT.serif};font-style:italic;font-size:${pick(c, 20, 22)}px;color:#55514a;white-space:nowrap;overflow:hidden}
.bar{display:inline-block;background:#d5412f;color:#fff;font-family:${FONT.serif};font-weight:500;font-size:${pick(c, 38, 40)}px;letter-spacing:.03em;line-height:1.1;padding:${pick(c, 8, 9)}px ${pick(c, 16, 18)}px ${pick(c, 9, 10)}px;box-shadow:0 8px 18px rgba(0,0,0,.45);max-width:${maxW}px;white-space:nowrap;overflow:hidden}
.words{color:#f4f1ea;font-family:${FONT.serif};font-size:${pick(c, 54, 60)}px;text-shadow:0 3px 16px rgba(0,0,0,.9);max-width:${maxW}px;white-space:nowrap;overflow:hidden}`,
    body
  }
}
