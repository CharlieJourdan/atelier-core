// The channel's sponsor (production-9, decision 0025): kept per channel once the engine reads it, removed by an empty text, and handed
// to the channel's runs as the pipeline's `sponsor` input when the run was not given one (and kept for « Refaire pareil »).
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineNode, NodeRegistry } from '../../src/engine'
import type { NodeHost } from '../../src/engine/host'
import type { Pipeline } from '../../src/engine/pipeline-schema'
import type { RunDetail } from '../../src/shared/api'
import { memoryCore } from './helpers'
import { waitFor } from './z1-runs-fixtures'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const SPONSOR = 'nom : Poêlo Clean\npitch : Le spray qui décape sans rayer.\nlien : https://poeloclean.example/atelier\nposition du qr : en haut à droite'

function setup(withSponsorInput = true) {
  const seen: { sponsor?: unknown } = {}
  const node = defineNode<Record<string, unknown>>({
    type: 'script.sponsor@1',
    inputs: { topic: { type: 'text.input', required: true }, sponsor: { type: 'text.input', required: false } },
    outputs: { text: 'text.script' },
    params: z.looseObject({}),
    executors: ['local'],
    estimate: () => ({ units: [], durationS: 1 }),
    run: async (_c, i) => {
      seen.sponsor = i.sponsor?.value ?? null
      return { text: { value: 'x' } }
    },
    fake: async (_c, i) => {
      seen.sponsor = i.sponsor?.value ?? null
      return { text: { value: 'x' } }
    }
  })
  const pipeline = (minutes: number): Pipeline => ({
    $schema: 'atelier.pipeline/1',
    id: 'sponsor-test',
    version: 1,
    name: 'Vidéo avec sponsor',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: 0.5, max: 30 } },
    inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet' }, ...(withSponsorInput ? [{ id: 'sponsor', kind: 'text' as const, required: false, label: 'Sponsor' }] : [])],
    budget: { default: 'usage_max' },
    nodes: [{ id: 'sponsor', type: 'script.sponsor@1', in: { topic: '$inputs.topic', ...(withSponsorInput ? { sponsor: '$inputs.sponsor' } : {}) } }]
  })
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'channel-sponsor-'))
  const core = memoryCore({
    productionRuns: {
      dataDir,
      registry: new NodeRegistry([node]),
      pipeline,
      defaultStyle: { language: 'fr' },
      host: (): NodeHost => ({ services: {}, cleanup: () => Promise.resolve() }),
      notifyEveryMs: 0,
      demo: true
    }
  })
  cleanups.push(
    () => core.close(),
    () => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  )
  const channelId = Number(core.db.prepare("INSERT INTO channels (name) VALUES ('Cuisine')").run().lastInsertRowid)
  return { core, seen, channelId }
}

const finished = (core: ReturnType<typeof memoryCore>, id: number): Promise<RunDetail> =>
  waitFor(async () => {
    const r = await core.api['production.get'](id)
    return r.status === 'succeeded' || r.status === 'failed' ? r : null
  }, 8000, `run ${id}`)
const start = (channelId: number, inputs?: Record<string, string>) =>
  ({ channelId, title: 'Ma vidéo', topic: 'Une poêle brûlée', minutes: 1, budgetMode: 'usage_max' as const, gateMode: 'all' as const, ...(inputs ? { inputs } : {}) })

describe('the channel’s sponsor', () => {
  it('is kept once the engine reads it, refused when it names no product, removed by an empty text', async () => {
    const { core, channelId } = setup()
    expect(await core.api['channelSponsor.get'](channelId)).toBeNull()
    const v = await core.api['channelSponsor.set'](channelId, SPONSOR)
    expect(v).toMatchObject({ channelId, read: { name: 'Poêlo Clean', link: 'https://poeloclean.example/atelier', qr: true, qrPosition: 'top-right', screen: 'card', where: 'after_hook' } })
    await expect(Promise.resolve().then(() => core.api['channelSponsor.set'](channelId, 'pitch : rien'))).rejects.toThrow(/nom :/)
    expect((await core.api['channelSponsor.get'](channelId))?.text).toBe(SPONSOR)
    await expect(Promise.resolve().then(() => core.api['channelSponsor.set'](999, SPONSOR))).rejects.toThrow(/chaîne/)
    expect(await core.api['channelSponsor.set'](channelId, '  ')).toBeNull()
    expect(await core.api['channelSponsor.get'](channelId)).toBeNull()
  })

  it('a run of the channel takes it as the `sponsor` input, and keeps it for « Refaire pareil »', async () => {
    const { core, seen, channelId } = setup()
    await core.api['channelSponsor.set'](channelId, SPONSOR)
    const run = await core.api['production.start'](start(channelId))
    expect((await finished(core, run.id)).status).toBe('succeeded')
    expect(seen.sponsor).toBe(SPONSOR)
    const row = core.db.prepare('SELECT inputs_json FROM video_runs WHERE id = ?').get(run.id) as { inputs_json: string }
    expect(JSON.parse(row.inputs_json)).toEqual({ sponsor: SPONSOR })
  })

  it('a sponsor given to the run wins; a pipeline that reads no sponsor gets none', async () => {
    const a = setup()
    await a.core.api['channelSponsor.set'](a.channelId, SPONSOR)
    const own = 'nom : Autre produit'
    const r1 = await a.core.api['production.start'](start(a.channelId, { sponsor: own }))
    await finished(a.core, r1.id)
    expect(a.seen.sponsor).toBe(own)
    const b = setup(false)
    await b.core.api['channelSponsor.set'](b.channelId, SPONSOR)
    const r2 = await b.core.api['production.start'](start(b.channelId))
    await finished(b.core, r2.id)
    const row = b.core.db.prepare('SELECT inputs_json FROM video_runs WHERE id = ?').get(r2.id) as { inputs_json: string }
    expect(JSON.parse(row.inputs_json)).toEqual({})
  })
})
