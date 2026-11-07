// solidite: a run killed mid-way by a quit or a crash is never left half-done in silence. On the desktop it comes back
// `interrupted` and the team hears of it (inbox, room, Atlas); on the team computer (`autoResume`) it starts again by
// itself and finishes; a run that crashed on every attempt is not started again (it may be what crashes the brain) and
// the team is told why.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCore } from '../../src/main/core'
import type { RunDetail, RunStartInput } from '../../src/shared/api'
import type { RunFinished } from '../../src/main/production/runs/video-status'
import { MAX_AUTO_ATTEMPTS } from '../../src/main/production/runs/recovery'
import { fixture, waitFor } from './z1-runs-fixtures'
import { okTester, testCipher } from './helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const input = (channelId: number): RunStartInput => ({ channelId, title: 'En cours', topic: 'Les templiers', minutes: 1, budgetMode: 'usage_max', gateMode: 'all' })

/** Starts a run, kills the app while its voice runs, and opens the app again with `autoResume` as given. */
async function killMidRun(autoResume: boolean, attemptsBefore = 0) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'runs-restart-'))
  const fx = fixture()
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }), () => fx.cleanup())
  const heard: RunFinished[] = []
  const open = () => createCore({ paths: { userData: dir }, cipher: testCipher(), tester: okTester, productionRuns: { ...fx.productionRuns, autoResume, onFinished: (e) => void heard.push(e) } })
  const first = open()
  const ch = await first.api['channels.create']({ name: 'Chaîne' })
  fx.block.add('voice.tts@1')
  const run = await first.api['production.start'](input(ch.id))
  await waitFor(async () => (await first.api['production.get'](run.id)).nodes.find((n) => n.nodeId === 'voice')?.state === 'running', 8_000, 'voice running')
  fx.block.clear()
  if (attemptsBefore) first.context.db.prepare('UPDATE video_runs SET attempt = ? WHERE id = ?').run(attemptsBefore, run.id)
  first.close() // the crash: the row stays « running »
  const second = open()
  cleanups.push(() => second.close())
  return { second, runId: run.id, heard }
}

describe('restart mid-run', () => {
  it('desktop: the run comes back « interrupted » and the team hears of it with the reason', async () => {
    const { second, runId, heard } = await killMidRun(false)
    const r = await second.api['production.get'](runId)
    expect(r.status).toBe('interrupted')
    expect(r.live).toBe(false)
    expect(heard).toEqual([expect.objectContaining({ runId, status: 'failed', error: expect.stringMatching(/Atelier a été fermé/) })])
  })

  it('team computer: the run starts again by itself and finishes', async () => {
    const { second, runId, heard } = await killMidRun(true)
    const done = await waitFor(async () => {
      const r: RunDetail = await second.api['production.get'](runId)
      return r.status === 'waiting' || r.status === 'succeeded' ? r : null
    }, 15_000, 'resumed run')
    expect(done.attempt).toBe(2)
    expect(done.nodes.find((n) => n.nodeId === 'research')?.state).toBe('cached') // nothing made twice
    expect(heard.filter((e) => e.status === 'failed')).toEqual([])
  })

  it('a run that crashed on every attempt is not started again: the team is told why', async () => {
    const { second, runId, heard } = await killMidRun(true, MAX_AUTO_ATTEMPTS)
    const r = await second.api['production.get'](runId)
    expect(r.status).toBe('interrupted')
    expect(r.live).toBe(false)
    expect(heard).toEqual([expect.objectContaining({ runId, status: 'failed', error: expect.stringMatching(/à chaque essai \(3 essais\)/) })])
  })
})
