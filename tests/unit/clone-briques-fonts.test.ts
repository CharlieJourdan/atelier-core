// moteur-briques — the cards' own fonts: the measured font descriptions become the figures' face, the titles' own face and an
// underline rule; the styled page sets them (the display serif loaded only when a style needs it).
import { describe, expect, it } from 'vitest'
import { needsDisplaySerif, styledPage, type CardStyle } from '../../src/engine/motion/styled'
import { faceFrom, faceOfFont } from '../../src/main/production/clone/pipeline/values'

const base: CardStyle = { ground: '#0b1028', ink: '#ffffff', accent: '#5b8cff', muted: '#8f98c4', face: 'sans', upper: false, easing: 'out', texture: 'flat', fullScreen: true, landShare: 0.15 }
const ctx = { width: 1920, height: 1080, durationS: 3, fontCss: '' }

describe('card fonts', () => {
  it('names the face of a measured font description', () => {
    expect(faceOfFont('serif italic light')).toBe('serif-italic')
    expect(faceOfFont('script')).toBe('serif-italic')
    expect(faceOfFont('rounded sans bold capitals')).toBe('geometric')
    expect(faceOfFont('bold condensed sans')).toBe('condensed')
    expect(faceOfFont('serif')).toBe('serif')
    expect(faceOfFont('grotesque sans medium')).toBe('sans')
  })

  it('sets titles apart when the reference does (Finary: serif italic titles, bold sans amounts)', () => {
    expect(faceFrom(['serif italic (titles)', 'bold sans (amounts, glowing yellow)'])).toEqual({ face: 'sans', upper: false, titleFace: 'serif-italic' })
  })

  it('reads capitals and an underlined title (Le Monde en POV cards)', () => {
    expect(faceFrom(['rounded sans bold capitals underlined title', 'rounded sans medium labels'])).toEqual({ face: 'geometric', upper: true, titleRule: true })
    expect(faceFrom([])).toEqual({ face: 'sans', upper: false })
  })

  it('draws the titles in their face with the rule, the display serif only when needed', () => {
    const page = styledPage(ctx, { ...base, titleFace: 'serif-italic', titleRule: true }, '', '')
    expect(page).toContain("--tface:'Instrument Serif'")
    expect(page).toContain('--tstyle:italic')
    expect(page).toContain('.ttl::after')
    expect(styledPage(ctx, base, '', '')).not.toContain('::after')
    expect(needsDisplaySerif({ ...base, titleFace: 'serif-italic' })).toBe(true)
    expect(needsDisplaySerif(base)).toBe(false)
  })
})

describe('look columns of moteur-briques', () => {
  it('reads the first-person hand and the depth columns, says nothing when an answer lacks them', async () => {
    const { parseShotLooks } = await import('../../src/main/production/clone/analysis/look')
    const { looks } = parseShotLooks('1|off|-|-|drawn|-|hand|deep\n2|off|-|-|drawn|-|-|flat\n3|off|-|-|found|-')
    expect(looks.get(1)).toMatchObject({ pov: true, depth: 'deep' })
    expect(looks.get(2)).toMatchObject({ pov: false, depth: 'flat' })
    expect(looks.get(3)).not.toHaveProperty('pov')
    expect(looks.get(3)).not.toHaveProperty('depth')
  })
})

describe('canonical fonts and colours for the synthesis', () => {
  it('reduces free font descriptions to shape + role items and case tokens', async () => {
    const { canonFonts } = await import('../../src/main/production/clone/analysis/canon')
    expect(canonFonts(['grotesque sans bold capitals none yellow title for on-screen headlines', 'rounded sans bold numerals none glowing gold amounts'])).toEqual(['grotesque sans title', 'capitals', 'rounded sans amount'])
    expect(canonFonts(['serif italic light title'])).toEqual(['serif italic title'])
    expect(faceFrom(['grotesque sans title', 'capitals', 'rounded sans amount'])).toEqual({ face: 'geometric', upper: true, titleFace: 'sans' })
  })

  it('makes five videos agree on their fonts and palette (Le Monde en POV, 2026-11-04)', async () => {
    const { canonLooks } = await import('../../src/main/production/clone/analysis/canon')
    const fonts = [
      ['rounded sans bold capitals none title', 'geometric sans light capitals none label', 'grotesque sans bold capitals none amount'],
      ['grotesque sans bold capitals none yellow title', 'grotesque sans semibold capitals none small label', 'rounded sans bold numerals none gold amounts'],
      ['geometric sans bold capitals none gold-glow large-amount counter', 'grotesque sans bold capitals none white checklist label'],
      ['grotesque sans bold capitals none title card', 'rounded sans bold numerals none gold glow (large money counters)', 'geometric sans semibold capitals none small chart and bar labels'],
      ['geometric sans bold capitals none on-screen callouts and amounts', 'serif italic light title', 'grotesque sans bold capitals none newspaper headlines']
    ]
    const palettes = [['#141B2E', '#E8B04A', '#D8352A'], ['#0E1628', '#F2C46B', '#E0492E'], ['#1E2B4D', '#F5C542', '#D8432E'], ['#14203F', '#E9B44C', '#D93A2E'], ['#0B1430', '#F6C453', '#E5484D']]
    const as = fonts.map((f, i) => ({ motion: { fonts: f, palette: palettes[i]!, elements: [] } }) as never)
    const out = canonLooks(as)
    const count = (x: string): number => out.filter((a) => a.motion.fonts.includes(x)).length
    expect(count('capitals')).toBe(5)
    expect(count('grotesque sans title')).toBeGreaterThanOrEqual(3)
    const gold = out.map((a) => a.motion.palette[1])
    expect(new Set(gold).size).toBe(1)
  })
})

describe('palette clusters keep real colours', () => {
  it('names each cluster by a colour some video uses', async () => {
    const { paletteMap } = await import('../../src/main/production/clone/analysis/canon')
    const m = paletteMap([['#E8B04A'], ['#F2C46B'], ['#E9B44C'], ['#0E1628']])
    const gold = new Set(['#E8B04A', '#F2C46B', '#E9B44C'].map((c) => m.get(c)))
    expect(gold.size).toBe(1)
    expect(['#E8B04A', '#F2C46B', '#E9B44C']).toContain([...gold][0])
    expect(m.get('#0E1628')).toBe('#0E1628')
  })
})
