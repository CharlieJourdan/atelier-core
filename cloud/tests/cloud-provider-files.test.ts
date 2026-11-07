// production-10: without a bucket (the beta), a provider fetches a file of a running job from the Cloud itself: a link bound to
// the job and the file, signed, expiring in minutes, served only while the job runs. And the HeyGen plan's fee follows config.json.
import { describe, expect, it } from 'vitest'
import { publishEngines, FAKE_ENGINES, HEYGEN_PLANS, withHeygenPlan } from '../src/providers/engines.ts'
import { PROVIDER_LINK_TTL_S } from '../src/jobs.ts'
import { makeCloud, quoteAndRun, signUpAndIn, wavBytes } from './helpers.ts'

const AUDIO = wavBytes(5)

async function setup() {
  const t = makeCloud()
  const p = await signUpAndIn(t, { credits: 100_000 })
  const voice = await t.cloud.storage.put(p.teamId, null, { name: 'voix.wav', mime: 'audio/wav', bytes: AUDIO }, false)
  // a job of the team (the fake answers at once), then held « running » as while a provider works
  const { job } = await quoteAndRun(t, p, 'talkingAvatar', { avatarId: 'portrait', audioArtefactId: voice.id, seconds: 5 })
  const id = (job as { id: string }).id
  t.cloud.db.prepare("UPDATE jobs SET state = 'running' WHERE id = ?").run(id)
  return { t, p, voice, jobId: id }
}

describe('provider file links of a running job', () => {
  it('serves the file while the job runs, then refuses; never another team’s file; tampered or expired links refused', async () => {
    const { t, p, voice, jobId } = await setup()
    const path = t.cloud.storage.signedJobPath(jobId, voice.id, PROVIDER_LINK_TTL_S)
    expect(path).toMatch(/^\/provider-files\/[^/]+\/[^/?]+\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/)
    const ok = await t.app.inject({ url: path })
    expect(ok.statusCode).toBe(200)
    expect(ok.rawPayload.equals(AUDIO)).toBe(true)
    expect(ok.headers['cache-control']).toBe('private, no-store')
    // a link of the job for another file, or a forged signature
    expect((await t.app.inject({ url: path.replace(/sig=[^&]+/, 'sig=' + 'A'.repeat(43)) })).statusCode).toBe(403)
    expect((await t.app.inject({ url: path.replace(encodeURIComponent(voice.id), 'art_other') })).statusCode).toBe(403)
    // another team's file under this job's link is never served
    const other = await signUpAndIn(t, { credits: 10 })
    const theirs = await t.cloud.storage.put(other.teamId, null, { name: 'x.mp3', mime: 'audio/mpeg', bytes: Buffer.from('theirs') }, false)
    expect((await t.app.inject({ url: t.cloud.storage.signedJobPath(jobId, theirs.id, 60) })).statusCode).toBe(403)
    // the job ends: the link stops working
    t.cloud.db.prepare("UPDATE jobs SET state = 'succeeded' WHERE id = ?").run(jobId)
    expect((await t.app.inject({ url: path })).statusCode).toBe(403)
    expect(p.teamId).toBeTruthy()
  })

  it('expires in minutes', async () => {
    const { t, voice, jobId } = await setup()
    expect(PROVIDER_LINK_TTL_S).toBeLessThanOrEqual(30 * 60)
    const path = t.cloud.storage.signedJobPath(jobId, voice.id, 60)
    ;(t.clock as unknown as { advance(ms: number): void }).advance(61_000)
    expect((await t.app.inject({ url: path })).statusCode).toBe(410)
  })
})

describe('the HeyGen plan', () => {
  it('publishes the fee of the founder’s plan apart, Pro by default', () => {
    const fee = (decls: typeof FAKE_ENGINES) => publishEngines(decls, { resolve: () => ({ status: 'demo' }), resolveFor: () => ({ status: 'demo' }) } as never, null).find((e) => e.id === 'presenter:heygen-mcp')?.planMonthlyUsd
    expect(HEYGEN_PLANS).toEqual({ pro: 49, business: 149 })
    expect(fee(FAKE_ENGINES)).toBe(49)
    expect(fee(withHeygenPlan(FAKE_ENGINES, 'business'))).toBe(149)
  })

  it('the Cloud answers GET /v1/engines with its configured plan', async () => {
    const t = makeCloud({ heygenPlan: 'business' })
    const p = await signUpAndIn(t)
    const r = await t.app.inject({ url: '/v1/engines', headers: p.auth })
    const e = (r.json() as { engines: { id: string; planMonthlyUsd: number | null }[] }).engines
    expect(e.find((x) => x.id === 'presenter:heygen-mcp')?.planMonthlyUsd).toBe(149)
    expect(e.find((x) => x.id === 'presenter:heygen-avatar4')?.planMonthlyUsd).toBeNull()
  })
})
