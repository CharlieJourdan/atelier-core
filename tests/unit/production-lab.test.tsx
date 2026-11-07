// production-lab (Charlie's notes of 2026-11-01): pipeline codes — every pipeline has one, a shared code carries the whole
// pipeline and imports as a new one (flag on), sharing and importing are refused and hidden while the flag is off (the
// beta; the screens are checked in tests/e2e/production-lab.spec.ts) — and the Lab's pure helpers: categories, orders of « Pipelines prêtes », price per video, videos in production.
import { describe, expect, it } from 'vitest'
import { canonicalJson, CODES_OFF, pipelineCode, pipelineCodesOn, readShareText, shareText } from '../../src/main/production/recipes/codes'
import type { EstimateCardsView } from '../../src/shared/estimates'
import { pipelineForm, type BasePipelineInfo, type ProjectSummary } from '../../src/shared/recipes'
import { activityOf, categoriesOf, categoryOf, orderMine, sortReady, stagesDone, videoSpecs } from '../../src/renderer/screens/production/lab/lab-model'
import { memoryCore } from './helpers'

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

const withCodes = async <T,>(on: boolean, f: () => Promise<T>): Promise<T> => {
  const before = process.env.ATELIER_PIPELINE_CODES
  if (on) process.env.ATELIER_PIPELINE_CODES = '1'
  else delete process.env.ATELIER_PIPELINE_CODES
  try {
    return await f()
  } finally {
    if (before === undefined) delete process.env.ATELIER_PIPELINE_CODES
    else process.env.ATELIER_PIPELINE_CODES = before
  }
}

describe('pipeline codes', () => {
  it('a code is the fingerprint of the document: same document, same code, whatever the order of its keys', () => {
    const a = { name: 'X', options: { b: 1, a: true }, bricks: [{ tech: 't@1', settings: { z: 1, y: 2 } }] }
    const b = { bricks: [{ settings: { y: 2, z: 1 }, tech: 't@1' }], options: { a: true, b: 1 }, name: 'X' }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(pipelineCode(a)).toBe(pipelineCode(b))
    expect(pipelineCode(a)).toMatch(CODE)
    expect(pipelineCode({ ...a, name: 'Y' })).not.toBe(pipelineCode(a))
  })

  it('a shared text carries the whole document and is refused when cut, changed or not a code', () => {
    const doc = { name: 'Ma pipeline', options: { captions: true }, format: { aspect: '16:9', minutes: 10 } }
    const text = shareText(doc)
    expect(text.startsWith(`ATL1.${pipelineCode(doc).replace('-', '')}.`)).toBe(true)
    expect(readShareText(text)).toEqual({ code: pipelineCode(doc), doc })
    // pasted with line breaks and spaces: still read
    expect(readShareText(`  ${text.slice(0, 20)}\n${text.slice(20)} `).doc).toEqual(doc)
    // another document under the same code: refused
    const other = shareText({ ...doc, name: 'Autre' }).split('.')[2]
    expect(() => readShareText(`ATL1.${pipelineCode(doc).replace('-', '')}.${other}`)).toThrow(/abîmé/)
    // cut short: refused
    expect(() => readShareText(text.slice(0, -6))).toThrow(/abîmé|pas un code/)
    for (const bad of ['', 'bonjour', 'ATL2.AAAAAAAA.abc', 'ATL1.AAAA.abc', 42, null]) expect(() => readShareText(bad)).toThrow(/pas un code/)
  })

  it('off in the beta: the flag is off by default, sharing and importing are refused', async () => {
    await withCodes(false, async () => {
      expect(pipelineCodesOn()).toBe(false)
      const core = memoryCore()
      try {
        expect((await core.api['app.info']()).pipelineCodes).toBe(false)
        const d = await core.api['recipes.fromBase']('avatar@1')
        // every pipeline still has its code (its fingerprint), shown nowhere while codes are off
        expect(d.code).toMatch(CODE)
        expect((await core.api['recipes.bases']())[0]?.code).toMatch(CODE)
        await expect(Promise.resolve().then(() => core.api['recipes.share'](d.id))).rejects.toThrow(CODES_OFF)
        await expect(Promise.resolve().then(() => core.api['recipes.fromCode']('ATL1.AAAAAAAA.abc'))).rejects.toThrow(CODES_OFF)
      } finally {
        core.close()
      }
    })
  })

  it('on (`ATELIER_PIPELINE_CODES=1`): a pipeline shared as a code comes back as a new pipeline, same document, same code', async () => {
    await withCodes(true, async () => {
      const core = memoryCore()
      try {
        expect((await core.api['app.info']()).pipelineCodes).toBe(true)
        const d = await core.api['recipes.fromBase']('avatar@1', 'Ma chaîne cuisine')
        const shared = await core.api['recipes.share'](d.id)
        expect(shared.code).toBe(d.code)
        expect(shared.code).toBe(pipelineCode(d.doc))
        const copy = await core.api['recipes.fromCode'](shared.text)
        expect(copy.id).not.toBe(d.id)
        expect(copy.name).toBe('Ma chaîne cuisine')
        expect(copy.doc).toEqual(d.doc)
        expect(copy.code).toBe(d.code)
        expect(copy.versions[0]?.note).toBe(`Depuis le code ${d.code}`)
        expect(copy.base).toBe('avatar@1')
        expect(copy.form).toBe('long')
        // a code that does not hold a valid pipeline is refused like any invalid save
        await expect(Promise.resolve().then(() => core.api['recipes.fromCode'](shareText({ name: 'vide', bricks: [] })))).rejects.toThrow(/pas valable/)
        await expect(Promise.resolve().then(() => core.api['recipes.fromCode']('pas un code'))).rejects.toThrow(/pas un code/)
      } finally {
        core.close()
      }
    })
  })
})

describe('the Lab’s helpers', () => {
  const base = (id: string, copies: number, minutes = 10): BasePipelineInfo =>
    ({ id, labelKey: 'pipe.base.avatar', copies, form: 'long', code: 'ABCD-EFGH', options: [], doc: { format: { aspect: '16:9', minutes } } }) as unknown as BasePipelineInfo
  const est = (avg: number, seconds: number) => ({ perMinute: { min: avg, avg, max: avg }, fit: null, renderTime: { minutes: 10, seconds: { min: seconds, avg: seconds, max: seconds } } })

  it('long or short from the document', () => {
    expect(pipelineForm({ videoType: 'avatar-long', format: { aspect: '16:9' } })).toBe('long')
    expect(pipelineForm({ videoType: 'autre', format: { aspect: '9:16' } })).toBe('short')
    expect(pipelineForm({ videoType: 'short', format: { aspect: '16:9' } })).toBe('short')
  })

  it('categories from the ready pipelines’ families; orders: most used, cheapest, fastest', () => {
    const bases = [base('avatar@1', 1), base('voiceover@1', 4), base('avatar@2', 0, 20)]
    expect(categoryOf(bases[0] as BasePipelineInfo)).toBe('avatar')
    expect(categoriesOf(bases)).toEqual(['avatar', 'voiceover'])
    const estimates: EstimateCardsView = { available: true, reason: null, creditEur: 0.01, recipes: {}, bases: { 'avatar@1': est(100, 900), 'voiceover@1': est(30, 300), 'avatar@2': est(60, 600) } }
    expect(sortReady(bases, 'used', estimates).map((b) => b.id)).toEqual(['voiceover@1', 'avatar@1', 'avatar@2'])
    // per video: avatar@1 1000, voiceover@1 300, avatar@2 60 × 20 = 1200
    expect(sortReady(bases, 'cheap', estimates).map((b) => b.id)).toEqual(['voiceover@1', 'avatar@1', 'avatar@2'])
    expect(sortReady(bases, 'fast', estimates).map((b) => b.id)).toEqual(['voiceover@1', 'avatar@2', 'avatar@1'])
    expect(sortReady(bases, 'used', estimates, 'avatar').map((b) => b.id)).toEqual(['avatar@1', 'avatar@2'])
    // long form first (Charlie 01/11): the default filter keeps the long ones; no short ready pipeline yet
    expect(sortReady(bases, 'used', estimates, null, 'long')).toHaveLength(3)
    expect(sortReady(bases, 'used', estimates, null, 'short')).toEqual([])
    // no prices yet: the order stays stable, nothing is NaN
    expect(sortReady(bases, 'cheap', null).map((b) => b.id)).toEqual(['avatar@1', 'avatar@2', 'voiceover@1'])
    expect(videoSpecs(undefined, 10)).toEqual({ credits: null, seconds: null })
    expect(videoSpecs(est(12.4, 840), 10)).toEqual({ credits: 124, seconds: 840 })
  })

  it('videos in production per pipeline, and how far the furthest one is', () => {
    const p = (id: number, recipeId: number, runId: number | null, runStatus: string | null) => ({ id, recipeId, runId, runStatus }) as ProjectSummary
    const projects = [p(1, 3, 10, 'running'), p(2, 3, 11, 'waiting'), p(3, 3, 12, 'succeeded'), p(4, 5, null, null), p(5, 5, 13, 'queued')]
    const a = activityOf(projects, [
      { id: 10, progress: 0.2 },
      { id: 11, progress: 0.65 },
      { id: 12, progress: 1 }
    ])
    expect(a.get(3)).toEqual({ videos: 2, progress: 0.65 })
    expect(a.get(5)).toEqual({ videos: 1, progress: 0 })
    expect(a.has(4)).toBe(false)
    expect(stagesDone(5, null)).toBe(0)
    expect(stagesDone(5, 0.65)).toBe(3)
    expect(stagesDone(5, 1)).toBe(5)
    const r = (id: number, archived = false) => ({ id, archived }) as never
    expect(orderMine([r(1), r(2, true), r(3), r(5)], a).map((x: { id: number }) => x.id)).toEqual([3, 5, 1, 2])
  })
})
