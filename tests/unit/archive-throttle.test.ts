// Issue #106: a throttled / erroring archive is told apart from « nothing found »: asked again (Retry-After, jittered backoff),
// then reported as an error, never as empty hands; « nothing found » only when every source answered empty. Fake fetches only.
import { describe, expect, it } from 'vitest'
import { searchArchives } from '../../src/engine/archive'
import { get, HttpStatusError, resolveDeps } from '../../src/engine/archive/http'
import { retryWait } from '../../src/engine/archive/polite'
import { archiveTroubleOf, noteArchiveTrouble } from '../../src/engine/nodes/archive-trouble'

const json = (v: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } })
const instant = (waits: number[]) => async (ms: number): Promise<void> => void waits.push(ms)

describe('throttled archive requests', () => {
  it('waits as Retry-After asks (else a jittered backoff), then goes through', async () => {
    const answers = [json({}, 429, { 'retry-after': '2' }), json({}, 503), json({ ok: true })]
    const waits: number[] = []
    const d = resolveDeps({ fetch: (async () => answers.shift() as Response) as typeof fetch, sleep: instant(waits) })
    const res = await get('https://commons.wikimedia.org/w/api.php', d)
    expect(res.status).toBe(200)
    expect(waits).toHaveLength(2)
    expect(waits[0]).toBeGreaterThanOrEqual(2000)
    expect(waits[0]).toBeLessThanOrEqual(2400)
    expect(waits[1]).toBeGreaterThan(0)
    expect(waits[1]).toBeLessThanOrEqual(15_000)
  })

  it('backoff grows and has jitter; a wait never passes the ceiling', () => {
    const h = { headers: new Headers() }
    expect(retryWait(h, 0, () => 0)).toBeLessThan(retryWait(h, 0, () => 1))
    expect(retryWait(h, 1, () => 0.5)).toBeGreaterThan(retryWait(h, 0, () => 0.5))
    expect(retryWait({ headers: new Headers({ 'retry-after': '3600' }) }, 0)).toBe(15_000)
  })

  it('a request still throttled after its retries throws; 404 is not retried', async () => {
    let n = 0
    const d = resolveDeps({ fetch: (async () => (n++, json({}, 429))) as typeof fetch, sleep: instant([]) })
    await expect(get('https://archive.org/x', d)).rejects.toBeInstanceOf(HttpStatusError)
    expect(n).toBe(4)
    let m = 0
    const d2 = resolveDeps({ fetch: (async () => (m++, json({}, 404))) as typeof fetch, sleep: instant([]) })
    await expect(get('https://archive.org/x', d2)).rejects.toBeInstanceOf(HttpStatusError)
    expect(m).toBe(1)
  })

  it('at most a few requests at once to one host', async () => {
    let live = 0
    let peak = 0
    const f = (async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 10))
      live--
      return json({})
    }) as typeof fetch
    const d = resolveDeps({ fetch: f })
    await Promise.all(Array.from({ length: 12 }, () => get('https://gate-test.example/a', d)))
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('throttled is not « nothing found »', () => {
  const wiki = (): Response => json({ query: { pages: [] } })
  const empty = (url: string): Response =>
    url.includes('archive.org') ? json({ response: { docs: [] } }) : url.includes('nasa.gov') ? json({ collection: { items: [] } }) : url.includes('metmuseum') ? json({ total: 0, objectIDs: null }) : wiki()

  it('every source answering empty is « nothing found »: no error', async () => {
    const fetchImpl = (async (u: unknown) => empty(String(u))) as typeof fetch
    const r = await searchArchives('zzz qqq', { count: 4 }, { fetch: fetchImpl, sleep: instant([]) })
    expect(r.hits).toEqual([])
    expect(r.errors).toEqual([])
  })

  it('a source throttled while the others find nothing is reported, and asked once more after a pause', async () => {
    const waits: number[] = []
    let ia = 0
    const fetchImpl = (async (u: unknown) => {
      const url = String(u)
      if (url.includes('archive.org')) {
        ia++
        return json({}, 429, { 'retry-after': '0' })
      }
      return empty(url)
    }) as typeof fetch
    const r = await searchArchives('zzz qqq', { count: 4 }, { fetch: fetchImpl, sleep: instant(waits) })
    expect(r.hits).toEqual([])
    expect(r.errors).toEqual([{ source: 'internet-archive', message: 'HTTP 429 from archive.org' }])
    expect(ia).toBe(8) // 4 attempts, then the whole source once more
  })

  it('a source that recovers on the second ask gives its hits', async () => {
    let ia = 0
    const fetchImpl = (async (u: unknown) => {
      const url = String(u)
      if (url.includes('archive.org/advancedsearch')) {
        ia++
        return ia <= 4 ? json({}, 429, { 'retry-after': '0' }) : json({ response: { docs: [] } })
      }
      return empty(url)
    }) as typeof fetch
    const r = await searchArchives('zzz qqq', { count: 4 }, { fetch: fetchImpl, sleep: instant([]) })
    expect(r.errors).toEqual([])
  })

  it('a run counts the archive troubles it met', () => {
    const ctx = {}
    expect(archiveTroubleOf(ctx)).toBe(0)
    noteArchiveTrouble(ctx)
    expect(archiveTroubleOf(ctx)).toBe(1)
  })
})
