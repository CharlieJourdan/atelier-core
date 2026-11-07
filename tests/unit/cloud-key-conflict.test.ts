// Issue #92: an idempotency key that the Cloud already holds with another quote (a job that failed, the app restarted and lost its
// record, failed again) must never block a retry: the client walks the key's next generations until one is free.
import { describe, expect, it } from 'vitest'
import { cloudJobRunner } from '../../src/engine/cloud-http'

const NOW = new Date().toISOString()
const job = (id: string, state: string, result: unknown = null): unknown => ({ id, usage: 'analyseVideo', state, quoteId: 'q', credits: 1, attempts: 1, error: null, result, artefacts: [], demo: false, createdAt: NOW, updatedAt: NOW })
const quote = { id: 'quote-1', usage: 'analyseVideo', gridVersion: 1, creditValueEur: 0.01, lines: [], totalCredits: 1, referenceEur: null, demo: false, createdAt: NOW, expiresAt: new Date(Date.now() + 600_000).toISOString() }
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('an idempotency key taken by an earlier failed job', () => {
  it('moves on to the first free generation instead of answering « conflict » forever', async () => {
    const taken = new Set(['analyse-abc', 'analyse-abc-g1', 'analyse-abc-g2'])
    const seen: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/quotes')) return json(200, quote)
      if (url.endsWith('/v1/jobs') && init?.method === 'POST') {
        const key = (JSON.parse(String(init.body)) as { idempotencyKey: string }).idempotencyKey
        seen.push(key)
        return taken.has(key) ? json(409, { error: { code: 'conflict', message: 'idempotency key already used for another quote' } }) : json(200, job('job-ok', 'succeeded', { analysis: 'x' }))
      }
      return json(404, { error: { code: 'not_found' } })
    }) as unknown as typeof fetch
    const runner = cloudJobRunner({ baseUrl: 'http://cloud.test', token: () => 'tok', fetchImpl, pollMs: 5 })
    const { job: done } = await runner.runJob('analyseVideo', { url: 'https://youtu.be/x', minutes: 1 }, { idempotencyKey: 'analyse-abc', signal: new AbortController().signal, dir: process.cwd() })
    expect(done.state).toBe('succeeded')
    expect(seen).toEqual(['analyse-abc', 'analyse-abc-g1', 'analyse-abc-g2', 'analyse-abc-g3'])
  })

  it('gives up with a plain refusal when every generation is taken', async () => {
    const fetchImpl = (async (url: string) => (url.endsWith('/v1/quotes') ? json(200, quote) : json(409, { error: { code: 'conflict' } }))) as unknown as typeof fetch
    const runner = cloudJobRunner({ baseUrl: 'http://cloud.test', token: () => 'tok', fetchImpl, pollMs: 5 })
    await expect(runner.runJob('analyseVideo', { url: 'u', minutes: 1 }, { idempotencyKey: 'analyse-zzz', signal: new AbortController().signal, dir: process.cwd() })).rejects.toThrow(/clé/)
  })
})
