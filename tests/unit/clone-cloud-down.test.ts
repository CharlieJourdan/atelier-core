// An unreachable Atelier Cloud stops the clone clearly (decision 0113): never a refused demo, never an improvement round.
import { mkdtempSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeChannel } from '../../src/main/production/clone/fakes/channels'
import { fakeServices } from '../../src/main/production/clone/fakes/services'
import { CLOUD_DOWN_WHY, CloudUnreachable, isCloudUnreachable } from '../../src/main/production/clone/cloud-down'
import { runClone } from '../../src/main/production/clone/orchestrator'
import type { IntakeAnswers } from '../../src/main/production/clone/p0-intake'
import type { CloneServices } from '../../src/main/production/clone/services'
import { sideBySideFilmArgs } from '../../src/main/production/clone/compare/film'

const answers = (url: string): IntakeAnswers => ({
  intent: 'copy-channel', references: [{ url, kind: 'channel', axes: [] }], style: null, language: 'fr', sourceLanguage: null,
  testBudgetUsd: 10, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: ['copie cette chaîne']
})

describe('isCloudUnreachable', () => {
  it('reads network errors by message, code and cause', () => {
    expect(isCloudUnreachable(new Error('connect ECONNREFUSED 127.0.0.1:8787'))).toBe(true)
    expect(isCloudUnreachable(new TypeError('fetch failed'))).toBe(true)
    expect(isCloudUnreachable(new Error('Atelier Cloud injoignable'))).toBe(true)
    // a paid round the runner found in demo mode because the brain has no Cloud (the POV proof, 2026-11-06)
    expect(isCloudUnreachable(new Error('the engines are in demo mode (Démo : le « Moteur réel » n’est pas utilisé (il est éteint pour cette vidéo, ou Atelier Cloud n’est pas connecté).'))).toBe(true)
    expect(isCloudUnreachable(new Error('run 4 failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }))).toBe(true)
    expect(isCloudUnreachable(new Error('the blind judge answered nothing usable'))).toBe(false)
  })
})

describe('a Cloud that is down stops the clone', () => {
  const run = async (where: 'demo' | 'paid') => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'clone-down-'))
    const ch = fakeChannel('presenter-motion')
    const { services } = fakeServices(ch)
    const down = (): never => { throw new TypeError('fetch failed') }
    const s: CloneServices = {
      ...services,
      demo: { produce: where === 'demo' ? async () => down() : (...a) => services.runs.produce(a[0], a[1], a[2], a[3], 0) },
      ...(where === 'paid' ? { runs: { produce: async () => down() } } : {})
    }
    const err = await runClone({ dataDir, cloneId: 'c1', services: s, answers: answers(ch.url) }).then(() => null, (e: unknown) => e)
    return { err, files: readdirSync(path.join(dataDir, 'clones', 'c1')) }
  }
  it('a free demo that cannot reach the Cloud: stopped with the reason, no gate verdict saved', async () => {
    const { err, files } = await run('demo')
    expect(err).toBeInstanceOf(CloudUnreachable)
    expect((err as Error).message).toBe(CLOUD_DOWN_WHY)
    expect(files.filter((f) => f.startsWith('gate-v') && f.endsWith('.json'))).toEqual([])
  })
  it('a paid round that cannot reach the Cloud: stopped, no round saved as improved', async () => {
    const { err, files } = await run('paid')
    expect(err).toBeInstanceOf(CloudUnreachable)
    expect(files.some((f) => /^round-\d+\.json$/.test(f))).toBe(false)
  })
})

describe('the side-by-side film arguments (pure)', () => {
  it('puts the reference left and ours right at 640 px each, with our sound and a capped bitrate', () => {
    const a = sideBySideFilmArgs('ref.mp4', 'ours.mp4', 'out.mp4')
    const f = a[a.indexOf('-filter_complex') + 1]!
    expect(f).toContain('[0:v]scale=640:360')
    expect(f).toContain('[a][b]hstack=inputs=2')
    expect(a.slice(a.indexOf('-map'), a.indexOf('-map') + 4)).toEqual(['-map', '[v]', '-map', '1:a?'])
    expect(a[a.indexOf('-crf') + 1]).toBe('30')
    expect(a[a.indexOf('-maxrate') + 1]).toBe('1.5M')
    expect(a[a.length - 1]).toBe('out.mp4')
  })
  it('uses a 720 px high cell for vertical films', () => {
    expect(sideBySideFilmArgs('r', 'o', 'x', 720)[8]).toContain('scale=640:720')
    // a whole reference is cut to the passage before it is read
    const cut = sideBySideFilmArgs('r', 'o', 'x', 360, { fromS: 42, lengthS: 90 })
    expect(cut.slice(cut.indexOf('-ss'), cut.indexOf('-ss') + 6)).toEqual(['-ss', '42', '-t', '90', '-i', 'r'])
  })
})
