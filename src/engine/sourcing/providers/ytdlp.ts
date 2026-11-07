// Short excerpts of public web and YouTube videos with yt-dlp: search, pick a time range, download ONLY that range.
// READ-ONLY by construction: the argument builders below never log in, never pass cookies, never upload, comment or call a
// write endpoint (tests/unit/sourcing.test.ts checks every argument list). yt-dlp only reads public pages.
//
// Legal stance: a clip on YouTube is the uploader's work. Unless the video carries the Creative Commons licence the uploader chose
// (yt-dlp's `license` field: « Creative Commons Attribution license (reuse allowed) »), a candidate is a `fair-use-excerpt` with
// review `human-review`: it is a short quotation for commentary, to be looked at by a person before the video is published, and
// never an automatic clearance. Excerpts are capped (default 45 s, hard 120 s).
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { FAIR_USE_LICENCE, licenceFromLink } from '../legal.ts'
import type { MediaCandidate, MediaLicence, ProviderCtx, RunFn, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, num, rec, str } from './common.ts'

export const MAX_EXCERPT_S = 120
export const DEFAULT_EXCERPT_S = 45

/** The default runner: spawn without a shell, collect output, kill on timeout or abort. */
export const spawnRun: RunFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 120_000)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`))
    })
  })

/** Arguments every call shares: no config files, no cookies, no playlists, quiet. */
const BASE = ['--ignore-config', '--no-warnings', '--no-playlist', '--no-cookies-from-browser', '--socket-timeout', '20']

export const searchArgs = (query: string, n: number): string[] => [...BASE, '--flat-playlist', '--dump-json', `ytsearch${Math.min(Math.max(n, 1), 15)}:${query}`]
// The link always comes after `--`: a « link » starting with `-` (an agent's input, a scraped page) is never read as an
// option such as `--exec` (decision 0076).
export const probeArgs = (url: string): string[] => [...BASE, '--skip-download', '--dump-single-json', '--', url]

/** « 75 » → « 1:15 »; yt-dlp reads H:MM:SS. */
const stamp = (s: number): string => {
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface ExcerptRange {
  startS: number
  endS: number
}

export function clampRange(r: ExcerptRange, durationS?: number): ExcerptRange {
  const startS = Math.max(0, Math.min(r.startS, durationS ? Math.max(durationS - 1, 0) : r.startS))
  let endS = Math.max(r.endS, startS + 1)
  endS = Math.min(endS, startS + MAX_EXCERPT_S, durationS && durationS > startS ? durationS : endS)
  return { startS, endS }
}

export const excerptArgs = (url: string, r: ExcerptRange, outDir: string, maxHeight = 720): string[] => [
  ...BASE,
  '--download-sections',
  `*${stamp(r.startS)}-${stamp(r.endS)}`,
  '--force-keyframes-at-cuts',
  '-f',
  `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`,
  '--merge-output-format',
  'mp4',
  '--max-filesize',
  '400M',
  '-o',
  path.join(outDir, '%(id)s_%(section_start)s.%(ext)s'),
  '--print',
  'after_move:filepath',
  '--',
  url
]

/** The Creative Commons licence yt-dlp reports for a YouTube video, as a sourcing licence, or the fair-use default. */
export function licenceOfVideo(license: unknown): { licence: MediaLicence; review: boolean } {
  const l = str(license)
  if (/creative commons attribution/i.test(l)) {
    return { licence: licenceFromLink('https://creativecommons.org/licenses/by/3.0/') ?? FAIR_USE_LICENCE, review: false }
  }
  return { licence: FAIR_USE_LICENCE, review: true }
}

export interface VideoProbe {
  id: string
  title: string
  durationS: number
  licence: MediaLicence
  review: boolean
}

export async function probeVideo(url: string, ctx: Pick<ProviderCtx, 'run' | 'signal'>): Promise<VideoProbe> {
  if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) links can be probed')
  const run = ctx.run ?? spawnRun
  const { stdout } = await run('yt-dlp', probeArgs(url), { signal: ctx.signal, timeoutMs: 60_000 })
  const j = rec(JSON.parse(stdout))
  return { id: str(j.id), title: str(j.title), durationS: num(j.duration), ...licenceOfVideo(j.license) }
}

/** Downloads only the asked range of a public video. Returns the cut file. Never writes anywhere but `outDir`. */
export async function downloadExcerpt(url: string, range: ExcerptRange, outDir: string, ctx: Pick<ProviderCtx, 'run' | 'signal'> = {}): Promise<{ file: string; range: ExcerptRange }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) links can be excerpted')
  const r = clampRange(range)
  await mkdir(outDir, { recursive: true })
  const run = ctx.run ?? spawnRun
  const { stdout } = await run('yt-dlp', excerptArgs(url, r, outDir), { signal: ctx.signal, timeoutMs: 15 * 60_000 })
  const file = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1)
  if (!file) throw new Error('yt-dlp printed no file name')
  return { file, range: r }
}

/**
 * YouTube search as a provider: titles, channels, durations and a thumbnail, no licence probe (one yt-dlp call per video is slow):
 * every result is a fair-use excerpt awaiting human review, with a default window at the start of the video.
 */
export const youtubeExcerpts: SourcingProvider = {
  id: 'youtube-excerpt',
  label: 'YouTube (public excerpt)',
  kinds: ['video'],
  optIn: true,
  async search(q: SourceQuery, ctx: ProviderCtx): Promise<MediaCandidate[]> {
    const run = ctx.run ?? spawnRun
    const { stdout } = await run('yt-dlp', searchArgs(q.query, Math.max(q.want, 5)), { signal: ctx.signal, timeoutMs: 60_000 })
    const rows = stdout.split(/\r?\n/).filter(Boolean).map((l) => rec(JSON.parse(l)))
    const out: MediaCandidate[] = []
    rows.forEach((r, i) => {
      const id = str(r.id)
      const duration = num(r.duration)
      if (!id || (q.minDurationS !== undefined && duration && duration < q.minDurationS)) return
      const thumbs = arr(r.thumbnails).map((t) => str(rec(t).url)).filter(Boolean)
      const range = clampRange({ startS: 0, endS: DEFAULT_EXCERPT_S }, duration || undefined)
      out.push(
        candidate({
          provider: 'youtube-excerpt', label: 'YouTube (public excerpt)', id, kind: 'video', title: str(r.title), description: str(r.description),
          creator: str(r.channel) || str(r.uploader) || undefined, pageUrl: `https://www.youtube.com/watch?v=${id}`, previewUrl: thumbs.at(-1) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          fileUrl: `https://www.youtube.com/watch?v=${id}`, durationS: duration || undefined, licence: FAIR_USE_LICENCE, review: 'human-review',
          reviewReason: 'fair-use excerpt of someone else’s video: a person must check it before publishing', rank: i, total: rows.length, excerpt: range
        })
      )
    })
    return out
  }
}
