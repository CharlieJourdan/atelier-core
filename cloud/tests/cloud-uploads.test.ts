// Lot P5, Cloud side: raw uploads (hash checked, deduplicated per team, invisible to other teams), unit estimates
// priced by hand, measured settlement (a job is charged what it used, priced on its quote's grid, never more than its
// hold) and the RunPod callback's signature.
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Artefact, EstimateResponse } from '../../src/shared/cloud-api.ts'
import { USAGE_ITEM } from '../src/pricing.ts'
import type { ProviderAdapter } from '../src/providers/types.ts'
import { makeCloud, quoteAndRun, signUpAndIn, type Person, type TestCloud } from './helpers.ts'

const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

function upload(t: TestCloud, who: Person, name: string, bytes: Buffer, sha = hex(bytes)) {
  return t.app.inject({
    method: 'POST',
    url: `/v1/uploads?name=${encodeURIComponent(name)}&sha256=${sha}`,
    headers: { ...who.auth, 'content-type': 'application/octet-stream' },
    payload: bytes
  })
}

describe('uploads', () => {
  it('stores the bytes once per team, checks the hash, guesses the type, and hides them from other teams', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    const other = await signUpAndIn(t)
    const bytes = randomBytes(2 * 1024 * 1024 + 17) // above the 1 MB limit of the JSON routes
    const first = await upload(t, p, 'clip.mp4', bytes)
    expect(first.statusCode).toBe(200)
    const a = Artefact.parse(first.json())
    expect(a).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4', size: bytes.length, sha256: hex(bytes), demo: false })
    expect(t.cloud.storage.get(a.id)).toMatchObject({ teamId: p.teamId, jobId: null })

    // Same content again (even under another name): the stored file answers, nothing new is written.
    const again = Artefact.parse((await upload(t, p, 'autre-nom.mp4', bytes)).json())
    expect(again.id).toBe(a.id)
    const rows = t.cloud.db.prepare('SELECT COUNT(*) AS n FROM artefacts WHERE sha256 = ?').get(hex(bytes)) as { n: number }
    expect(rows.n).toBe(1)

    // Lookup by hash: own team only.
    const found = await t.app.inject({ url: `/v1/uploads/${hex(bytes)}`, headers: p.auth })
    expect(found.statusCode).toBe(200)
    expect(Artefact.parse(found.json()).id).toBe(a.id)
    expect((await t.app.inject({ url: `/v1/uploads/${hex(bytes)}`, headers: other.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/v1/uploads/${'0'.repeat(64)}`, headers: p.auth })).statusCode).toBe(404)
    expect((await t.app.inject({ url: '/v1/uploads/NOT-A-HASH', headers: p.auth })).statusCode).toBe(400)
    expect((await t.app.inject({ url: `/v1/artefacts/${a.id}`, headers: other.auth })).statusCode).toBe(404)

    // The other team uploading the same bytes gets its own artefact.
    const theirs = Artefact.parse((await upload(t, other, 'clip.mp4', bytes)).json())
    expect(theirs.id).not.toBe(a.id)
    expect(t.cloud.storage.get(theirs.id)?.teamId).toBe(other.teamId)
  })

  it('refuses a wrong hash, a bad name, a JSON body and an anonymous caller; other routes keep their 1 MB limit', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t)
    const bytes = Buffer.from('quelques octets')
    const bad = await upload(t, p, 'a.txt', bytes, hex(Buffer.from('autre chose')))
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { error: { code: string } }).error.code).toBe('bad_request')
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM artefacts').get()).toEqual({ n: 0 })
    expect((await upload(t, p, '../evil.txt', bytes)).statusCode).toBe(400)
    const json = await t.app.inject({ method: 'POST', url: `/v1/uploads?name=a.txt&sha256=${hex(bytes)}`, headers: p.auth, payload: { a: 1 } })
    expect(json.statusCode).toBe(400)
    const anon = await t.app.inject({
      method: 'POST',
      url: `/v1/uploads?name=a.txt&sha256=${hex(bytes)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes
    })
    expect(anon.statusCode).toBe(401)
    const big = await t.app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: { ...p.auth, 'content-type': 'application/octet-stream' },
      payload: randomBytes(2 * 1024 * 1024)
    })
    expect(big.statusCode).toBe(400)
    expect((big.json() as { error: { message: string } }).error.message).toBe('body too large')
    // Types from the extension.
    for (const [name, mime] of [
      ['v.mp3', 'audio/mpeg'],
      ['p.PNG', 'image/png'],
      ['s.srt', 'application/x-subrip'],
      ['d.json', 'application/json'],
      ['x.bin', 'application/octet-stream'],
      ['sans-extension', 'application/octet-stream']
    ] as const) {
      const b = Buffer.from(`contenu ${name}`)
      expect(Artefact.parse((await upload(t, p, name, b)).json()).mime, name).toBe(mime)
    }
  })
})

describe('estimates', () => {
  const items = [
    { key: 'voix', usage: 'synthesize', quantity: 1000 },
    { key: 'images', usage: 'generateImage', quantity: 3 },
    { key: 'rendu', usage: 'submitGpuJob', quantity: 3600 }
  ]

  it('prices each item on the current grid, stores nothing, and an internal team pays the real cost', async () => {
    const t = makeCloud({ gridMargins: true })
    const p = await signUpAndIn(t)
    const me = await signUpAndIn(t, { internal: true })
    const quotesBefore = t.cloud.db.prepare('SELECT COUNT(*) AS n FROM quotes').get()
    const res = await t.app.inject({ method: 'POST', url: '/v1/estimates', headers: p.auth, payload: { items } })
    expect(res.statusCode).toBe(200)
    const e = EstimateResponse.parse(res.json())
    // Grid v1, cost € = qty × $ × 0.92 × 1.05, then the margin, in 0.01 € credits, rounded up, capped at the reference:
    //   voice 1000 × 0.00018 → 0.17388 € × 1.10 = 19.13 → 20 (reference 22)   images 3 × 0.02 → 0.05796 € × 1.25 = 7.25 → 8 (ref. 12)
    //   gpu 3600 × 0.00031 → 1.078056 € × 1.25 = 134.76 → 135 (no reference)
    expect(e).toEqual({
      gridVersion: 1,
      creditValueEur: 0.01,
      lines: [
        { key: 'voix', credits: 20, demo: true },
        { key: 'images', credits: 8, demo: true },
        { key: 'rendu', credits: 135, demo: true }
      ],
      totalCredits: 163
    })
    // At cost: 17.39 → 18, 5.80 → 6, 107.81 → 108.
    const internal = EstimateResponse.parse((await t.app.inject({ method: 'POST', url: '/v1/estimates', headers: me.auth, payload: { items } })).json())
    expect(internal.lines.map((l) => l.credits)).toEqual([18, 6, 108])
    expect(internal.totalCredits).toBe(132)
    expect(t.cloud.db.prepare('SELECT COUNT(*) AS n FROM quotes').get()).toEqual(quotesBefore)
    const bad = await t.app.inject({ method: 'POST', url: '/v1/estimates', headers: p.auth, payload: { items: [{ key: 'x', usage: 'nope', quantity: 1 }] } })
    expect(bad.statusCode).toBe(400)
    expect((await t.app.inject({ method: 'POST', url: '/v1/estimates', payload: { items } })).statusCode).toBe(401)
  })
})

describe('measured settlement', () => {
  /** A GPU fake that reports `seconds` really used, after `gate` opens. */
  const measured = (seconds: number, gate: Promise<void> = Promise.resolve()): ProviderAdapter => ({
    id: 'fake-gpu',
    kind: 'fake',
    async submitGpuJob() {
      await gate
      return { files: [], data: { used: seconds }, costUsd: 0, measure: [{ item: USAGE_ITEM.submitGpuJob, quantity: seconds }] }
    }
  })
  const gpu = { worker: 'render', payload: { scene: 1 }, estimatedGpuSeconds: 3600 }

  it('captures what was used (priced on the quote’s grid), gives the rest back, and the ledger adds up', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((r) => (open = r))
    const t = makeCloud({ gridMargins: true, fakes: { submitGpuJob: measured(600, gate) } })
    const admin = await signUpAndIn(t, { platformAdmin: true })
    const p = await signUpAndIn(t, { credits: 1000 })
    const q = (await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'submitGpuJob', input: gpu } })).json() as { id: string; totalCredits: number }
    expect(q.totalCredits).toBe(135)
    const j = (await t.app.inject({ method: 'POST', url: '/v1/jobs', headers: p.auth, payload: { quoteId: q.id, idempotencyKey: 'measured-1' } })).json() as { id: string }
    // A new grid (5 × dearer GPU) published while the job runs does not change its price.
    const grid = t.cloud.pricing.current()
    const items = grid.items.map((i) => (i.item === USAGE_ITEM.submitGpuJob ? { ...i, pricing: { mode: 'percent' as const, marginPct: 500 } } : i))
    t.cloud.pricing.publish({ creditValueEur: grid.creditValueEur, usdToEur: grid.usdToEur, overheadPct: grid.overheadPct, note: null, items }, admin.accountId)
    open()
    await t.cloud.jobs.whenIdle()
    const job = (await t.app.inject({ url: `/v1/jobs/${j.id}`, headers: p.auth })).json() as { state: string; credits: number }
    // 600 s × 0.00031 $ × 0.92 × 1.05 × 1.25 = 22.46 € cents → 23 credits.
    expect(job).toMatchObject({ state: 'succeeded', credits: 23 })
    expect(t.cloud.wallet.state(p.teamId)).toEqual({ teamId: p.teamId, balance: 1000 - 23, held: 0, available: 1000 - 23 })
    expect(t.cloud.wallet.sumOfEntries(p.teamId)).toEqual({ balance: 1000 - 23, held: 0 })
    const capture = t.cloud.wallet.entries(p.teamId).entries.find((e) => e.kind === 'capture')
    expect(capture).toMatchObject({ delta: -23, heldDelta: -135 })
    expect(t.cloud.jobs.events(j.id).at(-1)).toMatchObject({ type: 'succeeded', data: { credits: 23, held: 135 } })
  })

  it('never charges more than the hold; an internal team is settled at cost; no measure = the whole quote', async () => {
    const t = makeCloud({ gridMargins: true, fakes: { submitGpuJob: measured(100_000) } })
    const p = await signUpAndIn(t, { credits: 1000 })
    const over = await quoteAndRun(t, p, 'submitGpuJob', gpu)
    expect(over.job).toMatchObject({ state: 'succeeded', credits: 135 })
    expect(t.cloud.wallet.state(p.teamId)).toMatchObject({ balance: 865, held: 0 })

    const t2 = makeCloud({ gridMargins: true, fakes: { submitGpuJob: measured(600) } })
    const me = await signUpAndIn(t2, { internal: true, credits: 1000 })
    const internal = await quoteAndRun(t2, me, 'submitGpuJob', gpu)
    // At cost: hold 107.81 → 108; used 600 × 0.00029946 € = 17.97 → 18.
    expect(internal.quote.totalCredits).toBe(108)
    expect(internal.job).toMatchObject({ state: 'succeeded', credits: 18 })
    expect(t2.cloud.wallet.state(me.teamId)).toMatchObject({ balance: 982, held: 0 })

    const t3 = makeCloud({ gridMargins: true })
    const plain = await signUpAndIn(t3, { credits: 1000 })
    const whole = await quoteAndRun(t3, plain, 'submitGpuJob', gpu)
    expect(whole.job).toMatchObject({ state: 'succeeded', credits: 135 })
    expect(t3.cloud.jobs.events(whole.job.id).at(-1)?.data).toEqual({ credits: 135, held: 135 })
  })
})

describe('the RunPod callback', () => {
  it('refuses any defect of the signature with 403, delivers a signed body to its waiter, and answers ok without one', async () => {
    const t = makeCloud()
    const job = 'job_callback-1'
    const sig = t.cloud.webhooks.sign(job)
    const post = (url: string, payload: unknown = { id: 'pod-1', status: 'COMPLETED' }) =>
      t.app.inject({ method: 'POST', url, payload: payload as object })
    for (const url of [
      `/v1/runpod/webhook/${job}`,
      `/v1/runpod/webhook/${job}?sig=`,
      `/v1/runpod/webhook/${job}?sig=short`,
      `/v1/runpod/webhook/${job}?sig=${sig.slice(0, -1)}A`,
      `/v1/runpod/webhook/job_other?sig=${sig}`,
      `/v1/runpod/webhook/${job}?sig=${t.cloud.storage.signedPath(job).path.split('sig=')[1]}`
    ]) {
      const res = await post(url)
      expect(res.statusCode, url).toBe(403)
      expect((res.json() as { error: { code: string } }).error.code).toBe('forbidden')
    }
    expect(t.cloud.webhooks.verify(job, sig)).toBe(true)
    expect(t.cloud.webhooks.callbackPath(job)).toBe(`/v1/runpod/webhook/${job}?sig=${sig}`)

    const ac = new AbortController()
    const waiting = t.cloud.webhooks.wait(job, ac.signal)
    const ok = await post(t.cloud.webhooks.callbackPath(job), { id: 'pod-1', status: 'COMPLETED', output: { x: 1 } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true })
    expect(await waiting).toMatchObject({ id: 'pod-1', status: 'COMPLETED', output: { x: 1 } })
    expect(t.cloud.webhooks.pending()).toEqual([])
    // No waiter: still ok. A signed but malformed body: 400.
    expect((await post(t.cloud.webhooks.callbackPath(job))).json()).toEqual({ ok: true })
    expect((await post(t.cloud.webhooks.callbackPath(job), { nothing: true })).statusCode).toBe(400)
    // A waiter stops with its signal.
    const stop = new AbortController()
    const w = t.cloud.webhooks.wait(job, stop.signal)
    stop.abort(new Error('stopped'))
    await expect(w).rejects.toThrow('stopped')
    expect(t.cloud.webhooks.pending()).toEqual([])
  })

  it('is rate-limited by address', async () => {
    const t = makeCloud({ server: { requestsPerMinute: 3 } })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) codes.push((await t.app.inject({ method: 'POST', url: '/v1/runpod/webhook/job_x?sig=nope-nope-nope-nope', payload: {} })).statusCode)
    expect(codes).toEqual([403, 403, 403, 429, 429])
  })
})
