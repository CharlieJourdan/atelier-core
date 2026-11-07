// Fakes for tests and demos: a provider that answers canned candidates (free), one that fails, a paid one that counts its calls, a
// fake `fetch` routed by URL substring, and a fake yt-dlp runner. No network, no process.
import { FAIR_USE_LICENCE } from './legal.ts'
import { candidate } from './providers/common.ts'
import type { MediaCandidate, MediaKind, MediaLicence, RunFn, SourcingProvider } from './types.ts'

export const PD: MediaLicence = { short: 'Public domain', status: 'public-domain', attributionRequired: false }

export interface FakeItem {
  id: string
  title: string
  description?: string
  tags?: string[]
  width?: number
  height?: number
  durationS?: number
  licence?: MediaLicence
  review?: 'clear' | 'human-review'
}

export function fakeProvider(id: string, kind: MediaKind, items: FakeItem[], extra: Partial<SourcingProvider> = {}): SourcingProvider & { calls: number } {
  const p = {
    id,
    label: `Fake ${id}`,
    kinds: [kind] as const,
    calls: 0,
    async search(): Promise<MediaCandidate[]> {
      p.calls++
      return items.map((it, i) =>
        candidate({
          provider: id, label: `Fake ${id}`, id: it.id, kind, title: it.title, description: it.description, tags: it.tags, pageUrl: `https://fake.test/${it.id}`,
          previewUrl: `https://fake.test/${it.id}.jpg`, fileUrl: `https://fake.test/${it.id}.bin`, width: it.width, height: it.height, durationS: it.durationS,
          licence: it.licence ?? PD, review: it.review, rank: i, total: items.length
        })
      )
    },
    ...extra
  }
  return p as SourcingProvider & { calls: number }
}

export const failingProvider = (id: string, kind: MediaKind, message = 'boom'): SourcingProvider => ({ id, label: id, kinds: [kind], search: () => Promise.reject(new Error(message)) })

/** A paid provider that returns one generated candidate with a cost, and counts its calls (a test proves it is never called unasked). */
export function fakePaid(id: string, kind: MediaKind, costUsd = 0.15): SourcingProvider & { calls: number } {
  const p = fakeProvider(id, kind, [{ id: `${id}-gen-1`, title: 'generated track', durationS: 60 }], { paid: true, estCostUsd: costUsd })
  const inner = p.search.bind(p)
  p.search = async (q, ctx) => (await inner(q, ctx)).map((c) => ({ ...c, costUsd }))
  return p
}

export const fairUseVideo = (id: string, title: string): FakeItem => ({ id, title, licence: FAIR_USE_LICENCE, review: 'human-review', durationS: 30 })

/** A `fetch` that answers the first route whose key is contained in the URL; an unrouted URL fails the test (no network). */
export function routedFetch(routes: Array<[string, (url: string, init?: RequestInit) => Response | Promise<Response>]>): { fetch: typeof fetch; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({ url, headers: { ...((init?.headers ?? {}) as Record<string, string>) } })
    const route = routes.find(([key]) => url.includes(key))
    if (!route) throw new Error(`unexpected request: ${url}`)
    return route[1](url, init)
  }) as typeof fetch
  return { fetch: f, calls }
}

export const jsonResponse = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

/** A yt-dlp stand-in: records each call and answers from `answer(args)`. */
export function fakeRun(answer: (args: string[]) => string): { run: RunFn; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    run: async (cmd, args) => {
      if (cmd !== 'yt-dlp') throw new Error(`unexpected program ${cmd}`)
      calls.push(args)
      return { stdout: answer(args), stderr: '' }
    }
  }
}
