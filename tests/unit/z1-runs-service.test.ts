// Lot Z1: the runs service through `core.api` on small test nodes (see z1-runs-fixtures.ts): quote, start to success,
// gates (approve, send back with a note), cancel with unspent credits released, retry with cached nodes, redo, a restart
// (interrupted / waiting rows come back and resume), files confined to the artefact folder, the library.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCore } from '../../src/main/core'
import type { RunDetail, RunStartInput } from '../../src/shared/api'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'
import { memoryCore, okTester, testCipher } from './helpers'

type Core = ReturnType<typeof memoryCore>

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

async function setup(opts: { paid?: boolean; credits?: number } = {}): Promise<{ core: Core; fx: Fixture; channelId: number }> {
  const fx = fixture(opts.paid ? { paid: true } : {})
  const core = memoryCore({ productionRuns: fx.productionRuns })
  cleanups.push(() => core.close(), () => fx.cleanup())
  if (opts.credits) core.context.credits.grant({ amount: opts.credits, idempotencyKey: 'test-grant' })
  const channel = await core.api['channels.create']({ name: 'Chaîne de test' })
  return { core, fx, channelId: channel.id }
}

const input = (channelId: number, over: Partial<RunStartInput> = {}): RunStartInput => ({
  channelId,
  title: 'Ma vidéo',
  topic: 'Les templiers',
  minutes: 1,
  budgetMode: 'usage_max',
  gateMode: 'all',
  ...over
})

const until = (core: Core, runId: number, status: RunDetail['status']): Promise<RunDetail> =>
  waitFor(async () => {
    const r = await core.api['production.get'](runId)
    return r.status === status ? r : null
  }, 8_000, `run ${runId} ${status}`)

const node = (run: RunDetail, id: string) => run.nodes.find((n) => n.nodeId === id)!

describe('quote', () => {
  it('prices both budget modes per node, flags the demo and debits nothing', async () => {
    const { core } = await setup()
    const q = await core.api['production.quote']({ minutes: 2, topic: 'Un sujet' })
    expect(q.pipelineLabel).toBe('Vidéo de test')
    expect(q.pipelineVersion).toBe(3)
    expect(q.demo).toBe(true)
    expect(q.debited).toBe(false)
    expect(q.demoReason).toContain('Démo')
    expect(q.modes.usage_max.nodes.map((n) => n.nodeId)).toEqual(['research', 'script', 'voice', 'render', 'package'])
    expect(q.modes.qualite_max.nodes).toHaveLength(5)
    expect(q.modes.usage_max.nodes.find((n) => n.nodeId === 'package')?.gate).toBe('owner')
    expect(q.balance).toEqual({ available: 0, held: 0, total: 0, simulated: 0, example: 0 })
  })

  it('a paid setup is debited and its total is the sum of the node credits', async () => {
    const { core } = await setup({ paid: true, credits: 1000 })
    const q = await core.api['production.quote']({ minutes: 1 })
    expect(q.demo).toBe(false)
    expect(q.debited).toBe(true)
    const m = q.modes.usage_max
    expect(m.totalCredits).toBeGreaterThan(0)
    expect(m.totalCredits).toBe(m.nodes.reduce((s, n) => s + n.credits, 0))
    expect(m.totalEur).toBeCloseTo(m.totalCredits / 100, 5)
    expect(q.balance.available).toBe(1000)
  })
})

describe('start to success, gates', () => {
  it('"Tout d\'un coup" stops only at the owner gate (the package); approving finishes the run with its files', async () => {
    const { core, channelId } = await setup()
    const started = await core.api['production.start'](input(channelId))
    expect(started.demo).toBe(true)
    expect(started.nodes.map((n) => n.nodeId)).toEqual(['research', 'script', 'voice', 'render', 'package'])
    const waiting = await until(core, started.id, 'waiting')
    expect(waiting.waitingNodes).toEqual(['package'])
    expect(node(waiting, 'script').state).toBe('done')
    expect(waiting.spentCredits).toBe(0) // demo: nothing debited
    const pkg = await core.api['production.output'](started.id, 'package')
    expect(pkg).toMatchObject({ kind: 'package', title: 'Titre test', tags: ['a', 'b'] })
    await core.api['production.approve'](started.id, 'package')
    const done = await until(core, started.id, 'succeeded')
    expect(done.videoFileRef).toMatch(/video\.mp4$/)
    expect(done.durationS).toBe(61.2)
    expect(done.packageDir).toContain('paquet-')
    expect(done.progress).toBe(1)
    const video = await core.api['production.output'](started.id, 'render')
    expect(video).toMatchObject({ kind: 'video', width: 1920, height: 1080 })
    if (video.kind !== 'video') throw new Error('video expected')
    const file = await core.api['production.file'](started.id, video.file.ref)
    expect(file.mime).toBe('video/mp4')
    expect(Buffer.from(file.bytes).toString()).toBe('MP4DATA')
    const voice = await core.api['production.output'](started.id, 'voice')
    expect(voice).toMatchObject({ kind: 'audio', voice: 'v1', durationS: 3.5 })
    const events = core.context.productionRuns.activeIds()
    expect(events).toEqual([])
  })

  it('"Pas à pas" stops at the script; sending it back with a note reruns the script with it, then the next steps', async () => {
    const { core, fx, channelId } = await setup()
    const run = await core.api['production.start'](input(channelId, { gateMode: 'step' }))
    const w1 = await until(core, run.id, 'waiting')
    expect(w1.waitingNodes).toEqual(['script'])
    const first = await core.api['production.output'](run.id, 'script')
    expect(first).toMatchObject({ kind: 'text', text: 'Script initial', previous: null })
    await core.api['production.requestChanges'](run.id, 'script', 'Plus court et plus sobre')
    const w2 = await waitFor(async () => {
      const r = await core.api['production.get'](run.id)
      return r.status === 'waiting' && node(r, 'script').fingerprint !== node(w1, 'script').fingerprint ? r : null
    }, 8_000, 'script rerun')
    expect(w2.waitingNodes).toEqual(['script'])
    expect(node(w2, 'script').changeNote).toBe('Plus court et plus sobre')
    expect(fx.calls['script.write@1']).toBe(2)
    expect(fx.calls['research.topic@1']).toBe(1) // upstream is not redone
    const second = await core.api['production.output'](run.id, 'script')
    expect(second).toMatchObject({ kind: 'text', text: 'Script corrigé (Plus court et plus sobre)', previous: 'Script initial' })
    await core.api['production.approve'](run.id, 'script')
    const w3 = await waitFor(async () => {
      const r = await core.api['production.get'](run.id)
      return r.status === 'waiting' && r.waitingNodes[0] === 'package' ? r : null
    }, 8_000, 'package gate')
    expect(node(w3, 'voice').state).toBe('done')
    await core.api['production.approve'](run.id, 'package')
    await until(core, run.id, 'succeeded')
  })
})

describe('credits: hold, capture, release', () => {
  it('a paid run holds its quote; cancelling releases the unspent part and keeps what was spent', async () => {
    const { core, fx, channelId } = await setup({ paid: true, credits: 1000 })
    fx.block.add('render.assemble@1')
    const run = await core.api['production.start'](input(channelId))
    expect(run.demo).toBe(false)
    expect(run.quoteCredits).toBeGreaterThan(0)
    await waitFor(async () => (await core.api['production.get'](run.id)).nodes.find((n) => n.nodeId === 'render')?.state === 'running', 8_000, 'render running')
    const during = await core.api['credits.balance']()
    expect(during.held).toBeGreaterThan(0)
    const cancelled = await core.api['production.cancel'](run.id)
    expect(cancelled.status).toBe('cancelled')
    expect(node(cancelled, 'voice').state).toBe('done')
    expect(node(cancelled, 'render').state).toBe('cancelled')
    const after = await core.api['credits.balance']()
    expect(after.held).toBe(0)
    expect(after.total).toBe(1000 - cancelled.spentCredits)
    expect(cancelled.spentCredits).toBeGreaterThan(0)
    expect(cancelled.spentCredits).toBeLessThan(run.quoteCredits)
    const kinds = (await core.api['credits.entries']()).map((e) => e.kind)
    expect(kinds).toContain('hold')
    expect(kinds).toContain('capture')
    expect(kinds).toContain('release')
  })

  it('refuses a paid run the wallet cannot pay, in French, and creates nothing', async () => {
    const { core, channelId } = await setup({ paid: true, credits: 1 })
    await expect(core.api['production.start'](input(channelId))).rejects.toThrow(/Crédits insuffisants : \d+ nécessaires, 1 disponibles/)
    expect(await core.api['production.list']()).toEqual([])
    expect(await core.api['videos.list']()).toEqual([])
  })
})

describe('retry, redo', () => {
  it('a run that failed is retried: finished nodes come back cached and are not paid or executed again', async () => {
    const { core, fx, channelId } = await setup()
    fx.failOnce.add('voice.tts@1')
    const run = await core.api['production.start'](input(channelId))
    const failed = await until(core, run.id, 'failed')
    expect(failed.error).toContain('Voix')
    expect(node(failed, 'voice').state).toBe('error')
    expect(node(failed, 'voice').error?.message).toBeTruthy()
    expect(failed.attempt).toBe(1)
    const retried = await core.api['production.retry'](run.id)
    expect(retried.attempt).toBe(2)
    const waiting = await until(core, run.id, 'waiting')
    expect(node(waiting, 'research').state).toBe('cached')
    expect(node(waiting, 'script').state).toBe('cached')
    expect(fx.calls['research.topic@1']).toBe(1)
    expect(fx.calls['script.write@1']).toBe(1)
    expect(fx.calls['voice.tts@1']).toBe(2)
    await core.api['production.approve'](run.id, 'package')
    await until(core, run.id, 'succeeded')
  })

  it('"Refaire pareil" makes a new run on a NEW video of the same channel with the same settings', async () => {
    const { core, channelId } = await setup()
    const run = await core.api['production.start'](input(channelId, { budgetMode: 'qualite_max', minutes: 2 }))
    await until(core, run.id, 'waiting')
    await core.api['production.approve'](run.id, 'package')
    await until(core, run.id, 'succeeded')
    const again = await core.api['production.redo'](run.id)
    expect(again.id).not.toBe(run.id)
    expect(again.videoId).not.toBe(run.videoId)
    expect(again.channelId).toBe(channelId)
    expect(again).toMatchObject({ topic: 'Les templiers', minutes: 2, budgetMode: 'qualite_max', gateMode: 'all', redoOf: run.id, videoTitle: 'Ma vidéo' })
    await until(core, again.id, 'waiting')
    expect((await core.api['videos.list']()).length).toBe(2)
    expect((await core.api['production.list']({ channelId })).map((r) => r.id)).toEqual([again.id, run.id])
  })
})

describe('restart: interrupted and waiting runs', () => {
  it('a run killed mid-way is `interrupted` at the next start and "Reprendre" finishes it; a waiting run resumes on approval', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'z1-runs-db-'))
    const fx = fixture()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }), () => fx.cleanup())
    const open = () => createCore({ paths: { userData: dir }, cipher: testCipher(), tester: okTester, productionRuns: fx.productionRuns })
    const first = open()
    const ch = await first.api['channels.create']({ name: 'Chaîne' })
    fx.block.add('voice.tts@1')
    const running = await first.api['production.start'](input(ch.id, { title: 'En cours' }))
    await waitFor(async () => (await first.api['production.get'](running.id)).nodes.find((n) => n.nodeId === 'voice')?.state === 'running', 8_000, 'voice running')
    fx.block.clear()
    const gated = await first.api['production.start'](input(ch.id, { title: 'Au script', gateMode: 'step' }))
    await until(first, gated.id, 'waiting')
    first.close() // quit without finishing

    const second = open()
    cleanups.push(() => second.close())
    const r1 = await second.api['production.get'](running.id)
    expect(r1.status).toBe('interrupted')
    expect(r1.live).toBe(false)
    expect(r1.error).toContain('Atelier a été fermé')
    expect(node(r1, 'voice').state).toBe('pending')
    expect(node(r1, 'research').state).toBe('done')
    const r2 = await second.api['production.get'](gated.id)
    expect(r2.status).toBe('waiting')
    expect(r2.live).toBe(false)
    const resumed = await second.api['production.resume'](running.id)
    expect(resumed.live).toBe(true)
    await until(second, running.id, 'waiting')
    await second.api['production.approve'](running.id, 'package')
    await until(second, running.id, 'succeeded')
    // an engine-less waiting run: approving relaunches the engine and applies the decision
    await second.api['production.approve'](gated.id, 'script')
    const next = await waitFor(async () => {
      const r = await second.api['production.get'](gated.id)
      return r.status === 'waiting' && r.waitingNodes[0] === 'package' ? r : null
    }, 8_000, 'package gate after resume')
    expect(next.live).toBe(true)
    await second.api['production.approve'](gated.id, 'package')
    await until(second, gated.id, 'succeeded')
  })

  it('markInterrupted gives back the hold of a paid run left running', async () => {
    const { core, fx, channelId } = await setup({ paid: true, credits: 1000 })
    fx.block.add('render.assemble@1')
    const run = await core.api['production.start'](input(channelId))
    await waitFor(async () => (await core.api['production.get'](run.id)).nodes.find((n) => n.nodeId === 'render')?.state === 'running', 8_000, 'render running')
    expect((await core.api['credits.balance']()).held).toBeGreaterThan(0)
    expect(core.context.productionRuns.markInterrupted()).toBe(1)
    expect((await core.api['credits.balance']()).held).toBe(0)
    expect((await core.api['production.get'](run.id)).status).toBe('interrupted')
  })
})

describe('files and library', () => {
  it('serves only files inside the video\'s artefact folder', async () => {
    const { core, channelId } = await setup()
    const run = await core.api['production.start'](input(channelId))
    await until(core, run.id, 'waiting')
    const voice = await core.api['production.output'](run.id, 'voice')
    if (voice.kind !== 'audio') throw new Error('audio expected')
    const ok = await core.api['production.file'](run.id, voice.file.ref)
    expect(ok.mime).toBe('audio/wav')
    expect(ok.name).toMatch(/voice\.wav$/)
    await expect(core.api['production.file'](run.id, '../../../atelier.db')).rejects.toThrow('Accès refusé')
    await expect(core.api['production.file'](run.id, `sub/../${voice.file.ref}`)).rejects.toThrow('Accès refusé')
    await expect(core.api['production.file'](run.id, path.join(os.tmpdir(), 'x.txt'))).rejects.toThrow('Accès refusé')
    await expect(core.api['production.file'](run.id, 'C:\\Windows\\win.ini')).rejects.toThrow('Accès refusé')
    await expect(core.api['production.file'](run.id, '/etc/passwd')).rejects.toThrow('Accès refusé')
    await expect(core.api['production.file'](run.id, 'absent.bin')).rejects.toThrow('Fichier introuvable')
    await expect(core.api['production.file'](run.id, '')).rejects.toThrow('Référence de fichier invalide')
    await expect(core.api['production.file'](run.id, 42 as never)).rejects.toThrow('Référence de fichier invalide')
  })

  it('lists finished videos only, newest first, with credits per node and the package files; filters by channel', async () => {
    const { core, channelId } = await setup({ paid: true, credits: 5000 })
    const other = await core.api['channels.create']({ name: 'Autre chaîne' })
    const a = await core.api['production.start'](input(channelId, { title: 'A' }))
    await until(core, a.id, 'waiting')
    const b = await core.api['production.start'](input(other.id, { title: 'B' }))
    await until(core, b.id, 'waiting')
    expect(await core.api['production.library']()).toEqual([]) // nothing finished yet
    await core.api['production.approve'](a.id, 'package')
    await until(core, a.id, 'succeeded')
    await core.api['production.approve'](b.id, 'package')
    await until(core, b.id, 'succeeded')
    const lib = await core.api['production.library']()
    expect(lib.map((i) => i.title)).toEqual(['B', 'A'])
    const item = lib[1]!
    expect(item).toMatchObject({ runId: a.id, channelName: 'Chaîne de test', pipelineLabel: 'Vidéo de test', pipelineVersion: 3, demo: false, durationS: 61.2 })
    expect(item.creditsByNode.map((n) => n.nodeId)).toEqual(['research', 'script', 'voice', 'render', 'package'])
    expect(item.creditsByNode.reduce((s, n) => s + n.credits, 0)).toBe(item.totalCredits)
    expect(item.totalCredits).toBeGreaterThan(0)
    expect(item.packageFiles.map((f) => f.name.replace(/^\d+-/, '')).sort()).toEqual(['description.txt', 'video.mp4'])
    expect((await core.api['production.library']({ channelId: other.id })).map((i) => i.title)).toEqual(['B'])
  })
})
