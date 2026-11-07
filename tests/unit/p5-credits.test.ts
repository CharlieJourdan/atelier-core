// CreditSpender and CloudQuoter (src/main/production/credits.ts) on a scripted Cloud: pricing per unit, the video cap
// (seeded with what the video already committed), the wallet check, settle at the reported cost, release, and the
// "nothing paid" refusal when the Cloud cannot be reached.
import { describe, expect, it } from 'vitest'
import type { CloudCaller } from '../../src/engine/cloud-http'
import { EngineError } from '../../src/engine/errors'
import { CLOUD_UNREACHABLE_NOTHING_PAID, CloudQuoter, CreditSpender, notConnectedSpender, UNIT_USAGE } from '../../src/main/production/credits'

/** 1 credit per 10 chars, 2 per image, 8 per second of video, 4 per second of avatar, 1 per 30 GPU seconds; `available` credits in the wallet. */
function scripted(available: number, o: { down?: boolean } = {}): CloudCaller & { calls: string[] } {
  const calls: string[] = []
  const per: Record<string, number> = { synthesize: 0.1, generateImage: 2, generateVideo: 8, talkingAvatar: 4, submitGpuJob: 1 / 30 }
  const call = ((method: string, url: string, _schema: unknown, _signal: AbortSignal, body?: unknown) => {
    calls.push(`${method} ${url}`)
    if (o.down) return Promise.reject(new EngineError('transient', 'Atelier Cloud est injoignable'))
    if (url === '/v1/wallet') return Promise.resolve({ teamId: 't', balance: available, held: 0, available })
    const items = (body as { items: { key: string; usage: string; quantity: number }[] }).items
    const lines = items.map((i) => ({ key: i.key, credits: Math.max(1, Math.ceil(i.quantity * (per[i.usage] ?? 0))), demo: true }))
    return Promise.resolve({ gridVersion: 1, creditValueEur: 0.01, lines, totalCredits: lines.reduce((s, l) => s + l.credits, 0) })
  }) as CloudCaller['call']
  return { baseUrl: 'http://127.0.0.1:1', fetch, raw: call, call, calls }
}

const req = (units: { unit: 'chars' | 'images' | 'video_s' | 'avatar_s' | 'gpu_s' | 'tokens'; qty: number }[], key = 'k1') => ({
  runId: 'r',
  nodeId: 'n',
  idempotencyKey: key,
  estimate: { units, durationS: 1 }
})

describe('CreditSpender', () => {
  it('prices the estimate, holds it in the run, settles at the reported use and frees it on release', async () => {
    const s = new CreditSpender({ caller: scripted(1000), capCredits: 100 })
    const r = await s.reserve(req([{ unit: 'chars', qty: 300 }, { unit: 'tokens', qty: 5000 }]))
    expect(s.committed()).toBe(30)
    await r.settle({ units: [{ unit: 'chars', qty: 120 }] })
    expect(s.committed()).toBe(12)
    const r2 = await s.reserve(req([{ unit: 'images', qty: 3 }], 'k2'))
    expect(s.committed()).toBe(18)
    await r2.release()
    expect(s.committed()).toBe(12)
  })

  it('prices generated video and a talking avatar by the second, and settles them at the seconds really used', async () => {
    expect(UNIT_USAGE).toMatchObject({ chars: 'synthesize', images: 'generateImage', video_s: 'generateVideo', avatar_s: 'talkingAvatar', searches: 'searchStock', gpu_s: 'submitGpuJob' })
    const s = new CreditSpender({ caller: scripted(1000) })
    const r = await s.reserve(req([{ unit: 'avatar_s', qty: 14 }, { unit: 'video_s', qty: 10 }]))
    expect(s.committed()).toBe(14 * 4 + 10 * 8)
    await r.settle({ units: [{ unit: 'avatar_s', qty: 9 }] })
    expect(s.committed()).toBe(36)
  })

  it('refuses a node that would cross the video cap, counting what the video already committed', async () => {
    const s = new CreditSpender({ caller: scripted(1000), capCredits: 50, alreadyCommitted: 45 })
    await expect(s.reserve(req([{ unit: 'images', qty: 3 }]))).rejects.toMatchObject({ code: 'budget', message: expect.stringMatching(/plafond de la vidéo \(50 crédits\)/) })
    const ok = await s.reserve(req([{ unit: 'images', qty: 2 }]))
    expect(s.committed()).toBe(49)
    await ok.release()
  })

  it('refuses a node the wallet cannot pay, with the amounts in French', async () => {
    const s = new CreditSpender({ caller: scripted(5) })
    await expect(s.reserve(req([{ unit: 'gpu_s', qty: 600 }]))).rejects.toMatchObject({
      code: 'budget',
      message: 'Crédits insuffisants pour cette étape : il en faut ≈ 20, il en reste 5.'
    })
  })

  it('an unreachable Cloud refuses the node before anything starts, for good, saying nothing was paid', async () => {
    const caller = scripted(1000, { down: true })
    const s = new CreditSpender({ caller })
    const e = await s.reserve(req([{ unit: 'chars', qty: 10 }])).catch((x: unknown) => x)
    expect(e).toMatchObject({ code: 'missing_tool', permanent: true, message: CLOUD_UNREACHABLE_NOTHING_PAID })
    expect(caller.calls).toEqual(['POST /v1/estimates'])
    await expect(notConnectedSpender.reserve(req([{ unit: 'chars', qty: 10 }]) as never)).rejects.toMatchObject({ code: 'missing_tool', message: /pas connectée/ })
  })

  it('CloudQuoter prices each paid line; units the grid does not sell cost 0 without a call', async () => {
    const caller = scripted(1000)
    const q = await new CloudQuoter(caller).quote([
      { nodeId: 'voice', type: 'voice.tts@1', where: 'cloud', units: [{ unit: 'chars', qty: 900 }] },
      { nodeId: 'script', type: 'script.write@1', where: 'local', units: [{ unit: 'tokens', qty: 9000 }] }
    ])
    expect(q.lines).toEqual([
      { nodeId: 'voice', credits: 90 },
      { nodeId: 'script', credits: 0 }
    ])
    expect(caller.calls).toEqual(['POST /v1/estimates'])
  })
})
