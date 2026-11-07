// Fills the sound-effects library (resources/sfx/) with REAL recordings: searches, downloads, checks, cuts and stores them, then writes
// library.json, CREDITS.md, and a listening report (one WAV per kind that plays all its sounds) outside git.
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning --import ./scripts/ts-resolve.mjs \
//        scripts/sfx-library-fetch.ts [--source keyless|freesound|both] [--per-kind 6] [--cache <dir>] [--report <dir>]
// Sources: Freesound (FREESOUND_API_KEY from the environment only; CC0 and CC BY, hq mp3 previews), and keyless ones: the Internet
// Archive's CC0 sound-effect collections (The Designer's Choice UCS packs by Nicholas A. Judy; the USC Cinema / Sunset Editorial
// archive) and Wikimedia Commons (Gravity Sound, CC BY 4.0). Each licence is read from the source at run time; anything other than
// CC0, public domain or CC BY (NC, ND, SA, Sampling+, unknown) is refused. Downloads are cached, so a rerun only redoes the cutting.
// Free: no paid call. Exit 1 when a kind ends with fewer than 4 sounds or the folder passes 4 MB.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describeSfx, findSoundEvents, rmsEnvelope, sfxKindFit } from '../src/engine/media/sfx-analysis'
import { SFX_KINDS, SFX_RATE, SfxLibraryFile, type SfxKind, type SfxLibrarySound } from '../src/engine/media/sfx'
import { writeWav } from '../src/engine/media/wav'
import { freesound } from '../src/engine/sourcing/providers/audio-keyed'

type Licence = SfxLibrarySound['licence']
const execFileP = promisify(execFile)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SFX_DIR = path.join(ROOT, 'resources', 'sfx')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const say = (s: string): void => void process.stdout.write(s + '\n')
const INPUTS = path.join(process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs'), 'tests-2026-11', 'motion')
const CACHE = path.resolve(arg('cache', path.join(INPUTS, 'sfx-cache')))
const REPORT = path.resolve(arg('report', path.join(INPUTS, 'sfx-library')))
const PER_KIND = Number(arg('per-kind', '6'))
const SOURCE = arg('source', 'both') as 'keyless' | 'freesound' | 'both'
const MAX_PER_FILE = 2
const BUDGET_BYTES = 4 * 1024 * 1024
const UA = 'AtelierSfxFetch/1.0 (sound-effects library builder; https://github.com/CharlieJourdan/atelier-core)'

interface Candidate {
  provider: 'archive' | 'commons' | 'freesound'
  via: string
  kinds: SfxKind[]
  url: string
  page: string
  title: string
  author: string
  licence: Licence
  reverse?: boolean
}

// ---------------------------------------------------------------------------------------------------------------------
// What to look for (each source is searched with these patterns; the cut sounds are then measured, so a wrong guess is refused)

const TDC = 'Designers-Choice-Collection-'
const RED_FOLEY = [1, 2, 3, 4, 5].map((n) => `Red_Library_Foley_Props_${n}`)
interface Plan {
  where: string
  kinds: SfxKind[]
  match: RegExp
  reverse?: boolean
  max?: number
}
const ARCHIVE_PLAN: Plan[] = [
  { where: `${TDC}Swooshes`, kinds: ['whoosh', 'whoosh-soft'], match: /WHSH-|SWSH-.*(Stick, Small|Swishes, Big, Low|Medium Low|Cloth, Swoosh)/ },
  { where: `${TDC}Designed`, kinds: ['whoosh', 'whoosh-soft', 'riser'], match: /DSGNWhsh-/ },
  { where: `${TDC}Cartoon`, kinds: ['whoosh', 'whoosh-soft'], match: /TOONSwsh-CU_Windy Swooshes/ },
  { where: 'SSE_Library_SWOOSHES', kinds: ['whoosh', 'whoosh-soft'], match: /SWSH_Processed swishes|WHSH-FIREWORKS/ },
  { where: 'Red_Library_Foley_Props_3', kinds: ['whoosh', 'whoosh-soft'], match: /Tarp Whoosh/ },
  { where: `${TDC}Objects`, kinds: ['paper'], match: /OBJBook-.*(Page, Turn|Page Flip)/ },
  { where: `${TDC}Paper`, kinds: ['paper', 'stamp'], match: /PAPRHndl-.*(Page Flip|Crumple)|PAPRRip-.*(Card_|Paper 0\d|Paper 01|Long_|Paper, Slow)|PAPRImpt-/ },
  ...RED_FOLEY.map((where) => ({ where, kinds: ['paper'] as SfxKind[], match: /Magazine Pages|Paper/i, max: 4 })),
  { where: `${TDC}Computers`, kinds: ['click', 'tick'], match: /CMPTKey-.*(Buttons Being Pressed|Enter|Space Bar|Caps Lock)/ },
  { where: `${TDC}Objects`, kinds: ['click', 'stamp'], match: /Pen, Top|Cap Top Open|Button, Snap|Pocket Knife, Flip Open|Comic Book, Drop to Floor|Set Down on Desk|Three Hole Paper Punch/ },
  { where: `${TDC}Clocks`, kinds: ['tick', 'click'], match: /CLOCKTick-|Cooking Timer, Ticking|Stopwatch/ },
  { where: 'SSE_Library_CLOCKS', kinds: ['tick', 'click'], match: /tick|clock/i, max: 4 },
  { where: `${TDC}Cartoon`, kinds: ['tick', 'click', 'pop'], match: /Mouth Click, Simulated Clock, Cartoon_|TOONPop-/ },
  { where: `${TDC}Musical`, kinds: ['tick'], match: /Agogo Bells, Muted, Clock Ticking/ },
  { where: 'designers-choice-collection-food-drink', kinds: ['pop'], match: /Cork, Pop|Champagne Cork Pops/ },
  { where: `${TDC}Objects`, kinds: ['pop'], match: /Spray Can, Pop Open/ },
  { where: `${TDC}Toys`, kinds: ['pop', 'click'], match: /Fidget Popper|Poppitoppy|Jack In The Box, Pop Open/ },
  { where: 'SSE_Library_CARTOON', kinds: ['pop'], match: /pop/i, max: 4 },
  ...RED_FOLEY.map((where) => ({ where, kinds: ['pop'] as SfxKind[], match: /Popping Balloons|Pull Corks/, max: 4 })),
  ...RED_FOLEY.map((where) => ({ where, kinds: ['stamp'] as SfxKind[], match: /Bang on Wooden Table|Wood Object Put onto|Small Wood Drawer Close/, max: 4 })),
  { where: 'Red_Library_Impacts', kinds: ['impact', 'stamp'], match: /./, max: 14 },
  { where: `${TDC}Musical`, kinds: ['impact'], match: /Big Timpani Impact|Bongo, Large, Hit/ },
  { where: 'Red_Library_Fights', kinds: ['impact'], match: /Punches/, max: 4 },
  { where: `${TDC}Games`, kinds: ['stamp'], match: /Card, Hit on Desk|Deck of Cards, Thump/ },
  { where: 'designers-choice-collection-foley_202508', kinds: ['stamp'], match: /Game Case, (Fall|Set Down)/ },
  // risers: a cymbal roll, a crash or a hit played backwards swells into its attack (the classic recorded riser)
  { where: `${TDC}Musical`, kinds: ['riser'], match: /Cymbal, Rolls, Stinger|Thunder Tube, (Crash_|Double Crash)|Hand Cymbal, Choke|Piano Hit|Big Timpani Impact/, reverse: true },
  { where: 'Red_Library_Impacts', kinds: ['riser'], match: /./, reverse: true, max: 14 },
  // a cymbal roll swells into its stinger as recorded
  { where: `${TDC}Musical`, kinds: ['riser'], match: /Cymbal, Rolls, Stinger/ },
  { where: `${TDC}Cartoon`, kinds: ['riser'], match: /Rise Up/ }
]
const GRAVITY = 'Audio_files_by_Gravity_Sound'
const COMMONS_PLAN: Plan[] = [
  { where: GRAVITY, kinds: ['whoosh', 'whoosh-soft'], match: /Swipe/, max: 14 },
  { where: GRAVITY, kinds: ['impact', 'stamp'], match: /Deep hit|Crash hit|Hollow hit \d|Hard Punch|File:Punch|File:Hit \d|Slam 1/, max: 14 },
  { where: GRAVITY, kinds: ['stamp', 'click', 'tick'], match: /Smack stick once|Knock on bin \d|Dropping item \d|Drop Item/, max: 12 },
  { where: GRAVITY, kinds: ['click', 'tick'], match: /Clicking/ },
  { where: GRAVITY, kinds: ['riser'], match: /Crash hit|Deep hit|Sign hit|Hollow tree hit/, reverse: true }
]
const FREESOUND_QUERIES: Record<SfxKind, string[]> = {
  whoosh: ['whoosh', 'swoosh fast', 'whoosh transition'],
  'whoosh-soft': ['soft whoosh', 'air swish gentle'],
  paper: ['page turn', 'paper flip'],
  click: ['mouse click', 'switch click'],
  tick: ['clock tick single', 'wood tick'],
  pop: ['cork pop', 'mouth pop'],
  impact: ['impact hit deep', 'cinematic hit'],
  stamp: ['rubber stamp', 'stamp paper desk'],
  riser: ['riser', 'reverse cymbal']
}

// ---------------------------------------------------------------------------------------------------------------------
// Licences (strict: anything not recognised is refused)

function licenceFromUrl(u: string): Licence | undefined {
  if (/publicdomain\/zero\//i.test(u)) return 'CC0-1.0'
  if (/publicdomain\/mark\//i.test(u)) return 'PD'
  const m = /creativecommons\.org\/licenses\/by\/(2\.0|2\.5|3\.0|4\.0)\/?/i.exec(u)
  return m ? (`CC-BY-${m[1]}` as Licence) : undefined
}
function licenceFromName(n: string): Licence | undefined {
  const s = n.trim()
  if (/^(CC0|CC0 1\.0|Creative Commons 0)$/i.test(s)) return 'CC0-1.0'
  if (/^public domain$/i.test(s)) return 'PD'
  const m = /^CC BY (2\.0|2\.5|3\.0|4\.0)$/i.exec(s)
  return m ? (`CC-BY-${m[1]}` as Licence) : undefined
}
const LICENCE_LABEL: Record<Licence, string> = { 'CC0-1.0': 'CC0 1.0', PD: 'Public domain', 'CC-BY-2.0': 'CC BY 2.0', 'CC-BY-2.5': 'CC BY 2.5', 'CC-BY-3.0': 'CC BY 3.0', 'CC-BY-4.0': 'CC BY 4.0' }
const LICENCE_LINK: Record<Licence, string> = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  PD: 'https://creativecommons.org/publicdomain/mark/1.0/',
  'CC-BY-2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC-BY-2.5': 'https://creativecommons.org/licenses/by/2.5/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/'
}

// ---------------------------------------------------------------------------------------------------------------------
// Network, with a cache

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16)
async function fetchRetry(url: string): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) })
      if (res.ok) return res
      if (i >= 2 || res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`)
    } catch (e) {
      if (i >= 2) throw e
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
  }
}
async function cachedJson(url: string): Promise<Record<string, unknown>> {
  const f = path.join(CACHE, 'meta', `${hash(url)}.json`)
  if (existsSync(f)) return JSON.parse(await readFile(f, 'utf8')) as Record<string, unknown>
  const j = (await (await fetchRetry(url)).json()) as Record<string, unknown>
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, JSON.stringify(j))
  return j
}
async function download(url: string): Promise<string> {
  const ext = (/\.(wav|flac|mp3|ogg|oga)(?:$|\?)/i.exec(url)?.[1] ?? 'bin').toLowerCase()
  const f = path.join(CACHE, 'files', `${hash(url)}.${ext}`)
  if (existsSync(f)) return f
  const buf = Buffer.from(await (await fetchRetry(url)).arrayBuffer())
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, buf)
  return f
}

// ---------------------------------------------------------------------------------------------------------------------
// Searching

const lengthOf = (v: unknown): number => {
  const s = String(v ?? '')
  if (s.includes(':')) return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
  return Number(s)
}
const plainText = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function archiveCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const p of ARCHIVE_PLAN) {
    let j: Record<string, unknown>
    try {
      j = await cachedJson(`https://archive.org/metadata/${p.where}`)
    } catch (e) {
      say(`  archive ${p.where}: ${(e as Error).message}`)
      continue
    }
    const meta = (j.metadata ?? {}) as Record<string, unknown>
    const licence = licenceFromUrl(String(meta.licenseurl ?? ''))
    if (!licence) {
      say(`  archive ${p.where}: licence ${String(meta.licenseurl ?? 'none')} refused`)
      continue
    }
    const usc = String(meta.collection ?? '').includes('usc-sound-effect-archive') || p.where.startsWith('SSE_') || p.where.startsWith('Red_')
    const author = usc ? 'Sunset Editorial / USC Cinematic Arts sound effects archive' : String(meta.creator ?? "The Designer's Choice")
    const files = ((j.files ?? []) as Record<string, unknown>[]).filter(
      (f) => f.source === 'original' && /\.(wav|flac|mp3|ogg)$/i.test(String(f.name)) && lengthOf(f.length) <= 30 && Number(f.size) <= 8e6 && p.match.test(String(f.name))
    )
    for (const f of files.slice(0, p.max ?? 10)) {
      const name = String(f.name)
      out.push({
        provider: 'archive', via: 'Internet Archive', kinds: p.kinds, licence, author, reverse: p.reverse,
        url: `https://archive.org/download/${p.where}/${name.split('/').map(encodeURIComponent).join('/')}`,
        page: `https://archive.org/details/${p.where}`, title: path.basename(name).replace(/\.\w+$/, '')
      })
    }
  }
  return out
}

async function commonsCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = []
  const listings = new Map<string, Record<string, unknown>[]>()
  for (const p of COMMONS_PLAN) {
    if (!listings.has(p.where)) {
      const pages: Record<string, unknown>[] = []
      let cont: Record<string, string> = {}
      for (let i = 0; i < 20; i++) {
        const u = new URL('https://commons.wikimedia.org/w/api.php')
        const q = { action: 'query', generator: 'categorymembers', gcmtitle: `Category:${p.where}`, gcmtype: 'file', gcmlimit: '200', prop: 'imageinfo', iiprop: 'url|size|extmetadata|metadata', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist', format: 'json', ...cont }
        for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
        const j = await cachedJson(u.toString())
        pages.push(...Object.values(((j.query ?? {}) as Record<string, unknown>).pages ?? {}).map((x) => x as Record<string, unknown>))
        if (!j.continue) break
        cont = j.continue as Record<string, string>
      }
      listings.set(p.where, pages)
    }
    const picked = (listings.get(p.where) ?? []).filter((pg) => p.match.test(String(pg.title))).slice(0, p.max ?? 10)
    for (const pg of picked) {
      const ii = ((pg.imageinfo ?? []) as Record<string, unknown>[])[0]
      if (!ii) continue
      const m = (ii.extmetadata ?? {}) as Record<string, { value?: string }>
      const licence = licenceFromName(m.LicenseShortName?.value ?? '') ?? licenceFromUrl(m.LicenseUrl?.value ?? '')
      const md = Object.fromEntries(((ii.metadata ?? []) as { name: string; value: unknown }[]).map((x) => [x.name, x.value]))
      if (!licence || lengthOf(md.length ?? md.playtime_seconds) > 30) continue
      out.push({
        provider: 'commons', via: 'Wikimedia Commons', kinds: p.kinds, licence, reverse: p.reverse, url: String(ii.url),
        page: String(ii.descriptionurl), title: String(pg.title).replace(/^File:/, '').replace(/\.\w+$/, ''), author: plainText(m.Artist?.value ?? '') || 'unknown'
      })
    }
  }
  return out
}

async function freesoundCandidates(key: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const kind of SFX_KINDS) {
    for (const query of FREESOUND_QUERIES[kind]) {
      const found = await freesound
        .search({ query, kind: 'sfx', want: 10, minDurationS: 0.05, maxDurationS: kind === 'riser' ? 8 : 4 }, { fetch, timeoutMs: 30_000, key })
        .catch((e: Error) => (say(`  freesound "${query}": ${e.message}`), []))
      for (const c of found) {
        const licence = licenceFromUrl(c.licence.url ?? '') ?? licenceFromName(c.licence.short)
        if (!licence) continue
        out.push({ provider: 'freesound', via: 'Freesound', kinds: [kind], licence, url: c.fileUrl, page: c.pageUrl, title: c.title, author: c.creator ?? 'unknown' })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Cutting

async function decode(file: string): Promise<Float32Array> {
  const { stdout } = await execFileP('ffmpeg', ['-v', 'error', '-t', '30', '-i', file, '-ac', '1', '-ar', String(SFX_RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 64 << 20 })
  const b = stdout as Buffer
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)))
}

const HIT_MAX_S: Partial<Record<SfxKind, number>> = { click: 0.25, tick: 0.3, pop: 0.5, stamp: 0.7, impact: 1.5, paper: 1.5 }
const FLOWING: SfxKind[] = ['whoosh', 'whoosh-soft']

/** One event of a recording cut for `kind`: from just before its onset to where it dies away (hits, paper), around its swell
 * (whooshes), or up to its peak (risers). Returns the cut, not yet normalised. */
function cutFor(kind: SfxKind, a: Float32Array, ev: { start: number; end: number }, reverse: boolean): Float32Array | undefined {
  let seg = a.slice(ev.start, ev.end)
  if (reverse) seg = seg.slice().reverse()
  const sr = SFX_RATE
  const env = rmsEnvelope(seg, sr)
  const hop = Math.round(sr * 0.005)
  let pk = 0
  for (let f = 0; f < env.length; f++) if ((env[f] as number) > (env[pk] as number)) pk = f
  const max = env[pk] ?? 0
  if (max <= 0) return undefined
  let s: number
  let e: number
  if (kind === 'riser') {
    e = Math.min(seg.length, (pk + 2) * hop)
    s = Math.max(0, e - Math.round(3 * sr))
    let q = Math.floor(s / hop)
    while (q < pk && (env[q] as number) < max * 0.003) q++ // skip the silence before it starts to climb
    s = Math.max(s, (q - 1) * hop)
  } else if (FLOWING.includes(kind)) {
    const cap = kind === 'whoosh' ? 1.1 : 1.4
    let a0 = pk
    while (a0 > 0 && (env[a0 - 1] as number) > max * 0.01) a0--
    let b0 = pk
    while (b0 < env.length - 1 && (env[b0 + 1] as number) > max * 0.006) b0++
    s = a0 * hop
    e = Math.min(seg.length, (b0 + 1) * hop)
    if ((e - s) / sr > cap) {
      s = Math.max(s, pk * hop - Math.round(cap * 0.6 * sr))
      e = Math.min(e, s + Math.round(cap * sr))
    }
  } else {
    let on = 0
    while (on < pk && (env[on] as number) < max * 0.0316) on++
    s = Math.max(0, on * hop - Math.round(0.003 * sr))
    let end = pk
    while (end < env.length - 1 && (env[end] as number) > max * 0.0056) end++ // -45 dB
    e = Math.min(seg.length, (end + 1) * hop, s + Math.round((HIT_MAX_S[kind] ?? 1.5) * sr))
  }
  return seg.slice(s, e)
}

/** Short fades, then the peak to -1 dBFS. */
function finish(a: Float32Array, kind: SfxKind): Float32Array {
  const sr = SFX_RATE
  const out = Float32Array.from(a)
  const fin = Math.min(out.length >> 3, Math.round((kind === 'riser' ? 0.15 : FLOWING.includes(kind) ? 0.01 : 0.002) * sr))
  const fout = Math.min(out.length >> 2, Math.round((kind === 'impact' || kind === 'riser' ? 0.06 : 0.025) * sr))
  for (let i = 0; i < fin; i++) out[i] = (out[i] as number) * (i / fin)
  for (let i = 0; i < fout; i++) out[out.length - 1 - i] = (out[out.length - 1 - i] as number) * (i / fout)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const g = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * g
  return out
}

/** The key moment: the attack of a hit, the loudest 30 ms of a whoosh or paper, the end of a riser. */
function keyMomentS(a: Float32Array, kind: SfxKind): number {
  const sr = SFX_RATE
  if (kind === 'riser') {
    const env = rmsEnvelope(a, sr)
    let pk = Math.floor(env.length * 0.7)
    for (let f = pk; f < env.length; f++) if ((env[f] as number) >= (env[pk] as number)) pk = f
    return Math.min(a.length / sr, pk * 0.005 + 0.005)
  }
  if (kind === 'whoosh' || kind === 'whoosh-soft' || kind === 'paper') {
    const env = rmsEnvelope(a, sr)
    let best = 0
    let bv = -1
    for (let f = 0; f + 6 <= env.length; f++) {
      let s = 0
      for (let k = 0; k < 6; k++) s += env[f + k] as number
      if (s > bv) [bv, best] = [s, f + 3]
    }
    return best * 0.005
  }
  let best = 0
  for (let i = 0; i < Math.min(a.length, Math.round(0.08 * sr)); i++) if (Math.abs(a[i] as number) > Math.abs(a[best] as number)) best = i
  return best / sr
}

// ---------------------------------------------------------------------------------------------------------------------
// The run

interface Cut {
  cand: Candidate
  /** The recording and the event in it: one event serves one kind only. */
  event: string
  kind: SfxKind
  samples: Float32Array
  score: number
  durationS: number
  centroidHz: number
  attackS: number
}

async function main(): Promise<void> {
  const key = process.env.FREESOUND_API_KEY?.trim()
  if (SOURCE === 'freesound' && !key) throw new Error('--source freesound needs FREESOUND_API_KEY in the environment')
  say(`sources: ${SOURCE}; Freesound key ${key ? 'present' : 'absent (keyless sources only)'}`)
  const cands: Candidate[] = []
  if (SOURCE !== 'freesound') cands.push(...(await archiveCandidates()), ...(await commonsCandidates()))
  if (SOURCE !== 'keyless' && key) cands.push(...(await freesoundCandidates(key)))
  say(`${cands.length} candidate recordings`)

  const cuts: Cut[] = []
  const rejected = new Map<string, number>()
  for (const [i, c] of cands.entries()) {
    let pcm: Float32Array
    try {
      pcm = await decode(await download(c.url))
    } catch (e) {
      say(`  skip ${c.title}: ${(e as Error).message.split('\n')[0]}`)
      continue
    }
    const events = findSoundEvents(pcm, SFX_RATE, { gapS: c.kinds.some((k) => FLOWING.includes(k) || k === 'riser' || k === 'paper') ? 0.2 : 0.08 })
    let kept = 0
    for (const ev of events.slice(0, 40)) {
      for (const kind of c.kinds) {
        const raw = cutFor(kind, pcm, ev, !!c.reverse)
        if (!raw || raw.length < SFX_RATE * 0.01) continue
        const shape = describeSfx(raw, SFX_RATE)
        const fit = sfxKindFit(kind, shape)
        if ('reason' in fit) {
          const r = `${kind}: ${fit.reason.replace(/[\d.]+/g, '#')}`
          rejected.set(r, (rejected.get(r) ?? 0) + 1)
          continue
        }
        kept++
        const bonus = c.licence === 'CC0-1.0' || c.licence === 'PD' ? 0.1 : 0
        cuts.push({ cand: c, event: `${c.url}#${c.reverse ? 'r' : ''}${ev.start}`, kind, samples: finish(raw, kind), score: fit.score + bonus, durationS: shape.durationS, centroidHz: shape.centroidHz, attackS: shape.attackS })
      }
    }
    say(`  [${i + 1}/${cands.length}] ${c.title.slice(0, 70)} (${c.licence}${c.reverse ? ', reversed' : ''}): ${events.length} events, ${kept} usable cuts`)
  }

  // choose: best first, one kind per cut event, at most two per recording and kind, no near-twins
  cuts.sort((a, b) => b.score - a.score)
  const chosen: Cut[] = []
  const usedEvent = new Set<string>()
  for (const c of cuts) {
    const same = chosen.filter((x) => x.kind === c.kind)
    if (same.length >= PER_KIND || usedEvent.has(c.event)) continue
    if (same.filter((x) => x.cand.url === c.cand.url).length >= MAX_PER_FILE) continue
    if (same.some((x) => Math.abs(x.durationS / c.durationS - 1) < 0.04 && Math.abs(x.centroidHz / c.centroidHz - 1) < 0.04)) continue
    chosen.push(c)
    usedEvent.add(c.event)
  }
  await writeLibrary(chosen, rejected)
}

async function encode(samples: Float32Array, out: string): Promise<void> {
  const tmp = path.join(CACHE, 'tmp.wav')
  await mkdir(CACHE, { recursive: true })
  await writeWav(tmp, samples, SFX_RATE, 1, 32)
  await execFileP('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '5', '-ar', String(SFX_RATE), '-ac', '1', out])
}

async function writeLibrary(chosen: Cut[], rejected: Map<string, number>): Promise<void> {
  // the previous library's files go first (only the ones it named), then the new set is written
  const old = existsSync(path.join(SFX_DIR, 'library.json')) ? SfxLibraryFile.parse(JSON.parse(await readFile(path.join(SFX_DIR, 'library.json'), 'utf8'))) : undefined
  for (const s of old?.sounds ?? []) await rm(path.join(SFX_DIR, s.file), { force: true })
  await mkdir(REPORT, { recursive: true })
  const sounds: SfxLibrarySound[] = []
  const lines: string[] = ['# Sound-effects library: listening report', '', `Built ${new Date().toISOString().slice(0, 10)} by scripts/sfx-library-fetch.ts (source: ${SOURCE}).`, '']
  for (const kind of SFX_KINDS) {
    const mine = chosen.filter((c) => c.kind === kind).sort((a, b) => a.durationS - b.durationS)
    const preview: Float32Array[] = []
    lines.push(`## ${kind} (${mine.length})`, '', '| id | length | centroid | attack | licence | from |', '|---|---|---|---|---|---|')
    for (const [n, c] of mine.entries()) {
      const id = `${kind}-${n + 1}`
      const file = `${id}.ogg`
      await encode(c.samples, path.join(SFX_DIR, file))
      const back = await decode(path.join(SFX_DIR, file))
      preview.push(back, new Float32Array(Math.round(SFX_RATE * 0.45)))
      const title = `${c.cand.title}${c.cand.reverse ? ' (reversed)' : ''}`
      sounds.push({
        id, kind, file, licence: c.cand.licence, author: c.cand.author, title, source: c.cand.page,
        credit: `${c.cand.title} — ${c.cand.author}, ${LICENCE_LABEL[c.cand.licence]}, via ${c.cand.via}${c.cand.reverse ? ' (cut, reversed)' : ' (cut)'}`,
        peakS: Number(keyMomentS(back, kind).toFixed(4)), durationS: Number((back.length / SFX_RATE).toFixed(3)), centroidHz: Math.round(c.centroidHz)
      })
      lines.push(`| ${id} | ${c.durationS.toFixed(2)} s | ${Math.round(c.centroidHz)} Hz | ${(c.attackS * 1000).toFixed(0)} ms | ${c.cand.licence} | ${title.slice(0, 60)} |`)
    }
    if (preview.length) {
      const all = new Float32Array(preview.reduce((n, p) => n + p.length, 0))
      let at = 0
      for (const p of preview) all.set(p, (at += p.length) - p.length)
      await writeWav(path.join(REPORT, `${kind}.wav`), all, SFX_RATE, 1)
    }
    lines.push('')
  }
  lines.push('## Refused cuts (kind: reason, count)', '', ...[...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([r, n]) => `- ${r}: ${n}`), '')
  const lib = SfxLibraryFile.parse({ version: 1, sounds })
  await writeFile(path.join(SFX_DIR, 'library.json'), JSON.stringify(lib, null, 2) + '\n')
  await writeFile(path.join(SFX_DIR, 'CREDITS.md'), credits(sounds))
  let bytes = 0
  for (const f of await readdir(SFX_DIR)) bytes += (await stat(path.join(SFX_DIR, f))).size
  lines.splice(3, 0, `${sounds.length} sounds, resources/sfx/ is ${(bytes / 1024).toFixed(0)} KB.`, '')
  await writeFile(path.join(REPORT, 'report.md'), lines.join('\n'))
  const short = SFX_KINDS.filter((k) => sounds.filter((s) => s.kind === k).length < 4)
  say(`${sounds.length} sounds written (${(bytes / 1024).toFixed(0)} KB); report in ${REPORT}`)
  for (const k of SFX_KINDS) say(`  ${k.padEnd(12)} ${sounds.filter((s) => s.kind === k).length}`)
  if (short.length) say(`TOO FEW SOUNDS: ${short.join(', ')}`)
  if (bytes > BUDGET_BYTES) say('OVER THE 4 MB BUDGET')
  process.exitCode = short.length || bytes > BUDGET_BYTES ? 1 : 0
}

function credits(sounds: SfxLibrarySound[]): string {
  const row = (s: SfxLibrarySound): string => `- \`${s.file}\` (${s.kind}): « ${s.title} » by ${s.author}, [${LICENCE_LABEL[s.licence]}](${LICENCE_LINK[s.licence]}), ${s.source}`
  const by = sounds.filter((s) => s.licence.startsWith('CC-BY'))
  const free = sounds.filter((s) => !s.licence.startsWith('CC-BY'))
  return [
    '# Sound-effects credits',
    '',
    'Written by `scripts/sfx-library-fetch.ts`; do not edit by hand. Every sound was cut from the recording named, faded and',
    'peak-normalised (risers marked « reversed » are played backwards). A film that uses a CC BY sound credits it with its line',
    'from `library.json` (`credit`).',
    '',
    `## CC BY (attribution required) — ${by.length}`,
    '',
    ...by.map(row),
    '',
    `## CC0 / public domain (no attribution required, listed for the record) — ${free.length}`,
    '',
    ...free.map(row),
    ''
  ].join('\n')
}

await main()
