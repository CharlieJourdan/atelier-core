// `npm run previews:options` — the before / after previews of the options a user may pick (pipeline-ui, Charlie 01/11: « quand
// il est marqué chapitre à l'écran, je ne sais pas à quoi ça ressemble… mettre différence avant / après »). The engine renders
// the base pipeline `avatar@1` on the fakes (free, offline: drawn pictures and presenter, the system voice; cuts, captions,
// chapter marks, the sponsor's card and QR code, music and render are the real code) once with every option on, then once per
// option with only that option changed; a 3-second loop of each film at the moment the option shows (480 px, small) is kept
// in resources/option-previews (files + manifest.json), read through the saved previews (`previews.options`). Music keeps its
// sound. Needs the system ffmpeg. Options: --out <dir> (default resources/option-previews); --only <optionId> remakes the loops of
// that option alone and keeps every other file and manifest item as it is.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FULL_FFMPEG_HINT, systemMediaService } from '../src/engine/media/tools'
import { runAvatarBaseDemo, type AvatarBaseDemoOptions, type AvatarBaseDemoResult } from '../src/engine/pipelines/avatar-base-demo'
import { BASE_STYLES } from '../src/main/production/styles/seeds'
import { OPTION_PREVIEWS, optionPreviewKey } from '../src/shared/option-previews'
import { PREVIEWS_SCHEMA, type PreviewItem, type PreviewManifest } from '../src/shared/previews'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : null
}
const OUT = path.resolve(arg('out') ?? path.join(ROOT, 'resources', 'option-previews'))
const ONLY = arg('only')
const out = (s: string): void => void process.stdout.write(s + '\n')
const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run previews:options ».`)
  process.exit(1)
}
const signal = new AbortController().signal
const tmp = path.join(os.tmpdir(), `atelier-option-previews-${process.pid}`)
const LOOP_S = 3

// the channel's sponsor, its mention early in the film so that a short film shows it
const SPONSOR = JSON.stringify({ name: 'Poêlo Clean', pitch: 'Le spray au bicarbonate qui décape sans rayer.', link: 'https://poeloclean.example/atelier', rule: { windowS: [12, 30], seconds: 6, reminder: false } })
/** The options that change the avatar film. */
// the loops cut from our real videos (`real`, avatar-reglages-voix: the fakes cannot show them) are never remade nor deleted
const FILM_OPTIONS = OPTION_PREVIEWS.filter((p) => !p.real)
const REAL = OPTION_PREVIEWS.filter((p) => p.real).map((p) => `option:${p.option.toLowerCase()}:`)
/** Every previewed option on its « after » value: the film the « before » films differ from by one option each. */
const ALL_ON = Object.fromEntries(FILM_OPTIONS.map((p) => [p.option, p.after]))

async function film(name: string, options: Record<string, string | boolean>): Promise<AvatarBaseDemoResult> {
  const dataDir = path.join(tmp, name)
  mkdirSync(dataDir, { recursive: true })
  const o: AvatarBaseDemoOptions = {
    dataDir,
    resourcesDir: path.join(ROOT, 'resources'),
    minutes: 0.75,
    options,
    sponsor: SPONSOR,
    mix: { presenter: 0.45, imageAi: 0.34 },
    settings: { 'director.plan': { layouts: ['full', 'split', 'pip'] }, 'script.write': { chapters: 3 } },
    styles: Object.fromEntries(BASE_STYLES.map((s) => [s.id, s]))
  }
  const r = await runAvatarBaseDemo(o)
  if (r.status !== 'done' || !r.video) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.errors)}`)
  out(`  ${name}: ${r.video}`)
  return r
}

/** Where an option shows in a film: the chapter mark, the sponsor's card, a presenter shot, the voice. */
function momentOf(option: string, r: AvatarBaseDemoResult): number {
  if (option === 'chapters') {
    const mark = ((r.chapters.value ?? []) as { startS: number }[])[0]
    if (mark) return Math.max(0, mark.startS - 0.3)
  }
  if (option === 'sponsor') {
    const w = ((r.sponsor.meta.windows ?? []) as { startS: number }[])[0]
    if (w) return w.startS + 0.4
  }
  // captions and music: a moment of speech after the hook
  return 6
}

/** The full-screen presenter shots away from the sponsor's card: where « recadrages » may show (the one most changed wins). */
function presenterMoments(r: AvatarBaseDemoResult): number[] {
  const windows = (r.sponsor.meta.windows ?? []) as { startS: number; endS: number }[]
  return (r.plan?.shots ?? [])
    .filter((x) => x.kind === 'avatar' && (x.layout ?? 'full') === 'full' && x.endFrame - x.startFrame >= 45)
    .filter((x) => !windows.some((w) => x.startFrame / 30 < w.endS + 3 && x.endFrame / 30 > w.startS))
    .map((x) => x.startFrame / 30 + 0.2)
}

/** How alike two films are at one moment (PSNR in dB, higher is closer). */
async function likeness(a: string, b: string, at: number): Promise<number> {
  const { stderr } = await media!.run('ffmpeg', ['-v', 'info', '-ss', at.toFixed(2), '-i', a, '-ss', at.toFixed(2), '-i', b, '-frames:v', '1', '-lavfi', 'psnr', '-f', 'null', '-'], { signal })
  const db = /average:([\d.]+|inf)/.exec(stderr)?.[1]
  return db === undefined || db === 'inf' ? Infinity : Number(db)
}

async function loop(video: string, at: number, file: string, sound: boolean): Promise<void> {
  const audio = sound ? ['-c:a', 'aac', '-b:a', '64k', '-ac', '1'] : ['-an']
  await media!.run('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-t', String(LOOP_S), '-i', video, '-vf', 'scale=480:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', file], { signal })
}

const itemOf = (key: string, label: string, dir: string): PreviewItem => ({ key, kind: 'option', family: 'clip', label, source: 'demo', madeAt: new Date().toISOString().slice(0, 10), files: [{ ref: `${dir}/loop.mp4`, type: 'video' }] })
const dirOf = (key: string): string => key.replace(/[^a-z0-9.-]+/g, '-')

/** The before / after loops of the options that change the avatar film (the base pipeline on the fakes); `only` keeps one option. */
async function filmItems(only: string | null): Promise<PreviewItem[]> {
  const on = await film('all-on', ALL_ON)
  const items: PreviewItem[] = []
  for (const p of FILM_OPTIONS) {
    if (only && p.option.toLowerCase() !== only.toLowerCase()) continue
    const before = await film(`before-${p.option}`, { ...ALL_ON, [p.option]: p.before })
    // the moment is read on the film where the option shows (the presenter's framing: where the two films differ most)
    let at = momentOf(p.option, on)
    if (p.option === 'presenterShots') {
      let best = Infinity
      for (const m of presenterMoments(on)) {
        const db = await likeness(before.video as string, on.video as string, m + 1)
        if (db < best) [best, at] = [db, m]
      }
    }
    for (const [side, r] of [['before', before], ['after', on]] as const) {
      const value = side === 'before' ? p.before : p.after
      const key = optionPreviewKey(p.option, value)
      const dir = dirOf(key)
      mkdirSync(path.join(OUT, dir), { recursive: true })
      await loop(r.video as string, at, path.join(OUT, dir, 'loop.mp4'), p.sound)
      items.push(itemOf(key, `${p.option} = ${String(value)}`, dir))
      out(`${key}: ${at.toFixed(1)} s`)
    }
  }
  return items
}

// ---- the run --------------------------------------------------------------------------------------------------------------------------------------

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
out('Atelier option previews — films on the fakes')
let items: PreviewItem[]
if (ONLY) {
  // one option remade: every other item of the manifest, and its files, stay as they are
  const known = FILM_OPTIONS.map((p) => p.option)
  if (!known.some((o) => o.toLowerCase() === ONLY.toLowerCase())) {
    out(`--only ${ONLY}: unknown option (${known.join(', ')})`)
    process.exit(1)
  }
  const prefix = `option:${ONLY.toLowerCase()}:`
  const kept = (JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as PreviewManifest).items.filter((i) => !i.key.startsWith(prefix))
  const made = await filmItems(ONLY)
  items = [...kept, ...made]
} else {
  const real = (JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as PreviewManifest).items.filter((i) => REAL.some((r) => i.key.startsWith(r)))
  const keep = new Set(real.flatMap((i) => i.files.map((f) => f.ref.split('/')[0] as string)))
  for (const d of readdirSync(OUT)) if (!keep.has(d)) rmSync(path.join(OUT, d), { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  items = [...real, ...(await filmItems(null))]
  writeFileSync(
    path.join(OUT, 'README.md'),
    '# Option previews (made on the fakes)\n\nMade by `npm run previews:options` (pipeline-ui): for each option a user may pick, a 3-second loop of the base pipeline `avatar@1` ' +
      'rendered by the engine on the fakes with the option off (« avant ») and on (« après »), at the moment it shows. Free to look at.\n'
  )
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ schema: PREVIEWS_SCHEMA, items } satisfies PreviewManifest, null, 2) + '\n')
rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
out(`${items.length} aperçus dans ${path.relative(ROOT, OUT)}`)
