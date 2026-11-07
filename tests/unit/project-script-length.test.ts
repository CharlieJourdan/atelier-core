// QA B4 / B5: an imported script sets the video's length (the quote, the run and the library follow it), and the launch
// quote reads the Cloud's prices the estimate reads (it is not made on the placeholder grid when the cache is empty).
import { describe, expect, it } from 'vitest'
import { avatarBase, fromBase } from '../../src/engine/technologies'
import type { RecipeDocument } from '../../src/shared/api'
import { scriptMinutes } from '../../src/main/production/recipes/script-length'
import { livePrices } from '../../src/main/production/estimates/book'
import { DEFAULT_ENGINES } from '../../src/shared/cloud-engines'
import { memoryCore } from './helpers'

const WORDS = (n: number): string => Array.from({ length: n }, (_, i) => (i % 9 === 8 ? 'chauffage.' : 'le')).join(' ')

describe('scriptMinutes', () => {
  it('counts the spoken length of the script, in tenths of a minute, between 0.5 and 30', () => {
    expect(scriptMinutes(undefined)).toBeNull()
    expect(scriptMinutes('   ')).toBeNull()
    expect(scriptMinutes(WORDS(175))).toBe(1.2)
    expect(scriptMinutes(WORDS(30))).toBe(0.5)
    expect(scriptMinutes(WORDS(9000))).toBe(30)
  })
})

describe('a project with an imported script', () => {
  it('is quoted at the script’s length, not the pipeline’s 12 minutes', async () => {
    const core = memoryCore()
    try {
      const api = core.api
      const ch = await api['channels.create']({ name: 'Marcel', niche: 'bricolage' })
      const doc = fromBase(avatarBase) as unknown as RecipeDocument & { options?: Record<string, unknown> }
      const r = await api['recipes.save']({ doc: { ...doc, options: { ...(doc.options ?? {}), script: 'import' } } as RecipeDocument })
      const p = await api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Purger', idea: 'Purger les radiateurs', inputs: { script: WORDS(175) } })
      const quote = await api['projects.quote'](p.id)
      expect(quote.minutes).toBe(1.2)
      const without = await api['projects.create']({ recipeId: r.id, channelId: ch.id, title: 'Sans', idea: 'Sans script' })
      expect((await api['projects.quote'](without.id)).minutes).toBe(12)
    } finally {
      core.close()
    }
  })
})

describe('livePrices', () => {
  const engine = (id: string, unit: string, priceCredits: number) => ({ id, unit, priceCredits, limits: { maxSecondsPerCall: 10 } }) as never

  it('prices the nodes from the Cloud engines read now, as the estimate does', async () => {
    const prices = await livePrices(async () => [engine(DEFAULT_ENGINES.presenter.engine, 'second', 4), engine(DEFAULT_ENGINES.image.engine, 'image', 2)])
    expect(prices).toMatchObject({ avatar_s: 4, images: 2 })
  })

  it('is null when the Cloud does not answer or lists nothing: the quote then keeps the placeholder grid', async () => {
    expect(await livePrices(async () => null)).toBeNull()
    expect(await livePrices(async () => [])).toBeNull()
    expect(await livePrices(async () => Promise.reject(new Error('offline')))).toBeNull()
  })
})
