// The Avatar base pipeline's settings Charlie asked for (avatar-reglages-voix, 02/11): the character's shots, layouts and acting,
// the voice, the offer and the editing — each a pipeline setting (record 0055) whose effect on the price per finished minute the
// estimator shows (`optionCostDeltas`, the Δ under each choice in the pipeline page), on a fresh Atelier Cloud's default grid.
import { describe, expect, it } from 'vitest'
import { technologyRegistry } from '../../src/engine/technologies'
import { basePipeline } from '../../src/engine/technologies/bases'
import { estimateCost, optionCostDeltas } from '../../src/engine/technologies/cost'
import type { RecipeDoc } from '../../src/engine/technologies/recipe'
import { creditsBook } from '../../src/main/production/estimates/book'
import type { EngineInfo } from '../../src/shared/api'
import { OPTION_GROUPS, OPTION_PREVIEWS } from '../../src/shared/option-previews'
import { cloudHelpers } from './cloud-app-helpers'

const reg = technologyRegistry()
const ENGINES_MODULE = 'engines'
const engineMod = (await import(`../../cloud/src/providers/${ENGINES_MODULE}.ts`)) as {
  FAKE_ENGINES: unknown[]
  publishEngines(decls: unknown[], registry: { resolve(u: string): { status: 'real' | 'demo' } }, grid: unknown): EngineInfo[]
}
const book = creditsBook(engineMod.publishEngines(engineMod.FAKE_ENGINES, { resolve: () => ({ status: 'demo' }) }, (cloudHelpers.makeCloud() as unknown as { cloud: { pricing: { current(): unknown } } }).cloud.pricing.current()), [])
const cost = { book, backend: 'subscription' as const }
const avatar = basePipeline('avatar@1')
if (!avatar) throw new Error('no avatar@1')
const doc = { ...(structuredClone(avatar.doc) as RecipeDoc), base: 'avatar@1' }
const avg = (d: RecipeDoc): number => {
  const r = estimateCost(d, reg, cost)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.estimate.perMinute.avg
}

describe('avatar@1 settings and the price per minute', () => {
  const deltas = optionCostDeltas(doc, reg, cost)
  const asked = ['presenterShots', 'presenterLayouts', 'presenterInBroll', 'quality.voice', 'sponsor', 'offerPlace', 'editing']

  it('every setting Charlie asked for is an option of the base, in a group, with its Δ per minute', () => {
    const rows = asked.map((id) => {
      const o = avatar.options.find((x) => x.id === id)
      if (!o || o.kind === 'slider') throw new Error(`no option ${id}`)
      return `| ${id} | ${String(o.default)} | ${o.choices.filter((c) => !c.soon && c.value !== o.default).map((c) => `${String(c.value)} ${(deltas[id]?.[String(c.value)] ?? 0) >= 0 ? '+' : ''}${(deltas[id]?.[String(c.value)] ?? 0).toFixed(1)}`).join(' · ')} |`
    })
    console.log([`base avatar@1: ${avg(doc).toFixed(1)} credits a minute`, '| Setting | Default | Other choices: Δ credits a minute |', '|---|---|---|', ...rows].join('\n'))
    for (const id of asked) expect(OPTION_GROUPS.some((g) => g.options.includes(id))).toBe(true)
    for (const id of ['presenterLayouts', 'presenterInBroll', 'editing']) expect(OPTION_PREVIEWS.some((p) => p.option === id)).toBe(true)
  })

  it('the layouts: a presenter in half-screen or inset needs a picture beside him (full frame only is cheaper)', () => {
    expect(deltas.presenterLayouts?.full).toBeLessThan(0)
    expect(deltas.presenterLayouts?.split).toBeLessThan(0)
    expect(deltas.presenterLayouts?.full as number).toBeLessThan(deltas.presenterLayouts?.split as number)
  })

  it('the editing: « dynamique » cuts shorter shots, so more pictures and clips a minute', () => {
    expect(deltas.editing?.dynamic).toBeGreaterThan(5)
  })

  it('the voice: ai33 stays the default while we test; MiniMax HD (« haute qualité », for release) costs more', () => {
    expect(deltas['quality.voice']?.high).toBeGreaterThan(5)
    // Charlie 02/11: « pas MiniMax par défaut, surtout pas pour les tests »
    const o = avatar.options.find((x) => x.id === 'quality.voice')
    const standard = o && o.kind !== 'slider' ? o.choices.find((c) => c.value === o.default) : undefined
    expect(standard?.effects).toEqual([
      { op: 'setEngine', brick: 'voice.tts', engine: 'voice:ai33' },
      { op: 'setFallbacks', brick: 'voice.tts', fallbacks: ['voice:minimax-28-hd'] }
    ])
  })

  it('the offer: where it goes costs nothing a minute; the presenter shots and acting keep their own price', () => {
    for (const v of ['after_hook', 'mention', 'end', 'none']) expect(Math.abs(deltas.offerPlace?.[v] ?? 0)).toBeLessThan(0.5)
    expect(deltas.presenterShots).toBeDefined()
    expect(deltas.presenterInBroll).toBeDefined()
  })
})
