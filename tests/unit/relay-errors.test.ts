// Security review, finding 6: an error of the brain longer than the Cloud accepts (code 100, message 4000 characters)
// used to get a 400 from `/reply` and the person waited 60 s for a timeout. The brain now cuts the envelope to the
// Cloud's limits before posting it, and answers any other refusal of its answer (4xx) with a short error envelope.
import { describe, expect, it } from 'vitest'
import { BrainEnvelope, RelayReplyRequest } from '../../src/shared/cloud-api'
import { EventHub } from '../../src/main/headless/events'
import { BrainRelay, fitEnvelope } from '../../src/main/headless/relay'

const link = { cloudUrl: 'http://127.0.0.1:9', machineId: 'mch_1', teamId: 'team_1', credential: 'amc_test' }

/** A fake Cloud: one call on the first poll, then polls that wait until aborted; answers recorded, statuses scripted. */
function fakeCloud(statuses: number[]) {
  const replies: unknown[] = []
  let polled = 0
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/relay/machine/next')) {
      if (polled++ === 0) return new Response(JSON.stringify({ requests: [{ id: 'rq_1', method: 'chat.send', args: [] }] }), { status: 200 })
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    if (url.includes('/v1/relay/machine/reply')) {
      replies.push(JSON.parse(String(init?.body)))
      const status = statuses.shift() ?? 200
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: { code: 'bad_request', message: 'x' } }), { status })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, replies }
}

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('the brain’s answers through the relay', () => {
  it('cuts a long error to the Cloud’s limits, so the Cloud accepts it', async () => {
    const cloud = fakeCloud([])
    const relay = new BrainRelay({
      link,
      hub: new EventHub(),
      fetchImpl: cloud.fetchImpl,
      dispatch: async () => ({ ok: false, error: { code: 'E'.repeat(300), message: `Error: boom\n${'    at frame (file.ts:1:1)\n'.repeat(500)}` } })
    })
    relay.start()
    await until(() => cloud.replies.length === 1)
    await relay.close()
    const posted = RelayReplyRequest.parse(cloud.replies[0])
    expect(posted.response.ok).toBe(false)
    const error = (posted.response as { error: { code: string; message: string } }).error
    expect(error.code).toHaveLength(100)
    expect(error.message).toHaveLength(4000)
    expect(error.message.startsWith('Error: boom')).toBe(true)
    expect(error.message.endsWith('…')).toBe(true)
    // short envelopes and successes pass untouched
    expect(fitEnvelope({ ok: true, value: 'x'.repeat(10_000) })).toEqual({ ok: true, value: 'x'.repeat(10_000) })
    expect(fitEnvelope({ ok: false, error: { code: 'NOT_FOUND', message: 'Introuvable' } })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Introuvable' } })
    expect(BrainEnvelope.safeParse(fitEnvelope({ ok: false, error: { code: 42, message: null } })).success).toBe(true)
  })

  it('answers any refusal of its answer (4xx) with a short error envelope instead of letting the caller time out', async () => {
    for (const status of [400, 422, 429]) {
      const cloud = fakeCloud([status])
      const relay = new BrainRelay({ link, hub: new EventHub(), fetchImpl: cloud.fetchImpl, dispatch: async () => ({ ok: true, value: { odd: 'shape' } }) })
      relay.start()
      await until(() => cloud.replies.length === 2)
      await relay.close()
      const second = RelayReplyRequest.parse(cloud.replies[1])
      expect(second).toEqual({ id: 'rq_1', response: { ok: false, error: { code: 'ERROR', message: 'Réponse du cerveau refusée par Atelier Cloud.' } } })
    }
    // 413 keeps its own answer; 404 (the call is gone) and 401 (revoked) have nobody to answer
    const big = fakeCloud([413])
    const r413 = new BrainRelay({ link, hub: new EventHub(), fetchImpl: big.fetchImpl, dispatch: async () => ({ ok: true }) })
    r413.start()
    await until(() => big.replies.length === 2)
    await r413.close()
    expect(big.replies[1]).toMatchObject({ response: { ok: false, error: { code: 'TOO_LARGE' } } })
    for (const status of [401, 404]) {
      const gone = fakeCloud([status])
      const r = new BrainRelay({ link, hub: new EventHub(), fetchImpl: gone.fetchImpl, dispatch: async () => ({ ok: true }) })
      r.start()
      await until(() => gone.replies.length === 1)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await r.close()
      expect(gone.replies).toHaveLength(1)
    }
  })
})
