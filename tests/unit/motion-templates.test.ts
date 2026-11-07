// Our motion templates (docs/ENGINE-SPEC.md §25) without a browser: the spec checks (a bad field names its template and field), the HTML each
// template produces from its props (texts escaped, times taken from the props, both frame shapes, French typography, text that reads on its
// backing at 4.5:1, nothing in the band where the captions are drawn), and the page's clock maths (easings, the scrolling list, French
// numbers) run in plain Node. The pictures themselves are checked in motion-browser.test.ts, with a real Chromium.
import { describe, expect, it } from 'vitest'
import { checkMotion, MOTION_SECONDS, MOTION_TEMPLATES, MotionSpec, type MotionSpecInput } from '../../src/engine/formats/motion'
import { FRAME_SIZES } from '../../src/engine/formats/timing'
import { contrast, esc, readableOn, themeOf, typo, zone, type MotionCtx } from '../../src/engine/motion/base'
import { figureText } from '../../src/engine/motion/cards'
import { avatarColour, typingStarts } from '../../src/engine/motion/conversation'
import { motionHtml } from '../../src/engine/motion'
import { RUNTIME_JS } from '../../src/engine/motion/runtime'
import { itemTimes } from '../../src/engine/motion/scenes'

const ctxOf = (aspect: '16:9' | '9:16', durationS = 5): MotionCtx => ({ width: FRAME_SIZES[aspect][0], height: FRAME_SIZES[aspect][1], durationS, fontCss: '' })

const SPECS: Record<string, MotionSpecInput> = {
  title: { template: 'title', props: { kicker: 'Épisode 3', title: 'Le phare oublié d’Ouessant', subtitle: 'Une histoire vraie' } },
  'lower-third': { template: 'lower-third', props: { name: 'Élise Moreau', role: 'Professeur' } },
  figure: { template: 'figure', props: { value: 12000, suffix: ' navires', label: 'passés devant ses fenêtres' } },
  list: { template: 'list', props: { heading: 'Trois raisons', items: [{ text: 'Le temps' }, { text: 'L’argent' }, { text: 'La patience' }] } },
  quote: { template: 'quote', props: { text: 'On ne voit bien qu’avec le cœur.', attribution: 'Antoine de Saint-Exupéry' } },
  'map-pin': { template: 'map-pin', props: { place: 'Ouessant', caption: 'Bretagne' } },
  conversation: {
    template: 'conversation',
    props: {
      speakers: [{ name: 'Léa', side: 'right' }, { name: 'Maël', side: 'left' }],
      turns: [{ speaker: 0, text: 'Tu dors ?', atS: 0.5 }, { speaker: 1, text: 'Non.', atS: 2 }, { speaker: 1, text: 'Je regarde le plafond.', atS: 3 }]
    }
  },
  // the motion kit (their own tests are motion-kit-templates.test.ts)
  kinetic: { template: 'kinetic', props: { words: [{ text: 'Trois', atS: 0.4 }, { text: 'raisons', atS: 0.8, emphasis: true }] } },
  // documentary-2: the texts over an archive film
  'doc-tags': { template: 'doc-tags', props: { tags: [{ kind: 'date', text: 'Mai 1940', atS: 0.3 }, { kind: 'bar', text: 'Une insulte au cœur de l’Europe', atS: 1 }] } },
  document: { template: 'document', props: { text: 'Le roi ordonne que la flotte parte avant la fin du mois.', marks: [{ phrase: 'la flotte parte', atS: 1, style: 'highlight' }] } },
  chart: { template: 'chart', props: { title: 'Les prix', kind: 'counters', counters: [{ label: 'Mineurs', value: 160000, atS: 1 }] } },
  // the documentary cards (formats/cards.ts; their own tests are doc-cards.test.ts, doc-prints.test.ts and map-card.test.ts)
  archive: { template: 'archive', props: { frame: 'board', label: 'Silver bar, 1622', sub: 'from the Atocha', punch: 'Belonged to Madrid' } },
  map: { template: 'map', props: { title: 'Europe, summer 1940' } },
  bars: { template: 'bars', props: { title: 'Market value lost', rows: [{ label: 'U.S. loss', value: 500, display: '$500B' }, { label: 'Global loss', value: 1700, accent: true }] } },
  timeline: { template: 'timeline', props: { title: 'Three centuries', events: [{ when: '1550', label: 'Treaty signed' }, { when: '1661', label: 'The crown defaults', accent: true }] } },
  prints: { template: 'prints', props: { prints: [{ label: 'Poland' }, { label: 'Adolf Hitler', sub: 'Führer · Germany', tag: 'torn' }], bars: [{ text: 'Not the whole story' }] } },
  // the 3D map card (its own tests are map3d.test.ts and map3d-browser.test.ts)
  // the motion studio card (its own tests are motion-studio.test.ts)
  studio: { template: 'studio', props: { items: [{ kind: 'counter', to: 1500, suffix: 'Mds $' }] } },
  map3d: { template: 'map3d', props: { title: 'Europe, summer 1940', camera: { keys: [{ atS: 0, center: { lat: 48.6, lon: 8.9 }, zoom: 4.7 }] } } },
  // the POV card (its own tests are pov-cards.test.ts)
  pov: { template: 'pov', props: { shot: { kind: 'scene', set: 'room', cast: [{ pose: 'phone', x: 0.4 }] } } }
}

describe('the specs of the templates', () => {
  it('every template of the library has a valid example, and a length range', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...MOTION_TEMPLATES].sort())
    for (const t of MOTION_TEMPLATES) {
      expect(MotionSpec.safeParse(SPECS[t]).success, t).toBe(true)
      expect(checkMotion(SPECS[t], 5.5), t).toEqual([])
      expect(MOTION_SECONDS[t].min).toBeLessThan(MOTION_SECONDS[t].max)
    }
  })

  it('a bad field is a permanent error that names the template and the field, never a silent truncation', () => {
    const long = { template: 'title', props: { title: 'x'.repeat(81) } }
    expect(checkMotion(long, 4)[0]).toMatch(/^motion title: props\.title /)
    expect(checkMotion({ template: 'figure', props: { value: 5, from: 5, label: 'cinq choses' } }, 4)).toContain('motion figure: value equals from, nothing to count')
    expect(checkMotion({ template: 'list', props: { items: [{ text: 'seul' }] } }, 6)[0]).toMatch(/motion list: props\.items /)
    expect(checkMotion({ template: 'conversation', props: { speakers: [{ name: 'A', side: 'right' }, { name: 'B', side: 'left' }], turns: [{ speaker: 3, text: 'x', atS: 0 }] } }, 5)[0]).toMatch(/speaker is not in the list/)
    expect(checkMotion({ template: 'nope', props: {} }, 4)[0]).toMatch(/motion nope/)
  })

  it('the length is checked against the template and against what is said inside it', () => {
    expect(checkMotion(SPECS.title, 1)[0]).toMatch(/shorter than the 2 s it needs/)
    expect(checkMotion(SPECS.title, 9)[0]).toMatch(/longer than the 6 s it allows/)
    // a bubble that would come after the overlay has gone
    expect(checkMotion(SPECS.conversation, 3.2)[0]).toMatch(/last bubble \(3\.0 s\) comes too late/)
    expect(checkMotion({ template: 'list', props: { items: [{ text: 'un', atS: 1 }, { text: 'deux', atS: 5.5 }] } }, 6)[0]).toMatch(/item 2 \(5\.5 s\) comes too late/)
  })

  it('turns of a conversation must follow the order of the voice', () => {
    const r = MotionSpec.safeParse({ template: 'conversation', props: { speakers: [{ name: 'A', side: 'right' }, { name: 'B', side: 'left' }], turns: [{ speaker: 0, text: 'a', atS: 3 }, { speaker: 1, text: 'b', atS: 2 }] } })
    expect(r.success).toBe(false)
  })
})

describe('the HTML of each template', () => {
  it('is a transparent page of the frame’s size with the runtime that moves it, for both shapes', () => {
    for (const t of MOTION_TEMPLATES) {
      for (const aspect of ['16:9', '9:16'] as const) {
        const c = ctxOf(aspect, t === 'conversation' ? 6 : 6)
        const html = motionHtml(SPECS[t] as MotionSpecInput, c)
        expect(html, `${t} ${aspect}`).toContain(`width:${c.width}px;height:${c.height}px`)
        expect(html).toContain('background:transparent')
        expect(html).toContain('atelierRenderAt')
        expect(html).toContain('lang="fr"')
        // the page is the same page every time it is asked for (a graphic is a function of its fields)
        expect(motionHtml(SPECS[t] as MotionSpecInput, c)).toBe(html)
        // no network, no script from outside
        expect(html).not.toMatch(/https?:\/\//)
      }
    }
  })

  it('writes the props as text, escaped, with French non-breaking spaces before the signs that take one', () => {
    const html = motionHtml({ template: 'lower-third', props: { name: 'A <b>&</b> « B »', role: 'Chef : cuisine !' } }, ctxOf('16:9'))
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; « B »')
    expect(html).toContain('Chef : cuisine !')
    expect(html).not.toContain('<b>&</b>')
    expect(esc('a"b')).toBe('a&quot;b')
    expect(typo('Quoi ? Oui ; non : « ok » 5 %')).toBe('Quoi ? Oui ; non : « ok » 5 %')
  })

  it('the title card shows its words one after the other, its kicker and its subtitle; a long title is fitted by measurement, not cut', () => {
    const html = motionHtml(SPECS.title as MotionSpecInput, ctxOf('16:9', 4))
    expect(html).toContain('Épisode 3')
    expect(html.match(/class="w"/g)).toHaveLength(4)
    expect(html).toContain('data-fit="44"')
    // the way out starts 0.4 s before the end
    expect(html).toContain('data-out="3.60"')
    const long = motionHtml({ template: 'title', props: { title: 'Un titre très long qui prend beaucoup de place sur trois lignes complètes' } }, ctxOf('9:16', 4))
    expect(long).toContain('>complètes<')
  })

  it('the figure counts from its start to its value in French, and reserves the room of the final number', () => {
    const html = motionHtml({ template: 'figure', props: { value: 3.5, decimals: 1, suffix: ' millions d’euros', label: 'dépensés pour sauver le phare' } }, ctxOf('9:16', 5))
    expect(html).toContain('data-count data-from="0" data-to="3.5" data-dec="1"')
    expect(html).toContain('class="ghost">3,5<')
    // a long unit gets its own line, a short one stands next to the number
    expect(html).toContain('class="unit"')
    expect(motionHtml({ template: 'figure', props: { value: 40, suffix: ' %', label: 'de la population' } }, ctxOf('16:9', 5))).toContain('class="suf"')
    expect(figureText({ value: 12000, from: 0, decimals: 0, prefix: '', suffix: '', label: 'x' })).toBe('12 000')
    expect(figureText({ value: 1234567.891, from: 0, decimals: 2, prefix: '', suffix: '', label: 'x' })).toBe('1 234 567,89')
  })

  it('the list reveals its items at the times the plan gives, else spread evenly; a ranking counts down', () => {
    expect(itemTimes([{}, {}, {}], 8)).toEqual([0.7, 3.55, 6.4])
    expect(itemTimes([{ atS: 1 }, {}, { atS: 5 }], 8)[0]).toBe(1)
    const html = motionHtml({ template: 'list', props: { items: [{ text: 'A', atS: 1 }, { text: 'B', atS: 2 }, { text: 'C', atS: 3 }], order: 'desc' } }, ctxOf('9:16', 6))
    expect(html.match(/data-anim="left" data-at="(\d\.\d\d)"/g)).toEqual(['data-anim="left" data-at="1.00"', 'data-anim="left" data-at="2.00"', 'data-anim="left" data-at="3.00"'])
    expect([...html.matchAll(/class="no">(\d)</g)].map((m) => m[1])).toEqual(['3', '2', '1'])
  })

  it('the map pin is drawn, not fetched: the same place always looks the same, another place looks different', () => {
    const a = motionHtml({ template: 'map-pin', props: { place: 'Ouessant' } }, ctxOf('16:9'))
    expect(motionHtml({ template: 'map-pin', props: { place: 'Ouessant' } }, ctxOf('16:9'))).toBe(a)
    expect(motionHtml({ template: 'map-pin', props: { place: 'Brest' } }, ctxOf('16:9'))).not.toBe(a)
    expect(a).toContain('<svg')
    expect(a).not.toMatch(/tile|https?:/)
  })

  it('the conversation has a row per bubble, timed by the plan: the dots first, then the bubble, the list scrolling at the dots', () => {
    const c = ctxOf('9:16', 6)
    const html = motionHtml(SPECS.conversation as MotionSpecInput, c)
    // three bubbles, at the times of the lines
    expect([...html.matchAll(/class="bub" data-anim="pop" data-at="([\d.]+)"/g)].map((m) => m[1])).toEqual(['0.50', '2.00', '3.00'])
    // dots for the first line of a speaker (before it), none for a bubble of the speaker who goes on
    expect(html.match(/class="typing"/g)).toHaveLength(2)
    expect([...html.matchAll(/data-typing data-from="([\d.]+)" data-to="([\d.]+)"/g)].map((m) => [m[1], m[2]])).toEqual([['0.00', '0.50'], ['1.10', '2.00']])
    expect(html).toContain('data-scroll')
    expect(html.match(/class="row /g)).toHaveLength(3)
    // right = the one who writes; the header names the others
    expect(html).toContain('class="row right"')
    expect(html).toContain('class="row left"')
    expect(html).toMatch(/class="nm"[^>]*>Maël</)
  })

  it('names the speakers above the bubbles of a group chat only', () => {
    const turns = [{ speaker: 0, text: 'a', atS: 0.5 }, { speaker: 1, text: 'b', atS: 2 }, { speaker: 2, text: 'c', atS: 3.5 }]
    const two = motionHtml({ template: 'conversation', props: { speakers: [{ name: 'A', side: 'right' }, { name: 'B', side: 'left' }], turns: turns.slice(0, 2) } }, ctxOf('9:16', 6))
    expect(two).not.toContain('class="who"')
    const three = motionHtml({ template: 'conversation', props: { speakers: [{ name: 'A', side: 'right' }, { name: 'B', side: 'left' }, { name: 'C', side: 'left' }], turns } }, ctxOf('9:16', 6))
    expect(three.match(/class="who"/g)).toHaveLength(2)
  })

  it('typing dots: asked for, else just before the bubble and after the previous line; none when the speaker goes on', () => {
    const t = (speaker: number, atS: number, typingS?: number) => ({ speaker, text: 'x', atS, ...(typingS !== undefined ? { typingS } : {}) })
    expect(typingStarts([t(0, 0.2), t(1, 3), t(1, 4), t(0, 4.4), t(1, 9, 8.2)])).toEqual([0, 2.1, 4, 4.15, 8.2])
    expect(avatarColour('Léa')).toBe(avatarColour('Léa'))
  })
})

describe('legibility', () => {
  it('text reads on its backing at 4.5:1 for any accent, in both looks', () => {
    for (const accent of ['#3B82F6', '#FFD84D', '#10B981', '#F59E0B', '#EC4899', '#FFFFFF', '#00FF00']) {
      for (const mode of ['dark', 'light'] as const) {
        const t = themeOf(accent, mode)
        expect(contrast(t.chip, t.chipText), `${accent} ${mode} chip`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast('#2A2F3B', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#E3E6ED', '#10131A')).toBeGreaterThanOrEqual(4.5)
    // a dark backing is made dark enough for white text
    expect(contrast(readableOn('#FFD84D', '#FFFFFF'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('graphics keep out of the band where the captions are drawn and out of the labels’ corner', () => {
    for (const aspect of ['16:9', '9:16'] as const) {
      const c = ctxOf(aspect)
      const z = zone(c)
      // captions: a film from 77 % of its height (the bottom margin is 90 px), a short in the band at 66–75 %
      expect(z.bottom).toBeLessThanOrEqual(Math.round(c.height * (aspect === '16:9' ? 0.77 : 0.66)))
      // labels: the upper left corner, below 9 % in a short
      expect(z.top).toBeGreaterThanOrEqual(Math.round(c.height * (aspect === '16:9' ? 0.1 : 0.12)) - 1)
      expect(z.left).toBeGreaterThanOrEqual(60)
    }
  })
})

describe('the clock of the page, in plain Node', () => {
  const root: { __atelierMotion?: { ease: Record<string, (x: number) => number>; scrollOffset: (r: { at: number; bottom: number }[], v: number, p: number, t: number, d: number) => number; formatNumber: (v: number, d: number) => string; look: (p: string, a: number, q: number, dx: number, dy: number) => { o: number; ty: number; sx: number; tx: number; clip: string } } } = {}
  new Function('window', 'document', RUNTIME_JS)(root, undefined)
  // the runtime binds itself on its argument (the page's window); without a document it only exports its maths
  const m = (root as { __atelierMotion: NonNullable<typeof root.__atelierMotion> }).__atelierMotion

  it('every easing starts at 0 and ends at 1; the pop overshoots then settles; the bounce stays between 0 and 1', () => {
    for (const k of ['linear', 'out', 'inOut', 'back', 'bounce'] as const) {
      expect((m.ease[k] as (x: number) => number)(0)).toBeCloseTo(0, 6)
      expect((m.ease[k] as (x: number) => number)(1)).toBeCloseTo(1, 6)
    }
    expect(Math.max(...Array.from({ length: 21 }, (_, i) => (m.ease.back as (x: number) => number)(i / 20)))).toBeGreaterThan(1)
    for (let i = 0; i <= 20; i++) expect(m.ease.bounce?.(i / 20)).toBeLessThanOrEqual(1)
  })

  it('a state is a pure function of the time: hidden before its start, settled after, faded on the way out', () => {
    expect(m.look('rise', 0, 0, 120, 40)).toMatchObject({ o: 0, ty: 40 })
    expect(m.look('rise', 1, 0, 120, 40)).toMatchObject({ o: 1, ty: 0 })
    expect(m.look('pop', 1, 0, 0, 0)).toMatchObject({ o: 1, sx: 1 })
    expect(m.look('wipe', 0.5, 0, 0, 0).clip).toMatch(/^inset\(0 /)
    expect(m.look('fade', 1, 1, 0, 0).o).toBeCloseTo(0, 6)
    expect(m.look('left', 0, 0, 120, 40).tx).toBe(-120)
  })

  it('French numbers: a non-breaking space between thousands, a comma for decimals', () => {
    expect(m.formatNumber(12000, 0)).toBe('12 000')
    expect(m.formatNumber(3.5, 1)).toBe('3,5')
    expect(m.formatNumber(1234567, 0)).toBe('1 234 567')
  })

  it('the list scrolls only when a row would pass the bottom, by eased steps that never go back (no jump)', () => {
    // a view of 600 px; rows end at 150, 300, 450, 600, 750, 900 one second apart
    const rows = [1, 2, 3, 4, 5, 6].map((at) => ({ at, bottom: at * 150 }))
    const y = (t: number): number => m.scrollOffset(rows, 600, 24, t, 0.5)
    expect(y(0)).toBe(0)
    expect(y(3.9)).toBe(0) // 450 + 24 < 600: no scroll yet
    expect(y(4.5)).toBeGreaterThan(0) // the fourth row (bottom 600) asks for 24 px
    expect(y(10)).toBeCloseTo(900 + 24 - 600, 6)
    let last = -1
    for (let t = 0; t <= 8; t += 1 / 30) {
      const v = y(t)
      expect(v).toBeGreaterThanOrEqual(last - 1e-9)
      expect(v - last).toBeLessThan(35) // a row of 150 px in half a second: at most ~30 px a frame at the peak of the ease, never a jump
      last = v
    }
  })
})
