// The style agent on Charlie's 18 reference channels (production-15, research note avatar-channels-2026-10 (old repository)), priced on the
// engines a fresh Atelier Cloud publishes (its default grid, fakes): every channel gets a proposal; the three contrasted ones
// — #12 (presenter half the time, three layouts), #5 (a small inset then full screen, clips: as many as the clip slider allows),
// #14 (stills and stock, split screen) — land near their own measures, get the base, the curve and the layouts they show, and are ordered as they should
// be on presenter time and price; #13 (no presenter) gets the « sans présentateur » base. The table is printed for the docs.
import { describe, expect, it } from 'vitest'
import { technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { predictStyle } from '../../src/engine/technologies/likeness'
import { proposeForStyle, type StyleVariant } from '../../src/engine/technologies/style-propose'
import { creditsBook } from '../../src/main/production/estimates/book'
import type { EngineInfo } from '../../src/shared/api'
import { channel, REFERENCE_CHANNELS } from '../fixtures/avatar-channels'
import { cloudHelpers } from './cloud-app-helpers'

const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}
const engines = engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, (cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }).cloud.pricing.current())
const cost = { book: creditsBook(engines, []), backend: 'subscription' as const }
const reg = technologyRegistry()
const CREDIT_EUR = 0.01

const propose = (n: number) => {
  const c = channel(n)
  return proposeForStyle({ refs: c.videos, ctx: { language: c.lang }, cost, name: c.name }, reg)
}
const faithful = (n: number): StyleVariant => propose(n).variants.find((v) => v.kind === 'faithful') as StyleVariant
const median = (a: number, b: number): number => (a + b) / 2

describe('the 18 reference channels', () => {
  it('every channel gets a priced proposal; the table for the docs', () => {
    const rows: string[] = ['| # | Chaîne | Base | Présentateur | Plan | €/min fidèle | €/min éco | Estimation /100 |', '|---|---|---|---|---|---|---|---|']
    for (const c of REFERENCE_CHANNELS) {
      const p = propose(c.n)
      const f = p.variants.find((v) => v.kind === 'faithful') as StyleVariant
      const cheap = p.variants.find((v) => v.kind === 'cheap')
      expect(f.estimate?.perMinute.avg, c.name).toBeGreaterThan(0)
      const m = predictStyle(f.doc, reg, { language: c.lang })
      const eur = (x: number | undefined): string => (x === undefined ? '—' : (x * CREDIT_EUR).toFixed(2).replace('.', ','))
      rows.push(`| ${c.n} | ${c.name} | ${p.base} | ${Math.round((m?.presenterShare ?? 0) * 100)} % | ${m?.shotS?.toFixed(1) ?? '—'} s | ${eur(f.estimate?.perMinute.avg)} | ${eur(cheap?.estimate?.perMinute.avg)} | ${f.likeness ?? '—'} |`)
    }
    console.log(rows.join('\n'))
  })

  it('#12 presenter-heavy: half the screen, full / split / inset, flat, near its own rhythm and pace', () => {
    const c = channel(12)
    const f = faithful(12)
    const m = predictStyle(f.doc, reg, { language: 'de' }) as NonNullable<ReturnType<typeof predictStyle>>
    expect(propose(12).base).toBe('avatar@1')
    expect(m.presenterShare).toBeCloseTo(0.5, 1)
    expect(m.layouts).toEqual(expect.arrayContaining(['full', 'split', 'pip']))
    expect(m.curve).toBe('flat')
    expect(Math.abs((m.shotS as number) - 3.75)).toBeLessThan(0.5)
    expect(Math.abs((m.wordsPerMinute as number) - median(c.videos[0].wordsPerMinute as number, c.videos[1].wordsPerMinute as number))).toBeLessThan(15)
    expect(f.likeness as number).toBeGreaterThanOrEqual(80)
  })

  it('#5 inset then full, clips: little presenter, the hook-heavy curve, mostly clips', () => {
    const f = faithful(5)
    const m = predictStyle(f.doc, reg, { language: 'fr' }) as NonNullable<ReturnType<typeof predictStyle>>
    expect(m.presenterShare as number).toBeLessThan(0.12)
    expect(m.curve).toBe('hook-heavy')
    expect(m.layouts).toEqual(expect.arrayContaining(['pip', 'full']))
    // its clips (≈ 92 % of the pictures) stop at the clip slider's top (50 % of the screen): the rest are stills, the mix gap
    // stays visible in the estimate (Charlie decides whether the slider goes higher)
    expect(f.doc.options.clipShare).toBe(0.5)
    expect(m.kinds?.clipAi as number).toBeGreaterThan(0.5)
    expect(Math.abs((m.shotS as number) - 3)).toBeLessThan(0.5)
    expect(f.likeness as number).toBeGreaterThanOrEqual(75)
  })

  it('#14 stills and stock, split screen: a stock share, longer shots, slower narration', () => {
    const f = faithful(14)
    const m = predictStyle(f.doc, reg, { language: 'it' }) as NonNullable<ReturnType<typeof predictStyle>>
    expect(m.kinds?.stock as number).toBeGreaterThan(0.2)
    expect(m.kinds?.imageAi as number).toBeGreaterThan(0.5)
    expect(m.layouts).toEqual(expect.arrayContaining(['full', 'split']))
    expect(m.shotS as number).toBeGreaterThan(4.8)
    expect(Math.abs((m.wordsPerMinute as number) - 143)).toBeLessThan(15)
    expect(f.likeness as number).toBeGreaterThanOrEqual(75)
  })

  it('the three contrasted channels are ordered as they should be: presenter time #12 > #14 > #5, price #12 > #14', () => {
    const share = (n: number): number => (predictStyle(faithful(n).doc as RecipeDoc, reg)?.presenterShare ?? 0)
    expect(share(12)).toBeGreaterThan(share(14))
    expect(share(14)).toBeGreaterThan(share(5))
    expect(faithful(12).estimate?.perMinute.avg as number).toBeGreaterThan(faithful(14).estimate?.perMinute.avg as number)
  })

  it('#13 (no presenter, stock and archives) gets the « sans présentateur » base; #18 (stills, hook) keeps the avatar', () => {
    const p13 = propose(13)
    expect(p13.base).toBe('voiceover@1')
    const m13 = predictStyle(p13.variants[0]?.doc as RecipeDoc, reg) as NonNullable<ReturnType<typeof predictStyle>>
    expect(m13.presenterShare).toBe(0)
    expect((m13.kinds?.stock ?? 0) + (m13.kinds?.archive ?? 0)).toBeGreaterThan(0.8)
    const p18 = propose(18)
    expect(p18.base).toBe('avatar@1')
    expect(predictStyle(p18.variants[0]?.doc as RecipeDoc, reg)?.curve).toBe('hook-heavy')
  })
})
