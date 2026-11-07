// The prints board (formats/cards.ts `prints`, motion/doc-prints.ts, clone-markets-2): several prints dropped one by one on a slate or a
// cream paper, each with its typed, torn or boxed label, and red bars. Without a browser: the page each board makes, where its prints
// sit for one to eight prints in both frame shapes, the typed labels letter by letter, and the problems `checkMotion` names.
import { describe, expect, it } from 'vitest'
import { PrintsCardProps } from '../../src/engine/formats/cards'
import { checkMotion, MotionSpec, type MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { motionHtml } from '../../src/engine/motion'
import type { MotionCtx } from '../../src/engine/motion/base'
import { printSlots, TYPE_STEP_S } from '../../src/engine/motion/doc-prints'

const [W, H] = FRAME_SIZES['16:9']
const ctx = (w = W, h = H, durationS = 6): MotionCtx => ({ width: w, height: h, durationS, fontCss: '' })
const board = (props: Record<string, unknown>): MotionSpecInput => ({ template: 'prints', props }) as MotionSpecInput
const COUNTRIES = ['Poland', 'Denmark', 'Norway', 'Belgium', 'Netherlands', 'Luxembourg', 'France']

describe('the prints board', () => {
  it('parses with its defaults: a slate, typed labels, no bars, a slight push', () => {
    const p = PrintsCardProps.parse({ prints: [{ label: 'Poland' }] })
    expect(p.surface).toBe('slate')
    expect(p.prints[0]?.tag).toBe('typed')
    expect(p.bars).toEqual([])
    expect(p.move).toBe('push')
    expect(PrintsCardProps.safeParse({ prints: [] }).success).toBe(false)
    expect(PrintsCardProps.safeParse({ prints: Array.from({ length: 9 }, () => ({})) }).success).toBe(false)
  })

  it('draws one dropped print per item, in order, each from its own word', () => {
    const html = motionHtml(board({ prints: COUNTRIES.map((label, i) => ({ label, atS: 0.3 + i * 0.7 })) }), ctx())
    expect(html.match(/class="pw"/g)).toHaveLength(7)
    const ats = [...html.matchAll(/class="pw"[^>]*data-anim="drop" data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(ats).toEqual(COUNTRIES.map((_, i) => +(0.3 + i * 0.7).toFixed(2)))
    // without pictures: the neutral stand-in, never a broken image
    expect(html.match(/class="pimg ph"/g)).toHaveLength(7)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('types a tape label letter by letter, about twenty letters a second, after its print', () => {
    const html = motionHtml(board({ prints: [{ label: 'To be arrested', atS: 1 }] }), ctx())
    const letters = [...html.matchAll(/<span data-anim="fade" data-at="([\d.]+)" data-dur="0.02">(.)<\/span>/g)]
    expect(letters.map((m) => m[2]).join('')).toBe('TOBEARRESTED')
    // the label follows the print by 0.5 s: the tape shows first, then the letters
    expect(Number(letters[0]?.[1])).toBeCloseTo(1.6, 5)
    expect(Number(letters[1]?.[1]) - Number(letters[0]?.[1])).toBeCloseTo(TYPE_STEP_S, 5)
  })

  it('draws a torn strip for a person and a black box for an institution, escaped', () => {
    const html = motionHtml(
      board({ prints: [{ label: 'Adolf <Hitler>', sub: 'Führer · Germany', tag: 'torn' }, { label: 'Swiss National Bank', sub: 'Bern & Zurich', tag: 'box', labelAtS: 3 }] }),
      ctx()
    )
    expect(html).toContain('class="torn" style="clip-path:polygon(')
    expect(html).toContain('Adolf &lt;Hitler&gt;')
    expect(html).toContain('class="bx"')
    expect(html).toContain('Bern &amp; Zurich')
    expect(html).toMatch(/class="pl corner" data-anim="wipe" data-at="3.00"/)
  })

  it('wipes red bars in on their words, over a print or across the board, and types the extra tags', () => {
    const html = motionHtml(
      board({ prints: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], bars: [{ text: 'None of them hold up', atS: 4 }, { text: '“Stinking little state”', atS: 2, over: 1 }], extraTags: [{ label: 'Refused', atS: 5 }] }),
      ctx()
    )
    expect(html.match(/class="bar" data-anim="wipe"/g)).toHaveLength(2)
    expect(html).toContain('NONE OF THEM HOLD UP')
    expect(html).toContain('class="pl free"')
  })

  it('keeps every print inside the frame, from one to eight prints, in both shapes', () => {
    for (const [w, h] of [FRAME_SIZES['16:9'], FRAME_SIZES['9:16']]) {
      for (let n = 1; n <= 8; n++) {
        const slots = printSlots(
          Array.from({ length: n }, (_, i) => (i % 2 ? 0.75 : 1.5)),
          ctx(w, h),
          `n${n}`
        )
        expect(slots).toHaveLength(n)
        for (const s of slots) {
          expect(s.x, `${w}x${h} n=${n}`).toBeGreaterThanOrEqual(0)
          expect(s.y).toBeGreaterThanOrEqual(0)
          expect(s.x + s.w).toBeLessThanOrEqual(w)
          expect(s.y + s.h).toBeLessThanOrEqual(h)
          expect(Math.abs(s.tilt)).toBeLessThanOrEqual(2.6)
        }
      }
    }
  })

  it('turns to the cream paper when asked, and is the same page every time', () => {
    const spec = board({ surface: 'paper', prints: [{ label: 'Leonding, Austria · 1899', tag: 'box' }] })
    const html = motionHtml(spec, ctx())
    expect(html).toContain('#ece4d2')
    expect(motionHtml(spec, ctx())).toBe(html)
  })

  it('turns its labels and bars into red stamps on the kraft folder (the « dossier » look)', () => {
    const html = motionHtml(board({ surface: 'manila', prints: [{ label: 'Refusé', tag: 'stamp', atS: 0.4 }], bars: [{ text: 'Classé secret', atS: 2 }] }), ctx())
    expect(html).toContain('#d8b77e')
    expect(html.match(/class="stamp( big)?"/g)).toHaveLength(2)
    expect(html).toContain('CLASSÉ SECRET')
    expect(html).not.toContain('class="bar"')
  })

  it('keeps the board still when asked (a film laid into a print must not slide out of its frame)', () => {
    expect(motionHtml(board({ prints: [{ label: 'A' }] }), ctx())).toMatch(/class="stage" data-zoom/)
    expect(motionHtml(board({ move: 'still', prints: [{ label: 'A' }] }), ctx())).toMatch(/class="stage" >/)
  })

  it('names a print, a bar or a tag that would land after the board has gone', () => {
    const late = board({ prints: [{ label: 'A', atS: 5.9 }], bars: [{ text: 'x', atS: 7 }], extraTags: [{ label: 'y', atS: 6 }] })
    expect(MotionSpec.safeParse(late).success).toBe(true)
    const problems = checkMotion(late, 6)
    expect(problems.some((p) => /print 1/.test(p))).toBe(true)
    expect(problems.some((p) => /bar 1/.test(p))).toBe(true)
    expect(problems.some((p) => /tag 1/.test(p))).toBe(true)
  })
})
