// `node --import ./scripts/ts-resolve.mjs scripts/media-proof.ts [--out <dir>] [--youtube] [--excerpt] [--count 6]`
// REAL network, FREE sources only (keyless archives + the published demo keys of Europeana and Smithsonian; keys already in the
// environment are used too: EUROPEANA_API_KEY, SMITHSONIAN_API_KEY, PIXABAY_API_KEY, FREESOUND_API_KEY, PEXELS_API_KEY…).
// Runs the 5 benchmark queries of research note technos-medias-2026-11 (old repository) and writes, per query, in <out>/<NN-slug>/:
//   sheet.jpg (contact sheet of the previews), sheet.html (labels, licences, links), results.json; plus <out>/summary.json.
// `--youtube` also asks yt-dlp for public YouTube excerpts (search only); `--excerpt` downloads one 6-second excerpt as proof.
// Exit 0 = every query returned at least 3 candidates and none threw. Cost: 0 $. Not part of `npm test`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROVIDERS, FileCache, creditsText, publishBlockers, searchMedia, withLocalBank, downloadExcerpt, type MediaCandidate, type MediaKind } from '../src/engine/sourcing'

const args = process.argv.slice(2)
const flag = (n: string): string | undefined => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
const out = flag('out') ?? path.join(process.env.ATELIER_INPUTS ?? path.join(os.tmpdir(), 'atelier-inputs'), 'tests-2026-11', 'medias')
const count = Number(flag('count') ?? 6)
const withYoutube = args.includes('--youtube')
const doExcerpt = args.includes('--excerpt')

// `variants` are what `claudeExpander` would propose (the archive's own words); the script passes them by hand so it costs nothing
const QUERIES: Array<{ q: string; kinds: MediaKind[]; variants?: string[] }> = [
  { q: 'Swiss border 1940', kinds: ['image', 'video'], variants: ['Grenzbesetzung 1939', 'Swiss army mobilization 1939', 'Switzerland soldiers border'] },
  { q: 'Wall Street crash 1929', kinds: ['image', 'video'] },
  { q: 'Paris street 1960s', kinds: ['image', 'video'] },
  { q: 'air conditioner outdoor unit', kinds: ['image', 'video'] },
  { q: 'crowd cheering', kinds: ['image', 'video', 'sfx'] }
]

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

mkdirSync(out, { recursive: true })
const bank = path.join(out, 'sfx-bank')
if (!existsSync(path.join(bank, 'bank.json'))) {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'make-sfx-bank.mjs'), bank], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('could not build the local sound bank')
}

const env = (n: string): string | undefined => process.env[n] || undefined
const cache = new FileCache(path.join(out, '.cache'))

async function fetchThumb(url: string, file: string, attempt = 0): Promise<boolean> {
  if (!url.startsWith('http')) return false
  await new Promise((r) => setTimeout(r, 350)) // polite: the archives throttle a burst of downloads
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Atelier/1.0 (https://github.com/CharlieJourdan/atelier-core; media proof)' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
    if (!res.ok) return attempt < 1 && res.status === 429 ? (await new Promise((r) => setTimeout(r, 3000)), fetchThumb(url, file, attempt + 1)) : false
    const raw = file + '.raw'
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()).subarray(0, 8 * 1024 * 1024))
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x202020', file], { encoding: 'utf8' })
    return r.status === 0 && existsSync(file)
  } catch {
    return false
  }
}

const summary: Array<Record<string, unknown>> = []
let failed = false
for (const [n, { q, kinds, variants }] of QUERIES.entries()) {
  const dir = path.join(out, `${String(n + 1).padStart(2, '0')}-${slug(q)}`)
  mkdirSync(dir, { recursive: true })
  const started = Date.now()
  const res = await searchMedia(
    q,
    { kinds, count, allowDemoKeys: true, ...(variants ? { variants } : {}), cache, orientation: 'landscape', ...(withYoutube ? { providers: [...PROVIDERS.filter((p) => !p.optIn).map((p) => p.id), 'youtube-excerpt'] } : {}), ...(kinds.includes('sfx') ? { maxDurationS: 30 } : {}) },
    { providers: withLocalBank(bank), secrets: env, providerTimeoutMs: 40_000 }
  )
  const ms = Date.now() - started
  // thumbnails
  const tiles: Array<{ c: MediaCandidate; file?: string }> = []
  for (const c of res.candidates) {
    const file = path.join(dir, `t${String(tiles.length + 1).padStart(2, '0')}.jpg`)
    tiles.push({ c, file: c.kind !== 'sfx' && c.kind !== 'music' && (await fetchThumb(c.previewUrl, file)) ? file : undefined })
  }
  const shown = tiles.filter((t) => t.file)
  if (shown.length) {
    // number the tiles (label = position in the list) and tile them 4 per row
    const labelled: string[] = []
    for (const [i, t] of shown.entries()) {
      const lab = path.join(dir, `l${String(i + 1).padStart(2, '0')}.jpg`)
      const id = tiles.indexOf(t) + 1
      const text = `${id} ${t.c.provider}`.replace(/[^A-Za-z0-9 _-]/g, '')
      const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', t.file!, '-vf', `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${text}':fontcolor=white:fontsize=16:box=1:boxcolor=black@0.7:x=4:y=4`, lab], { encoding: 'utf8' })
      if (r.status === 0) labelled.push(lab)
    }
    if (labelled.length) {
      // tiles 4 per row: xstack (the tile filter drops frames when the grid is not full)
      const layout = labelled.map((_, i) => `${(i % 4) * 320}_${Math.floor(i / 4) * 180}`).join('|')
      const inputs = labelled.flatMap((f) => ['-i', f])
      const graph = labelled.length === 1 ? 'null' : `xstack=inputs=${labelled.length}:layout=${layout}:fill=black`
      spawnSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-frames:v', '1', path.join(dir, 'sheet.jpg')], { encoding: 'utf8' })
    }
  }
  writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ query: q, ms, ...res }, null, 2))
  const rows = tiles
    .map(({ c, file }, i) => {
      const thumb = file ? `<img src="${esc(path.basename(file))}" width="320">` : c.kind === 'sfx' || c.kind === 'music' ? `<audio controls src="${esc(c.previewUrl)}"></audio>` : '(no preview)'
      return `<tr><td>${i + 1}</td><td>${thumb}</td><td><b>${esc(c.title)}</b><br>${c.kind} · ${esc(c.provider)} · ${esc(c.licence.short)} (${c.licence.status})${c.review === 'human-review' ? ' · <b>HUMAN REVIEW</b>' : ''}<br>${c.durationS ? c.durationS + ' s · ' : ''}${c.width ? c.width + '×' + c.height + ' · ' : ''}score ${c.score}<br><a href="${esc(c.pageUrl)}">page</a> · <a href="${esc(c.fileUrl)}">file</a></td></tr>`
    })
    .join('\n')
  writeFileSync(path.join(dir, 'sheet.html'), `<!doctype html><meta charset="utf-8"><title>${esc(q)}</title><style>body{font:14px sans-serif;background:#181818;color:#ddd}td{padding:6px;vertical-align:top}a{color:#8cf}</style><h1>${esc(q)}</h1><p>${res.candidates.length} candidates in ${ms} ms, ${res.costUsd} $</p><table>${rows}</table>`)

  const byKind = Object.fromEntries(kinds.map((k) => [k, res.candidates.filter((c) => c.kind === k).length]))
  console.log(`\n« ${q} » — ${res.candidates.length} candidates in ${ms} ms, cost ${res.costUsd} $, by kind ${JSON.stringify(byKind)}`)
  console.log('  provider timings (ms):', JSON.stringify(res.timingsMs))
  for (const e of res.errors) console.log(`  ! ${e.provider}: ${e.message}`)
  for (const s of res.skipped) console.log(`  - skipped ${s.provider}: ${s.reason}${s.detail ? ' (' + s.detail + ')' : ''}`)
  for (const [i, c] of res.candidates.entries()) console.log(`  ${i + 1}. [${c.kind}/${c.provider}] ${c.title.slice(0, 70)} | ${c.licence.short} | ${c.review}`)
  const credits = creditsText(res.candidates)
  if (credits) console.log(`  credits needed for ${credits.split('\n').length} of them; human review for ${publishBlockers(res.candidates).length}`)
  if (res.candidates.length < 3) {
    console.log('  FAIL: fewer than 3 candidates')
    failed = true
  }
  summary.push({ query: q, ms, byKind, errors: res.errors, timingsMs: res.timingsMs, providersWithHits: [...new Set(res.candidates.map((c) => c.provider))] })
}

if (doExcerpt) {
  const t0 = Date.now()
  const yt = await searchMedia('Wall Street crash 1929 newsreel', { kinds: ['video'], count: 3, providers: ['youtube-excerpt'] }, {})
  const first = yt.candidates[0]
  if (!first) {
    console.log('\nyt-dlp: no YouTube result', yt.errors)
    failed = true
  } else {
    const r = await downloadExcerpt(first.fileUrl, { startS: 10, endS: 16 }, path.join(out, 'excerpt'))
    console.log(`\nyt-dlp excerpt of « ${first.title.slice(0, 60)} » [${first.licence.status}, ${first.review}] 10 s–16 s → ${r.file} (${Date.now() - t0} ms)`)
    summary.push({ excerpt: r.file, from: first.pageUrl, status: first.licence.status, review: first.review })
  }
}

writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\n${failed ? 'FAILED' : 'OK'} — contact sheets in ${out}`)
process.exit(failed ? 1 : 0)
