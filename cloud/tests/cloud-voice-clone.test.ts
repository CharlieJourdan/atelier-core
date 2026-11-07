// Voice cloning (usage `cloneVoice`): the contract, the fake, the price, the catalogue of a team's voices, migration 007, and
// the MiniMax adapter against a fake fetch (request shape, auth from the secret, errors, no secret leak). Never the network.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { CatalogResponse, CloneVoiceInput, USAGES, USAGE_INPUTS } from '../../src/shared/cloud-api.ts'
import { DEFAULT_GRID, VOICE_CLONE_ITEM } from '../src/db/migrations/002_default_prices.ts'
import { up as migrate007 } from '../src/db/migrations/007_voice_clone_price.ts'
import { fakeCloneId, FAKE_VOICE_FILE, FAKE_VOICES } from '../src/providers/fakes.ts'
import { MINIMAX_EXCEPTION_CLONE_NAMES } from '../../src/shared/voice-exception.ts'
import { MINIMAX_CLONE_MAX_BYTES, MINIMAX_VOICE_FEE_USD, cloneVoiceId, minimaxAdapter } from '../src/providers/minimax.ts'
import { RetryableProviderError, runUsage, type ProviderContext } from '../src/providers/types.ts'
import { ctxFor, fakeFetch, json } from './fake-fetch.ts'
import { makeCloud, quoteAndRun, signUpAndIn } from './helpers.ts'

const KEY = 'mm-test-SECRET-4f8a1c9d2e'
const PROD = { NODE_ENV: 'production' }
const CLIP_URL = 'https://cloud.example/files/art_clip?exp=1&sig=abc'
const WAV = readFileSync(FAKE_VOICE_FILE)

describe('the contract', () => {
  it('cloneVoice is a usage; its input is an uploaded clip and a name, the language defaults to French', () => {
    expect(USAGES).toContain('cloneVoice')
    expect(CloneVoiceInput.parse({ audioArtefactId: 'art_1', name: '  Marie  ', consent: true })).toEqual({ audioArtefactId: 'art_1', name: 'Marie', language: 'fr', consent: true })
    // decision 0025 (production-5): no clone without the consent tick
    expect(CloneVoiceInput.safeParse({ audioArtefactId: 'art_1', name: 'Marie' }).success).toBe(false)
    expect(CloneVoiceInput.safeParse({ audioArtefactId: 'art_1', name: 'Marie', consent: false }).success).toBe(false)
    expect(CloneVoiceInput.safeParse({ audioArtefactId: 'art_1', name: '   ' }).success).toBe(false)
    expect(CloneVoiceInput.safeParse({ name: 'x' }).success).toBe(false)
    expect(USAGE_INPUTS.cloneVoice).toBe(CloneVoiceInput)
  })

  it('the catalogue voice entries say whether they are cloned', () => {
    const c = CatalogResponse.parse({ paidCalls: false, providers: [], models: [], voices: [{ id: 'a', name: 'A', language: 'fr', demo: true }] })
    expect(c.voices[0]).toMatchObject({ cloned: false })
  })
})

describe('the fake clone, its price and the team’s voices', () => {
  it('returns a deterministic clone- id, charges one voice.clone unit, and the voice shows in the team’s catalogue only', async () => {
    const t = makeCloud({ gridMargins: true })
    const p = await signUpAndIn(t, { credits: 10_000 })
    const other = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'ma-voix.wav', mime: 'audio/wav', bytes: WAV }, false)

    const input = { audioArtefactId: clip.id, name: 'Marie', consent: true }
    const { quote, job } = await quoteAndRun(t, p, 'cloneVoice', input)
    expect(quote).toMatchObject({ usage: 'cloneVoice' })
    const lines = (await t.app.inject({ method: 'GET', url: '/v1/jobs/' + job.id, headers: p.auth })).json() as { quoteId: string }
    const stored = t.cloud.pricing.getQuote(lines.quoteId)
    expect(stored?.lines).toMatchObject([{ item: 'voice.clone', quantity: 1, unit: 'voice' }])
    expect(quote.totalCredits).toBe(160) // USD 1.50 × 0.92 × 1.05 overhead, +10 %, at EUR 0.01 a credit
    expect(job).toMatchObject({ state: 'succeeded', demo: true, credits: 160 })
    const result = job.result as { voiceId: string; name: string; language: string }
    expect(result.voiceId).toBe(fakeCloneId(clip.id, 'Marie'))
    expect(result.voiceId).toMatch(/^clone-[0-9a-f]{12}$/)
    expect(result).toMatchObject({ name: 'Marie', language: 'fr' })
    expect(job.artefacts).toHaveLength(0)

    const catalog = async (who: typeof p) => CatalogResponse.parse((await t.app.inject({ method: 'GET', url: '/v1/catalog', headers: who.auth })).json())
    const mine = await catalog(p)
    // the demonstration voices, then the platform's default real voices (issue #95), none of them cloned
    expect(mine.voices.filter((v) => !v.cloned).map((v) => v.id).slice(0, FAKE_VOICES.length)).toEqual(FAKE_VOICES.map((v) => v.id))
    expect(mine.voices.filter((v) => !v.cloned && !v.demo).every((v) => v.default)).toBe(true)
    expect(mine.voices.at(-1)).toEqual({ id: result.voiceId, name: 'Marie', language: 'fr', demo: true, cloned: true, default: false })
    expect((await catalog(other)).voices.some((v) => v.cloned)).toBe(false)
    expect(mine.providers.find((x) => x.usage === 'cloneVoice')).toMatchObject({ status: 'demo' })

    // the same clip and name give the same voice, listed once; another name is another voice
    await quoteAndRun(t, p, 'cloneVoice', input)
    await quoteAndRun(t, p, 'cloneVoice', { ...input, name: 'Marie bis' })
    const again = (await catalog(p)).voices.filter((v) => v.cloned)
    expect(again.map((v) => v.name)).toEqual(['Marie', 'Marie bis'])
  })

  it('refuses a clip that is not the team’s own', async () => {
    const t = makeCloud()
    const p = await signUpAndIn(t, { credits: 1000 })
    const other = await signUpAndIn(t, { credits: 1000 })
    const theirs = await t.cloud.storage.put(other.teamId, null, { name: 'x.wav', mime: 'audio/wav', bytes: WAV }, false)
    for (const id of [theirs.id, 'art_missing']) {
      const r = await t.app.inject({ method: 'POST', url: '/v1/quotes', headers: p.auth, payload: { usage: 'cloneVoice', input: { audioArtefactId: id, name: 'Marie', consent: true } } })
      expect(r.statusCode).toBe(404)
    }
  })
})

describe('migration 007', () => {
  const grids = (db: DatabaseSync): { version: number; items: { item: string }[] }[] =>
    (db.prepare('SELECT version, items_json FROM price_grids ORDER BY version').all() as { version: number; items_json: string }[]).map((r) => ({ version: r.version, items: JSON.parse(r.items_json) as { item: string }[] }))
  const grid = (): DatabaseSync => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE price_grids (version INTEGER PRIMARY KEY, credit_value_eur REAL, usd_to_eur REAL, overhead_pct REAL, note TEXT, items_json TEXT, created_at TEXT, created_by TEXT)`)
    return db
  }
  const insert = (db: DatabaseSync, version: number, items: readonly unknown[], creditValue = 0.01): void => {
    db.prepare(`INSERT INTO price_grids VALUES (?, ?, 0.92, 5, 'x', ?, 'now', 'test')`).run(version, creditValue, JSON.stringify(items))
  }

  it('a database whose current grid lacks voice.clone gets a new version: the same figures plus the item', () => {
    const db = grid()
    const old = DEFAULT_GRID.items.filter((i) => i.item !== 'voice.clone')
    insert(db, 1, old)
    insert(db, 2, old, 0.02) // an admin changed the credit value: the new grid builds on the current one, not on version 1
    migrate007(db)
    const g = grids(db)
    expect(g.map((x) => x.version)).toEqual([1, 2, 3])
    expect(g[2]?.items.map((i) => i.item)).toEqual([...old.map((i) => i.item), 'voice.clone'])
    expect((db.prepare('SELECT credit_value_eur AS v FROM price_grids WHERE version = 3').get() as { v: number }).v).toBe(0.02)
    expect(g[0]?.items).toHaveLength(old.length) // earlier grids are never touched
    migrate007(db) // idempotent
    expect(grids(db)).toHaveLength(3)
  })

  it('a grid that already has the item (a fresh database) is left alone, and every usage is priced by every default grid', () => {
    const db = grid()
    insert(db, 1, DEFAULT_GRID.items)
    migrate007(db)
    expect(grids(db).map((x) => x.version)).toEqual([1])
    expect(DEFAULT_GRID.items.find((i) => i.item === VOICE_CLONE_ITEM.item)).toMatchObject({ usage: 'cloneVoice', providerCostUsd: 1.5 })
    const t = makeCloud()
    expect(t.cloud.pricing.current().version).toBe(1)
    expect(t.cloud.pricing.current().items.map((i) => i.usage).sort()).toEqual([...USAGES].sort())
  })
})

// ---- the MiniMax adapter ------------------------------------------------------------------------------------------------

function cloneCtx(o: { name?: string; jobId?: string; signal?: AbortSignal } = {}): ProviderContext {
  return {
    ...ctxFor(KEY, o.signal),
    jobId: o.jobId ?? 'job_clone_1',
    artefact: (id) => {
      if (id !== 'art_clip') throw new Error('not found')
      return { name: o.name ?? 'ma-voix.wav', url: CLIP_URL }
    }
  }
}
const okUpload = () => json({ file: { file_id: 'file-123', bytes: 100 }, base_resp: { status_code: 0, status_msg: 'success' } })
const okClone = () => json({ input_sensitive: false, base_resp: { status_code: 0, status_msg: 'success' } })
/** Serves the clip from its signed link (the Cloud's own job-bound /provider-files/ link in a job) and answers the two MiniMax calls. */
function mm(over: { clip?: () => Response; upload?: () => Response; clone?: () => Response } = {}) {
  return fakeFetch((req) => {
    if (req.method === 'GET' && (req.url === CLIP_URL || req.url.includes('/files/') || req.url.includes('/provider-files/'))) return over.clip?.() ?? new Response(WAV, { status: 200 })
    if (req.url.endsWith('/v1/files/upload')) return over.upload?.() ?? okUpload()
    if (req.url.endsWith('/v1/voice_clone')) return over.clone?.() ?? okClone()
    return new Response('unexpected', { status: 404 })
  })
}
const input = { audioArtefactId: 'art_clip', name: 'Marie', language: 'fr' }
const clone = (a: ReturnType<typeof minimaxAdapter>, ctx = cloneCtx(), i: Record<string, unknown> = input) => runUsage(a, 'cloneVoice', i, ctx)

describe('MiniMax voice clone', () => {
  it('downloads the clip from the Cloud link without the key, uploads it as voice_clone, then clones with our voice id', async () => {
    const f = mm()
    const out = await clone(minimaxAdapter({ fetchImpl: f.fetch }))
    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', CLIP_URL],
      ['POST', 'https://api.minimax.io/v1/files/upload'],
      ['POST', 'https://api.minimax.io/v1/voice_clone']
    ])
    expect(f.calls[0]?.headers.authorization).toBeUndefined() // the key never goes to the Cloud's own link
    const [, upload, cloneCall] = f.calls
    expect(upload?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(upload?.headers['content-type']).toBeUndefined() // multipart: the boundary header is the runtime's own
    expect(upload?.form).toEqual({ purpose: 'voice_clone', file: { name: 'ma-voix.wav', type: 'audio/wav', size: WAV.length } })
    expect(cloneCall?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(cloneCall?.headers['content-type']).toBe('application/json')
    const voiceId = cloneVoiceId('job_clone_1')
    expect(voiceId).toMatch(/^clone-[0-9a-f]{16}$/)
    expect(JSON.parse(cloneCall?.body ?? '{}')).toEqual({ file_id: 'file-123', voice_id: voiceId, model: 'speech-2.8-hd' })
    expect(out.files).toEqual([])
    expect(out.data).toEqual({ voiceId, name: 'Marie', language: 'fr', model: 'speech-2.8-hd' })
    expect(out.costUsd).toBe(MINIMAX_VOICE_FEE_USD)
    expect(out.costUsd).toBe(1.5)
    expect(out.measure).toEqual([{ item: 'voice.clone', quantity: 1 }])
  })

  it('uses the China host and the turbo model when configured; a numeric file id is passed on as is', async () => {
    const f = mm({ upload: () => json({ file: { file_id: 987654321 }, base_resp: { status_code: 0 } }) })
    await clone(minimaxAdapter({ fetchImpl: f.fetch, region: 'china', model: 'speech-2.8-turbo' }), cloneCtx({ name: 'voix.m4a' }))
    expect(f.calls[1]?.url).toBe('https://api.minimaxi.com/v1/files/upload')
    expect(f.calls[1]?.form?.file).toMatchObject({ name: 'voix.m4a', type: 'audio/mp4' })
    expect(JSON.parse(f.calls[2]?.body ?? '{}')).toMatchObject({ file_id: 987654321, model: 'speech-2.8-turbo' })
  })

  it('the same Cloud job always asks for the same voice id; another job another one', () => {
    expect(cloneVoiceId('job_a')).toBe(cloneVoiceId('job_a'))
    expect(cloneVoiceId('job_a')).not.toBe(cloneVoiceId('job_b'))
  })

  it('refuses a clip that is not mp3, m4a or wav, an empty one and one over 20 MB, before any MiniMax call', async () => {
    const f = mm()
    await expect(clone(minimaxAdapter({ fetchImpl: f.fetch }), cloneCtx({ name: 'voix.flac' }))).rejects.toThrow(/mp3, m4a or wav/)
    expect(f.calls).toHaveLength(0)
    const empty = mm({ clip: () => new Response(new Uint8Array(0)) })
    await expect(clone(minimaxAdapter({ fetchImpl: empty.fetch }))).rejects.toThrow(/empty/)
    const big = mm({ clip: () => new Response(new Uint8Array(MINIMAX_CLONE_MAX_BYTES + 1)) })
    await expect(clone(minimaxAdapter({ fetchImpl: big.fetch }))).rejects.toThrow(/over 20 MB/)
    expect(big.calls.map((c) => c.method)).toEqual(['GET']) // nothing was sent to MiniMax
  })

  it('a refused key is fatal, a 5xx or a rate limit is retryable, and the secret never appears in a message', async () => {
    const refused = mm({ upload: () => new Response('no', { status: 401 }) })
    const err = await clone(minimaxAdapter({ fetchImpl: refused.fetch })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RetryableProviderError)
    expect((err as Error).message).toMatch(/HTTP 401/)

    const authCode = mm({ clone: () => json({ base_resp: { status_code: 1004, status_msg: `bad key ${KEY}` } }) })
    const e2 = await clone(minimaxAdapter({ fetchImpl: authCode.fetch })).catch((e: unknown) => e)
    expect(e2).not.toBeInstanceOf(RetryableProviderError)
    expect((e2 as Error).message).toMatch(/code 1004, authentication failed/)

    const odd = mm({ clone: () => json({ base_resp: { status_code: 2039, status_msg: `used ${KEY} twice` } }) })
    const e3 = (await clone(minimaxAdapter({ fetchImpl: odd.fetch })).catch((e: unknown) => e)) as Error
    expect(e3.message).toMatch(/code 2039/)
    expect(e3.message).not.toContain(KEY)

    for (const bad of [new Response('x', { status: 503 }), new Response('x', { status: 429 })]) {
      const f = mm({ clone: () => bad })
      await expect(clone(minimaxAdapter({ fetchImpl: f.fetch }))).rejects.toBeInstanceOf(RetryableProviderError)
    }
    const limited = mm({ upload: () => json({ base_resp: { status_code: 1002 } }) })
    await expect(clone(minimaxAdapter({ fetchImpl: limited.fetch }))).rejects.toBeInstanceOf(RetryableProviderError)
    const noId = mm({ upload: () => json({ base_resp: { status_code: 0 } }) })
    await expect(clone(minimaxAdapter({ fetchImpl: noId.fetch }))).rejects.toThrow(/no file id/)
    const junk = mm({ clone: () => new Response('<html>', { status: 200 }) })
    await expect(clone(minimaxAdapter({ fetchImpl: junk.fetch }))).rejects.toThrow(/not JSON/)
  })

  it('stops when the job is aborted', async () => {
    const c = new AbortController()
    c.abort(new Error('cancelled'))
    const f = mm()
    await expect(clone(minimaxAdapter({ fetchImpl: f.fetch }), cloneCtx({ signal: c.signal }))).rejects.toThrow(/cancelled/)
    expect(f.calls).toHaveLength(0)
  })
})

describe('a clone job on the MiniMax adapter (fake fetch)', () => {
  it('runs real only with paidCalls, the clone provider and the key; is charged one voice.clone; the voice is listed as real', async () => {
    const f = mm()
    const t = makeCloud({ gridMargins: true,
      paidCalls: true,
      env: PROD,
      realAdapters: [minimaxAdapter({ fetchImpl: f.fetch })],
      providers: { synthesize: 'minimax', cloneVoice: 'minimax' }
    })
    t.cloud.vault.set('MINIMAX_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'ma-voix.wav', mime: 'audio/wav', bytes: WAV }, false)
    const { job } = await quoteAndRun(t, p, 'cloneVoice', { audioArtefactId: clip.id, name: MINIMAX_EXCEPTION_CLONE_NAMES[0], consent: true })
    expect(job).toMatchObject({ state: 'succeeded', demo: false, credits: 160, error: null })
    expect((t.cloud.db.prepare('SELECT provider, cost_usd FROM jobs WHERE id = ?').get(job.id) as { provider: string; cost_usd: number })).toEqual({ provider: 'minimax', cost_usd: 1.5 })
    expect((job.result as { voiceId: string }).voiceId).toBe(cloneVoiceId(job.id))
    expect(t.cloud.wallet.state(p.teamId).held).toBe(0)

    const catalog = CatalogResponse.parse((await t.app.inject({ method: 'GET', url: '/v1/catalog', headers: p.auth })).json())
    expect(catalog.voices.at(-1)).toMatchObject({ id: cloneVoiceId(job.id), name: MINIMAX_EXCEPTION_CLONE_NAMES[0], demo: false, cloned: true })
    expect(catalog.providers.find((x) => x.usage === 'cloneVoice')).toMatchObject({ provider: 'minimax', status: 'real' })
  })

  it('stays on the fake when the clone usage is left on fake, whatever is in the vault', async () => {
    const f = mm()
    const t = makeCloud({ paidCalls: true, env: PROD, realAdapters: [minimaxAdapter({ fetchImpl: f.fetch })], providers: { synthesize: 'minimax' } })
    t.cloud.vault.set('MINIMAX_API_KEY', KEY, 'test')
    const p = await signUpAndIn(t, { credits: 10_000 })
    const clip = await t.cloud.storage.put(p.teamId, null, { name: 'ma-voix.wav', mime: 'audio/wav', bytes: WAV }, false)
    const { job } = await quoteAndRun(t, p, 'cloneVoice', { audioArtefactId: clip.id, name: 'Marie', consent: true })
    expect(job).toMatchObject({ state: 'succeeded', demo: true })
    expect(f.calls).toHaveLength(0)
  })
})
