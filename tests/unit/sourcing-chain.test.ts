// The footage chain of src/engine/sourcing: needs, the agent picker, the Gemini shot log (budgeted), the code filter, scene-cut snapping,
// the contact-sheet check, visual similarity, the cost ledger, and the whole chain end to end on fakes (no network, no process, no model).
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BudgetExceeded, CostLedger, footageBudget } from '../../src/engine/sourcing/budget'
import { sourceFootage } from '../../src/engine/sourcing/chain'
import { CUT_MAX_S, cropFor, cutArgs, downloadWindow, planCut } from '../../src/engine/sourcing/cut'
import { fakeRun, jsonResponse, routedFetch } from '../../src/engine/sourcing/fakes'
import { fallbackNeed, parseNeeds, planNeeds, type Beat } from '../../src/engine/sourcing/needs'
import { parsePicks, pickMedia } from '../../src/engine/sourcing/pick'
import type { AskClaude } from '../../src/engine/sourcing/rank'
import { sheetArgs } from '../../src/engine/sourcing/sheet'
import { rankBySimilarity, similarity, signatureOf, type PixelReader } from '../../src/engine/sourcing/similar'
import type { MediaCandidate, MediaSearchResult } from '../../src/engine/sourcing/types'
import { parseVerdicts } from '../../src/engine/sourcing/verify'
import { filterShots, geminiWatch, parseShotLog, shotsToCandidates, watchCostUsd, watchMaxCostUsd, WATCH_MAX_OUTPUT_TOKENS, type Shot } from '../../src/engine/sourcing/watch'

interface GenerateBody {
  contents: Array<{ parts: Array<{ fileData?: unknown; videoMetadata?: { endOffset?: string }; text?: string }> }>
  generationConfig: Record<string, unknown>
}
const tmp: string[] = []
afterEach(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true })
})
const work = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'atelier-chain-'))
  tmp.push(d)
  return d
}

const cand = (id: string, title: string, extra: Partial<MediaCandidate> = {}): MediaCandidate => ({
  provider: 'fake', id, kind: 'video', title, pageUrl: `https://fake.test/${id}`, previewUrl: `https://fake.test/${id}.jpg`, fileUrl: `https://fake.test/${id}.mp4`,
  licence: { short: 'Public domain', status: 'public-domain', attributionRequired: false }, credit: title, review: 'clear', costUsd: 0, score: 10, ...extra
})
const shot = (startS: number, endS: number, extra: Partial<Shot> = {}): Shot => ({ startS, endS, shows: 'soldiers at a border post', kind: 'archive-film', text: 'none', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4, ...extra })

describe('needs: spoken words → search needs', () => {
  const beats: Beat[] = [
    { id: 'b1', text: 'In 1940 the Swiss army guarded the border.' },
    { id: 'b2', text: 'It was a quiet winter.' }
  ]
  it('reads the answer, keeps at most 4 queries and a person only when given', () => {
    const text = JSON.stringify({ needs: [{ b: 'b1', mode: 'literal', subject: 'Swiss army, border, 1940', era: '1940', need: 'Swiss soldiers at a border post', kinds: ['video'], queries: ['Swiss army border guard 1940 newsreel', 'Grenzbesetzung 1939 Soldaten', 'q3 aaa', 'q4 bbb', 'q5 ccc'] }, { b: 'b2', mode: 'none', subject: '', need: '', queries: [] }] })
    const n = parseNeeds(text, beats)
    expect(n[0]).toMatchObject({ beat: 'b1', mode: 'literal', era: '1940', kinds: ['video'] })
    expect(n[0]!.queries).toHaveLength(4)
    expect(n[0]!.person).toBeUndefined()
    expect(n[1]!.mode).toBe('none')
  })
  it('falls back to the beat’s own words when the answer is unreadable or a beat is missing', () => {
    const missing: string[] = []
    const n = parseNeeds('not json', beats, (id) => missing.push(id))
    expect(n.map((x) => x.mode)).toEqual(['illustrative', 'illustrative'])
    expect(missing).toEqual(['b1', 'b2'])
    expect(fallbackNeed(beats[0]!).queries[0]).toContain('Swiss army guarded')
  })
  it('asks Claude in batches of 24 with the beat before the batch as context, and survives a failing call', async () => {
    const many: Beat[] = Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, text: `sentence number ${i} about Paris` }))
    const prompts: string[] = []
    let n = 0
    const claude: AskClaude = { ask: async (req) => { prompts.push(req.prompt); if (n++ === 0) throw new Error('quota'); return { text: '{"needs":[]}' } } }
    const r = await planNeeds(many, claude, { topic: 'Paris' })
    expect(r.calls).toBe(2)
    expect(r.needs).toHaveLength(30)
    expect(prompts[1]).toContain('The beat just before this batch: sentence number 23')
    expect(r.failed).toBe(30)
  })
})

describe('the agent picker', () => {
  const items = [{ id: 'b1', spoken: 'Swiss soldiers at the border', candidates: [cand('a', 'Swiss soldiers 1940'), cand('b', 'Alpine meadow'), cand('c', 'Border post')] }]
  it('maps the chosen number to the candidate, with backups, and refuses an out-of-range number', () => {
    const p = parsePicks('{"picks":[{"item":"b1","pick":1,"backups":[3,1,9],"match":"literal","why":"shows the soldiers"}]}', items)[0]!
    expect(p.choice!.id).toBe('a')
    expect(p.backups.map((c) => c.id)).toEqual(['c'])
    expect(p.match).toBe('literal')
    expect(parsePicks('{"picks":[{"item":"b1","pick":7}]}', items)[0]!.choice).toBeNull()
    expect(parsePicks('{"picks":[{"item":"b1","pick":0,"match":"none"}]}', items)[0]).toMatchObject({ choice: null, match: 'none' })
    expect(parsePicks('garbage', items)[0]!.choice).toBeNull()
  })
  it('one call per 6 beats; a beat with no candidate costs no call; the sheets go as pictures', async () => {
    const six = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, spoken: `s${i}`, candidates: i === 7 ? [] : [cand(`c${i}`, `t${i}`)], sheet: i === 0 ? '/tmp/s0.jpg' : undefined }))
    const seen: Array<string[] | undefined> = []
    const claude: AskClaude = { ask: async (req) => ((seen.push(req.images), { text: JSON.stringify({ picks: six.map((x) => ({ item: x.id, pick: 1, match: 'literal', why: 'ok' })) }) })) }
    const r = await pickMedia(six, claude)
    expect(r.calls).toBe(2)
    expect(seen[0]).toEqual(['/tmp/s0.jpg'])
    expect(r.picks[0]!.choice!.id).toBe('c0')
    expect(r.picks[7]!.choice).toBeNull() // nothing found: a gap, not a guess
  })
})

describe('Gemini watching: shot log, filter, cost', () => {
  const answer = (shots: unknown[]) => JSON.stringify({ shots })
  const raw = (s: string, e: string, extra: Record<string, unknown> = {}) => ({ start: s, end: e, shows: 'a border post', kind: 'archive-film', text: 'none', logo: 'none', ai: false, edited: false, subtitles: false, quality: 4, ...extra })

  it('parses MM:SS.s, drops malformed rows and out-of-range times, and can read clip-relative times', () => {
    const t = answer([raw('01:10.5', '01:16'), raw('00:05', '00:09'), raw('01:20', '01:19'), raw('01:30', '01:35', { kind: 'unknown-kind' }), raw('01:40', '01:45', { quality: 9 })])
    expect(parseShotLog(t, { startS: 60, endS: 180 })).toEqual([expect.objectContaining({ startS: 70.5, endS: 76 })])
    expect(parseShotLog(answer([raw('00:10', '00:15')]), { startS: 60, endS: 180 }, { timesAreClipRelative: true })[0]).toMatchObject({ startS: 70, endS: 75 })
    expect(parseShotLog('nope', { startS: 0, endS: 10 })).toEqual([])
  })
  it('the code filter keeps real footage, little text, quality ≥ 3, ≥ 2.5 s, never AI, edited or subtitled', () => {
    const shots = [shot(0, 5), shot(5, 6), shot(10, 15, { kind: 'talking-head' }), shot(20, 25, { text: 'large' }), shot(30, 35, { quality: 2 }), shot(40, 45, { ai: true }), shot(50, 55, { edited: true }), shot(60, 65, { subtitles: true }), shot(70, 75, { text: 'small' })]
    expect(filterShots(shots).map((s) => s.startS)).toEqual([0, 70])
  })
  it('a kept shot becomes a fair-use candidate with its range, its logo corner and a human-review flag', () => {
    const [c] = shotsToCandidates({ id: 'vid1', title: 'Newsreel 1940', url: 'https://www.youtube.com/watch?v=vid1' }, [shot(70.5, 76, { logo: 'top-right' })])
    expect(c).toMatchObject({ provider: 'youtube-excerpt', id: 'vid1@70.5', excerpt: { startS: 70.5, endS: 76 }, logo: 'top-right', review: 'human-review', costUsd: 0 })
    expect(c!.licence.status).toBe('fair-use-excerpt')
  })
  it('prices from the reported usage; an unknown model is priced at the highest rate; the worst case is known before the call', () => {
    const usage = { promptTokenCount: 30_000, candidatesTokenCount: 2_000 }
    expect(watchCostUsd('gemini-3.1-flash-lite', usage)).toBeCloseTo((30_000 * 0.25 + 2_000 * 1.5) / 1e6, 8)
    expect(watchCostUsd('gemini-mystery', usage)).toBeCloseTo((30_000 * 0.75 + 2_000 * 3.75) / 1e6, 8)
    expect(watchMaxCostUsd('gemini-3.1-flash-lite', 480)).toBeLessThan(0.03)
    expect(watchMaxCostUsd('gemini-3.1-flash-lite', 480)).toBeGreaterThan(watchCostUsd('gemini-3.1-flash-lite', { promptTokenCount: 480 * 100, candidatesTokenCount: 1500 }))
  })
  it('calls generateContent with the key in a header, the range as offsets, low resolution and a capped answer; reports cost and time', async () => {
    let body = {} as GenerateBody
    let headers: Record<string, string> = {}
    const { fetch, calls } = routedFetch([['generativelanguage.googleapis.com', (_u, init) => { body = JSON.parse(String(init?.body)) as GenerateBody; headers = init?.headers as Record<string, string>; return jsonResponse({ candidates: [{ content: { parts: [{ text: answer([raw('01:10', '01:16')]) }] } }], usageMetadata: { promptTokenCount: 24_000, candidatesTokenCount: 300 } }) }]])
    const r = await geminiWatch({ url: 'https://www.youtube.com/watch?v=abc', startS: 60, endS: 120, focus: 'Swiss soldiers' }, { apiKey: 'KEY-SECRET-123', fetch })
    expect(calls[0]!.url).not.toContain('KEY-SECRET-123')
    expect(headers['x-goog-api-key']).toBe('KEY-SECRET-123')
    expect(body.contents[0]!.parts[0]!).toEqual({ fileData: { fileUri: 'https://www.youtube.com/watch?v=abc' }, videoMetadata: { startOffset: '60s', endOffset: '120s' } })
    expect(body.generationConfig).toMatchObject({ mediaResolution: 'MEDIA_RESOLUTION_LOW', maxOutputTokens: WATCH_MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' })
    expect(body.contents[0]!.parts[1]!.text).toContain('Swiss soldiers')
    expect(r).toMatchObject({ rangeStartS: 60, rangeEndS: 120, shots: [expect.objectContaining({ startS: 70, endS: 76 })] })
    expect(r.costUsd).toBeCloseTo((24_000 * 0.25 + 300 * 1.5) / 1e6, 8)
  })
  it('cuts a range longer than 8 minutes, retries nothing itself, masks the key in errors and marks 429 retryable', async () => {
    let body = {} as GenerateBody
    const ok = routedFetch([['googleapis', (_u, init) => ((body = JSON.parse(String(init?.body)) as GenerateBody), jsonResponse({ candidates: [{ content: { parts: [{ text: answer([]) }] } }] }))]])
    await geminiWatch({ url: 'https://youtu.be/abc', startS: 0, endS: 3000 }, { apiKey: 'K', fetch: ok.fetch })
    expect(body.contents[0]!.parts[0]!.videoMetadata!.endOffset).toBe('480s')
    const bad = routedFetch([['googleapis', () => new Response('quota for key KEY-SECRET-123 exceeded', { status: 429 })]])
    await expect(geminiWatch({ url: 'https://youtu.be/abc', endS: 60 }, { apiKey: 'KEY-SECRET-123', fetch: bad.fetch })).rejects.toMatchObject({ retryable: true, message: expect.not.stringContaining('KEY-SECRET-123') })
  })
})

describe('cutting: scene-cut snapping', () => {
  it('downloads the shot ± 1.2 s', () => {
    expect(downloadWindow(70, 76)).toEqual({ startS: 68.8, endS: 77.2 })
    expect(downloadWindow(0.5, 6).startS).toBe(0)
  })
  it('a clean shot is kept as it is', () => {
    expect(planCut({ shotStartS: 70, shotEndS: 76, cuts: [] })).toMatchObject({ startS: 70, endS: 76, durationS: 6, speed: 1 })
  })
  it('cuts that fall inside the margin are not inside the shot: the clip stops before the next shot', () => {
    // the log said 70–76, the real shot ends at 75.2 (a cut there): the clip must not show the next shot
    const p = planCut({ shotStartS: 70, shotEndS: 76, cuts: [75.2] })!
    expect(p.endS).toBeLessThanOrEqual(75.2)
    expect(p.startS).toBeCloseTo(70, 1)
  })
  it('a cut inside the claimed shot: the longest cut-free run that overlaps it wins; too short everywhere = no clip', () => {
    const p = planCut({ shotStartS: 70, shotEndS: 80, cuts: [72] })!
    expect(p.startS).toBeGreaterThan(72)
    expect(p.durationS).toBe(CUT_MAX_S)
    expect(planCut({ shotStartS: 70, shotEndS: 73, cuts: [71, 72] })).toBeNull()
  })
  it('caps the length at 7 s, and a clip under 4 s is played at 0.89× (so it lasts longer)', () => {
    expect(planCut({ shotStartS: 10, shotEndS: 30, cuts: [] })!.durationS).toBe(CUT_MAX_S)
    const short = planCut({ shotStartS: 10, shotEndS: 13, cuts: [] })!
    expect(short).toMatchObject({ durationS: 3, speed: 0.89 })
    expect(short.outputS).toBeCloseTo(3 / 0.89, 1)
  })
  it('crops to 16:9 and zooms away from a flagged corner logo, never past 1.45×', () => {
    expect(cropFor(1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(cropFor(1280, 960)).toMatchObject({ w: 1280, h: 720, y: 120 })
    const c = cropFor(1920, 1080, 'top-right')
    expect(1920 / c.w).toBeLessThanOrEqual(1.45)
    // a logo in the top-right corner: the crop keeps the left edge and the bottom edge, so the corner leaves the frame
    expect(c.x).toBe(0)
    expect(c.y + c.h).toBe(1080)
    expect(c.y).toBeGreaterThan(0)
  })
  it('builds the ffmpeg arguments: seek, length, crop, scale, 30 fps, slow-down, no audio', () => {
    const a = cutArgs('in.mp4', { startS: 1, endS: 4, durationS: 3, speed: 0.89, outputS: 3.37 }, 'out.mp4', { srcW: 1920, srcH: 1080 }).join(' ')
    expect(a).toContain('-ss 1 -t 3 -i in.mp4 -an')
    expect(a).toContain('scale=1920:1080')
    expect(a).toContain('setpts=PTS/0.89')
    expect(a).toContain('fps=30')
  })
})

describe('contact sheets, verification, similarity', () => {
  it('a sheet numbers each tile, scales it into its cell and stacks them in a grid', () => {
    const a = sheetArgs(['a.jpg', 'b.jpg', 'c.jpg'], 'out.jpg', { cols: 2, cellW: 100, cellH: 50, platform: 'win32' }).join(' ')
    expect(a).toContain('xstack=inputs=3:layout=0_0|100_0|0_50')
    expect(a).toContain("text='1'")
    expect(a).toContain('C\\:/Windows/Fonts/arial.ttf')
    expect(sheetArgs(['a.jpg'], 'o.jpg').join(' ')).toContain('[t0]null[v]')
  })
  it('an unreadable or partial verdict never keeps a clip', () => {
    const clips = [{ id: 'c1', need: 'x' }, { id: 'c2', need: 'y' }]
    const v = parseVerdicts('{"verdicts":[{"clip":"c1","verdict":"keep","problem":"logo","note":"fine"}]}', clips)
    expect(v[0]).toMatchObject({ verdict: 'keep', problem: 'none' })
    expect(v[1]).toMatchObject({ verdict: 'drop' })
    expect(parseVerdicts('###', clips).every((x) => x.verdict === 'drop')).toBe(true)
    expect(parseVerdicts('{"verdicts":[{"clip":"c1","verdict":"replace","problem":"era","note":"1990s cars"}]}', clips)[0]).toMatchObject({ verdict: 'replace', problem: 'era' })
  })
  it('ranks previews by likeness to a reference frame; an unreadable one is left out', async () => {
    const gradient = (flip: boolean, tint: number): Uint8Array => { const p = new Uint8Array(9 * 8 * 3); for (let i = 0; i < 9 * 8; i++) { const v = (flip ? 8 - (i % 9) : i % 9) * 28; p[i * 3] = Math.min(255, v + tint); p[i * 3 + 1] = v; p[i * 3 + 2] = v } return p }
    const files: Record<string, Uint8Array> = { ref: gradient(false, 0), same: gradient(false, 5), flipped: gradient(true, 0), tinted: gradient(false, 90) }
    const read: PixelReader = async (f, w, h) => { const p = files[f]; if (!p) throw new Error('unreadable'); const out = new Uint8Array(w * h * 3); for (let i = 0; i < out.length; i++) out[i] = p[i % p.length]!; return out }
    const r = await rankBySimilarity('ref', [{ id: 'flipped', file: 'flipped' }, { id: 'same', file: 'same' }, { id: 'tinted', file: 'tinted' }, { id: 'broken', file: 'nope' }], read)
    expect(r.map((x) => x.id)).toEqual(['same', 'tinted', 'flipped'])
    expect(r[0]!.score).toBeGreaterThan(0.95)
    const s = await signatureOf('ref', read)
    expect(similarity(s, s)).toBe(1)
  })
})

describe('the cost ledger', () => {
  it('a film gets a budget from its length: 16 searches, 14 watches, 0.5 $ per minute', () => {
    expect(footageBudget(2)).toEqual({ searches: 32, watches: 28, costUsd: 1 })
  })
  it('refuses a search, a watch or a cost past its limit, BEFORE the call', () => {
    const l = new CostLedger({ searches: 2, watches: 2, costUsd: 0.05 })
    l.countSearch()
    l.countSearch()
    expect(() => l.countSearch()).toThrow(BudgetExceeded)
    l.reserveWatch(0.02)
    l.record('w1', 0.02)
    expect(() => l.reserveWatch(0.04)).toThrow(/cost/)
    l.reserveWatch(0.03)
    expect(() => l.reserveWatch(0.001)).toThrow(/watches/)
    expect(l.summary()).toMatchObject({ searches: 2, watches: 2, totalUsd: 0.02 })
  })
})

// ---- the whole chain on fakes ---------------------------------------------------------------------------------------------------------------

describe('sourceFootage end to end (fakes)', () => {
  const beats: Beat[] = [
    { id: 'b1', text: 'In 1940 Swiss soldiers guarded the border.' },
    { id: 'b2', text: 'The crowd outside the exchange panicked in 1929.' },
    { id: 'b3', text: 'Nobody had a word for it.' },
    { id: 'b4', text: 'A quiet transition about nothing in particular.' }
  ]
  const needsAnswer = JSON.stringify({
    needs: [
      { b: 'b1', mode: 'literal', subject: 'Swiss border 1940', era: '1940', need: 'Swiss soldiers at a border post', kinds: ['video'], queries: ['Swiss army border 1940 newsreel', 'Grenzbesetzung 1939'] },
      { b: 'b2', mode: 'literal', subject: 'Wall Street crash 1929', era: '1929', need: 'crowd outside the New York Stock Exchange', kinds: ['image', 'video'], queries: ['Wall Street crash 1929 crowd'] },
      { b: 'b3', mode: 'illustrative', subject: 'silence', need: 'an empty trading floor', kinds: ['image'], queries: ['empty trading floor archive'] },
      { b: 'b4', mode: 'none', subject: '', need: '', queries: [] }
    ]
  })
  const table: Record<string, MediaCandidate[]> = {
    'Swiss army border 1940 newsreel': [cand('yt1', 'Swiss army mobilisation 1940 newsreel', { provider: 'youtube-excerpt', pageUrl: 'https://www.youtube.com/watch?v=yt1', durationS: 200, review: 'human-review' })],
    'Grenzbesetzung 1939': [],
    'Wall Street crash 1929 crowd': [cand('wm1', 'Crowds outside the New York Stock Exchange, Wall Street crash 1929', { provider: 'wikimedia', kind: 'image', fileUrl: 'https://fake.test/c.jpg' })],
    'empty trading floor archive': []
  }
  const searchFake = (_calls: string[]) => async (query: string): Promise<MediaSearchResult> => ({ candidates: table[query] ?? [], errors: [], skipped: [], asked: ['fake'], costUsd: 0, droppedForbidden: 0, timingsMs: {} })

  const harness = (o: { verdict?: 'keep' | 'replace'; ledger?: CostLedger } = {}) => {
    const dir = work()
    const roles: string[] = []
    const claude: AskClaude = {
      ask: async (req) => {
        roles.push(req.role)
        if (req.role === 'media-needs') return { text: needsAnswer }
        if (req.role === 'media-picker') {
          const picks = [...req.prompt.matchAll(/ITEM (\S+)\n/g)].map((m) => m[1]!).map((id) => {
            const block = req.prompt.split(`ITEM ${id}\n`)[1]!.split('\n\nITEM')[0]!
            const lines = block.split('\n').filter((l) => /^\d+\. /.test(l))
            return { item: id, pick: lines.length ? 1 : 0, backups: lines.length > 1 ? [2] : [], match: lines.length ? 'literal' : 'none', why: 'best fit' }
          })
          return { text: JSON.stringify({ picks }) }
        }
        return { text: JSON.stringify({ verdicts: [{ clip: 'b1', verdict: o.verdict ?? 'keep', problem: o.verdict === 'replace' ? 'era' : 'none', note: 'x' }] }) }
      }
    }
    const searched: string[] = []
    const { run, calls } = fakeRun((args) => (args.includes('stream=width,height') ? '1280,720\n' : ''))
    const rawRun: typeof run = async (cmd, args, opts) => {
      if (cmd === 'ffmpeg' && args.join(' ').includes("select='gt(scene")) { calls.push(args); return { stdout: '', stderr: 'pts_time:3.1 pts_time:5.0' } }
      if (cmd === 'ffprobe') { calls.push(args); return { stdout: '1280,720\n', stderr: '' } }
      if (cmd === 'ffmpeg') { calls.push(args); return { stdout: '', stderr: '' } }
      return run(cmd, args, opts)
    }
    const watchCalls: Array<{ url: string; focus?: string }> = []
    const watch = async (input: { url: string; startS?: number; endS: number; focus?: string }) => {
      watchCalls.push(input)
      return { shots: [shot(70, 76, { shows: 'Swiss soldiers at a border post' }), shot(80, 82), shot(90, 96, { text: 'large' })], model: 'gemini-3.1-flash-lite', costUsd: 0.004, ms: 9000, usage: undefined, rangeStartS: 0, rangeEndS: input.endS }
    }
    const download = async (_url: string, range: { startS: number; endS: number }, outDir: string) => ({ file: path.join(outDir, 'dl.mp4'), range })
    const ledger = o.ledger ?? new CostLedger(footageBudget(0.5))
    return { dir, roles, calls, watchCalls, ledger, searched, run: rawRun, claude, watch, download, search: searchFake(searched) as never }
  }

  it('beats → needs → search → watch → filter → pick → cut → verify, with gaps and costs accounted', async () => {
    const h = harness()
    const r = await sourceFootage(beats, { claude: h.claude, searchDeps: { providers: [] }, run: h.run, workDir: h.dir, ledger: h.ledger, watch: h.watch, download: h.download as never, search: ((q: string) => (h.searched.push(q), table[q] ? Promise.resolve({ candidates: table[q], errors: [], skipped: [], asked: [], costUsd: 0, droppedForbidden: 0, timingsMs: {} }) : Promise.resolve({ candidates: [], errors: [], skipped: [], asked: [], costUsd: 0, droppedForbidden: 0, timingsMs: {} }))) as never }, { filmMinutes: 0.5 } as never)
    const by = Object.fromEntries(r.results.map((x) => [x.beat.id, x]))
    // b1: the YouTube video was watched, only its good shot (70–76) survived the filter, was picked, downloaded with its margin, snapped, cut, verified
    expect(h.watchCalls).toHaveLength(1)
    expect(h.watchCalls[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=yt1', focus: 'Swiss soldiers at a border post' })
    expect(by.b1!.pick!.choice!.id).toBe('yt1@70')
    expect(by.b1!.clip).toBeDefined()
    expect(by.b1!.clip!.verdict).toMatchObject({ verdict: 'keep' })
    expect(by.b1!.clip!.plan.durationS).toBeGreaterThanOrEqual(2.2)
    expect(by.b1!.gap).toBe(false)
    // b2: an archive photo, nothing to cut
    expect(by.b2!.pick!.choice!.provider).toBe('wikimedia')
    expect(by.b2!.clip).toBeUndefined()
    // b3: nothing found → a GAP (the only thing that would be generated); b4: no need at all
    expect(by.b3!.gap).toBe(true)
    expect(by.b4!.need.mode).toBe('none')
    expect(by.b4!.gap).toBe(false)
    // the money: one watch, 0.004 $, inside the budget; Claude calls counted
    expect(r.summary.watches).toBe(1)
    expect(r.summary.totalUsd).toBeCloseTo(0.004, 6)
    expect(r.summary.totalUsd).toBeLessThanOrEqual(r.summary.budget.costUsd)
    expect(r.calls).toMatchObject({ claudeNeeds: 1, claudePicks: 1, claudeVerify: 1, geminiWatches: 1 })
    expect(h.searched).toEqual(['Swiss army border 1940 newsreel', 'Grenzbesetzung 1939', 'Wall Street crash 1929 crowd', 'empty trading floor archive'])
  })

  it('a clip the checker rejects is a gap when no other candidate exists, and the watch budget stops further watching', async () => {
    const h = harness({ verdict: 'replace' })
    const tight = new CostLedger({ searches: 2, watches: 0, costUsd: 0.5 })
    const r = await sourceFootage(beats.slice(0, 2), { claude: h.claude, searchDeps: { providers: [] }, run: h.run, workDir: h.dir, ledger: tight, watch: h.watch, download: h.download as never, search: ((q: string) => Promise.resolve({ candidates: table[q] ?? [], errors: [], skipped: [], asked: [], costUsd: 0, droppedForbidden: 0, timingsMs: {} })) as never }, {})
    expect(h.watchCalls).toHaveLength(0) // 0 watches allowed: never called
    const b1 = r.results[0]!
    expect(b1.notes.some((n) => /watch skipped|search budget/.test(n))).toBe(true)
    expect(r.summary.watches).toBe(0)
    expect(r.summary.totalUsd).toBe(0)
    // the second beat's query ran out of searches (limit 2: b1 used both queries)
    expect(r.results[1]!.notes.join(' ')).toMatch(/search budget/)
  })

  it('a bad verdict falls through to the next candidate once, then to a gap', async () => {
    const h = harness({ verdict: 'replace' })
    table['Swiss army border 1940 newsreel'] = [cand('yt1', 'Swiss army mobilisation 1940 newsreel', { provider: 'youtube-excerpt', pageUrl: 'https://www.youtube.com/watch?v=yt1', durationS: 200, review: 'human-review' })]
    const r = await sourceFootage(beats.slice(0, 1), { claude: h.claude, searchDeps: { providers: [] }, run: h.run, workDir: h.dir, ledger: h.ledger, watch: h.watch, download: h.download as never, search: ((q: string) => Promise.resolve({ candidates: table[q] ?? [], errors: [], skipped: [], asked: [], costUsd: 0, droppedForbidden: 0, timingsMs: {} })) as never }, {})
    expect(r.results[0]!.clip).toBeUndefined()
    expect(r.results[0]!.gap).toBe(true)
    expect(r.results[0]!.notes.some((n) => n.includes('replace (era)'))).toBe(true)
  })
})
