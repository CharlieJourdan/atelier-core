// solidite: a provider call never holds a job forever. Past its deadline the job fails with the reason and its credits
// go back, even when the adapter ignores the abort (its slot is given back, so the provider's queue moves on); the
// 24 h sweep also reaches a job holding nothing (a demo answer in a real run is free).
import { describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { jobDeadlineMs } from '../src/jobs.ts'
import { ORPHAN_HOLD_MS } from '../src/wallet.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

const deaf: ProviderAdapter = { id: 'fake-video', kind: 'fake', generateVideo: () => new Promise(() => undefined) }

async function job(t: ReturnType<typeof makeCloud>, auth: Record<string, string>, key: string) {
  const q = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: auth, payload: { usage: 'generateVideo', input: { prompt: 'vagues', seconds: 5 } } })).json() as { id: string; totalCredits: number }
  const r = (await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: auth, payload: { quoteId: q.id, idempotencyKey: key } })).json() as { id: string }
  if (!r.id) throw new Error(JSON.stringify(r))
  return r
}
const read = async (t: ReturnType<typeof makeCloud>, auth: Record<string, string>, id: string) =>
  (await t.app.inject({ url: `/v1/jobs/${id}`, headers: auth })).json() as { state: string; error: string | null }

describe('job deadline', () => {
  it('a provider that never answers (and ignores the abort) fails the job « deadline », credits back, the next job runs', { timeout: 20_000 }, async () => {
    const t = makeCloud({ fakes: { generateVideo: deaf }, maxJobMs: () => 100, maxJobsPerProvider: 1 })
    const p = await signUpAndIn(t, { credits: 1000 })
    const a = await job(t, p.auth, 'deadline-deaf-1')
    const b = await job(t, p.auth, 'deadline-deaf-2') // waits for the provider's only slot
    await t.cloud.jobs.whenIdle()
    for (const id of [a.id, b.id]) expect(await read(t, p.auth, id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/deadline/) })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 1000, held: 0 })
  })

  it('a deadline long enough for the slowest provider by default (2 h; 12 h for a GPU render)', () => {
    expect(jobDeadlineMs('talkingAvatar')).toBe(2 * 3600_000)
    expect(jobDeadlineMs('submitGpuJob')).toBe(12 * 3600_000)
  })

  it('the 24 h sweep also stops a job that holds no credits', async () => {
    const hanging: ProviderAdapter = {
      id: 'fake-video',
      kind: 'fake',
      generateVideo: (_input, ctx) => new Promise((_r, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    const t = makeCloud({ fakes: { generateVideo: hanging } })
    const p = await signUpAndIn(t, { credits: 1000 })
    const j = await job(t, p.auth, 'deadline-free-1')
    await new Promise((r) => setTimeout(r, 10))
    // what a demo answer in a real run looks like: a job holding nothing
    t.cloud.db.prepare('UPDATE jobs SET hold_id = NULL WHERE id = ?').run(j.id)
    t.clock.advance(ORPHAN_HOLD_MS + 60_000)
    t.cloud.jobs.sweep()
    await t.cloud.jobs.whenIdle()
    // (the clock moved a day: the person's token expired, so the row is read directly)
    expect(t.cloud.db.prepare('SELECT state FROM jobs WHERE id = ?').get(j.id)).toMatchObject({ state: 'failed' })
  })
})
