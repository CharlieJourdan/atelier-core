// Issue #105 (decision 0088): the per-account limits fit ten productions of one team at once, and still stop a runaway client.
// Reasoning in decision 0088: a running job is polled at most every 4 s (15 a minute); ten productions with up to four jobs each stay near 600.
import { describe, expect, it } from 'vitest'
import { fakeProvider } from '../../src/engine/sourcing/fakes.ts'
import { MEDIA_ROUTES } from '../../src/shared/cloud-media.ts'
import { DEFAULT_MEDIA_SEARCHES_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE } from '../src/http/limits.ts'
import { makeCloud, signUpAndIn } from './helpers.ts'

describe('default limits of one account', () => {
  it('today\'s defaults are the ones the scale test measured (a team of ten productions fits with room)', () => {
    expect(DEFAULT_REQUESTS_PER_MINUTE).toBeGreaterThanOrEqual(1000)
    expect(DEFAULT_MEDIA_SEARCHES_PER_MINUTE).toBeGreaterThanOrEqual(100)
  })

  it('ten productions\' worth of searches in a minute all get through; a runaway one is still refused with Retry-After', async () => {
    const t = makeCloud({ server: { media: { providers: [fakeProvider('free-img', 'image', [{ id: '1', title: 'crowd' }])] } } })
    const p = await signUpAndIn(t)
    const codes: number[] = []
    for (let i = 0; i < 100; i++) codes.push((await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: `crowd ${i}`, kinds: ['image'] } })).statusCode)
    expect(codes.every((c) => c === 200)).toBe(true)
    let refused = 0
    let last
    for (let i = 100; i < DEFAULT_MEDIA_SEARCHES_PER_MINUTE + 10; i++) {
      last = await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: `crowd ${i}`, kinds: ['image'] } })
      if (last.statusCode === 429) refused++
    }
    expect(refused).toBe(10)
    expect(Number(last?.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    t.clock.advance(60_000)
    expect((await t.app.inject({ method: 'POST', url: MEDIA_ROUTES.mediaSearch.path, headers: p.auth, payload: { query: 'crowd again', kinds: ['image'] } })).statusCode).toBe(200)
  })

  it('a flood of refused tokens is still stopped per address, far below the account limit', async () => {
    const t = makeCloud()
    let first429 = -1
    for (let i = 0; i < DEFAULT_REQUESTS_PER_MINUTE + 5 && first429 < 0; i++) {
      if ((await t.app.inject({ url: '/v1/wallet', headers: { authorization: `Bearer atk_bogus${i}` } })).statusCode === 429) first429 = i
    }
    expect(first429).toBe(DEFAULT_REQUESTS_PER_MINUTE)
  })
})
