// Cloud robustness (app-ux-robustesse-2): a Cloud that answers far too slowly, a connection cut in the middle of an answer,
// the network that goes and comes back, and a laptop that sleeps for hours (the clock jumps, the access token has expired).
// In-process Cloud on the loopback, fakes only.
import { describe, expect, it } from 'vitest'
import { UNREACHABLE } from '../../src/engine/cloud-http'
import { handleCall } from '../../src/main/ipc'
import { appCore, connect, startCloud } from './cloud-app-helpers'

const HOUR = 3600_000

describe('a very slow Cloud', () => {
  it('a request that the timeout aborts ends in the plain French sentence, and the app keeps working', async () => {
    const rig = await startCloud(100)
    let slow = false
    const app = appCore({
      // when slow: the request never answers by itself, it only ends when its own timeout aborts it
      cloudFetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (slow) {
          return new Promise<Response>((_resolve, reject) => {
            const abort = (): void => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
            // the production timeout is 15 s; the test shortens it by aborting itself
            setTimeout(abort, 40)
            init?.signal?.addEventListener('abort', abort)
          })
        }
        return fetch(input, init)
      }) as typeof fetch
    })
    await connect(app, rig)
    slow = true
    const started = Date.now()
    expect(await handleCall(app.core.api, 'cloud.account', [])).toEqual({ ok: false, error: { code: 'transient', message: UNREACHABLE } })
    expect(Date.now() - started).toBeLessThan(5000)
    // the message itself is a calm French sentence with a next step
    expect(UNREACHABLE).toMatch(/[éè]/)
    slow = false
    expect(await app.core.cloud.api.wallet()).toMatchObject({ balance: 100 })
  })
})

describe('the network drops in the middle of a call and comes back', () => {
  it('a connection reset is the same plain sentence, nothing is signed out, and the next call works', async () => {
    const rig = await startCloud(250)
    const app = appCore()
    await connect(app, rig)
    for (let round = 0; round < 3; round++) {
      app.net.gate = async () => {
        // the answer was received, then the cable is pulled before the app reads it
        app.net.down = true
        throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
      }
      const cut = await handleCall(app.core.api, 'cloud.account', [])
      expect(cut).toEqual({ ok: false, error: { code: 'transient', message: UNREACHABLE } })
      expect(app.core.cloud.session.status().connected, 'tokens are kept while offline').toBe(true)
      app.net.gate = null
      app.net.down = false
      expect(await app.core.cloud.api.wallet()).toMatchObject({ balance: 250 })
    }
  })
})

describe('sleep and resume', () => {
  it('after hours asleep the expired access token is renewed by itself, with no message to the user', async () => {
    const rig = await startCloud(80)
    const app = appCore()
    await connect(app, rig)
    app.clock.now += 9 * HOUR // the laptop slept all night
    expect(await app.core.cloud.api.wallet()).toMatchObject({ balance: 80 })
    expect(app.core.cloud.session.status().connected).toBe(true)
    app.clock.now += 30 * 24 * HOUR // and a month later
    const later = await handleCall(app.core.api, 'cloud.account', [])
    if (!later.ok) expect(later.error.message).not.toMatch(/[A-Za-z]+Error|ECONN|at .*:\d+/)
  })
})
